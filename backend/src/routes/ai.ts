/**
 * ai.ts — AI expense parsing routes (Stage 6A)
 *
 * Architecture contract (Architecture.md §2):
 *   - These routes are READ-ONLY with respect to the database and the ledger.
 *   - No DB writes happen here. Ever.
 *   - The only DB reads are: group member lookup + recent expense lookup (duplicate detection).
 *   - The actual expense creation always goes through POST /expenses (Stage 3 endpoint).
 *
 * Endpoints:
 *   POST /ai/parse-expense   — parse NL text → ParsedExpenseDraft | AIFallback
 *   POST /ai/parse-receipt   — upload receipt image → stub (Phase 6B)
 *   POST /ai/extract-order   — one order screenshot → vision model → checked order JSON
 *   GET  /ai/test-key        — real text + vision ping to Groq
 */

import { Router, Request, Response } from "express";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { GroqProvider } from "../ai/GroqProvider";
import type { GroupMember, ParsedExpenseDraft } from "../ai/AIProvider";
import { normalizeOrder, checkTotals } from "../lib/orderExtract";
import { MAX_IMAGE_CHARS, MAX_RECEIPT_IMAGES, IMAGE_DATA_URL } from "../lib/limits";
import { open as openSecret } from "../lib/secretBox";
import { strictLimitBy } from "../lib/strictLimit";
import { bump } from "../lib/telemetry";
import { buildPersonalContext } from "../lib/personalAiContext";
import { maskReceipt, repairSharedBy } from "../lib/receiptPrivacy";
import { parseAmount } from "../lib/limits";
import { CATEGORIES as PERSONAL_CATEGORIES } from "./personal_expenses";

/**
 * Exact per-account AI limits, across every server copy. They protect the SERVER's Groq key
 * (shared by everyone without a key of their own) and the Worker from runaway clients.
 * People with their own key pay Groq themselves and Groq limits them per account, so their
 * daily ceiling is much higher; only the abuse guard remains.
 */
const DAY = 86_400;
const DAILY_MSG = (n: number) => `You've used Spenit's ${n} AI reads for today. It resets at 5:30 am.`;
async function ownsAiKey(userId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `select (groq_api_key is not null or jsonb_array_length(groq_extra_keys) > 0) as own from "User" where id = $1`,
    [userId]
  );
  return rows[0]?.own === true;
}
const SERVER_DAILY = 400;
const OWN_KEY_DAILY = 5_000;
const aiLimit = strictLimitBy("ai", async (userId) => {
  const daily = (await ownsAiKey(userId)) ? OWN_KEY_DAILY : SERVER_DAILY;
  return [
    { limit: 20, seconds: 60, message: "That's a lot of AI requests at once. Wait a minute and try again." },
    { limit: daily, seconds: DAY, message: DAILY_MSG(daily) },
  ];
});
/**
 * Screenshot reading: one call per screenshot (plus retries), several at once with extra
 * keys, so the per-minute ceiling is higher. Same counters as aiLimit.
 */
const orderReadLimit = strictLimitBy("ai", async (userId) => {
  const own = await ownsAiKey(userId);
  const daily = own ? OWN_KEY_DAILY : SERVER_DAILY;
  return [
    { limit: own ? 120 : 60, seconds: 60, message: "That's a lot of screenshots at once. Wait a minute and try again." },
    { limit: daily, seconds: DAY, message: DAILY_MSG(daily) },
  ];
});
import { buildGroupContext } from "../lib/groupAiContext";
import { userGroqKeys } from "../lib/groqKeys";
import { answerWithItems } from "../lib/chatItems";
import { aliasesOf, categoryFromText, membersNamedIn, payerFromText, sharersFromText } from "../lib/expenseText";
import { listGroupExpenses } from "./expenses";
import { listGroupSettlements } from "./settlements";
import { getGroupBalance } from "./balance";

const router = Router();

// ─── POST /ai/parse-expense ────────────────────────────────────────────────────
/**
 * Parse natural language expense text into an editable draft.
 *
 * Body: { text: string, groupId: string }
 *
 * Returns: ParsedExpenseDraft | AIFallback
 *
 * The client MUST show an editable confirm-card before calling POST /expenses.
 * This endpoint NEVER creates an expense — it only produces a suggestion.
 */
