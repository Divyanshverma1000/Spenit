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
import { strictLimit } from "../lib/strictLimit";
import { bump } from "../lib/telemetry";

/** AI calls cost money and share the Groq quota: an exact limit per account, across every server. */
const aiLimit = strictLimit("ai", [
  { limit: 20, seconds: 60, message: "That's a lot of AI requests at once. Wait a minute and try again." },
  { limit: 400, seconds: 86_400, message: "You've reached today's AI limit. It resets tomorrow." },
]);
import { buildGroupContext } from "../lib/groupAiContext";
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
    }>(
      `SELECT u.id, COALESCE(gm.nickname, u.name) AS name, u.username
       FROM "GroupMember" gm
       JOIN "User" u ON u.id = gm.user_id
       WHERE gm.group_id = $1
       ORDER BY (gm.user_id = $2) DESC, COALESCE(gm.nickname, u.name) ASC`,
      [groupId, userId]
    );

    const groupContext: GroupMember[] = membersRes.rows;

    const apiKey = (await groqKeyFor(userId)).key ?? "";
    
    // ── 3. Call AI provider ────────────────────────────────────────────────────
    const startMs = Date.now();
    const ai = new GroqProvider(apiKey);
    
    let result;
    try {
      result = await ai.parseExpenseText(text.trim(), groupContext);
    } catch (e) {
      result = { fallback: true, reason: "config_error", rawText: text.trim() };
    }
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
    const draft = result as ParsedExpenseDraft;
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

// ─── Groq key ──────────────────────────────────────────────────────────────────

/** The user's own key wins; otherwise the server's GROQ_API_KEY secret, if one is set. */
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
    await bump({ ai_calls: 1, receipt_scans: 1, ...(result && "fallback" in result ? { ai_failures: 1 } : {}) });

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
  aiLimit,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const { imageBase64 } = req.body as { imageBase64?: string };

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

    const { key, source } = await groqKeyFor(userId);
    if (!key) {
      res.json({ fallback: true, reason: "config_error", stage: "config", message: "No Groq API key configured", rawText: "" });
      return;
    }

    const result = await new GroqProvider(key).extractOrder({ imageBase64 });
    await bump(result.ok
      ? { ai_calls: 1, order_reads: 1, ai_tokens_in: result.usage?.promptTokens ?? 0, ai_tokens_out: result.usage?.completionTokens ?? 0 }
      : { ai_calls: 1, ai_failures: 1 });
    if (!result.ok) {
      console.warn(
        `[ai] stage=EXTRACT_FAILED at=${result.stage} reason=${result.reason} status=${result.status ?? "-"} model=${result.model} keySource=${source} msg=${(result.message ?? "").slice(0, 160)}`
      );
      res.json({
        fallback: true,
        reason: result.reason,
        stage: result.stage,
        status: result.status,
        message: result.message,
        model: result.model,
        retryAfterMs: result.retryAfterMs,
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

    const ctx = buildGroupContext({
      groupName: membersRes.rows[0]?.group_name ?? "this group",
      viewerId: userId,
      members: membersRes.rows.map((m: { id: string; name: string; is_placeholder: boolean }) => ({ id: m.id, name: m.name, isPlaceholder: m.is_placeholder })),
      expenses,
      settlements,
      balance,
    });

    const turns = (Array.isArray(history) ? history : [])
      .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string")
      .map((m: any) => ({ role: m.role as "user" | "assistant", content: String(m.content) }));

    const result = await new GroqProvider(key).groupChat(ctx.text, question.trim(), turns);
    await bump(result.ok
      ? { ai_calls: 1, chat_questions: 1, ai_tokens_in: result.usage.in, ai_tokens_out: result.usage.out }
      : { ai_calls: 1, ai_failures: 1, chat_questions: 1 });
    if (!result.ok) {
      const status = result.reason === "rate_limit" ? 429 : result.reason === "config_error" ? 502 : 503;
      res.status(status).json({ error: result.reason, message: result.message, retryAfterMs: result.retryAfterMs });
      return;
    }
    res.json({
      answer: result.answer,
      expenseIds: result.refs.map((r) => ctx.refs[r]).filter(Boolean),
      followUps: result.followUps,
    });
  }
);



// ─── POST /ai/ask-personal ───────────────────────────────────────────────────
/**
 * Stage 6B: Conversational Ledger Intelligence for Personal Expenses.
 * Fetch user's personal expenses, then ask AI to answer.
 *
 * Body: { question: string }
 */
router.post(
  "/ask-personal",
  requireAuth,
  aiLimit,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const { question } = req.body;

    if (!question || question.trim().length === 0) {
      res.status(400).json({ error: "question is required" });
      return;
    }

    const userRes = await pool.query('SELECT name FROM "User" WHERE id = $1', [userId]);
    const apiKey = (await groqKeyFor(userId)).key;
    const userName = userRes.rows[0]?.name;
    
    if (!apiKey) {
      res.status(403).json({ error: "missing_key", message: "Groq API Key required. Please set it in your Profile." });
      return;
    }

    // Fetch personal expenses
    const expRes = await pool.query(
      `SELECT id, description, amount, currency, category, created_at
       FROM "PersonalExpense"
       WHERE user_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 100`,
      [userId]
    );

    // Fetch group expenses the user is involved in
    const groupExpRes = await pool.query(
      `SELECT e.id, e.description, e.amount, e.currency, e.category, e.created_at, g.name as group_name
       FROM "Expense" e
       JOIN "Group" g ON g.id = e.group_id
       JOIN "GroupMember" gm ON gm.group_id = e.group_id
       WHERE gm.user_id = $1 AND e.deleted_at IS NULL
       ORDER BY e.created_at DESC LIMIT 50`,
      [userId]
    );

    const context = {
      members: [{ id: userId, name: userName, username: "me" }],
      personalExpenses: expRes.rows,
      groupExpenses: groupExpRes.rows,
    };

    try {
      const ai = new GroqProvider(apiKey);
      const result = await ai.answerLedgerQuery(question, context);
      
      if (result.action === "log" && result.logDetails) {
        await pool.query(
          `INSERT INTO "PersonalExpense" (user_id, description, amount, currency, category)
           VALUES ($1, $2, $3, 'INR', $4)`,
          [userId, result.logDetails.description, result.logDetails.amount, result.logDetails.category || 'Misc']
        );
      }

      res.json(result);
    } catch (err: any) {
      console.error("[ai] ask-personal failed:", err);
      res.status(500).json({ error: err.message || "AI request failed" });
    }
  }
);

export default router;
