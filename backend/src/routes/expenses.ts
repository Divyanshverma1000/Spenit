/**
 * Expenses router — Stage 3 (Manual Entry, Equal & Exact splits)
 *
 * Architecture decisions respected:
 * - No `balance` column anywhere — balances are derived at read-time (Architecture.md §3)
 * - Soft-delete only on Expense.deleted_at — never a hard DELETE (DB_Design.md §1 rule 3)
 * - Idempotency key via Redis (Architecture.md §9) — prevents duplicate creation on retry
 * - Same endpoint that Stage 6 AI will call after parsing (Architecture.md §2)
 * - Equal split: share_amount computed server-side; remainder cents to first participant(s)
 * - sum(ExpensePayer.amount_paid) must == Expense.amount (server validated)
 * - sum(ExpenseSplit.share_amount) must == Expense.amount (server validated)
 */

import { Router, Request, Response } from "express";
import { Decimal } from "decimal.js";
import pool from "../db/pool";
import redis from "../db/redis";
import { requireAuth } from "../middleware/auth";
import { invalidateGroupBalanceCache } from "./balance";
import { sendToUsers } from "../push";

const router = Router();

// ─── Types ────────────────────────────────────────────────────────────────────

interface PayerInput {
  userId: string;
  amountPaid: number; // must sum to total amount
}

interface SplitInput {
  userId: string;
  shareAmount?: number;    // required for 'exact'; ignored for 'equal'/'fairshare'
  personalAmount?: number; // required for 'fairshare': sum of this person's personal items
}