router.post(
  "/parse-expense",
  requireAuth,
  aiLimit,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const { text, groupId } = req.body as { text?: string; groupId?: string };

    if (!text || text.trim().length === 0) {
      res.status(400).json({ error: "text is required" });
      return;
    }
    if (!groupId) {
      res.status(400).json({ error: "groupId is required" });
      return;
    }

    // ── 1. Verify user is a member of the group ──────────────────────────────
    const memberCheck = await pool.query(
      'SELECT 1 FROM "GroupMember" WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );
    if (memberCheck.rows.length === 0) {
      res.status(403).json({ error: "You are not a member of this group" });
      return;
    }

    // ── 2. Fetch group members for context ────────────────────────────────────
    // The requesting user is placed FIRST so the LLM knows "me" = current user.
    const membersRes = await pool.query<{
      id: string;
      name: string;
      username: string;
      realName: string;
    }>(
      `SELECT u.id, COALESCE(gm.nickname, u.name) AS name, u.username, u.name AS "realName"
       FROM "GroupMember" gm
       JOIN "User" u ON u.id = gm.user_id
       WHERE gm.group_id = $1
       ORDER BY (gm.user_id = $2) DESC, COALESCE(gm.nickname, u.name) ASC`,
      [groupId, userId]
    );

    const groupContext: GroupMember[] = membersRes.rows;

    // ── 3. Call AI provider: every key the person has, the next one if a key is busy ──
    const startMs = Date.now();
    const { keys } = await groqLanesFor(userId, Math.floor(Math.random() * 1000));
    const tryKeys = keys.filter((k) => !isCoolingDown(k));
    let result: Awaited<ReturnType<GroqProvider["parseExpenseText"]>> | { fallback: true; reason: string; rawText: string } =
      { fallback: true, reason: "config_error", rawText: text.trim() };
    for (const key of tryKeys.length ? tryKeys : keys) {
      try {
        result = await new GroqProvider(key).parseExpenseText(text.trim(), groupContext);
      } catch {
        result = { fallback: true, reason: "network", rawText: text.trim() };
      }
      if (!("fallback" in result) || !["rate_limit", "network", "timeout"].includes(String(result.reason))) break;
      if (result.reason === "rate_limit") coolDown(key, 30_000);
    }
    await bump({ ai_calls: 1, ...("fallback" in result ? { ai_failures: 1 } : {}) }, userId);
    const latencyMs = Date.now() - startMs;

    console.log(
      `[ai] parse-expense — latency=${latencyMs}ms fallback=${"fallback" in result}`
    );

    // If AI failed, return the fallback immediately
    if ("fallback" in result) {
      res.json(result);
      return;
    }

    // ── 4. Duplicate detection ─────────────────────────────────────────────────
    // Read-only. Checks recent expenses (last 24h) for amount + description match.
    // Never touches the write path.
    const draft = fixDraft(result as ParsedExpenseDraft, text.trim(), groupContext, userId);
    if (draft.amount !== null && draft.amount > 0) {
      try {
        const recentRes = await pool.query<{
          amount: string;
          description: string;
        }>(
          `SELECT amount, description
           FROM "Expense"
           WHERE group_id = $1
             AND deleted_at IS NULL
             AND created_at > now() - interval '24 hours'`,
          [groupId]
        );

        for (const recent of recentRes.rows) {
          const recentAmount = parseFloat(recent.amount);
          const amountMatch =
            Math.abs(recentAmount - draft.amount!) / recentAmount < 0.01;
          const descSimilarity = jaccardSimilarity(
            draft.description,
            recent.description
          );

          if (amountMatch && descSimilarity > 0.55) {
            draft.possibleDuplicate = true;
            break;
          }
        }
      } catch (err) {
        // Duplicate detection is best-effort — never block the response
        console.warn("[ai] duplicate detection failed:", (err as Error).message);
      }
    }

    res.json(draft);
  }
);

/**
 * The plain facts of the sentence win over the model: anyone named (by nickname, real
 * name, first name or username) is in the split, "X paid" sets the payer, a cab is Travel.
 * Ambiguities about names that were in fact found are dropped.
 */
