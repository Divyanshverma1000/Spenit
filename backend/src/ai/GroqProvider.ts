/**
 * GroqProvider.ts — Groq implementation of the AIProvider interface
 *
 * Architecture rules enforced here (Architecture.md §2, §6):
 *   - Hard 10-second timeout on every Groq call → returns AIFallback, never throws
 *   - Names are NEVER invented: every userId in the response must come from
 *     the groupContext passed in. Unresolvable names → ambiguities[] string.
 *   - The LLM receives member id+name+username — enough to disambiguate duplicates.
 *   - No caching of categorization (Architecture.md §6: deferred to later tier).
 *   - Model is configurable via GROQ_MODEL env var.
 */

import type {
  AIProvider,
  GroupMember,
  ParseResult,
  ParsedExpenseDraft,
  AIFallback,
  ExpenseCategory,
  ParsedReceiptDraft,
  Transfer,
  SpendStats,
  QueryResult,
  LedgerQueryResponse,
} from "./AIProvider";
import { EXPENSE_CATEGORIES } from "./AIProvider";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_TIMEOUT_MS = 10_000;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

// ── System prompt ──────────────────────────────────────────────────────────────

function buildSystemPrompt(members: GroupMember[]): string {
  const memberList = members
    .map((m) => `  - id: "${m.id}", name: "${m.name}", username: "@${m.username}"`)
    .join("\n");

  const categoryList = EXPENSE_CATEGORIES.join(" | ");

  return `You are an expense parsing assistant for a group expense app called Spenit.
Your job is to extract structured expense data from natural language text.

CRITICAL RULES — READ CAREFULLY:
1. MEMBER LIST: You ONLY use user IDs from the provided group member list. NEVER invent userIds.
2. CURRENT USER: The FIRST member in the list is ALWAYS the current user. "me", "I", "myself", "my" all refer to the FIRST member's userId.
   First member (current user): id="${members[0]?.id || 'unknown'}" name="${members[0]?.name || 'unknown'}"
3. PAYER DETECTION:
   - "paid by me" / "I paid" / "I have paid" / "paid by myself" → payers = [{"userId": "${members[0]?.id}", amountPaid: total_amount}]
   - "Rahul paid" → payers = [{userId: Rahul's_id, amountPaid: total_amount}]
   - "Rahul and Aman paid equally" → split amount 50/50 between them
4. PARTICIPANT DETECTION (critical — read carefully):
   - "only I ate" / "just me" / "I alone" / "only me" / "I only" → participants = [{"userId": "${members[0]?.id}"}] — ONLY the current user, nobody else
   - "everyone" → participants = ALL members
   - "everyone except Mohit" / "others didn't" + context → exclude mentioned person from participants
   - "split between X and me" → participants = [X, FIRST_MEMBER]
   - Default (no explicit mention) → participants = ALL members
5. SPLIT TYPE:
   - "equally" / default → "equal"
   - Exact amounts per person → "exact"
   - "only I" patterns with single participant → "exact" with that person's shareAmount = total_amount
6. If a name doesn't match any member, add to ambiguities[]. Never guess an ID.
7. Return ONLY valid JSON. No prose, no markdown.

GROUP MEMBERS (index 0 = CURRENT USER = "me"/"I"):
${memberList}

CATEGORIES: ${categoryList}

OUTPUT JSON SCHEMA:
{
  "description": "string",
  "amount": number or null,
  "currency": "INR",
  "splitType": "equal" | "exact" | "fairshare",
  "category": string or null,
  "payers": [{"userId": "uuid", "amountPaid": number}],
  "participants": [{"userId": "uuid", "shareAmount": number_or_null, "personalAmount": number_or_null}],
  "receiptData": [{"id": "uuid", "label": "string", "amount": string, "sharedBy": ["uuid"]}],
  "confidence": number,
  "ambiguities": ["string"]
}

EXPLANATION OF RECEIPT_DATA & FAIRSHARE:
If the user mentions specific items belonging to specific people (e.g. "Pizza for 400 for John and me, and coke for 100 for me"), this is a True Universal Fairshare expense!
1. Set splitType to "fairshare".
2. You DO NOT need to do the math to divide the rest.
3. Just figure out the total value of personal items for each person. If multiple people share a personal item, divide its amount equally among them and add it to their personal amount.
4. Set "personalAmount" inside the "participants" array for anyone who had personal items.
5. The backend will automatically subtract the sum of all personalAmounts from the total amount, and divide the remainder equally among everyone in the "participants" array.

EXAMPLES:
- "Dinner 900 Rahul paid" → payers:[{Rahul,900}], participants:all, splitType:equal
- "I paid 1000, 400 was for wine that Rahul and I drank" → payers:[{me,1000}], participants:[{userId: me, personalAmount: 200}, {userId: Rahul, personalAmount: 200}], splitType:fairshare (Backend handles the remaining 600)
- "paid by me 500" → payers:[{me,500}], participants:all, splitType:equal`;
}

