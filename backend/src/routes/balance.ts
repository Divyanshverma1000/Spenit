/**
 * balance.ts — Balance endpoints with Redis caching.
 *
 * Architecture.md §4 and §9:
 *   "Balance endpoints (GET /users/me/balance, GET /groups/:id/balance) are the
 *    ONLY endpoints with a caching layer in v0."
 *
 * Cache invalidation strategy (precise, per Architecture.md §4):
 *   - POST /expenses in a group     → invalidate group cache key + all member user cache keys
 *   - POST /settlements in a group  → invalidate group cache key + from/to user cache keys
 *   - PATCH /settlements/:id (confirm/reject) → same as above
 *
 * Cache TTL: 5 minutes (balance updates should be fast enough; cache ensures hot reads
 *   don't hammer Postgres at v0 scale, and invalidation keeps it consistent).
 *
 * Cache keys:
 *   balance:group:{groupId}          → GET /groups/:id/balance response
 *   balance:user:{userId}:cross      → GET /users/me/balance response
 */

import { Router, Request, Response } from "express";
import { Decimal } from "decimal.js";
import pool from "../db/pool";
import { cacheGet, cacheSet, cacheDel } from "../lib/cache";
import { requireAuth } from "../middleware/auth";
import {
  computeNetBalance,
  computeAllNetBalances,
  ExpenseRow,
  ExpensePayerRow,
  ExpenseSplitRow,
  SettlementRow,
} from "../lib/balance";
import { simplifyDebts } from "../lib/debtSimplification";

const router = Router();
const BALANCE_CACHE_TTL = 5 * 60; // 5 minutes in seconds

// ─── Cache helpers ────────────────────────────────────────────────────────────

export function groupBalanceCacheKey(groupId: string): string {
  return `balance:group:${groupId}`;
}

export function userCrossGroupCacheKey(userId: string): string {
  return `balance:user:${userId}:cross`;
}

/**
 * Invalidate balance caches for a group expense write.
 * Called by POST /expenses after successful persist.
 * Invalidates the group key AND every member's cross-group key.
 */
export async function invalidateGroupBalanceCache(groupId: string): Promise<void> {
  // Get all members of the group to invalidate their cross-group keys too
  try {
    const memberRows = await pool.query(
      'SELECT user_id FROM "GroupMember" WHERE group_id = $1',
      [groupId]
    );
    const keys: string[] = [
      groupBalanceCacheKey(groupId),
      ...memberRows.rows.map((r: { user_id: string }) => userCrossGroupCacheKey(r.user_id)),
    ];
    if (keys.length > 0) {
      await cacheDel(...keys);
    }
  } catch (err) {
    // Don't crash the write if cache invalidation fails
    console.error("Cache invalidation error:", err);
  }
}

// ─── GET /groups/:id/balance ──────────────────────────────────────────────────
/**
 * Per-group balance: returns the net balance for every member, plus the
 * debt-simplification "settle up" transfer list.
 *
 * Response shape (ProductDetailIDEA.md §3 — one number per person, net direction):
 * {
 *   groupId, groupName,
 *   myBalance: { netAmount, direction },        // my own balance
 *   memberBalances: [                           // all members
 *     { userId, name, username, avatarUrl, netAmount, direction }
 *   ],
 *   simplifiedTransfers: [                      // min-cash-flow result
 *     { from: userId, to: userId, amount }
 *   ],
 *   cachedAt: ISO string | null
 * }
 *
 * Auth: required — user must be a member of the group.
 */
/**
 * Group-level balance data shared by GET /balance/groups/:id and GET /groups/:id/overview.
 * The cached part is identical for every member; `myBalance` is derived per
 * viewer AFTER the cache read (it used to be cached, which could show one
 * member another member's balance).
 * Returns null if the group doesn't exist.
 */
