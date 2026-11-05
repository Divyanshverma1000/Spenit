/**
 * groupSafety.ts — claims that can be undone, and the group activity log.
 *
 * Claiming: a joiner who says "I'm Sourabh" takes over the placeholder's history. Every
 * row moved is written to "MemberClaim", so a wrong pick can be put back exactly: the
 * placeholder comes back with its name, avatar and history, and the joiner stays in the
 * group with nothing (they can then pick the right name).
 *
 * Activity: anything that changes money or membership is logged with the names and
 * amounts at that moment, so everyone in the group can see who did what.
 */
import type { PoolClient } from "pg";
import { isDisplayNameTaken, suggestNickname } from "./members";

type Db = Pick<PoolClient, "query">;

export type ActivityKind =
  | "expense_added" | "expense_edited" | "expense_deleted" | "expense_restored"
  | "settlement_recorded" | "settlement_confirmed" | "settlement_rejected"
  | "member_joined" | "member_claimed" | "claim_undone" | "member_left" | "member_removed" | "member_added" | "account_deleted";

/** Write one activity row. Runs inside the caller's transaction when given its client. */
export async function logActivity(
  db: Db,
  a: { groupId: string; actorId: string | null; kind: ActivityKind; expenseId?: string | null; settlementId?: string | null; targetUser?: string | null; summary?: Record<string, unknown> }
): Promise<void> {
  await db.query(
    `insert into "GroupActivity" (group_id, actor_id, kind, expense_id, settlement_id, target_user, summary)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [a.groupId, a.actorId, a.kind, a.expenseId ?? null, a.settlementId ?? null, a.targetUser ?? null, JSON.stringify(a.summary ?? {})]
  );
}

/** Same, but never fails the request (for writes outside a transaction). */
export async function logActivitySafe(db: Db, a: Parameters<typeof logActivity>[1]): Promise<void> {
  try { await logActivity(db, a); } catch (err) { console.error("[activity] log failed:", (err as Error).message); }
}

/** A person's display name in a group (nickname, else account name). */
export async function displayName(db: Db, groupId: string, userId: string): Promise<string> {
  const { rows } = await db.query(
    `select coalesce(gm.nickname, u.name) as name from "User" u
     left join "GroupMember" gm on gm.group_id = $1 and gm.user_id = u.id where u.id = $2`,
    [groupId, userId]
  );
  return rows[0]?.name ?? "Someone";
}

const SETTLEMENT_COLUMNS = ["from_user", "to_user", "initiated_by", "confirmed_by"] as const;

export interface ClaimMoves {
  payerExpenses: string[];
  splitExpenses: string[];
  createdExpenses: string[];
  receiptExpenses: string[];
  settlements: Record<(typeof SETTLEMENT_COLUMNS)[number], string[]>;
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

/**
 * Move a placeholder's history to `userId` and make them a member under the placeholder's
 * name and avatar. Call inside a transaction, after locking the placeholder row.
 * Returns the claim id, or an error code.
 */
export async function claimPlaceholder(
  db: Db,
  groupId: string,
  placeholderId: string,
  userId: string,
  nickname: string | null
): Promise<{ ok: true; claimId: string; placeholderName: string } | { ok: false; code: "PLACEHOLDER_GONE" | "NICKNAME_TAKEN"; name?: string }> {
  const ph = await db.query(
    `select gm.nickname, gm.avatar_key, gm.joined_at, u.name
     from "GroupMember" gm join "User" u on u.id = gm.user_id
     where gm.group_id = $1 and gm.user_id = $2 and u.is_placeholder = true
     for update of gm`,
    [groupId, placeholderId]
  );
  if (ph.rows.length === 0) return { ok: false, code: "PLACEHOLDER_GONE" };
  const p = ph.rows[0];
  const placeholderName: string = p.nickname || p.name;

  // What will move — recorded so it can be moved back.
  const q = (sql: string) => db.query(sql, [groupId, placeholderId]).then((r) => ids(r.rows));
  const moves: ClaimMoves = {
    payerExpenses: await q(`select ep.expense_id as id from "ExpensePayer" ep join "Expense" e on e.id = ep.expense_id where e.group_id = $1 and ep.user_id = $2`),
    splitExpenses: await q(`select es.expense_id as id from "ExpenseSplit" es join "Expense" e on e.id = es.expense_id where e.group_id = $1 and es.user_id = $2`),
    createdExpenses: await q(`select id from "Expense" where group_id = $1 and created_by = $2`),
    receiptExpenses: await q(`select id from "Expense" where group_id = $1 and receipt_data::text like '%' || $2::text || '%'`),
    settlements: {} as ClaimMoves["settlements"],
  };
  for (const c of SETTLEMENT_COLUMNS) {
    moves.settlements[c] = await q(`select id from "Settlement" where group_id = $1 and ${c} = $2`);
  }

  await moveHistory(db, moves, placeholderId, userId);

  // The placeholder leaves; the joiner takes its place (name, avatar, join date).
  await db.query('delete from "GroupMember" where group_id = $1 and user_id = $2', [groupId, placeholderId]);
  await db.query('update "User" set deleted_at = now() where id = $1', [placeholderId]);
  const finalNickname = nickname || placeholderName;
  if (await isDisplayNameTaken(db, groupId, finalNickname, userId)) return { ok: false, code: "NICKNAME_TAKEN", name: finalNickname };
  // A new joiner gets a member row; someone already in the group (reassign) takes the name over.
  const already = await db.query('select 1 from "GroupMember" where group_id = $1 and user_id = $2', [groupId, userId]);
  if (already.rows.length > 0) {
    await db.query(
      'update "GroupMember" set nickname = $3, avatar_key = $4 where group_id = $1 and user_id = $2',
      [groupId, userId, finalNickname, p.avatar_key]
    );
  } else {
    await db.query(
      `insert into "GroupMember" (group_id, user_id, role, nickname, avatar_key, joined_at)
       values ($1, $2, 'member', $3, $4, coalesce($5, now()))`,
      [groupId, userId, finalNickname, p.avatar_key, p.joined_at]
    );
  }

  const claim = await db.query(
    `insert into "MemberClaim" (group_id, placeholder_id, claimed_by, placeholder_nickname, placeholder_avatar_key, placeholder_joined_at, moved)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [groupId, placeholderId, userId, p.nickname, p.avatar_key, p.joined_at, JSON.stringify(moves)]
  );
  return { ok: true, claimId: claim.rows[0].id, placeholderName };
}