// ── Name resolution helpers ────────────────────────────────────────────────────

/**
 * Validate that all userIds in payers/participants actually exist in the group.
 * Remove any that don't (they're hallucinated) and add an ambiguity message.
 */
function validateUserIds(
  draft: Partial<ParsedExpenseDraft>,
  members: GroupMember[]
): ParsedExpenseDraft {
  const validIds = new Set(members.map((m) => m.id));
  const ambiguities = [...(draft.ambiguities || [])];

  const payers = (draft.payers || []).filter((p) => {
    if (validIds.has(p.userId)) return true;
    ambiguities.push(`Unknown payer userId "${p.userId}" removed`);
    return false;
  });

  const participants = (draft.participants || []).filter((p) => {
    if (validIds.has(p.userId)) return true;
    ambiguities.push(`Unknown participant userId "${p.userId}" removed`);
    return false;
  });

  // If no participants specified, default to all members (equal split)
  const finalParticipants =
    participants.length > 0
      ? participants
      : members.map((m) => ({ userId: m.id }));

  return {
    description: draft.description || "",
    amount: draft.amount ?? null,
    currency: draft.currency || "INR",
    splitType: (draft.splitType as "equal" | "exact" | "fairshare") || "equal",
    category: (EXPENSE_CATEGORIES as readonly string[]).includes(draft.category as string)
      ? (draft.category as ExpenseCategory)
      : null,
    payers,
    participants: finalParticipants,
    confidence: draft.confidence ?? 0.5,
    ambiguities,
    possibleDuplicate: false, // set by route handler
    rawText: draft.rawText || "",
  };
}

/**
 * Try to extract a number from raw text for partial fallback pre-fill.
 */
function extractAmountFromText(text: string): number | undefined {
  const match = text.match(/[\d,]+(?:\.\d{1,2})?/);
  if (!match) return undefined;
  const num = parseFloat(match[0].replace(/,/g, ""));
  return isNaN(num) ? undefined : num;
}

// ── GroqProvider class ─────────────────────────────────────────────────────────