export async function getGroupBalance(groupId: string, viewerId: string) {
  const cacheKey = groupBalanceCacheKey(groupId);
  let base: {
    groupId: string;
    groupName: string;
    memberBalances: Array<{
      userId: string; name: string; username: string; avatarUrl: string | null;
      isPlaceholder: boolean; netAmount: string; direction: string; signedAmount: string;
    }>;
    simplifiedTransfers: Array<{ from: string; to: string; amount: string; fromName: string; toName: string }>;
    cachedAt: string | null;
  } | null = null;
  let fromCache = false;

  try {
    const cached = await cacheGet(cacheKey);
    if (cached) { base = JSON.parse(cached); fromCache = true; }
  } catch {
    // Cache miss or error — fall through to DB
  }

  if (!base) {
    const [groupResult, membersResult, expensesResult, payersResult, splitsResult, settlementsResult] =
      await Promise.all([
        pool.query('SELECT id, name FROM "Group" WHERE id = $1 AND deleted_at IS NULL', [groupId]),
        pool.query(
          `SELECT gm.user_id, COALESCE(gm.nickname, u.name) AS name, u.username, u.avatar_url, u.is_placeholder
           FROM "GroupMember" gm JOIN "User" u ON u.id = gm.user_id
           WHERE gm.group_id = $1 ORDER BY gm.joined_at ASC`,
          [groupId]
        ),
        pool.query('SELECT id, group_id, deleted_at FROM "Expense" WHERE group_id = $1', [groupId]),
        pool.query(
          `SELECT ep.expense_id, ep.user_id, ep.amount_paid
           FROM "ExpensePayer" ep JOIN "Expense" e ON e.id = ep.expense_id
           WHERE e.group_id = $1`,
          [groupId]
        ),
        pool.query(
          `SELECT es.expense_id, es.user_id, es.share_amount
           FROM "ExpenseSplit" es JOIN "Expense" e ON e.id = es.expense_id
           WHERE e.group_id = $1`,
          [groupId]
        ),
        pool.query(
          `SELECT id, group_id, from_user, to_user, amount, status
           FROM "Settlement" WHERE group_id = $1 AND deleted_at IS NULL`,
          [groupId]
        ),
      ]);

    if (groupResult.rows.length === 0) return null;

    const group = groupResult.rows[0];
    const members = membersResult.rows;
    const memberIds = members.map((m: { user_id: string }) => m.user_id);

    const expenses: ExpenseRow[] = expensesResult.rows.map((r) => ({
      id: r.id, groupId: r.group_id, deletedAt: r.deleted_at,
    }));
    const payers: ExpensePayerRow[] = payersResult.rows.map((r) => ({
      expenseId: r.expense_id, userId: r.user_id, amountPaid: r.amount_paid,
    }));
    const splits: ExpenseSplitRow[] = splitsResult.rows.map((r) => ({
      expenseId: r.expense_id, userId: r.user_id, shareAmount: r.share_amount,
    }));
    const settlements: SettlementRow[] = settlementsResult.rows.map((r) => ({
      id: r.id, groupId: r.group_id, fromUser: r.from_user, toUser: r.to_user, amount: r.amount, status: r.status,
    }));

    // Pure functions, no DB calls inside
    const allNetBalances = computeAllNetBalances(memberIds, expenses, payers, splits, settlements);
    const simplifiedTransfers = simplifyDebts(allNetBalances);

    const nameOf = (uid: string) =>
      members.find((m: { user_id: string }) => m.user_id === uid)?.name || uid;

    base = {
      groupId: group.id,
      groupName: group.name,
      memberBalances: members.map((m: { user_id: string; name: string; username: string; avatar_url: string | null; is_placeholder: boolean }) => {
        const netDecimal = allNetBalances.get(m.user_id) || new Decimal(0);
        const netNum = netDecimal.toNumber();
        return {
          userId: m.user_id,
          name: m.name,
          username: m.username,
          avatarUrl: m.avatar_url,
          isPlaceholder: m.is_placeholder,
          netAmount: netDecimal.abs().toFixed(2),
          direction: netNum > 0 ? "owed" : netNum < 0 ? "owes" : "settled",
          signedAmount: netDecimal.toFixed(2),
        };
      }),
      simplifiedTransfers: simplifiedTransfers.map((t) => ({
        from: t.from, to: t.to, amount: t.amount, fromName: nameOf(t.from), toName: nameOf(t.to),
      })),
      cachedAt: new Date().toISOString(),
    };

    cacheSet(cacheKey, JSON.stringify(base), BALANCE_CACHE_TTL)
      .catch((err) => console.error("Balance cache write error:", err));
  }

  const myBalance = base.memberBalances.find((mb) => mb.userId === viewerId) || {
    netAmount: "0.00", direction: "settled", signedAmount: "0.00",
  };
  return { ...base, myBalance, fromCache };
}

router.get("/groups/:groupId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { groupId } = req.params;
  const userId = req.user!.userId;

  const memberCheck = await pool.query(
    'SELECT 1 FROM "GroupMember" WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  );
  if (memberCheck.rows.length === 0) {
    res.status(403).json({ error: "You are not a member of this group" });
    return;
  }

  const payload = await getGroupBalance(groupId, userId);
  if (!payload) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  res.json(payload);
});

// ─── GET /users/me/balance ────────────────────────────────────────────────────
/**
 * Cross-group net balance for the authenticated user.
 * Shows ONE number: total owed across all groups minus total owing.
 *
 * Response (ProductDetailIDEA.md §3 — one number, single direction):
 * {
 *   userId,
 *   netAmount: "850.00",    // absolute value
 *   direction: "owed",      // "owed" | "owes" | "settled"
 *   signedAmount: "850.00", // positive = owed, negative = owes
 *   breakdown: [            // per-group breakdown
 *     { groupId, groupName, netAmount, direction, signedAmount }
 *   ]
 * }
 */
