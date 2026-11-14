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
import { requireAuth } from "../middleware/auth";
import { invalidateGroupBalanceCache } from "./balance";
import { sendToUsers } from "../push";
import { computeItemizedShares, FeePolicy } from "../lib/itemizedSplit";
import { maskReceipt, restoreMasked, setItemVisibility, repairSharedBy } from "../lib/receiptPrivacy";
import { logActivity, logActivitySafe, expenseSnapshot } from "../lib/groupSafety";
import { MAX_AMOUNT, MAX_DESCRIPTION, MAX_RECEIPT_JSON, amountError } from "../lib/limits";
import type { PoolClient } from "pg";

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
  splitType: SplitType;
  payers: PayerInput[];
  participants: SplitInput[]; // for 'exact': must include shareAmount; for 'equal'/'fairshare': list of userId + optional personalAmount
  /** Optional — AI-inferred or user-selected category. Stored in Expense.category (Tier 1 column, now active). */
  category?: string | null;
  /** Optional — JSON data representing itemized receipt details for Universal Fairshare */
  receiptData?: any;
}

type SplitType = "equal" | "exact" | "fairshare" | "itemized";
const SPLIT_TYPES: SplitType[] = ["equal", "exact", "fairshare", "itemized"];

/**
 * receiptData for split_type 'itemized' (one imported order — BulkOrderSplit_Plan.md §4).
 * The server computes every share from this; participants in the body are ignored.
 */
interface ItemizedReceiptData {
  items: { name: string; lineTotal: number; sharedBy: string[] }[];
  fees?: { label?: string; amount: number }[];
  discounts?: { label?: string; amount: number }[];
  feePolicy?: FeePolicy;
  orderKey?: string; // "platform:orderId" — used to spot double imports
}