/** Re-point the recorded rows from `from` to `to` (both directions use this). */
async function moveHistory(db: Db, m: ClaimMoves, from: string, to: string): Promise<void> {
  const run = async (sql: string, list: string[]) => { if (list.length) await db.query(sql, [list, from, to]); };
  await run(`update "ExpensePayer" set user_id = $3 where expense_id = any($1::uuid[]) and user_id = $2`, m.payerExpenses);
  await run(`update "ExpenseSplit" set user_id = $3 where expense_id = any($1::uuid[]) and user_id = $2`, m.splitExpenses);
  await run(`update "Expense" set created_by = $3 where id = any($1::uuid[]) and created_by = $2`, m.createdExpenses);
  // Item lists name people by id inside JSON ("sharedBy"); ids are unique, so a text swap is exact.
  await run(
    `update "Expense" set receipt_data = replace(receipt_data::text, $2::text, $3::text)::jsonb
     where id = any($1::uuid[]) and receipt_data is not null`,
    m.receiptExpenses
  );
  for (const c of SETTLEMENT_COLUMNS) {
    await run(`update "Settlement" set ${c} = $3 where id = any($1::uuid[]) and ${c} = $2`, m.settlements?.[c] ?? []);
  }
}

export interface ClaimRow {
  id: string;
  group_id: string;
  placeholder_id: string;
  claimed_by: string;
  placeholder_nickname: string | null;
  placeholder_avatar_key: string | null;
  placeholder_joined_at: string | null;
  moved: ClaimMoves;
  created_at: string;
  undone_at: string | null;
}

/** The person who claimed can undo for this long; the admin can undo any time. */
export const SELF_UNDO_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Put a claim back: the placeholder returns with its name, avatar and history, the
 * person who claimed stays in the group under their own name with nothing.
 * Call inside a transaction.
 */
export async function undoClaim(db: Db, claim: ClaimRow, actorId: string): Promise<{ placeholderName: string; claimerName: string }> {
  const { group_id: groupId, placeholder_id: ph, claimed_by: who } = claim;

  await moveHistory(db, claim.moved, who, ph);

  // Free the name and avatar for the placeholder.
  const me = await db.query('select name from "User" where id = $1', [who]);
  const realName: string = me.rows[0]?.name || "Member";
  await db.query('update "GroupMember" set nickname = null, avatar_key = null where group_id = $1 and user_id = $2', [groupId, who]);
  const phName = claim.placeholder_nickname;
  let claimerNick: string | null = null;
  if (phName && phName.toLowerCase() === realName.toLowerCase()) claimerNick = await suggestNickname(db, groupId, realName);
  else if (await isDisplayNameTaken(db, groupId, realName, who)) claimerNick = await suggestNickname(db, groupId, realName);
  if (claimerNick) await db.query('update "GroupMember" set nickname = $3 where group_id = $1 and user_id = $2', [groupId, who, claimerNick]);

  await db.query('update "User" set deleted_at = null where id = $1', [ph]);
  await db.query(
    `insert into "GroupMember" (group_id, user_id, role, nickname, avatar_key, joined_at)
     values ($1, $2, 'member', $3, $4, coalesce($5, now()))
     on conflict (group_id, user_id) do nothing`,
    [groupId, ph, claim.placeholder_nickname, claim.placeholder_avatar_key, claim.placeholder_joined_at]
  );
  await db.query('update "MemberClaim" set undone_at = now(), undone_by = $2 where id = $1', [claim.id, actorId]);

  const ph2 = await db.query('select coalesce($2::text, name) as name from "User" where id = $1', [ph, claim.placeholder_nickname]);
  return { placeholderName: ph2.rows[0]?.name ?? "them", claimerName: claimerNick || realName };
}

/** An expense as it is right now, with names, for before/after in the activity log. */
export async function expenseSnapshot(db: Db, expenseId: string) {
  const e = await db.query('select group_id, description, amount, currency from "Expense" where id = $1', [expenseId]);
  if (e.rows.length === 0) return null;
  const g = e.rows[0].group_id;
  const people = (table: "ExpensePayer" | "ExpenseSplit", col: "amount_paid" | "share_amount") =>
    db.query(
      `select t.user_id, t.${col} as amount, coalesce(gm.nickname, u.name) as name
       from "${table}" t join "User" u on u.id = t.user_id
       left join "GroupMember" gm on gm.group_id = $2 and gm.user_id = t.user_id
       where t.expense_id = $1 order by name`,
      [expenseId, g]
    ).then((r) => r.rows.map((x: { user_id: string; amount: string; name: string }) => ({ userId: x.user_id, name: x.name, amount: x.amount })));
  return {
    description: e.rows[0].description as string,
    amount: e.rows[0].amount as string,
    currency: e.rows[0].currency as string,
    paidBy: await people("ExpensePayer", "amount_paid"),
    shares: await people("ExpenseSplit", "share_amount"),
  };
}