router.get("/me", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;

  // ── Try cache first ─────────────────────────────────────────────────────
  const cacheKey = userCrossGroupCacheKey(userId);
  try {
    const cached = await cacheGet(cacheKey);
    if (cached) {
      res.json({ ...JSON.parse(cached), fromCache: true });
      return;
    }
  } catch {
    // Fall through
  }

  // All groups this user belongs to
  const groupsResult = await pool.query(
    `SELECT g.id, g.name
     FROM "Group" g
     JOIN "GroupMember" gm ON gm.group_id = g.id
     WHERE gm.user_id = $1 AND g.deleted_at IS NULL`,
    [userId]
  );
  const groups = groupsResult.rows;

  if (groups.length === 0) {
    const payload = {
      userId,
      netAmount: "0.00",
      direction: "settled" as const,
      signedAmount: "0.00",
      breakdown: [],
      fromCache: false,
    };
    res.json(payload);
    return;
  }

  const groupIds = groups.map((g: { id: string }) => g.id);

  // Batch fetch all data for all groups at once
  const [expensesResult, payersResult, splitsResult, settlementsResult] = await Promise.all([
    pool.query(
      'SELECT id, group_id, deleted_at FROM "Expense" WHERE group_id = ANY($1)',
      [groupIds]
    ),
    pool.query(
      `SELECT ep.expense_id, ep.user_id, ep.amount_paid, e.group_id
       FROM "ExpensePayer" ep
       JOIN "Expense" e ON e.id = ep.expense_id
       WHERE e.group_id = ANY($1)`,
      [groupIds]
    ),
    pool.query(
      `SELECT es.expense_id, es.user_id, es.share_amount, e.group_id
       FROM "ExpenseSplit" es
       JOIN "Expense" e ON e.id = es.expense_id
       WHERE e.group_id = ANY($1)`,
      [groupIds]
    ),
    pool.query(
      `SELECT id, group_id, from_user, to_user, amount, status
       FROM "Settlement"
       WHERE group_id = ANY($1) AND deleted_at IS NULL`,
      [groupIds]
    ),
  ]);

  // Compute per-group balance for this user
  let crossGroupNet = new Decimal(0);
  const breakdown = [];

  for (const group of groups) {
    const gId = group.id;

    const expenses: ExpenseRow[] = expensesResult.rows
      .filter((r: { group_id: string }) => r.group_id === gId)
      .map((r: { id: string; group_id: string; deleted_at: Date | null }) => ({
        id: r.id,
        groupId: r.group_id,
        deletedAt: r.deleted_at,
      }));

    const payers: ExpensePayerRow[] = payersResult.rows
      .filter((r: { group_id: string }) => r.group_id === gId)
      .map((r: { expense_id: string; user_id: string; amount_paid: string }) => ({
        expenseId: r.expense_id,
        userId: r.user_id,
        amountPaid: r.amount_paid,
      }));

    const splitsForGroup: ExpenseSplitRow[] = splitsResult.rows
      .filter((r: { group_id: string }) => r.group_id === gId)
      .map((r: { expense_id: string; user_id: string; share_amount: string }) => ({
        expenseId: r.expense_id,
        userId: r.user_id,
        shareAmount: r.share_amount,
      }));

    const settlements: SettlementRow[] = settlementsResult.rows
      .filter((r: { group_id: string }) => r.group_id === gId)
      .map((r: { id: string; group_id: string; from_user: string; to_user: string; amount: string; status: string }) => ({
        id: r.id,
        groupId: r.group_id,
        fromUser: r.from_user,
        toUser: r.to_user,
        amount: r.amount,
        status: r.status as "pending" | "confirmed" | "rejected",
      }));

    const b = computeNetBalance(userId, gId, expenses, payers, splitsForGroup, settlements);
    const signed = b.direction === "owed"
      ? new Decimal(b.netAmount)
      : b.direction === "owes"
        ? new Decimal(b.netAmount).negated()
        : new Decimal(0);

    crossGroupNet = crossGroupNet.plus(signed);

    breakdown.push({
      groupId: gId,
      groupName: group.name,
      netAmount: b.netAmount,
      direction: b.direction,
      signedAmount: signed.toFixed(2),
    });
  }

  const crossGroupNum = crossGroupNet.toNumber();
  const payload = {
    userId,
    netAmount: crossGroupNet.abs().toFixed(2),
    direction: crossGroupNum > 0 ? "owed" : crossGroupNum < 0 ? "owes" : "settled",
    signedAmount: crossGroupNet.toFixed(2),
    breakdown,
    fromCache: false,
  };

  // Cache it
  cacheSet(cacheKey, JSON.stringify({ ...payload, cachedAt: new Date().toISOString() }), BALANCE_CACHE_TTL)
    .catch((err) => console.error("Cross-group balance cache write error:", err));

  res.json(payload);
});

export default router;
