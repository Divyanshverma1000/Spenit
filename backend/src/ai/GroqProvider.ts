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
  "participants": [{"userId": "uuid", "shareAmount": number_or_null}],
  "receiptData": [{"id": "uuid", "label": "string", "amount": string, "sharedBy": ["uuid"]}],
  "confidence": number,
  "ambiguities": ["string"]
}

EXPLANATION OF RECEIPT_DATA:
If the user mentions specific items (e.g. "Pizza for 400 for John and me, and coke for 100 for me"), this is a True Universal Fairshare expense!
1. Set splitType to "exact".
2. Generate an array for receiptData. Assign a unique UUID for each item's "id".
3. "sharedBy" MUST be an array of the exact userIds who shared that specific item.
4. Calculate the final exact "shareAmount" for each participant in the "participants" array by splitting the items among the sharedBy users, and splitting any remaining amount equally among all mentioned participants.

EXAMPLES:
- "Dinner 900 Rahul paid" → payers:[{Rahul,900}], participants:all, splitType:equal, receiptData:null
- "I paid 1000, 400 was for wine that Rahul and I drank" → payers:[{me,1000}], participants:[all], splitType:exact, receiptData:[{id:"...", label:"wine", amount:"400", sharedBy:[me, Rahul]}] (Calculate exactly: remaining 600 split equally)
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
    _imageData: string,
    _groupContext: GroupMember[]
  ): Promise<ParseResult> {
    // Phase 6B: vision model OCR — stubbed for now
    // Returns a fallback so the frontend shows the manual form with a toast.
    return {
      fallback: true,
      reason: "parse_error",
      rawText: "[receipt image]",
    } satisfies AIFallback;
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
    context: { members: GroupMember[]; expenses: any[]; settlements: any[]; balances: any[] }
  ): Promise<LedgerQueryResponse> {
    if (!this.apiKey) {
      throw new Error("Bring your own AI: Groq API Key required. Please set it in your Profile.");
    }

    const systemPrompt = `You are a ledger intelligence assistant for a group expense app called Spenit.
Your job is to answer questions about the group's expenses, settlements, and balances.
You will be provided with the current state of the ledger as JSON data.
Answer the user's question accurately using ONLY the provided data. Do not invent or hallucinate amounts, users, or transactions.

LEDGER DATA:
${JSON.stringify(context)}

OUTPUT FORMAT:
Return ONLY a valid JSON object matching this schema:
{
  "answer": "A clear, natural language answer to the user's question. Explain balances if asked (e.g. 'Rahul owes you 800' instead of 'Net 800').",
  "filters": {
    "categories": ["Food"], // Optional: if the user asked to 'show food expenses', include 'Food' here
    "userIds": ["uuid-of-user"] // Optional: if the user asked for expenses involving a specific person, include their ID here
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