interface CreateExpenseBody {
  groupId: string;
  description: string;
  amount: number;
  currency?: string;
  splitType: "equal" | "exact" | "fairshare";
  payers: PayerInput[];
  participants: SplitInput[]; // for 'exact': must include shareAmount; for 'equal'/'fairshare': list of userId + optional personalAmount
  /** Optional — AI-inferred or user-selected category. Stored in Expense.category (Tier 1 column, now active). */
  category?: string | null;
  /** Optional — JSON data representing itemized receipt details for Universal Fairshare */
  receiptData?: any;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a JS number to a Decimal with 2dp.
 * All money arithmetic uses Decimal.js to avoid IEEE 754 rounding errors.
 */
function toDecimal(n: number | string | null | undefined): Decimal {
  if (n === null || n === undefined || n === "" || isNaN(Number(n))) {
    throw new Error(`[DecimalError] Invalid argument: ${JSON.stringify(n)}`);
  }
  return new Decimal(n).toDecimalPlaces(2);
}

/**
 * Equal-split computation per Architecture.md §3 / task spec:
 * - Divide totalAmount evenly among participantCount.
 * - Remainder cents (due to rounding) go to the FIRST participant(s) in stable order.
 * Returns an array of share_amounts in the same order as participantUserIds.
 */
function computeEqualShares(totalAmount: Decimal, participantCount: number): Decimal[] {
  if (participantCount === 0) throw new Error("No participants");

  // Integer arithmetic in cents to avoid rounding issues
  const totalCents = totalAmount.mul(100).toDecimalPlaces(0);
  const baseShareCents = totalCents.divToInt(participantCount);
  const remainderCents = totalCents.minus(baseShareCents.mul(participantCount)).toNumber();

  return Array.from({ length: participantCount }, (_, i) => {
    const extra = i < remainderCents ? new Decimal(1) : new Decimal(0);
    return baseShareCents.plus(extra).div(100).toDecimalPlaces(2);
  });
}

// Idempotency key TTL — 24 hours in seconds
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

// ─── POST /expenses ───────────────────────────────────────────────────────────

router.post("/", requireAuth, async (req: Request, res: Response): Promise<void> => {
  // ── 1. Idempotency key check ──────────────────────────────────────────────
  const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
  const userId = req.user!.userId;

  if (idempotencyKey) {
    const redisKey = `idempotency:expense:${userId}:${idempotencyKey}`;
    const cached = await redis.get(redisKey);
    if (cached) {
      // Return the exact same response as the original successful request
      res.status(200).json(JSON.parse(cached));
      return;
    }
  }

  // ── 2. Parse & basic validation ───────────────────────────────────────────
  const body = req.body as CreateExpenseBody;
  const {
    groupId,
    description,
    amount: rawAmount,
    currency = "INR",
    splitType,
    payers = [],
    participants = [],
    category = null,
  } = body;

  if (!groupId) { res.status(400).json({ error: "groupId is required" }); return; }
  if (!description || description.trim().length === 0) { res.status(400).json({ error: "description is required" }); return; }
  if (!rawAmount || isNaN(rawAmount) || rawAmount <= 0) { res.status(400).json({ error: "amount must be a positive number" }); return; }
  if (!["equal", "exact", "fairshare"].includes(splitType)) { res.status(400).json({ error: "splitType must be 'equal', 'exact', or 'fairshare'" }); return; }
  if (payers.length === 0) { res.status(400).json({ error: "At least one payer is required" }); return; }
  if (participants.length === 0) { res.status(400).json({ error: "At least one participant is required" }); return; }

  const amount = toDecimal(rawAmount);

  // ── 3. Verify the requesting user is a member of the group ────────────────
  const memberCheck = await pool.query(
    'SELECT 1 FROM "GroupMember" WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  );
  if (memberCheck.rows.length === 0) {
    res.status(403).json({ error: "You are not a member of this group" });
    return;
  }

  // ── 4. Auto-fill single payer and validate payer amounts ─────────────────
  // If there's exactly 1 payer and no amountPaid given, they paid the full amount.
  if (payers.length === 1 && (!payers[0].amountPaid || isNaN(Number(payers[0].amountPaid)))) {
    payers[0].amountPaid = rawAmount;
  }

  const payerTotal = payers.reduce(
    (acc, p) => acc.plus(toDecimal(p.amountPaid)),
    new Decimal(0)
  );
  if (!payerTotal.equals(amount)) {
    res.status(400).json({
      error: `Payer amounts sum to ${payerTotal.toFixed(2)} but expense amount is ${amount.toFixed(2)}. They must be equal.`,
    });
    return;
  }

  // ── 5. Compute split shares ───────────────────────────────────────────────
  let splitShares: { userId: string; shareAmount: Decimal }[];

  if (splitType === "equal") {
    const shares = computeEqualShares(amount, participants.length);
    splitShares = participants.map((p, i) => ({
      userId: p.userId,
      shareAmount: shares[i],
    }));
  } else if (splitType === "fairshare") {
    /**
     * Fairshare algorithm:
     * 1. Each participant has a personalAmount (their private items, not shared).
     * 2. sharedPool = totalAmount - sum(all personalAmounts)
     * 3. Each participant's total share = personalAmount + (sharedPool / participantCount)
     *
     * personalAmount items can be entered as a list by the user (the UI sums them).
     * The server receives the final sum per participant as `personalAmount` on each
     * participant object (number, defaults to 0).
     *
     * Validation: sum(personalAmounts) must be < totalAmount.
     */
    const totalPersonal = participants.reduce(
      (acc, p) => acc.plus(toDecimal(p.personalAmount ?? 0)),
      new Decimal(0)
    );
    if (totalPersonal.greaterThan(amount)) {
      res.status(400).json({
        error: `Personal items total (${totalPersonal.toFixed(2)}) exceeds the bill total (${amount.toFixed(2)}). Personal items cannot exceed the bill.`,
      });
      return;
    }
    const sharedPool = amount.minus(totalPersonal);
    const equalShares = computeEqualShares(sharedPool, participants.length);
    splitShares = participants.map((p, i) => ({
      userId: p.userId,
      shareAmount: toDecimal(p.personalAmount ?? 0).plus(equalShares[i]).toDecimalPlaces(2),
    }));
  } else {
    // exact — client provides shareAmount for each participant
    for (const p of participants) {
      if (p.shareAmount === undefined || p.shareAmount === null) {
        res.status(400).json({
          error: `Participant ${p.userId} is missing shareAmount (required for split_type 'exact')`,
        });
        return;
      }
    }
    splitShares = participants.map((p) => ({
      userId: p.userId,
      shareAmount: toDecimal(p.shareAmount!),
    }));

    // Validate exact shares sum to total
    const splitTotal = splitShares.reduce(
      (acc, s) => acc.plus(s.shareAmount),
      new Decimal(0)
    );
    if (!splitTotal.equals(amount)) {
      res.status(400).json({
        error: `Participant share amounts sum to ${splitTotal.toFixed(2)} but expense amount is ${amount.toFixed(2)}. They must be equal.`,
      });
      return;
    }
  }

  // ── 6. Persist in a transaction ───────────────────────────────────────────
  const client = await pool.connect();
  let expenseResult: Record<string, unknown>;

  try {
    await client.query("BEGIN");

    // Insert Expense row
    const expenseRow = await client.query(
      `INSERT INTO "Expense"
         (group_id, description, amount, currency, split_type, category, receipt_data, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, group_id, description, amount, currency, split_type, category, receipt_data, created_by, created_at`,
      [groupId, description.trim(), amount.toFixed(2), currency, splitType, category || null, body.receiptData ? JSON.stringify(body.receiptData) : null, userId]
    );
    const expense = expenseRow.rows[0];

    // Insert ExpensePayer rows
    for (const payer of payers) {
      await client.query(
        `INSERT INTO "ExpensePayer" (expense_id, user_id, amount_paid) VALUES ($1, $2, $3)`,
        [expense.id, payer.userId, toDecimal(payer.amountPaid).toFixed(2)]
      );
    }

    // Insert ExpenseSplit rows
    for (const split of splitShares) {
      await client.query(
        `INSERT INTO "ExpenseSplit" (expense_id, user_id, share_amount) VALUES ($1, $2, $3)`,
        [expense.id, split.userId, split.shareAmount.toFixed(2)]
      );
    }

    await client.query("COMMIT");

    expenseResult = {
      id: expense.id,
      groupId: expense.group_id,
      description: expense.description,
      amount: expense.amount,
      currency: expense.currency,
      splitType: expense.split_type,
      category: expense.category,
      createdBy: expense.created_by,
      createdAt: expense.created_at,
      payers: payers.map((p) => ({
        userId: p.userId,
        amountPaid: toDecimal(p.amountPaid).toFixed(2),
      })),
      splits: splitShares.map((s) => ({
        userId: s.userId,
        shareAmount: s.shareAmount.toFixed(2),
      })),
    };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /expenses error:", err);
    res.status(500).json({ error: "Failed to create expense" });
    return;
  } finally {
    client.release();
  }

  // ── 7. Cache idempotency result + invalidate balance cache ────────────────
  if (idempotencyKey) {
    const redisKey = `idempotency:expense:${userId}:${idempotencyKey}`;
    // Fire-and-forget — don't block response on Redis write
    redis
      .set(redisKey, JSON.stringify(expenseResult), "EX", IDEMPOTENCY_TTL_SECONDS)
      .catch((err) => console.error("Redis idempotency write failed:", err));
  }

  // Invalidate balance cache for this group (Architecture.md §4)
  // Fire-and-forget — cache miss just means next read recomputes from DB
  invalidateGroupBalanceCache(body.groupId).catch((err) =>
    console.error("Balance cache invalidation failed:", err)
  );

  // ── 8. Push notifications — notify all OTHER group members ─────────────────
  // Fire-and-forget: push MUST NOT fail the HTTP response.
  ;(async () => {
    try {
      const [membersRes, creatorRes] = await Promise.all([
        pool.query('SELECT user_id FROM "GroupMember" WHERE group_id = $1', [body.groupId]),
        pool.query('SELECT name FROM "User" WHERE id = $1', [userId]),
      ]);
      const memberIds = membersRes.rows.map((r: { user_id: string }) => r.user_id);
      const addedByName = creatorRes.rows[0]?.name || "Someone";
      await sendToUsers(memberIds, {
        title: "💸 New expense added",
        body: `${addedByName} added "${description.trim()}" — ₹${amount.toFixed(2)}`,
        url: `/groups/${body.groupId}`,
        tag: `expense-${body.groupId}`,
      }, userId); // exclude the creator
    } catch (err) {
      console.error("[push] expense notification failed:", err);
    }
  })();

  res.status(201).json(expenseResult);
});

// ─── GET /expenses?groupId=:groupId ──────────────────────────────────────────
/**
 * List all non-deleted expenses for a group.
 * Requires the requesting user to be a member of the group.
 * Returns expenses with their payer and split details.
 */
router.get("/", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { groupId } = req.query as { groupId?: string };
  const userId = req.user!.userId;

  if (!groupId) { res.status(400).json({ error: "groupId query param is required" }); return; }

  const memberCheck = await pool.query(
    'SELECT 1 FROM "GroupMember" WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  );
  if (memberCheck.rows.length === 0) {
    res.status(403).json({ error: "You are not a member of this group" });
    return;
  }

  // Fetch expenses with payers and splits in a single query set
  const expenses = await pool.query(
      `SELECT e.id, e.description, e.amount, e.currency, e.split_type, e.receipt_data, e.category,
              e.created_by, e.created_at,
              u.name AS created_by_name, u.username AS created_by_username
     FROM "Expense" e
     JOIN "User" u ON u.id = e.created_by
     WHERE e.group_id = $1 AND e.deleted_at IS NULL
     ORDER BY e.created_at DESC`,
    [groupId]
  );

  if (expenses.rows.length === 0) {
    res.json([]);
    return;
  }

  const expenseIds = expenses.rows.map((e) => e.id);

  // Batch-fetch payers and splits
  const payers = await pool.query(
    `SELECT ep.expense_id, ep.user_id, ep.amount_paid, u.name, u.username
     FROM "ExpensePayer" ep JOIN "User" u ON u.id = ep.user_id
     WHERE ep.expense_id = ANY($1)`,
    [expenseIds]
  );

  const splits = await pool.query(
    `SELECT es.expense_id, es.user_id, es.share_amount, u.name, u.username
     FROM "ExpenseSplit" es JOIN "User" u ON u.id = es.user_id
     WHERE es.expense_id = ANY($1)`,
    [expenseIds]
  );

  // Build lookup maps
  const payersByExpense: Record<string, typeof payers.rows> = {};
  for (const p of payers.rows) {
    if (!payersByExpense[p.expense_id]) payersByExpense[p.expense_id] = [];
    payersByExpense[p.expense_id].push(p);
  }

  const splitsByExpense: Record<string, typeof splits.rows> = {};
  for (const s of splits.rows) {
    if (!splitsByExpense[s.expense_id]) splitsByExpense[s.expense_id] = [];
    splitsByExpense[s.expense_id].push(s);
  }

  res.json(
    expenses.rows.map((e) => ({
      id: e.id,
      description: e.description,
      amount: e.amount,
      currency: e.currency,
      splitType: e.split_type,
      category: e.category,
      receiptData: e.receipt_data,
      createdBy: { id: e.created_by, name: e.created_by_name, username: e.created_by_username },
      createdAt: e.created_at,
      payers: (payersByExpense[e.id] || []).map((p) => ({
        userId: p.user_id,
        name: p.name,
        username: p.username,
        amountPaid: p.amount_paid,
      })),
      splits: (splitsByExpense[e.id] || []).map((s) => ({
        userId: s.user_id,
        name: s.name,
        username: s.username,
        shareAmount: s.share_amount,
      })),
    }))
  );
});

// ─── DELETE /expenses/:id (soft-delete) ───────────────────────────────────────
/**
 * Soft-delete an expense. Only the expense creator can delete it.
 * NEVER a hard delete — DB_Design.md §1 rule 3.
 */
router.delete("/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.userId;

  const expense = await pool.query(
    'SELECT id, created_by, group_id FROM "Expense" WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );

  if (expense.rows.length === 0) {
    res.status(404).json({ error: "Expense not found" });
    return;
  }

  const e = expense.rows[0];

  // Only the creator can soft-delete (group admins will be able to in a future tier)
  if (e.created_by !== userId) {
    res.status(403).json({ error: "Only the expense creator can delete this expense" });
    return;
  }

  await pool.query(
    'UPDATE "Expense" SET deleted_at = now(), updated_at = now() WHERE id = $1',
    [id]
  );

  res.json({ message: "Expense deleted", id });
});

export default router;