function fixDraft(d: ParsedExpenseDraft, text: string, members: GroupMember[], meId: string): ParsedExpenseDraft {
  const named = members.map((m) => ({ id: m.id, name: m.name, realName: m.realName ?? null, username: m.username }));
  const out: ParsedExpenseDraft = { ...d, payers: [...d.payers], participants: [...d.participants], ambiguities: [...d.ambiguities] };
  const sharers = sharersFromText(text, named, meId);
  if (sharers && out.splitType !== "exact") {
    const keep = new Map(out.participants.map((p) => [p.userId, p]));
    out.participants = sharers.map((id) => keep.get(id) ?? { userId: id });
  }
  const payer = payerFromText(text, named, meId);
  if (payer && (out.payers.length !== 1 || out.payers[0].userId !== payer)) out.payers = [{ userId: payer, amountPaid: out.amount ?? 0 }];
  if (out.payers.length === 0) out.payers = [{ userId: meId, amountPaid: out.amount ?? 0 }];
  if (!out.category || out.category === "Misc") {
    const c = categoryFromText(text);
    if (c) out.category = c as ParsedExpenseDraft["category"];
  }
  // A name the model couldn't place but we found: not an ambiguity any more.
  const found = new Set(membersNamedIn(text, named, meId));
  out.ambiguities = out.ambiguities.filter((a) => {
    const lower = a.toLowerCase();
    return !named.some((m) => found.has(m.id) && aliasesOf(m).some((al) => lower.includes(al)));
  }).filter((a) => !/unknown (payer|participant) userid/i.test(a));
  if (out.description) out.description = out.description.charAt(0).toUpperCase() + out.description.slice(1);
  return out;
}

// ─── Groq key ──────────────────────────────────────────────────────────────────

/** The user's own key wins; otherwise the server's GROQ_API_KEY secret, if one is set. */
/**
 * Every key this person can read screenshots with, starting at `lane` (so parallel
 * screenshots spread over different keys). Falls back to the server key.
 */
async function groqLanesFor(userId: string, lane: number): Promise<{ keys: string[]; source: "user" | "server" | null }> {
  const { main, extras } = await userGroqKeys(userId);
  const own = [...(main ? [main] : []), ...extras];
  if (own.length > 0) {
    const start = ((lane % own.length) + own.length) % own.length;
    return { keys: [...own.slice(start), ...own.slice(0, start)], source: "user" };
  }
  if (process.env.GROQ_API_KEY) return { keys: [process.env.GROQ_API_KEY], source: "server" };
  return { keys: [], source: null };
}

/**
 * Keys Groq has just called busy, with when to try them again (this server copy only;
 * a fresh copy simply asks Groq once and learns the same). Keyed by a short fingerprint.
 */
const keyCooldown = new Map<string, number>();
const fingerprint = (k: string) => `${k.length}:${k.slice(-10)}`;
function isCoolingDown(k: string): boolean {
  const until = keyCooldown.get(fingerprint(k));
  return !!until && until > Date.now();
}
function coolDown(k: string, retryAfterMs: number | undefined) {
  keyCooldown.set(fingerprint(k), Date.now() + Math.max(retryAfterMs ?? 0, 5_000));
  if (keyCooldown.size > 500) keyCooldown.clear();
}

type ChatResult = Awaited<ReturnType<GroqProvider["groupChat"]>>;
type ChatFailure = Extract<ChatResult, { ok: false }>;

/**
 * Ask a chat question with every key the person has. Starts from a different key each
 * time, skips keys Groq just called busy, and moves to the next key when one is busy or
 * fails. `ask` gets a key and how small to make the ledger (0 = full, 1 = shorter, 2 = least),
 * and is retried smaller on the same key when the question is too big for a free key.
 */
async function chatWithKeys(userId: string, ask: (ai: GroqProvider, size: 0 | 1 | 2) => Promise<ChatResult>): Promise<ChatResult | null> {
  const { keys } = await groqLanesFor(userId, Math.floor(Math.random() * 1000));
  if (keys.length === 0) return null;
  const ready = keys.filter((k) => !isCoolingDown(k));
  const order = ready.length > 0 ? ready : keys;
  let size: 0 | 1 | 2 = 0;
  let last: ChatResult | null = null;
  let shortest: ChatFailure | null = null;
  for (const key of order) {
    const ai = new GroqProvider(key);
    for (;;) {
      last = await ask(ai, size);
      if (!last.ok && last.reason === "too_large" && size < 2) { size = (size + 1) as 1 | 2; continue; }
      break;
    }
    if (last.ok) return last;
    if (last.reason === "too_large") return last; // the same size limit on every free key
    if (last.reason === "rate_limit") {
      coolDown(key, last.retryAfterMs);
      if (!shortest || last.retryAfterMs < shortest.retryAfterMs) shortest = last;
    }
    console.warn(`[ai] chat key failed reason=${last.reason} keys=${order.length} msg=${last.message.slice(0, 140)}`);
  }
  return last && !last.ok && last.reason !== "rate_limit" && shortest ? shortest : last;
}