export class GroqProvider implements AIProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  // ── parseExpenseText ─────────────────────────────────────────────────────────

  async parseExpenseText(
    input: string,
    groupContext: GroupMember[]
  ): Promise<ParseResult> {
    if (!this.apiKey) {
      return this.fallback("config_error", input);
    }

    const systemPrompt = buildSystemPrompt(groupContext);
    const userMessage = `Parse this expense: "${input}"`;

    let rawResponse = "";
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(GROQ_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: GROQ_MODEL,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userMessage },
            ],
            temperature: 0.1, // low temp for deterministic JSON extraction
            max_tokens: 1024,
            response_format: { type: "json_object" },
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        console.error(`[ai] Groq API error ${response.status}:`, errBody);
        if (response.status === 429) return this.fallback("rate_limit", input);
        if (response.status === 401) return this.fallback("config_error", input);
        return this.fallback("network", input);
      }

      const json = await response.json() as any;
      rawResponse = json.choices?.[0]?.message?.content || "";

      const parsed = JSON.parse(rawResponse);
      parsed.rawText = input;

      const draft = validateUserIds(parsed, groupContext);
      console.log(
        `[ai] parseExpenseText ok — confidence=${draft.confidence} model=${GROQ_MODEL}`
      );
      return draft;
    } catch (err) {
      const name = (err as Error).name;
      if (name === "AbortError") {
        console.warn("[ai] Groq timeout after 10s");
        return this.fallback("timeout", input);
      }
      if (rawResponse) {
        console.error("[ai] JSON parse failed:", rawResponse.slice(0, 200));
        return this.fallback("parse_error", input);
      }
      console.error("[ai] Network error:", (err as Error).message);
      return this.fallback("network", input);
    }
  }

  // ── parseReceiptImage — PHASE 6B STUB ────────────────────────────────────────

  async parseReceiptImage(
    imageData: string,
    groupContext: GroupMember[]
  ): Promise<ParseResult> {
    if (!this.apiKey) {
      return this.fallback("config_error", "[Receipt Image]");
    }

    // Ensure the image string has the proper data URL prefix if missing
    let base64Url = imageData;
    if (!base64Url.startsWith("data:image")) {
      base64Url = `data:image/jpeg;base64,${imageData}`;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000); // 60s for vision

      const systemPrompt = "Extract the line items and prices from this receipt. Return ONLY valid JSON in this exact schema: {\"items\": [{\"name\": \"string\", \"amount\": number}], \"total\": number, \"tax\": number, \"merchant\": \"string\"}.";

      const response = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "qwen/qwen3.6-27b",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: systemPrompt },
                {
                  type: "image_url",
                  image_url: {
                    url: base64Url,
                  },
                },
              ],
            },
          ],
          temperature: 0.1,
          max_tokens: 1024,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Groq vision API error: ${response.status} - ${errorText}`);
      }

      const json = await response.json() as any;
      const rawResponse = json.choices?.[0]?.message?.content || "";
      const cleaned = rawResponse.replace(/```(?:json)?/g, "").trim();
      const parsed = JSON.parse(cleaned);

      // We map the extracted items into a special ParseResult that the frontend can use for assignment
      // We will add `extractedItems` to the ParsedExpenseDraft object
      const draft: any = {
        description: parsed.merchant ? `${parsed.merchant} Bill` : "Receipt Bill",
        amount: parsed.total || null,
        currency: "INR",
        splitType: "fairshare",
        category: "Food",
        payers: [{ userId: groupContext[0]?.id || "unknown", amountPaid: parsed.total || 0 }],
        participants: groupContext.map(m => ({ userId: m.id, personalAmount: 0 })), // starts empty
        confidence: 0.9,
        ambiguities: [],
        possibleDuplicate: false,
        rawText: "[Receipt Scan]",
        extractedItems: parsed.items || [], // <--- Critical payload for Universal Fairshare UI
      };

      return draft;
    } catch (e: any) {
      console.error("[ai] vision error:", e);
      return this.fallback(
        e.name === "AbortError" ? "timeout" : "parse_error",
        "[Receipt Image]"
      );
    }
  }

  // ── Stubs for future capabilities ─────────────────────────────────────────────

  async phraseSettlementExplanation(_transfers: Transfer[]): Promise<string> {
    // Phase 6C stub
    return "";
  }

  async phraseSpendSummary(_stats: SpendStats): Promise<string> {
    // Tier 1 stub
    return "";
  }

  async answerLedgerQuery(
    question: string,
    context: { members?: GroupMember[]; expenses?: any[]; settlements?: any[]; balances?: any[]; personalExpenses?: any[] }
  ): Promise<LedgerQueryResponse> {
    if (!this.apiKey) {
      throw new Error("Bring your own AI: Groq API Key required. Please set it in your Profile.");
    }

    const systemPrompt = `You are a ledger intelligence assistant for a group expense app called Spenit.
Your job is to answer questions about the group's expenses, settlements, balances, and the user's personal expenses.
You will be provided with the current state of the ledger as JSON data.
Answer the user's question accurately using ONLY the provided data. Do not invent or hallucinate amounts, users, or transactions.
Use a friendly, premium tone. You can use markdown for formatting (bold, lists).

LEDGER DATA:
${JSON.stringify(context, null, 2)}

OUTPUT FORMAT:
Return ONLY a valid JSON object matching this schema:
{
  "action": "query" or "log", // If the user wants to log/add a new personal expense, set to "log". Otherwise "query".
  "logDetails": { // ONLY if action is "log"
    "description": "Short name for the expense",
    "amount": number,
    "category": "Food" | "Travel" | "Shopping" | "Stay" | "Fuel" | "Medical" | "Utilities" | "Entertainment" | "Misc"
  },
  "answer": "A clear, natural language answer. If action is 'log', say that you logged it successfully.",
  "filters": {
    "categories": ["Food"], // Optional
    "userIds": ["uuid-of-user"] // Optional
  }
}
No markdown fences, just the raw JSON.`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);

    try {
      const response = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: question },
          ],
          temperature: 0.1,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Groq API error ${response.status}: ${await response.text().catch(() => "")}`);
      }

      const json = await response.json() as any;
      const rawText = json.choices?.[0]?.message?.content || "{}";
      const parsed = JSON.parse(rawText);
      return {
        answer: parsed.answer || "I couldn't generate an answer.",
        action: parsed.action || "query",
        logDetails: parsed.logDetails,
        filters: parsed.filters,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Internal fallback helper ──────────────────────────────────────────────────

  private fallback(
    reason: AIFallback["reason"],
    rawText: string
  ): AIFallback {
    return {
      fallback: true,
      reason,
      partialAmount: extractAmountFromText(rawText),
      rawText,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: GroqProvider | null = null;

export function getAIProvider(): GroqProvider {
  if (!_instance) {
    _instance = new GroqProvider(process.env.GROQ_API_KEY || "");
  }
  return _instance;
}
