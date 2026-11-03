/**
 * owe.ts — shareable "what you owe" links.
 *
 *   POST /owe/groups/:groupId/members/:userId/link   (auth, group admin)
 *        -> { token }   create (or return the existing) link token for a member
 *   GET  /owe/:token                                  (public)
 *        -> what that person owes / is owed in the group, with prefilled UPI links
 *
 * The token is an unguessable 16-byte value; anyone holding it can see that one
 * person's balance in that one group, and nothing else.
 */

import { Router, Request, Response } from "express";
import crypto from "crypto";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { getMemberRole } from "../lib/members";
import { getGroupBalance } from "./balance";

const router = Router();

router.post(
  "/groups/:groupId/members/:userId/link",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { groupId, userId: targetId } = req.params;

    if ((await getMemberRole(groupId, req.user!.userId)) !== "admin") {
      res.status(403).json({ error: "Only the group admin can create share links" });
      return;
    }

    const existing = await pool.query(
      'select share_token from "GroupMember" where group_id = $1 and user_id = $2',
      [groupId, targetId]
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ error: "Member not found" });
      return;
    }
    if (existing.rows[0].share_token) {
      res.json({ token: existing.rows[0].share_token });
      return;
    }

    const token = crypto.randomBytes(16).toString("base64url");
    await pool.query(
      'update "GroupMember" set share_token = $3 where group_id = $1 and user_id = $2 and share_token is null',
      [groupId, targetId, token]
    );
    // Re-read in case of a concurrent request winning the race.
    const final = await pool.query(
      'select share_token from "GroupMember" where group_id = $1 and user_id = $2',
      [groupId, targetId]
    );
    res.status(201).json({ token: final.rows[0].share_token });
  }
);

router.get("/:token", async (req: Request, res: Response): Promise<void> => {
  const { token } = req.params;

  const member = await pool.query(
    `select gm.group_id, gm.user_id, g.name as group_name, g.invite_token, u.is_placeholder
     from "GroupMember" gm
     join "Group" g on g.id = gm.group_id and g.deleted_at is null
     join "User" u on u.id = gm.user_id
     where gm.share_token = $1`,
    [token]
  );
  if (member.rows.length === 0) {
    res.status(404).json({ error: "This link is invalid or no longer active" });
    return;
  }
  const m = member.rows[0];

  const balance = await getGroupBalance(m.group_id, m.user_id);
  if (!balance) {
    res.status(404).json({ error: "This link is invalid or no longer active" });
    return;
  }

  const me = balance.memberBalances.find((b) => b.userId === m.user_id);

  // Payees' UPI ids, so the page can offer a prefilled "Pay" button.
  const owes = balance.simplifiedTransfers.filter((t) => t.from === m.user_id);
  const owedBy = balance.simplifiedTransfers.filter((t) => t.to === m.user_id);
  const payeeIds = owes.map((t) => t.to);
  const payees = payeeIds.length
    ? await pool.query('select id, upi_id from "User" where id = any($1::uuid[])', [payeeIds])
    : { rows: [] as { id: string; upi_id: string | null }[] };
  const upiById = new Map(payees.rows.map((r) => [r.id, r.upi_id]));

  res.set("Cache-Control", "no-store");
  res.json({
    groupName: balance.groupName,
    personName: me?.name ?? "You",
    direction: me?.direction ?? "settled",
    netAmount: me?.netAmount ?? "0.00",
    owes: owes.map((t) => {
      const upiId = upiById.get(t.to) || null;
      return {
        toName: t.toName,
        amount: t.amount,
        upiId,
        upiLink: upiId
          ? `upi://pay?${new URLSearchParams({
              pa: upiId,
              pn: t.toName,
              am: Number(t.amount).toFixed(2),
              cu: "INR",
              tn: `${balance.groupName} (Spenit)`,
            }).toString()}`
          : null,
      };
    }),
    owedBy: owedBy.map((t) => ({ fromName: t.fromName, amount: t.amount })),
    // Lets a not-yet-joined person claim their name and keep tracking in the app.
    inviteToken: m.is_placeholder ? m.invite_token : null,
  });
});

export default router;