/** Plain words for a failed chat; Groq's own text (org ids, upgrade links) stays in the logs. */
function chatError(f: ChatFailure, keys: number) {
  const status = f.reason === "rate_limit" || f.reason === "too_large" ? 429 : f.reason === "config_error" ? 502 : 503;
  const message =
    f.reason === "too_large" ? "This question needs more than a free Groq key allows in a minute. Wait a minute and ask again, or start a new chat with the bin icon."
    : f.reason === "rate_limit" ? (keys > 1 ? "All your Groq keys are busy for a moment. Try again in a few seconds." : "The AI is busy for a moment (your Groq key's per-minute limit). Try again in a few seconds, or add more keys in Profile.")
    : f.reason === "timeout" ? "The AI took too long to answer. Try again."
    : f.reason === "config_error" ? "Your Groq key didn't work. Check it in Profile."
    : "Couldn't reach the AI right now. Try again in a moment.";
  return { status, body: { error: f.reason, message, retryAfterMs: f.retryAfterMs } };
}

async function groqKeyFor(userId: string): Promise<{ key: string | null; source: "user" | "server" | null }> {
  const userRes = await pool.query('SELECT groq_api_key FROM "User" WHERE id = $1', [userId]);
  // Stored encrypted (lib/secretBox); decrypted only here, for the request at hand.
  const own = await openSecret(userRes.rows[0]?.groq_api_key as string | null | undefined);
  if (own) return { key: own, source: "user" };
  if (process.env.GROQ_API_KEY) return { key: process.env.GROQ_API_KEY, source: "server" };
  return { key: null, source: null };
}

// ─── GET /ai/test-key ─────────────────────────────────────────────────────────
/**
 * Real connectivity check: one tiny text request and one tiny image request to Groq,
 * from the server (that is where every AI call runs — not the phone).
 * Returns each result with Groq's own status and message, so a wrong model name,
 * a revoked key or a blocked network are told apart.
 */
router.get(
  "/test-key",
  requireAuth,
  aiLimit,
  async (req: Request, res: Response): Promise<void> => {
    const { key, source } = await groqKeyFor(req.user!.userId);
    if (!key) {
      res.status(400).json({ ok: false, error: "No Groq API key configured" });
      return;
    }
    const { text, vision } = await new GroqProvider(key).ping();
    console.log(
      `[ai] test-key keySource=${source} text=${text.ok ? "ok" : text.status ?? "err"} vision=${vision.ok ? "ok" : vision.status ?? "err"}`
    );
    res.status(text.ok && vision.ok ? 200 : 502).json({ ok: text.ok && vision.ok, keySource: source, text, vision });
  }
);

// ─── POST /ai/parse-receipt ────────────────────────────────────────────────────
/**
 * Phase 6B stub — receipt OCR.
 * Accepts a base64 image but currently returns a fallback (vision model integration
 * deferred to Phase 6B). The frontend shows the manual form with a "coming soon" toast.
 */
