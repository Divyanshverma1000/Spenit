/**
 * settlements.ts — Settlement endpoints (Stage 5)
 *
 * Architecture rules strictly enforced:
 *   - Two-way confirmation is NOT optional (DB_Design.md §5, Usecase_Flow §6)
 *   - Balance NEVER clears until status = 'confirmed' — enforced by Stage 4's
 *     computeNetBalance (only confirmed settlements are subtracted)
 *   - No "mark as paid" shortcut exists — both paths (UPI + cash) use the same
 *     POST /settlements → POST /settlements/:id/confirm flow
 *   - Cache invalidated precisely on confirm/reject: group key + from/to user keys
 *
 * Endpoints:
 *   POST   /settlements               — create pending settlement
 *   POST   /settlements/:id/confirm   — to_user only, marks confirmed
 *   POST   /settlements/:id/reject    — to_user only, marks rejected
 *   GET    /settlements?groupId=      — list for a group (with from/to names)
 */

import { Router, Request, Response } from "express";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { invalidateGroupBalanceCache } from "./balance";
import { sendToUser } from "../push";

const router = Router();

// ─── POST /settlements ────────────────────────────────────────────────────────
/**
 * Create a new settlement (status = 'pending').
 *
 * Body:
 *   groupId   string  — which group this settles
 *   toUserId  string  — who receives the money (was owed)
 *   amount    string  — numeric string, e.g. "850.00"
 *   method    string  — 'upi' | 'cash' | 'other' (default 'upi')
 *
 * The initiating user is automatically fromUser = req.user.userId.
 * Two-way confirmation enforced: balance only clears on /confirm.
 */
router.post("/", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { groupId, toUserId, amount, method = "upi" } = req.body;

  if (!groupId || !toUserId || !amount) {
    res.status(400).json({ error: "groupId, toUserId, and amount are required" });
    return;
  }

  if (!["upi", "cash", "other"].includes(method)) {
    res.status(400).json({ error: "method must be 'upi', 'cash', or 'other'" });
    return;
  }

  if (userId === toUserId) {
    res.status(400).json({ error: "Cannot settle with yourself" });
    return;
  }

  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    res.status(400).json({ error: "amount must be a positive number" });
    return;
  }

  // Verify both users are in the group
  const memberCheck = await pool.query(
    `SELECT user_id FROM "GroupMember" WHERE group_id = $1 AND user_id = ANY($2)`,
    [groupId, [userId, toUserId]]
  );
  if (memberCheck.rows.length < 2) {
    res.status(403).json({ error: "Both users must be members of the group" });
    return;
  }

  const result = await pool.query(
    `INSERT INTO "Settlement" (group_id, from_user, to_user, amount, method, status, initiated_by)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6)
     RETURNING id, group_id, from_user, to_user, amount, method, status, initiated_by, created_at`,
    [groupId, userId, toUserId, amount, method, userId]
  );

  const settlement = result.rows[0];

  // Fetch toUser info for UPI deep link generation (returned to client)
  const toUserRow = await pool.query(
    'SELECT id, name, upi_id FROM "User" WHERE id = $1',
    [toUserId]
  );
  const toUser = toUserRow.rows[0];

  // Build UPI deep link (NPCI/BHIM UPI URL spec)
  // upi://pay?pa=<vpa>&pn=<name>&am=<amount>&cu=INR&tn=<note>
  let upiDeepLink: string | null = null;
  if (method === "upi" && toUser?.upi_id) {
    const params = new URLSearchParams({
      pa: toUser.upi_id,
      pn: toUser.name,
      am: parseFloat(settlement.amount).toFixed(2),
      cu: "INR",
      tn: "Spenit settlement",
    });
    upiDeepLink = `upi://pay?${params.toString()}`;
  }

  res.status(201).json({
    ...settlement,
    upiDeepLink,
    toUser: {
      id: toUser.id,
      name: toUser.name,
      upiId: toUser.upi_id,
    },
  });

  // ── Push notification: tell to_user they have a settlement request ────────────
  // Fire-and-forget — never blocks the response already sent above.
  ;(async () => {
    try {
      const fromRes = await pool.query('SELECT name FROM "User" WHERE id = $1', [userId]);
      const fromName = fromRes.rows[0]?.name || "Someone";
      await sendToUser(toUserId, {
        title: "💸 Settlement requested",
        body: `${fromName} sent you ₹${parseFloat(settlement.amount).toFixed(2)}. Confirm you received it.`,
        url: `/groups/${groupId}/settle`,
        tag: `settlement-requested-${settlement.id}`,
      });
    } catch (err) { console.error("[push] settlement request notification failed:", err); }
  })();
});

// ─── POST /settlements/:id/confirm ────────────────────────────────────────────
/**
 * Confirm a settlement — ONLY callable by the settlement's to_user.
 *
 * This is the action that actually clears the balance. Until this is called,
 * Stage 4's computeNetBalance treats the debt as outstanding (it only subtracts
 * confirmed settlements — the balance.ts pure function enforces this).
 *
 * Sets: status='confirmed', confirmed_by, confirmed_at.
 */
