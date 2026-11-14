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
  OrderExtractResult,
} from "./AIProvider";
import { EXPENSE_CATEGORIES } from "./AIProvider";
import { ORDER_EXTRACT_PROMPT } from "./orderPrompt";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_TIMEOUT_MS = 20_000;
/** Groq retired llama-3.3-70b-versatile on 2026-08-16; gpt-oss-120b is its recommended replacement. */
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
/**
 * gpt-oss models think before answering, and that thinking counts toward the token limit.
 * Low effort keeps short JSON tasks fast; other models do not accept the parameter.
 */
const textModelOptions = () => (GROQ_MODEL.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {});
/** Groq retired qwen/qwen3.6-27b on 2026-09-14; qwen3.8-27b is its successor. Read per call so a Worker var applies. */
const visionModel = () => process.env.GROQ_VISION_MODEL || "qwen/qwen3.8-27b";

/** 64×64 red PNG — the vision ping in GET /ai/test-key. */
const PING_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeUlEQVR4nO3PQQkAMAzAwCqpf1ETMxF7HINABFzm7H7dcEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFj13PLIEAOXyUUwAAAABJRU5ErkJggg==";

export interface PingResult {
  ok: boolean;
  model: string;
  status?: number;
  message?: string;
  ms?: number;
}

type GroqCall =
  | { kind: "ok"; status: number; ms: number; json: any }
  | { kind: "http"; status: number; ms: number; message: string; retryAfterMs: number }
  | { kind: "timeout"; status: 0; ms: number }
  | { kind: "network"; status: 0; ms: number; message: string };