router.post(
  "/parse-receipt",
  requireAuth,
  aiLimit,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const { imagesBase64, imageBase64, groupId } = req.body as {
      imagesBase64?: string[];
      imageBase64?: string; // fallback for backwards compatibility
      groupId?: string;
    };

    const finalImages = imagesBase64 || (imageBase64 ? [imageBase64] : []);

    if (finalImages.length > MAX_RECEIPT_IMAGES || finalImages.some((im) => typeof im !== "string" || !IMAGE_DATA_URL.test(im) || im.length > MAX_IMAGE_CHARS)) {
      res.status(400).json({ error: `Send up to ${MAX_RECEIPT_IMAGES} JPEG, PNG or WebP images, each under 4 MB` });
      return;
    }
    if (finalImages.length === 0) {
      res.status(400).json({ error: "imagesBase64 is required" });
      return;
    }
    
    let membersList: any[] = [];

    if (groupId) {
      // Group context
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(groupId)) {
        res.status(400).json({ error: "Invalid groupId format" });
        return;
      }

      // Verify membership
      const memberCheck = await pool.query(
        'SELECT 1 FROM "GroupMember" WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
      );
      if (memberCheck.rows.length === 0) {
        res.status(403).json({ error: "You are not a member of this group" });
        return;
      }

      // Fetch group members
      const membersRes = await pool.query<{ id: string; name: string; username: string; }>(
        `SELECT u.id, COALESCE(gm.nickname, u.name) AS name, u.username
         FROM "GroupMember" gm
         JOIN "User" u ON u.id = gm.user_id
         WHERE gm.group_id = $1
         ORDER BY (gm.user_id = $2) DESC, COALESCE(gm.nickname, u.name) ASC`,
        [groupId, userId]
      );
      membersList = membersRes.rows;
    } else {
      // Personal context
      const userRes = await pool.query('SELECT id, name, username FROM "User" WHERE id = $1', [userId]);
      membersList = userRes.rows;
    }

    const apiKey = (await groqKeyFor(userId)).key ?? "";
    const ai = new GroqProvider(apiKey);
    
    let result;
    try {
      result = await ai.parseReceiptImage(finalImages, membersList);
    } catch (e) {
      result = { fallback: true, reason: "config_error", rawText: "[receipt image]" };
    }
    await bump({ ai_calls: 1, receipt_scans: 1, ...(result && "fallback" in result ? { ai_failures: 1 } : {}) }, userId);

    res.json(result);
  }
);

// ─── POST /ai/extract-order ────────────────────────────────────────────────────
/**
 * Bulk order import (BulkOrderSplit_Plan.md §3): ONE order screenshot per call.
 *
 * The vision model reads the image; lib/orderExtract normalizes and checks it.
 * Joining screenshots of the same order happens on the phone.
 *
 * Body: { imageBase64: string }  (data URL, jpeg/png/webp, ≤ 4 MB — Groq's base64 limit)
 * Returns: { order, totals, model, latencyMs, attempts, usage }
 *        | { fallback: true, reason, stage, status?, message, model }
 */