/** Where prepareExpense reports a validation failure (an Express Response, or a collector for batches). */
interface ErrorSink {
  status(code: number): { json(body: unknown): unknown };
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

/** Idempotency keys are kept for 7 days (see index.ts for the periodic cleanup). */
const MAX_IDEMPOTENCY_KEY_LENGTH = 100;

/** Everything validated and computed, ready to be written. */
interface PreparedExpense {
  groupId: string;
  description: string;
  amount: Decimal;
  currency: string;
  splitType: SplitType;
  category: string | null;
  receiptData: unknown;
  payers: PayerInput[];
  splitShares: { userId: string; shareAmount: Decimal }[];
}

/**
 * Validate an expense payload and compute the split shares. Shared by create and edit,
 * so editing can never bypass a rule that creating enforces.
 * On failure it has already sent the 400/403 response and returns null.
 */
async function prepareExpense(
  body: CreateExpenseBody,
  userId: string,
  res: ErrorSink
): Promise<PreparedExpense | null> {
  // ── 2. Parse & basic validation ───────────────────────────────────────────
  const {
    groupId,
    description,
    amount: rawAmount,
    currency = "INR",
    splitType,
    payers = [],
    category = null,
  } = body;
  let participants = body.participants ?? [];

  // Itemized: who shares what lives in receiptData; participants are derived from it.
  const itemized = splitType === "itemized" ? (body.receiptData as ItemizedReceiptData | undefined) : undefined;
  if (splitType === "itemized") {
    if (!itemized || !Array.isArray(itemized.items) || itemized.items.length === 0) {
      res.status(400).json({ error: "receiptData.items is required for split_type 'itemized'" });
      return null;
    }
    if (itemized.items.length > 300) { res.status(400).json({ error: "Too many items in one expense" }); return null; }
    participants = Array.from(new Set(itemized.items.flatMap((i) => (Array.isArray(i.sharedBy) ? i.sharedBy : [])))).map(
      (id) => ({ userId: String(id) })
    );
  }

  if (!groupId) { res.status(400).json({ error: "groupId is required" }); return null; }
  if (!description || description.trim().length === 0) { res.status(400).json({ error: "description is required" }); return null; }
  if (!rawAmount || isNaN(rawAmount) || rawAmount <= 0 || Number(rawAmount) > MAX_AMOUNT) { res.status(400).json({ error: amountError() }); return null; }
  if (description.trim().length > MAX_DESCRIPTION) { res.status(400).json({ error: `Keep the name under ${MAX_DESCRIPTION} characters` }); return null; }
  if (body.receiptData != null && JSON.stringify(body.receiptData).length > MAX_RECEIPT_JSON) { res.status(413).json({ error: "This bill has too much item data to save" }); return null; }
  if (!SPLIT_TYPES.includes(splitType)) { res.status(400).json({ error: "splitType must be 'equal', 'exact', 'fairshare' or 'itemized'" }); return null; }
  if (payers.length === 0) { res.status(400).json({ error: "At least one payer is required" }); return null; }
  if (participants.length === 0) { res.status(400).json({ error: "At least one participant is required" }); return null; }

  const amount = toDecimal(rawAmount);

  // ── 3. Verify the requesting user is a member of the group ────────────────
  const memberCheck = await pool.query(
    'SELECT 1 FROM "GroupMember" WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  );
  if (memberCheck.rows.length === 0) {
    res.status(403).json({ error: "You are not a member of this group" });
    return null;
  }

  // Every payer and participant must belong to this group (real or not-yet-joined).
  const referencedIds = Array.from(
    new Set([...payers.map((p) => p.userId), ...participants.map((p) => p.userId)])
  );
  const validMembers = await pool.query(
    'SELECT user_id FROM "GroupMember" WHERE group_id = $1 AND user_id = ANY($2::uuid[])',
    [groupId, referencedIds]
  );
  if (validMembers.rows.length !== referencedIds.length) {
    res.status(400).json({ error: "All payers and participants must be members of the group" });
    return null;
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
    return null;
  }

  // ── 5. Compute split shares ───────────────────────────────────────────────
  let splitShares: { userId: string; shareAmount: Decimal }[];

  if (splitType === "itemized") {
    const feePolicy: FeePolicy = ["proportional", "equal", "payer"].includes(itemized!.feePolicy as string)
      ? itemized!.feePolicy!
      : "proportional";
    // The biggest payer carries the extras under the 'payer' fee policy.
    const mainPayer = [...payers].sort((a, b) => Number(b.amountPaid) - Number(a.amountPaid))[0].userId;
    let result;
    try {
      result = computeItemizedShares({
        amount,
        payerId: mainPayer,
        items: itemized!.items.map((i) => ({ lineTotal: toDecimal(i.lineTotal).toFixed(2), sharedBy: i.sharedBy })),
        fees: (itemized!.fees ?? []).map((f) => ({ amount: toDecimal(f.amount).toFixed(2) })),
        discounts: (itemized!.discounts ?? []).map((d) => ({ amount: toDecimal(Math.abs(Number(d.amount))).toFixed(2) })),
        feePolicy,
      });
    } catch {
      res.status(400).json({ error: "Every item, fee and discount needs a valid amount" });
      return null;
    }
    if (!result.ok) { res.status(400).json({ error: result.error }); return null; }
    splitShares = result.shares;
  } else if (splitType === "equal") {
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
      return null;
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
        return null;
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
      return null;
    }
  }

  return {
    groupId,
    description: description.trim(),
    amount,
    currency,
    splitType,
    category: category || null,
    receiptData: body.receiptData ?? null,
    payers,
    splitShares,
  };
}

/** Write one prepared expense (Expense + payer + split rows) inside the caller's transaction. */
async function insertExpense(
  client: PoolClient,
  prepared: PreparedExpense,
  userId: string
): Promise<Record<string, unknown>> {
  const { groupId, description, amount, currency, splitType, category, receiptData, payers, splitShares } = prepared;

  // Insert Expense row
  const expenseRow = await client.query(
    `INSERT INTO "Expense"
       (group_id, description, amount, currency, split_type, category, receipt_data, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, group_id, description, amount, currency, split_type, category, receipt_data, created_by, created_at`,
    [groupId, description.trim(), amount.toFixed(2), currency, splitType, category || null, receiptData ? JSON.stringify(receiptData) : null, userId]
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

  const snap = await expenseSnapshot(client, expense.id);
  await logActivity(client, { groupId, actorId: userId, kind: "expense_added", expenseId: expense.id, summary: { after: snap } });

  return {
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
}

// ─── POST /expenses ───────────────────────────────────────────────────────────

router.post("/", requireAuth, async (req: Request, res: Response): Promise<void> => {
  // ── 1. Idempotency key check ──────────────────────────────────────────────
  const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
  const userId = req.user!.userId;

  if (idempotencyKey) {
    if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      res.status(400).json({ error: "Idempotency-Key is too long" });
      return;
    }
    // A retry of a request that already succeeded: return the exact same response.
    const prior = await pool.query(
      'SELECT response FROM "IdempotencyKey" WHERE user_id = $1 AND key = $2',
      [userId, idempotencyKey]
    );
    if (prior.rows.length > 0) {
      res.status(200).json(prior.rows[0].response);
      return;
    }
  }

  // ── 2–5. Validate + compute shares (shared with edit) ────────────────────
  const body = req.body as CreateExpenseBody;
  const prepared = await prepareExpense(body, userId, res);
  if (!prepared) return;
  const { description, amount } = prepared;

  // ── 6. Persist in a transaction ───────────────────────────────────────────
  const client = await pool.connect();
  let expenseResult: Record<string, unknown>;

  try {
    await client.query("BEGIN");

    expenseResult = await insertExpense(client, prepared, userId);

    // Record the idempotency key in the SAME transaction as the expense. If a concurrent
    // duplicate request got there first, undo ours and return its stored response.
    if (idempotencyKey) {
      const stored = await client.query(
        `INSERT INTO "IdempotencyKey" (user_id, key, response) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, key) DO NOTHING RETURNING key`,
        [userId, idempotencyKey, JSON.stringify(expenseResult)]
      );
      if (stored.rows.length === 0) {
        await client.query("ROLLBACK");
        const winner = await pool.query(
          'SELECT response FROM "IdempotencyKey" WHERE user_id = $1 AND key = $2',
          [userId, idempotencyKey]
        );
        res.status(200).json(winner.rows[0]?.response ?? expenseResult);
        return;
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /expenses error:", err);
    res.status(500).json({ error: "Failed to create expense" });
    return;
  } finally {
    client.release();
  }

  // ── 7. Invalidate the balance cache ───────────────────────────────────────
  // Invalidate balance cache for this group (Architecture.md §4)
  // Fire-and-forget — cache miss just means next read recomputes from DB
  invalidateGroupBalanceCache(body.groupId).catch((err) =>
    console.error("Balance cache invalidation failed:", err)
  );

  // ── 8. Push notifications — notify all OTHER group members ─────────────────
  // Push must never fail the request (errors are caught inside).
  // Awaited: on Workers, work still running after the reply is cut off.
  await (async () => {
    try {
      const [membersRes, creatorRes] = await Promise.all([
        pool.query('SELECT user_id FROM "GroupMember" WHERE group_id = $1', [body.groupId]),
        pool.query(
          `SELECT COALESCE(gm.nickname, u.name) AS name
           FROM "User" u LEFT JOIN "GroupMember" gm ON gm.group_id = $2 AND gm.user_id = u.id
           WHERE u.id = $1`,
          [userId, body.groupId]
        ),
      ]);
      const memberIds = membersRes.rows.map((r: { user_id: string }) => r.user_id);
      const addedByName = creatorRes.rows[0]?.name || "Someone";
      await sendToUsers(memberIds, {
        title: "New expense added",
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

// ─── POST /expenses/batch ─────────────────────────────────────────────────────
/**
 * Bulk order import (BulkOrderSplit_Plan.md §4): up to 30 expenses in ONE group, all or nothing.
 * Every expense goes through the same prepareExpense rules as a single create.
 * One Idempotency-Key covers the whole batch; one push notification for all of it.
 *
 * Body: { groupId, expenses: CreateExpenseBody[] }
 * Returns 201 { expenses: [...] } | 400 { error, index } | 409 { error, duplicateOrderKeys }
 */
const MAX_BATCH = 30;

router.post("/batch", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
  const userId = req.user!.userId;
  const { groupId, expenses } = req.body as { groupId?: string; expenses?: CreateExpenseBody[] };

  if (!groupId) { res.status(400).json({ error: "groupId is required" }); return; }
  if (!Array.isArray(expenses) || expenses.length === 0) { res.status(400).json({ error: "expenses is required" }); return; }
  if (expenses.length > MAX_BATCH) { res.status(400).json({ error: `At most ${MAX_BATCH} expenses per batch` }); return; }

  if (idempotencyKey) {
    if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      res.status(400).json({ error: "Idempotency-Key is too long" });
      return;
    }
    const prior = await pool.query(
      'SELECT response FROM "IdempotencyKey" WHERE user_id = $1 AND key = $2',
      [userId, idempotencyKey]
    );
    if (prior.rows.length > 0) {
      res.status(200).json(prior.rows[0].response);
      return;
    }
  }

  // Validate everything before writing anything.
  const prepared: PreparedExpense[] = [];
  for (const [index, e] of expenses.entries()) {
    let failure: { code: number; body: any } | null = null;
    const collector: ErrorSink = {
      status: (code) => ({ json: (body) => (failure = { code, body }) }),
    };
    const p = await prepareExpense({ ...e, groupId }, userId, collector);
    if (!p) {
      const f = failure as { code: number; body: any } | null;
      res.status(f?.code ?? 400).json({ ...(f?.body ?? { error: "Invalid expense" }), index });
      return;
    }
    prepared.push(p);
  }

  // The same order can't be imported twice into a group (even from another phone).
  const orderKeys = prepared
    .map((p) => (p.receiptData as ItemizedReceiptData | null)?.orderKey)
    .filter((k): k is string => typeof k === "string" && k.length > 0);
  if (orderKeys.length > 0) {
    const dup = await pool.query(
      `SELECT DISTINCT receipt_data->>'orderKey' AS key FROM "Expense"
       WHERE group_id = $1 AND deleted_at IS NULL AND receipt_data->>'orderKey' = ANY($2::text[])`,
      [groupId, orderKeys]
    );
    if (dup.rows.length > 0) {
      res.status(409).json({
        error: "Some of these orders were already added to this group",
        duplicateOrderKeys: dup.rows.map((r: { key: string }) => r.key),
      });
      return;
    }
  }

  const client = await pool.connect();
  let response: { expenses: Record<string, unknown>[] };
  try {
    await client.query("BEGIN");
    const created: Record<string, unknown>[] = [];
    for (const p of prepared) created.push(await insertExpense(client, p, userId));
    response = { expenses: created };

    if (idempotencyKey) {
      const stored = await client.query(
        `INSERT INTO "IdempotencyKey" (user_id, key, response) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, key) DO NOTHING RETURNING key`,
        [userId, idempotencyKey, JSON.stringify(response)]
      );
      if (stored.rows.length === 0) {
        await client.query("ROLLBACK");
        const winner = await pool.query(
          'SELECT response FROM "IdempotencyKey" WHERE user_id = $1 AND key = $2',
          [userId, idempotencyKey]
        );
        res.status(200).json(winner.rows[0]?.response ?? response);
        return;
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /expenses/batch error:", err);
    res.status(500).json({ error: "Failed to create expenses" });
    return;
  } finally {
    client.release();
  }

  invalidateGroupBalanceCache(groupId).catch((err) =>
    console.error("Balance cache invalidation failed:", err)
  );

  // One push for the whole import, not one per order.
  // Awaited: on Workers, work still running after the reply is cut off.
  await (async () => {
    try {
      const [membersRes, creatorRes] = await Promise.all([
        pool.query('SELECT user_id FROM "GroupMember" WHERE group_id = $1', [groupId]),
        pool.query(
          `SELECT COALESCE(gm.nickname, u.name) AS name
           FROM "User" u LEFT JOIN "GroupMember" gm ON gm.group_id = $2 AND gm.user_id = u.id
           WHERE u.id = $1`,
          [userId, groupId]
        ),
      ]);
      const memberIds = membersRes.rows.map((r: { user_id: string }) => r.user_id);
      const addedByName = creatorRes.rows[0]?.name || "Someone";
      const total = prepared.reduce((a, p) => a.plus(p.amount), new Decimal(0));
      await sendToUsers(memberIds, {
        title: "Orders added",
        body: `${addedByName} added ${prepared.length} order${prepared.length > 1 ? "s" : ""} — ₹${total.toFixed(2)}`,
        url: `/groups/${groupId}`,
        tag: `expense-${groupId}`,
      }, userId);
    } catch (err) {
      console.error("[push] batch notification failed:", err);
    }
  })();

  res.status(201).json(response);
});

// ─── POST /expenses/order-keys ────────────────────────────────────────────────
/**
 * Which of these imported orders are already in the group? Lets the import screen mark
 * "Already added" while reading, before the user spends any taps on them.
 * Body: { groupId, keys: string[] } → { existing: { key, expenseId, createdAt }[] }
 */
router.post("/order-keys", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { groupId, keys } = req.body as { groupId?: string; keys?: string[] };
  if (!groupId || !Array.isArray(keys)) { res.status(400).json({ error: "groupId and keys are required" }); return; }

  const member = await pool.query(
    'SELECT 1 FROM "GroupMember" WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  );
  if (member.rows.length === 0) { res.status(403).json({ error: "You are not a member of this group" }); return; }

  const clean = keys.filter((k) => typeof k === "string" && k.length > 0).slice(0, 100);
  if (clean.length === 0) { res.json({ existing: [] }); return; }
  const rows = await pool.query(
    `SELECT receipt_data->>'orderKey' AS key, id, created_at FROM "Expense"
     WHERE group_id = $1 AND deleted_at IS NULL AND receipt_data->>'orderKey' = ANY($2::text[])`,
    [groupId, clean]
  );
  res.json({
    existing: rows.rows.map((r: { key: string; id: string; created_at: string }) => ({
      key: r.key,
      expenseId: r.id,
      createdAt: r.created_at,
    })),
  });
});

/**
 * Non-deleted expenses for a group with payers/splits (display names = nicknames).
 * Item lists are shown as `viewerId` may see them: other people's private items are masked.
 */
export async function listGroupExpenses(groupId: string, viewerId: string) {
  // Fetch expenses with payers and splits in a single query set
  const expenses = await pool.query(
      `SELECT e.id, e.description, e.amount, e.currency, e.split_type, e.receipt_data, e.category,
              e.created_by, e.created_at, e.updated_at,
              COALESCE(gm.nickname, u.name) AS created_by_name, u.username AS created_by_username
     FROM "Expense" e
     JOIN "User" u ON u.id = e.created_by
     LEFT JOIN "GroupMember" gm ON gm.group_id = e.group_id AND gm.user_id = e.created_by
     WHERE e.group_id = $1 AND e.deleted_at IS NULL
     ORDER BY e.created_at DESC`,
    [groupId]
  );

  if (expenses.rows.length === 0) {
    return [];
  }

  const expenseIds = expenses.rows.map((e) => e.id);

  // Batch-fetch payers and splits
  const payers = await pool.query(
    `SELECT ep.expense_id, ep.user_id, ep.amount_paid, COALESCE(gm.nickname, u.name) AS name, u.username
     FROM "ExpensePayer" ep
     JOIN "User" u ON u.id = ep.user_id
     LEFT JOIN "GroupMember" gm ON gm.group_id = $2 AND gm.user_id = ep.user_id
     WHERE ep.expense_id = ANY($1)`,
    [expenseIds, groupId]
  );

  const splits = await pool.query(
    `SELECT es.expense_id, es.user_id, es.share_amount, COALESCE(gm.nickname, u.name) AS name, u.username
     FROM "ExpenseSplit" es
     JOIN "User" u ON u.id = es.user_id
     LEFT JOIN "GroupMember" gm ON gm.group_id = $2 AND gm.user_id = es.user_id
     WHERE es.expense_id = ANY($1)`,
    [expenseIds, groupId]
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

  return expenses.rows.map((e) => ({
      id: e.id,
      description: e.description,
      amount: e.amount,
      currency: e.currency,
      splitType: e.split_type,
      category: e.category,
      receiptData: maskReceipt(
        repairSharedBy(e.receipt_data, (splitsByExpense[e.id] || []).map((s) => s.user_id)),
        viewerId,
        e.created_by
      ),
      createdBy: { id: e.created_by, name: e.created_by_name, username: e.created_by_username },
      createdAt: e.created_at,
      // set only when the expense was changed after being created
      editedAt: new Date(e.updated_at).getTime() - new Date(e.created_at).getTime() > 5000 ? e.updated_at : null,
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
  }));
}

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

  res.json(await listGroupExpenses(groupId, userId));
});

// ─── PUT /expenses/:id (edit) ─────────────────────────────────────────────────
/**
 * Edit an expense in place. Allowed for the creator or the group admin.
 * The whole payload is re-validated exactly like a create (same rules), then the
 * expense row is updated and its payer/split rows are replaced in ONE transaction.
 * The group can't be changed. updated_at records that it was edited.
 */
router.put("/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.userId;

  const existing = await pool.query(
    'SELECT id, group_id, created_by, receipt_data FROM "Expense" WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  if (existing.rows.length === 0) {
    res.status(404).json({ error: "Expense not found" });
    return;
  }
  const e = existing.rows[0];

  if (e.created_by !== userId) {
    const roleRes = await pool.query(
      'SELECT role FROM "GroupMember" WHERE group_id = $1 AND user_id = $2',
      [e.group_id, userId]
    );
    if (roleRes.rows[0]?.role !== "admin") {
      res.status(403).json({ error: "Only the expense creator or the group admin can edit this expense" });
      return;
    }
  }

  const body = { ...(req.body as CreateExpenseBody), groupId: e.group_id };
  // An editor who saw private items masked must not wipe them: restore from what's stored.
  body.receiptData = restoreMasked(body.receiptData, e.receipt_data);
  const prepared = await prepareExpense(body, userId, res);
  if (!prepared) return;

  const before = await expenseSnapshot(pool, id);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE "Expense"
       SET description = $2, amount = $3, currency = $4, split_type = $5,
           category = $6, receipt_data = $7, updated_at = now()
       WHERE id = $1`,
      [
        id,
        prepared.description,
        prepared.amount.toFixed(2),
        prepared.currency,
        prepared.splitType,
        prepared.category,
        prepared.receiptData ? JSON.stringify(prepared.receiptData) : null,
      ]
    );
    // Replace the payer/split rows with the new ones (children of this expense only)
    await client.query('DELETE FROM "ExpensePayer" WHERE expense_id = $1', [id]);
    await client.query('DELETE FROM "ExpenseSplit" WHERE expense_id = $1', [id]);
    for (const payer of prepared.payers) {
      await client.query(
        `INSERT INTO "ExpensePayer" (expense_id, user_id, amount_paid) VALUES ($1, $2, $3)`,
        [id, payer.userId, toDecimal(payer.amountPaid).toFixed(2)]
      );
    }
    for (const split of prepared.splitShares) {
      await client.query(
        `INSERT INTO "ExpenseSplit" (expense_id, user_id, share_amount) VALUES ($1, $2, $3)`,
        [id, split.userId, split.shareAmount.toFixed(2)]
      );
    }
    await logActivity(client, { groupId: e.group_id, actorId: userId, kind: "expense_edited", expenseId: id, summary: { before, after: await expenseSnapshot(client, id) } });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("PUT /expenses/:id error:", err);
    res.status(500).json({ error: "Failed to update expense" });
    return;
  } finally {
    client.release();
  }

  invalidateGroupBalanceCache(e.group_id).catch((err) =>
    console.error("Balance cache invalidation failed:", err)
  );


  // Tell the others it changed (fire-and-forget; never affects the response).
  // Awaited: on Workers, work still running after the reply is cut off.
  await (async () => {
    try {
      const [membersRes, editorRes] = await Promise.all([
        pool.query('SELECT user_id FROM "GroupMember" WHERE group_id = $1', [e.group_id]),
        pool.query(
          `SELECT COALESCE(gm.nickname, u.name) AS name
           FROM "User" u LEFT JOIN "GroupMember" gm ON gm.group_id = $2 AND gm.user_id = u.id
           WHERE u.id = $1`,
          [userId, e.group_id]
        ),
      ]);
      await sendToUsers(
        membersRes.rows.map((r: { user_id: string }) => r.user_id),
        {
          title: "Expense updated",
          body: `${editorRes.rows[0]?.name || "Someone"} changed "${prepared.description}" to ₹${prepared.amount.toFixed(2)}`,
          url: `/groups/${e.group_id}`,
          tag: `expense-edit-${id}`,
        },
        userId
      );
    } catch (err) {
      console.error("[push] expense edit notification failed:", err);
    }
  })();

  res.json({ id, groupId: e.group_id, message: "Expense updated" });
});

// ─── PATCH /expenses/:id/item-visibility ──────────────────────────────────────
/**
 * Show or hide your own private items (items only you share) to the rest of the group.
 * Body: { items: number[] (indexes in receiptData.items), visible: boolean }.
 * Doesn't change any money, so it isn't recorded as an edit.
 */
router.patch("/:id/item-visibility", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.userId;
  const { items, visible } = (req.body ?? {}) as { items?: unknown; visible?: unknown };
  if (!Array.isArray(items) || items.length === 0 || items.length > 500 || typeof visible !== "boolean") {
    res.status(400).json({ error: "Send { items: [indexes], visible: true|false }" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT e.receipt_data FROM "Expense" e
       JOIN "GroupMember" gm ON gm.group_id = e.group_id AND gm.user_id = $2
       WHERE e.id = $1 AND e.deleted_at IS NULL
       FOR UPDATE OF e`,
      [id, userId]
    );
    if (found.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Expense not found" });
      return;
    }
    const result = setItemVisibility(found.rows[0].receipt_data, userId, items as number[], visible);
    if (!result.ok) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: result.error });
      return;
    }
    await client.query('UPDATE "Expense" SET receipt_data = $2 WHERE id = $1', [id, JSON.stringify(result.receipt)]);
    await client.query("COMMIT");
    res.json({ id, items, visible });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
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

  // The creator or the group admin can soft-delete. The admin needs this to fix
  // expenses recorded on behalf of people who haven't joined.
  if (e.created_by !== userId) {
    const roleRes = await pool.query(
      'SELECT role FROM "GroupMember" WHERE group_id = $1 AND user_id = $2',
      [e.group_id, userId]
    );
    if (roleRes.rows[0]?.role !== "admin") {
      res.status(403).json({ error: "Only the expense creator or the group admin can delete this expense" });
      return;
    }
  }

  await pool.query(
    'UPDATE "Expense" SET deleted_at = now(), updated_at = now() WHERE id = $1',
    [id]
  );
  await logActivitySafe(pool, { groupId: e.group_id, actorId: userId, kind: "expense_deleted", expenseId: id, summary: { before: await expenseSnapshot(pool, id) } });

  // Architecture §9: Invalidate the group and cross-group caches so the UI updates immediately
  await invalidateGroupBalanceCache(e.group_id);

  res.json({ message: "Expense deleted", id });
});

// ─── POST /expenses/:id/restore ───────────────────────────────────────────────
/** Bring back a deleted expense (its creator or the group admin), e.g. from the activity log. */
router.post("/:id/restore", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.userId;
  const found = await pool.query(
    'SELECT e.group_id, e.created_by, gm.role FROM "Expense" e LEFT JOIN "GroupMember" gm ON gm.group_id = e.group_id AND gm.user_id = $2 WHERE e.id = $1 AND e.deleted_at IS NOT NULL',
    [id, userId]
  );
  const e = found.rows[0];
  if (!e || !e.role) { res.status(404).json({ error: "Nothing to restore" }); return; }
  if (e.created_by !== userId && e.role !== "admin") {
    res.status(403).json({ error: "Only the person who added it or the group admin can restore it" });
    return;
  }
  await pool.query('UPDATE "Expense" SET deleted_at = NULL, updated_at = now() WHERE id = $1', [id]);
  await logActivitySafe(pool, { groupId: e.group_id, actorId: userId, kind: "expense_restored", expenseId: id, summary: { after: await expenseSnapshot(pool, id) } });
  await invalidateGroupBalanceCache(e.group_id);
  res.json({ message: "Restored", id });
});

export default router;