/** One chat-completions request. Never throws; never logs the key or the image. */
async function groqChat(apiKey: string, body: object, timeoutMs: number): Promise<GroqCall> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const ms = Date.now() - start;
    if (response.ok) return { kind: "ok", status: response.status, ms, json: await response.json() };
    const errText = await response.text().catch(() => "");
    let message = errText.slice(0, 300);
    try { message = JSON.parse(errText)?.error?.message || message; } catch { /* plain text */ }
    const retryAfter = Number(response.headers.get("retry-after"));
    return { kind: "http", status: response.status, ms, message, retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : 0 };
  } catch (err) {
    const ms = Date.now() - start;
    if ((err as Error).name === "AbortError") return { kind: "timeout", status: 0, ms };
    return { kind: "network", status: 0, ms, message: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/** Model text → JSON. Tolerates code fences and a leading <think> block. undefined = not JSON. */
export function parseModelJson(content: string): unknown {
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* try the outermost object */ }
  const a = cleaned.indexOf("{"), b = cleaned.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try { return JSON.parse(cleaned.slice(a, b + 1)); } catch { /* give up */ }
  }
  return undefined;
}

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
            max_completion_tokens: 2048,
            response_format: { type: "json_object" },
            ...textModelOptions(),
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
        console.error(`[ai] JSON parse failed (${rawResponse.length} chars)`);
        return this.fallback("parse_error", input);
      }
      console.error("[ai] Network error:", (err as Error).message);
      return this.fallback("network", input);
    }
  }

  // ── parseReceiptImage — PHASE 6B STUB ────────────────────────────────────────

  async parseReceiptImage(
    imageDatas: string[],
    groupContext: GroupMember[]
  ): Promise<ParseResult> {
    if (!this.apiKey) {
      return this.fallback("config_error", "[Receipt Image]");
    }

    if (!imageDatas || imageDatas.length === 0) {
      return this.fallback("parse_error", "No images provided");
    }

    // Ensure image strings have the proper data URL prefix if missing
    const base64Urls = imageDatas.map(img => 
      img.startsWith("data:image") ? img : `data:image/jpeg;base64,${img}`
    );

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000); // 60s for vision

      const systemPrompt = `You are a receipt parser. Extract the merchant, total, tax, and EVERY line item. Return ONLY valid JSON in this exact format:
{
  "merchant": "string",
  "total": number,
  "tax": number,
  "items": [
    { "name": "string", "amount": number }
  ]
}
If there are items, you MUST include them in the "items" array.`;

      const contentArray: any[] = [{ type: "text", text: systemPrompt }];
      for (const url of base64Urls) {
        contentArray.push({
          type: "image_url",
          image_url: { url }
        });
      }

      const response = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: visionModel(),
          messages: [
            {
              role: "user",
              content: contentArray,
            },
          ],
          temperature: 0.1,
          max_completion_tokens: 1024,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        if (response.status === 403) throw new Error("GROQ_BLOCKED_403: " + errText);
        throw new Error(`Groq vision API error: ${response.status} - ${errText}`);
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
      console.error("Groq vision error:", e);
      return this.fallback(
        e.name === "AbortError" ? "timeout" : "parse_error",
        `[Error]: ${e.message}`
      );
    }
  }

  // ── extractOrder — one screenshot → vision model → order JSON ───────────────

  /**
   * JSON mode, one request per screenshot. 429 / 5xx / timeouts are retried once when the
   * wait is short; a longer retry-after goes back to the phone, which waits and retries.
   * 401 / 404 / 413 are never retried.
   */
  async extractOrder(input: { imageBase64: string; waitOnBusy?: boolean }): Promise<OrderExtractResult> {
    const model = visionModel();
    if (!this.apiKey) return { ok: false, reason: "config_error", stage: "config", message: "No Groq API key", model };

    const url = input.imageBase64.startsWith("data:image") ? input.imageBase64 : `data:image/jpeg;base64,${input.imageBase64}`;
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: ORDER_EXTRACT_PROMPT },
          { type: "image_url", image_url: { url } },
        ],
      },
    ];

    const startMs = Date.now();
    let attempts = 0;
    let transientRetries = 0;
    for (;;) {
      attempts++;
      const call = await groqChat(this.apiKey, {
        model,
        messages,
        temperature: 0,
        max_completion_tokens: 4096,
        response_format: { type: "json_object" },
      }, 45_000);
      console.log(
        `[ai] stage=GROQ_RESPONSE_RECEIVED model=${model} attempt=${attempts} status=${call.status} ms=${call.ms}`
      );

      if (call.kind === "ok") {
        const content: string = call.json.choices?.[0]?.message?.content || "";
        const usage = {
          promptTokens: call.json.usage?.prompt_tokens ?? null,
          completionTokens: call.json.usage?.completion_tokens ?? null,
        };
        const parsed = parseModelJson(content);
        if (parsed !== undefined) {
          return { ok: true, raw: parsed, model, latencyMs: Date.now() - startMs, attempts, usage };
        }
        console.error(`[ai] stage=JSON_PARSE_FAILED model=${model} chars=${content.length}`);
        return {
          ok: false, reason: "parse_error", stage: "json_parse", model,
          message: content ? "The AI answer was not valid JSON" : "The AI returned an empty answer",
          rawText: content.slice(0, 500),
        };
      }

      if (call.kind === "http") {
        const { status, message } = call;
        // With several keys, a busy key hands over to the next one at once instead of waiting.
        const mayWait = status !== 429 || input.waitOnBusy !== false;
        if ((status === 429 || status >= 500) && mayWait && transientRetries === 0 && call.retryAfterMs <= 10_000) {
          transientRetries++;
          await new Promise((r) => setTimeout(r, Math.max(call.retryAfterMs, 1_000)));
          continue;
        }
        const reason =
          status === 401 ? "config_error"
          : status === 403 ? "blocked"
          : status === 404 ? "model_unavailable"
          : status === 413 ? "too_large"
          : status === 429 ? "rate_limit"
          : status === 400 || status === 422 ? "invalid_request"
          : "network";
        return { ok: false, reason, stage: "groq_request", status, message, model, retryAfterMs: call.retryAfterMs || undefined };
      }

      // timeout / network error
      if (transientRetries === 0) { transientRetries++; continue; }
      return {
        ok: false, reason: call.kind === "timeout" ? "timeout" : "network", stage: "groq_request",
        message: call.kind === "timeout" ? "Groq did not answer within 45 s" : call.message, model,
      };
    }
  }

  /** Tiny real requests to both models — proves the key, the network and the model names. */
  async ping(): Promise<{ text: PingResult; vision: PingResult }> {
    const one = async (model: string, content: unknown): Promise<PingResult> => {
      if (!this.apiKey) return { ok: false, model, message: "No Groq API key" };
      const call = await groqChat(this.apiKey, {
        model, messages: [{ role: "user", content }], temperature: 0, max_completion_tokens: 200,
        ...(model === GROQ_MODEL ? textModelOptions() : {}),
      }, 20_000);
      if (call.kind === "ok") return { ok: true, model, ms: call.ms };
      if (call.kind === "http") return { ok: false, model, status: call.status, message: call.message, ms: call.ms };
      return { ok: false, model, message: call.kind === "timeout" ? "timed out" : call.message };
    };
    const [text, vision] = await Promise.all([
      one(GROQ_MODEL, "Reply with the word OK."),
      one(visionModel(), [
        { type: "text", text: "What colour is this image? One word." },
        { type: "image_url", image_url: { url: PING_IMAGE } },
      ]),
    ]);
    return { text, vision };
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
          ...textModelOptions(),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        if (response.status === 403) throw new Error("GROQ_BLOCKED_403: " + errText);
        throw new Error(`Groq API error ${response.status}: ${errText}`);
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

  /**
   * Group chat: answer a question about one group from its ledger (built by
   * lib/groupAiContext). Keeps the last few turns so follow-ups work.
   * Never throws: returns the answer, or why it failed.
   */
  async groupChat(
    ledger: string,
    question: string,
    history: { role: "user" | "assistant"; content: string }[],
    /** another assistant (e.g. personal spending) with its own instructions; the ledger is appended */
    opts: { system?: string; maxTurns?: number } = {}
  ): Promise<
    | { ok: true; answer: string; refs: string[]; followUps: string[]; usage: { in: number; out: number }; extra: Record<string, unknown> }
    | { ok: false; reason: "rate_limit" | "too_large" | "timeout" | "config_error" | "unavailable"; message: string; retryAfterMs: number }
  > {
    const system = opts.system ? `${opts.system}

LEDGER
${ledger}` : `You are Spenit's assistant inside one expense-sharing group. You talk with a member of the group like a friendly, sharp accountant who knows every bill.

Use ONLY the LEDGER below. It is complete and up to date: balances, payments still due, payments waiting for confirmation, every expense with who paid and each person's share, item lists of imported orders, and pre-computed totals. Never invent numbers. Prefer the pre-computed totals over adding things up yourself.

How to answer:
- Short and direct: the answer first, in 1-3 sentences, then at most a few bullets if they help. Use **bold** for key amounts. Indian rupees like ₹1,141.
- "You" is the person asking (marked "(you)").
- Owing and pending: use BALANCES NOW and "payments still due". A payment that is waiting for confirmation is not counted yet — say so when it matters.
- Items ("how much on milk", "vegetables", "snacks"): use ITEMS BOUGHT. Group kinds sensibly yourself (vegetables = onion, tomato, potato, lady's finger, coriander…; dairy = milk, curd, paneer, butter…). Give the total price and the asker's part, and mention which bills if useful.
- Private items have no name on purpose. Never guess what they were.
- "Why is my share high / compare shares": use WHY SHARES DIFFER. A share is only what someone is in; who paid NEVER changes a share (it only changes balances). Explain differences by own items vs shared items, naming the biggest own items.
- If the ledger can't answer, say what is missing and what they could do in the app.
- Talk naturally; follow on from earlier messages.

Return JSON only:
{"answer": string, "refs": ["E1", ...] (the expenses your answer is about, max 20, [] if none), "followUps": [up to 3 short questions the user might ask next]}

LEDGER
${ledger}`;

    const body = {
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: system },
        ...history.slice(-(opts.maxTurns ?? 4)).map((m) => ({ role: m.role, content: m.content.slice(0, 600) })),
        { role: "user", content: question.slice(0, 500) },
      ],
      temperature: 0.2,
      max_completion_tokens: 1200,
      response_format: { type: "json_object" },
      ...textModelOptions(),
    };

    let call = await groqChat(this.apiKey, body, 30_000);
    if (call.kind === "timeout" || (call.kind === "http" && call.status >= 500)) call = await groqChat(this.apiKey, body, 30_000);

    if (call.kind !== "ok") {
      const status = call.kind === "http" ? call.status : 0;
      console.warn(`[ai] groupChat failed kind=${call.kind} status=${status} ms=${call.ms}`);
      // "Request too large ... tokens per minute": the question plus ledger is over the key's limit.
      if (call.kind === "http" && (status === 413 || /request too large|context length|too many tokens/i.test(call.message)))
        return { ok: false, reason: "too_large", message: call.message, retryAfterMs: 0 };
      if (call.kind === "http" && status === 429)
        return { ok: false, reason: "rate_limit", message: call.message, retryAfterMs: call.retryAfterMs || 10_000 };
      if (call.kind === "timeout") return { ok: false, reason: "timeout", message: "The AI took too long", retryAfterMs: 0 };
      if (call.kind === "http" && (status === 401 || status === 403))
        return { ok: false, reason: "config_error", message: call.message, retryAfterMs: 0 };
      return { ok: false, reason: "unavailable", message: call.kind === "http" ? call.message : "Couldn't reach the AI", retryAfterMs: 0 };
    }

    const content = (call.json as any)?.choices?.[0]?.message?.content ?? "";
    const parsed = parseModelJson(content) as { answer?: unknown; refs?: unknown; followUps?: unknown } | undefined;
    const answer = typeof parsed?.answer === "string" && parsed.answer.trim() ? parsed.answer.trim() : content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    const strs = (v: unknown, n: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, n) : []);
    console.log(`[ai] groupChat ok ms=${call.ms} tokens=${(call.json as any)?.usage?.total_tokens ?? "?"}`);
    const usage = (call.json as any)?.usage ?? {};
    return {
      ok: true,
      answer: answer || "I couldn't work that out. Try asking another way.",
      refs: strs(parsed?.refs, 20),
      followUps: strs(parsed?.followUps, 3),
      usage: { in: Number(usage.prompt_tokens) || 0, out: Number(usage.completion_tokens) || 0 },
      extra: (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>,
    };
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