router.post(
  "/extract-order",
  requireAuth,
  orderReadLimit,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const { imageBase64, lane } = req.body as { imageBase64?: string; lane?: number };

    if (typeof imageBase64 !== "string" || imageBase64.length < 100) {
      res.status(400).json({ fallback: true, reason: "invalid_request", stage: "upload", message: "imageBase64 is required" });
      return;
    }
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(imageBase64)) {
      res.status(400).json({ fallback: true, reason: "invalid_request", stage: "upload", message: "Image must be a JPEG, PNG or WebP data URL" });
      return;
    }
    if (imageBase64.length > MAX_IMAGE_CHARS) {
      res.status(413).json({ fallback: true, reason: "too_large", stage: "upload", message: "Image is larger than 4 MB" });
      return;
    }
    console.log(`[ai] stage=UPLOAD_RECEIVED user=${userId.slice(0, 8)} kb=${Math.round(imageBase64.length / 1024)}`);

    const { keys, source } = await groqLanesFor(userId, Number.isInteger(lane) ? Number(lane) : 0);
    if (keys.length === 0) {
      res.json({ fallback: true, reason: "config_error", stage: "config", message: "No Groq API key configured", rawText: "" });
      return;
    }

    // This lane's key first; if Groq says it's busy, the person's other keys take over.
    // Keys Groq recently called busy are skipped until their wait is over (one daily-limited
    // key must not hold up the rest). If every key is busy, report the SHORTEST wait.
    const ready = keys.filter((k) => !isCoolingDown(k));
    const tryKeys = ready.length > 0 ? ready : keys;
    const multi = tryKeys.length > 1;
    let result = await new GroqProvider(tryKeys[0]).extractOrder({ imageBase64, waitOnBusy: !multi });
    let shortest = result;
    for (let i = 0; !result.ok && result.reason === "rate_limit"; ) {
      coolDown(tryKeys[i], result.retryAfterMs);
      if (!shortest.ok && (result.retryAfterMs ?? 60_000) <= (shortest.retryAfterMs ?? 60_000)) shortest = result;
      if (++i >= tryKeys.length) { result = shortest; break; }
      result = await new GroqProvider(tryKeys[i]).extractOrder({ imageBase64, waitOnBusy: false });
    }
    await bump(result.ok
      ? { ai_calls: 1, order_reads: 1, ai_tokens_in: result.usage?.promptTokens ?? 0, ai_tokens_out: result.usage?.completionTokens ?? 0 }
      : { ai_calls: 1, ai_failures: 1 }, userId);
    if (!result.ok) {
      console.warn(
        `[ai] stage=EXTRACT_FAILED at=${result.stage} reason=${result.reason} status=${result.status ?? "-"} model=${result.model} keySource=${source} keys=${keys.length} msg=${(result.message ?? "").slice(0, 160)}`
      );
      res.json({
        fallback: true,
        reason: result.reason,
        stage: result.stage,
        status: result.status,
        message: result.message,
        model: result.model,
        retryAfterMs: result.retryAfterMs,
        /** Groq's daily cap (not the per-minute one): waiting a few seconds won't help */
        perDay: result.reason === "rate_limit" && /per day/i.test(result.message ?? ""),
        keys: keys.length,
        rawText: "",
      });
      return;
    }

    const order = normalizeOrder(result.raw);
    const totals = checkTotals(order);
    console.log(
      `[ai] stage=EXTRACT_COMPLETED model=${result.model} items=${order.items.length} totals=${totals.status} confidence=${order.confidence} tokens=${result.usage.promptTokens ?? "?"}+${result.usage.completionTokens ?? "?"} ms=${result.latencyMs}`
    );
    res.json({ order, totals, model: result.model, latencyMs: result.latencyMs, attempts: result.attempts, usage: result.usage });
  }
);

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Jaccard similarity between two strings (token-level).
 * Used for duplicate detection — compares description overlap.
 * Threshold 0.55 chosen to avoid false positives while catching "Dinner 900" / "Dinner" matches.
 */
function jaccardSimilarity(a: string, b: string): number {
  const tokenize = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(Boolean)
    );

  const setA = tokenize(a);
  const setB = tokenize(b);

  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

// ─── POST /ai/query ────────────────────────────────────────────────────────────
/**
 * Group chat. Answers questions about one group from its full, current ledger:
 * balances and payments still due, recorded payments and their status, every expense
 * with payer and shares, imported order items (private ones masked for this viewer),
 * and totals by category / month / kind of item (lib/groupAiContext.ts).
 *
 * Body: { groupId, question, history?: [{ role: "user"|"assistant", content }] }
 * 200 → { answer, expenseIds, followUps }
 * 429 → { error: "rate_limit", retryAfterMs } · 403 → { error: "missing_key" }
 */