router.post("/:id/confirm", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const settlementRow = await pool.query(
    `SELECT id, group_id, from_user, to_user, amount, status
     FROM "Settlement" WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );

  if (settlementRow.rows.length === 0) {
    res.status(404).json({ error: "Settlement not found" });
    return;
  }

  const s = settlementRow.rows[0];

  // Two-way confirmation enforced: ONLY the to_user (recipient) can confirm
  if (s.to_user !== userId) {
    res.status(403).json({
      error: "Only the recipient (to_user) can confirm a settlement. The balance clears only after the recipient confirms they received the payment.",
    });
    return;
  }

  if (s.status !== "pending") {
    res.status(409).json({ error: `Settlement is already ${s.status}` });
    return;
  }

  const updated = await pool.query(
    `UPDATE "Settlement"
     SET status = 'confirmed', confirmed_by = $1, confirmed_at = now()
     WHERE id = $2
     RETURNING id, group_id, from_user, to_user, amount, method, status, confirmed_by, confirmed_at`,
    [userId, id]
  );

  // Invalidate balance cache now that balance actually changes (Architecture.md §4)
  invalidateGroupBalanceCache(s.group_id).catch((err) =>
    console.error("Balance cache invalidation error after confirm:", err)
  );

  res.json(updated.rows[0]);

  // ── Push notification: tell from_user their payment was confirmed received ──────
  ;(async () => {
    try {
      const confirmerRes = await pool.query('SELECT name FROM "User" WHERE id = $1', [userId]);
      const confirmerName = confirmerRes.rows[0]?.name || "Someone";
      await sendToUser(s.from_user, {
        title: "✅ Payment confirmed!",
        body: `${confirmerName} confirmed they received your ₹${parseFloat(s.amount).toFixed(2)} payment. Balance cleared.`,
        url: `/groups/${s.group_id}/settle`,
        tag: `settlement-confirmed-${id}`,
      });
    } catch (err) { console.error("[push] settlement confirm notification failed:", err); }
  })();
});

// ─── POST /settlements/:id/reject ─────────────────────────────────────────────
/**
 * Reject a settlement — ONLY callable by the settlement's to_user.
 *
 * Sets: status='rejected'. Balance stays outstanding (pending/rejected are both
 * excluded from computeNetBalance — same logic as pending).
 * Does NOT invalidate balance cache (balance hasn't changed).
 */
router.post("/:id/reject", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { id } = req.params;

  const settlementRow = await pool.query(
    `SELECT id, group_id, to_user, status FROM "Settlement" WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );

  if (settlementRow.rows.length === 0) {
    res.status(404).json({ error: "Settlement not found" });
    return;
  }

  const s = settlementRow.rows[0];

  if (s.to_user !== userId) {
    res.status(403).json({ error: "Only the recipient can reject a settlement" });
    return;
  }

  if (s.status !== "pending") {
    res.status(409).json({ error: `Settlement is already ${s.status}` });
    return;
  }

  const updated = await pool.query(
    `UPDATE "Settlement" SET status = 'rejected' WHERE id = $1
     RETURNING id, status`,
    [id]
  );

  res.json(updated.rows[0]);
});

// ─── GET /settlements?groupId= ────────────────────────────────────────────────
/**
 * List all non-deleted settlements for a group (pending + confirmed + rejected).
 * Returns from/to user names for display.
 */
router.get("/", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { groupId } = req.query;

  if (!groupId) {
    res.status(400).json({ error: "groupId query param required" });
    return;
  }

  // Verify membership
  const memberCheck = await pool.query(
    'SELECT 1 FROM "GroupMember" WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  );
  if (memberCheck.rows.length === 0) {
    res.status(403).json({ error: "Not a member of this group" });
    return;
  }

  const result = await pool.query(
    `SELECT
       s.id, s.group_id, s.amount, s.method, s.status,
       s.created_at, s.confirmed_at,
       fu.id as from_user_id, fu.name as from_user_name, fu.username as from_user_username, fu.avatar_url as from_user_avatar,
       tu.id as to_user_id, tu.name as to_user_name, tu.username as to_user_username, tu.avatar_url as to_user_avatar,
       ib.name as initiated_by_name
     FROM "Settlement" s
     JOIN "User" fu ON fu.id = s.from_user
     JOIN "User" tu ON tu.id = s.to_user
     JOIN "User" ib ON ib.id = s.initiated_by
     WHERE s.group_id = $1 AND s.deleted_at IS NULL
     ORDER BY s.created_at DESC`,
    [groupId]
  );

  const settlements = result.rows.map((r) => ({
    id: r.id,
    groupId: r.group_id,
    amount: r.amount,
    method: r.method,
    status: r.status,
    createdAt: r.created_at,
    confirmedAt: r.confirmed_at,
    fromUser: {
      id: r.from_user_id,
      name: r.from_user_name,
      username: r.from_user_username,
      avatarUrl: r.from_user_avatar,
    },
    toUser: {
      id: r.to_user_id,
      name: r.to_user_name,
      username: r.to_user_username,
      avatarUrl: r.to_user_avatar,
    },
    initiatedByName: r.initiated_by_name,
    isIncoming: r.to_user_id === userId, // true = someone is paying me
    isOutgoing: r.from_user_id === userId, // true = I am paying someone
  }));

  res.json(settlements);
});

export default router;
