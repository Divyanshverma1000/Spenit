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
 */

import { Router, Request, Response } from "express";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { GroqProvider } from "../ai/GroqProvider";
import type { GroupMember, ParsedExpenseDraft } from "../ai/AIProvider";

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
      `SELECT u.id, u.name, u.username
       FROM "GroupMember" gm
       JOIN "User" u ON u.id = gm.user_id
       WHERE gm.group_id = $1
       ORDER BY (gm.user_id = $2) DESC, u.name ASC`,
      [groupId, userId]
    );

    const groupContext: GroupMember[] = membersRes.rows;

    const userRes = await pool.query('SELECT groq_api_key FROM "User" WHERE id = $1', [userId]);
    const apiKey = userRes.rows[0]?.groq_api_key;
    
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

// ─── POST /ai/parse-receipt ────────────────────────────────────────────────────
/**
 * Phase 6B stub — receipt OCR.
 * Accepts a base64 image but currently returns a fallback (vision model integration
 * deferred to Phase 6B). The frontend shows the manual form with a "coming soon" toast.
 */
router.post(
  "/parse-receipt",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const { imageBase64, groupId } = req.body as {
      imageBase64?: string;
      groupId?: string;
    };

    if (!groupId) {
      res.status(400).json({ error: "groupId is required" });
      return;
    }
    if (!imageBase64) {
      res.status(400).json({ error: "imageBase64 is required" });
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

    // Fetch group context
    const membersRes = await pool.query<{
      id: string;
      name: string;
      username: string;
    }>(
      `SELECT u.id, u.name, u.username
       FROM "GroupMember" gm
       JOIN "User" u ON u.id = gm.user_id
       WHERE gm.group_id = $1
       ORDER BY (gm.user_id = $2) DESC, u.name ASC`,
      [groupId, userId]
    );

    const userRes = await pool.query('SELECT groq_api_key FROM "User" WHERE id = $1', [userId]);
    const apiKey = userRes.rows[0]?.groq_api_key;
    const ai = new GroqProvider(apiKey);
    
    let result;
    try {
      result = await ai.parseReceiptImage(imageBase64, membersRes.rows);
    } catch (e) {
      result = { fallback: true, reason: "config_error", rawText: "[receipt image]" };
    }

    // Stub always returns fallback — Phase 6B will implement vision model
    res.json({ ...result, stubMessage: "Receipt OCR coming in Phase 6B" });
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
 * Stage 6B: Conversational Ledger Intelligence.
 * Fetch all read-only ledger data for a group, then ask the AI to answer the user's question based on it.
 *
 * Body: { groupId: string, question: string }
 */
router.post(
  "/query",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const { groupId, question } = req.body;

    if (!groupId || !question || question.trim().length === 0) {
      res.status(400).json({ error: "groupId and question are required" });
      return;
    }

    // 1. Verify membership
    const memberCheck = await pool.query(
      'SELECT 1 FROM "GroupMember" WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );
    if (memberCheck.rows.length === 0) {
      res.status(403).json({ error: "You are not a member of this group" });
      return;
    }

    // 2. Fetch User's API Key
    const userRes = await pool.query('SELECT groq_api_key FROM "User" WHERE id = $1', [userId]);
    const apiKey = userRes.rows[0]?.groq_api_key;
    if (!apiKey) {
      res.status(403).json({ error: "missing_key", message: "Groq API Key required. Please set it in your Profile." });
      return;
    }

    // 3. Fetch all context (Members, Expenses, Settlements, Balances)
    // We reuse existing balance/expense endpoints logic here by fetching directly
    const membersRes = await pool.query(
      `SELECT u.id, u.name, u.username
       FROM "GroupMember" gm JOIN "User" u ON u.id = gm.user_id
       WHERE gm.group_id = $1 ORDER BY (gm.user_id = $2) DESC, u.name ASC`,
      [groupId, userId]
    );
    const members = membersRes.rows;

    const expensesRes = await pool.query(
      `SELECT e.id, e.description, e.amount, e.currency, e.category, e.created_at, u.name as added_by
       FROM "Expense" e
       JOIN "User" u ON u.id = e.created_by
       WHERE e.group_id = $1 AND e.deleted_at IS NULL
       ORDER BY e.created_at DESC LIMIT 50`,
      [groupId]
    );
    const expenses = expensesRes.rows;

    // Fetch balances via HTTP or require the balance logic? 
    // It's cleaner to just fetch what we can. For Stage 6B, AI needs raw context.
    const settlementsRes = await pool.query(
      `SELECT s.id, s.amount, s.status, s.method, s.created_at,
              f.name as from_user, t.name as to_user
       FROM "Settlement" s
       JOIN "User" f ON f.id = s.from_user
       JOIN "User" t ON t.id = s.to_user
       WHERE s.group_id = $1 AND s.deleted_at IS NULL
       ORDER BY s.created_at DESC`,
      [groupId]
    );
    const settlements = settlementsRes.rows;

    const context = { members, expenses, settlements, balances: [] };

    try {
      const ai = new GroqProvider(apiKey);
      const answer = await ai.answerLedgerQuery(question.trim(), context);
      res.json(answer);
    } catch (err: any) {
      console.error("[ai/query] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
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
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.userId;
    const { question } = req.body;

    if (!question || question.trim().length === 0) {
      res.status(400).json({ error: "question is required" });
      return;
    }

    const userRes = await pool.query('SELECT name, groq_api_key FROM "User" WHERE id = $1', [userId]);
    const apiKey = userRes.rows[0]?.groq_api_key;
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

    const context = {
      members: [{ id: userId, name: userName, username: "me" }],
      personalExpenses: expRes.rows,
    };

    try {
      const ai = new GroqProvider(apiKey);
      const result = await ai.answerLedgerQuery(question, context);
      res.json(result);
    } catch (err: any) {
      console.error("[ai] ask-personal failed:", err);
      res.status(500).json({ error: err.message || "AI request failed" });
    }
  }
);

export default router;