router.post(
  "/query",
  requireAuth,
  aiLimit,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const { groupId, question, history } = req.body ?? {};

    if (typeof groupId !== "string" || typeof question !== "string" || !question.trim()) {
      res.status(400).json({ error: "groupId and question are required" });
      return;
    }

    const memberCheck = await pool.query(
      'SELECT 1 FROM "GroupMember" WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );
    if (memberCheck.rows.length === 0) {
      res.status(403).json({ error: "You are not a member of this group" });
      return;
    }

    const { key } = await groqKeyFor(userId);
    if (!key) {
      res.status(403).json({ error: "missing_key", message: "Groq API Key required. Please set it in your Profile." });
      return;
    }

    const [membersRes, expenses, settlements, balance] = await Promise.all([
      pool.query(
        `SELECT u.id, COALESCE(gm.nickname, u.name) AS name, u.is_placeholder, g.name AS group_name
         FROM "GroupMember" gm JOIN "User" u ON u.id = gm.user_id JOIN "Group" g ON g.id = gm.group_id
         WHERE gm.group_id = $1 ORDER BY gm.joined_at ASC`,
        [groupId]
      ),
      listGroupExpenses(groupId, userId),
      listGroupSettlements(groupId, userId),
      getGroupBalance(groupId, userId),
    ]);

    const build = (budget?: number) => buildGroupContext({
      groupName: membersRes.rows[0]?.group_name ?? "this group",
      viewerId: userId,
      members: membersRes.rows.map((m: { id: string; name: string; is_placeholder: boolean }) => ({ id: m.id, name: m.name, isPlaceholder: m.is_placeholder })),
      expenses,
      settlements,
      balance,
      budget,
      // search every bill for the items this question (and the one before) is about
      focus: [question, ...(Array.isArray(history) ? history : []).filter((m: any) => m?.role === "user" && typeof m?.content === "string").slice(-1).map((m: any) => m.content)].join(" \n "),
    });
    let ctx = build(5500);

    const turns = (Array.isArray(history) ? history : [])
      .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string")
      .map((m: any) => ({ role: m.role as "user" | "assistant", content: String(m.content) }));

    const BUDGETS = [5500, 3000, 1200] as const;
    const TURNS = [4, 2, 0] as const;
    const result = await chatWithKeys(userId, (ai, size) => {
      ctx = build(BUDGETS[size]);
      return ai.groupChat(ctx.text, question.trim(), turns, { maxTurns: TURNS[size] });
    });
    if (!result) { res.status(403).json({ error: "missing_key", message: "Groq API Key required. Please set it in your Profile." }); return; }
    await bump(result.ok
      ? { ai_calls: 1, chat_questions: 1, ai_tokens_in: result.usage.in, ai_tokens_out: result.usage.out }
      : { ai_calls: 1, ai_failures: 1, chat_questions: 1 }, userId);
    if (!result.ok) {
      const { keys } = await groqLanesFor(userId, 0);
      const e = chatError(result, keys.length);
      res.status(e.status).json(e.body);
      return;
    }
    // Item questions: the model picks rows, the server writes the list and the total, so no
    // price or sum is ever made up.
    const picked = (Array.isArray(result.extra.items) ? result.extra.items : [])
      .filter((x): x is string => typeof x === "string")
      .map((id) => ctx.items[id.trim().toUpperCase()])
      .filter((r, i, all): r is NonNullable<typeof r> => !!r && all.indexOf(r) === i);
    let answer = result.answer;
    let expenseIds = result.refs.map((r) => ctx.refs[r]).filter(Boolean);
    if (picked.length) {
      answer = answerWithItems(answer, picked);
      expenseIds = [...new Set(picked.map((r) => r.expenseId))];
    }
    res.json({ answer, expenseIds, followUps: result.followUps });
  }
);



// ─── POST /ai/ask-personal ───────────────────────────────────────────────────
/**
 * The personal spending assistant. Knows what the Spending tab knows: your own entries,
 * your share of every group bill, and your part of each item inside those bills
 * (lib/personalAiContext). Can also log an expense you tell it about ("spent 200 on lunch").
 *
 * Body: { question, history?: [{ role, content }] }
 * 200 → { answer, followUps, logged: { id, description, amount, category } | null }
 */
const PERSONAL_SYSTEM = `You are Spenit's personal spending assistant. You talk with one person about their own money like a friendly, sharp accountant.

Use ONLY the LEDGER below. It is complete and up to date: their own logged expenses, their share of every group bill they are in, and their part of every item inside those bills. "Spending" always means own entries + group shares. Prefer the pre-computed totals over adding things up yourself. Never invent numbers.

How to answer:
- Short and direct: the answer first in 1-3 sentences, then a few bullets only if they help. **Bold** key amounts. Rupees like ₹1,141.
- Items ("how much on milk", "vegetables", "snacks"): use ITEMS YOU PAID FOR, the person's part only. Group kinds sensibly yourself (vegetables = onion, tomato, potato, lady's finger…; dairy = milk, curd, paneer, butter…). Say which bills or groups it came from.
- Categories: map everyday words using CATEGORIES (fashion → Shopping, utility bills → Utilities, rent → Stay…). Use the category names the app shows.
- "This month" means the current month in TODAY. If a time range isn't given, answer for this month and mention the all-time figure if it helps.
- Budget questions: compare this month's spending with MONTHLY BUDGET.
- Private items have no name on purpose; never guess what they were.
- If the ledger can't answer, say what's missing.
- If the person clearly says they spent money just now ("spent 200 on lunch", "add auto 60"), log it: set "log". Otherwise "log" is null. Never log when they only ask a question.

Return JSON only:
{"answer": string, "log": {"description": string, "amount": number, "category": one of Food|Groceries|Travel|Shopping|Stay|Fuel|Medical|Utilities|Entertainment|Misc} | null, "followUps": [up to 3 short questions they might ask next]}`;

router.post(
  "/ask-personal",
  requireAuth,
  aiLimit,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const { question, history } = req.body ?? {};
    if (typeof question !== "string" || !question.trim()) {
      res.status(400).json({ error: "question is required" });
      return;
    }
    const { key } = await groqKeyFor(userId);
    if (!key) {
      res.status(403).json({ error: "missing_key", message: "Groq API Key required. Please set it in your Profile." });
      return;
    }

    const [me, personal, bills] = await Promise.all([
      pool.query('SELECT name, monthly_budget::float AS budget FROM "User" WHERE id = $1', [userId]),
      pool.query(
        `SELECT description, amount::float AS amount, COALESCE(category, 'Misc') AS category, spent_at AS at
         FROM "PersonalExpense" WHERE user_id = $1 AND deleted_at IS NULL AND spent_at > now() - interval '13 months'
         ORDER BY spent_at DESC LIMIT 1500`,
        [userId]
      ),
      pool.query(
        `SELECT e.description, g.name AS group_name, e.category, e.created_at AS at, e.amount::float AS total,
                es.share_amount::float AS my_share, e.receipt_data, e.created_by,
                ARRAY(SELECT x.user_id::text FROM "ExpenseSplit" x WHERE x.expense_id = e.id) AS split_ids
         FROM "ExpenseSplit" es
         JOIN "Expense" e ON e.id = es.expense_id AND e.deleted_at IS NULL
         JOIN "Group" g ON g.id = e.group_id
         WHERE es.user_id = $1 AND es.share_amount > 0 AND e.created_at > now() - interval '13 months'
         ORDER BY e.created_at DESC LIMIT 400`,
        [userId]
      ),
    ]);

    const ledger = buildPersonalContext({
      me: { id: userId, name: me.rows[0]?.name ?? "you" },
      budget: me.rows[0]?.budget ?? null,
      personal: personal.rows,
      groupBills: bills.rows.map((b: any) => ({
        description: b.description,
        groupName: b.group_name,
        category: b.category,
        at: b.at,
        total: b.total,
        myShare: b.my_share,
        // the same masking every screen uses: other people's private items stay unnamed
        receiptData: maskReceipt(repairSharedBy(b.receipt_data, b.split_ids), userId, b.created_by),
      })),
    });

    const turns = (Array.isArray(history) ? history : [])
      .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string")
      .map((m: any) => ({ role: m.role as "user" | "assistant", content: String(m.content) }));

    const result = await chatWithKeys(userId, (ai, size) =>
      ai.groupChat(ledger, question.trim(), turns, { system: PERSONAL_SYSTEM, maxTurns: [6, 2, 0][size] }));
    if (!result) { res.status(403).json({ error: "missing_key", message: "Groq API Key required. Please set it in your Profile." }); return; }
    await bump(result.ok
      ? { ai_calls: 1, chat_questions: 1, ai_tokens_in: result.usage.in, ai_tokens_out: result.usage.out }
      : { ai_calls: 1, ai_failures: 1, chat_questions: 1 }, userId);
    if (!result.ok) {
      const { keys } = await groqLanesFor(userId, 0);
      const e = chatError(result, keys.length);
      res.status(e.status).json(e.body);
      return;
    }

    // "spent 200 on lunch": log it, with the same checks as the Spending tab.
    let logged: { id: string; description: string; amount: number; category: string } | null = null;
    const log = result.extra.log as { description?: unknown; amount?: unknown; category?: unknown } | null | undefined;
    if (log && typeof log === "object") {
      const amount = parseAmount(log.amount);
      const description = typeof log.description === "string" ? log.description.trim().slice(0, 80) : "";
      const category = (PERSONAL_CATEGORIES as readonly string[]).includes(String(log.category)) ? String(log.category) : "Misc";
      if (amount !== null && description) {
        const r = await pool.query(
          `INSERT INTO "PersonalExpense" (user_id, description, amount, category) VALUES ($1, $2, $3, $4) RETURNING id`,
          [userId, description, amount, category]
        );
        logged = { id: r.rows[0].id, description, amount, category };
      }
    }
    res.json({ answer: result.answer, followUps: result.followUps, logged });
  }
);

export default router;
