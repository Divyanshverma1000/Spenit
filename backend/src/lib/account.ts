/**
 * account.ts — delete my account, and export my data (DPDP Act 2023 / GDPR rights).
 *
 * Deleting erases everything personal: name, email, Google link, photo, UPI ID, AI key,
 * personal expenses, notification subscriptions. Group records are other people's
 * records too, so they stay, but under "Deleted user":
 *  - groups where you're settled up: you leave the group;
 *  - groups where money is still open: you stay listed as "Deleted user" so everyone
 *    else's balances keep adding up.
 */
import type { PoolClient } from "pg";
import { logActivity } from "./groupSafety";
import { maskReceipt } from "./receiptPrivacy";

type Db = Pick<PoolClient, "query">;

/** Bump when the Terms or Privacy Policy change in a way people must agree to again. */
export const TERMS_VERSION = "2026-11-05";

export const DELETED_NAME = "Deleted user";

/**
 * Erase a person. `openGroups` = groups where their balance isn't zero (from the caller,
 * which has the balance code). Call inside a transaction.
 */
export async function deleteAccount(db: Db, userId: string, openGroups: Set<string>): Promise<{ groupsLeft: number; groupsKept: number }> {
  const me = await db.query('select name from "User" where id = $1 and deleted_at is null for update', [userId]);
  if (me.rows.length === 0) return { groupsLeft: 0, groupsKept: 0 };

  const memberships = await db.query(
    `select gm.group_id, gm.role, coalesce(gm.nickname, u.name) as shown
     from "GroupMember" gm join "User" u on u.id = gm.user_id where gm.user_id = $1`,
    [userId]
  );
  let left = 0, kept = 0;
  for (const m of memberships.rows as { group_id: string; role: string; shown: string }[]) {
    await logActivity(db, { groupId: m.group_id, actorId: null, kind: "account_deleted", targetUser: userId, summary: { name: m.shown } });
    if (openGroups.has(m.group_id)) {
      await db.query(
        `update "GroupMember" set nickname = null, avatar_key = null, role = 'member' where group_id = $1 and user_id = $2`,
        [m.group_id, userId]
      );
      kept++;
    } else {
      await db.query('delete from "GroupMember" where group_id = $1 and user_id = $2', [m.group_id, userId]);
      left++;
    }
    // If they were the only admin, the longest-standing person who joined takes over.
    if (m.role === "admin") {
      const admins = await db.query(
        `select 1 from "GroupMember" where group_id = $1 and role = 'admin' and user_id <> $2 limit 1`,
        [m.group_id, userId]
      );
      if (admins.rows.length === 0) {
        await db.query(
          `update "GroupMember" set role = 'admin'
           where group_id = $1 and user_id = (
             select gm.user_id from "GroupMember" gm join "User" u on u.id = gm.user_id
             where gm.group_id = $1 and u.is_placeholder = false and u.deleted_at is null and gm.user_id <> $2
             order by gm.joined_at asc limit 1)`,
          [m.group_id, userId]
        );
      }
    }
  }

  // Personal data: gone.
  for (const table of ["PersonalExpense", "PushSubscription", "UserPhoto", "IdempotencyKey", "UserUsageDaily"]) {
    await db.query(`delete from "${table}" where user_id = $1`, [userId]);
  }
  await db.query(
    `update "User" set
       name = $2, username = 'deleted_' || replace(id::text, '-', ''), email = null, google_id = null,
       avatar_url = null, upi_id = null, venmo_handle = null, password_hash = null, groq_api_key = null, groq_extra_keys = '[]'::jsonb,
       terms_version = null, terms_accepted_at = null, deleted_at = now(), updated_at = now()
     where id = $1`,
    [userId, DELETED_NAME]
  );
  return { groupsLeft: left, groupsKept: kept };
}

/** Everything we hold about a person, as one JSON document. */
export async function exportAccount(db: Db, userId: string) {
  const q = (sql: string) => db.query(sql, [userId]).then((r) => r.rows);
  const [profile] = await q(
    `select id, username, name, email, upi_id, avatar_url, created_at, terms_version, terms_accepted_at,
            (groq_api_key is not null) as has_ai_key
     from "User" where id = $1`
  );
  return {
    exportedAt: new Date().toISOString(),
    about: "Everything Spenit stores about you. Group bills are shared with the other members of each group.",
    profile,
    groups: await q(
      `select g.id, g.name, gm.role, gm.nickname, gm.joined_at from "GroupMember" gm join "Group" g on g.id = gm.group_id
       where gm.user_id = $1 order by gm.joined_at`
    ),
    // Other people's private items stay masked, like everywhere else.
    groupExpenses: (await q(
      `select e.id, g.name as "group", e.description, e.amount, e.currency, e.category, e.created_at,
              (select amount_paid from "ExpensePayer" where expense_id = e.id and user_id = $1) as you_paid,
              (select share_amount from "ExpenseSplit" where expense_id = e.id and user_id = $1) as your_share,
              e.receipt_data as items, e.created_by
       from "Expense" e join "Group" g on g.id = e.group_id
       where e.deleted_at is null and (e.created_by = $1
         or exists (select 1 from "ExpensePayer" where expense_id = e.id and user_id = $1)
         or exists (select 1 from "ExpenseSplit" where expense_id = e.id and user_id = $1))
       order by e.created_at`
    )).map(({ created_by, items, ...e }: Record<string, unknown>) => ({ ...e, items: maskReceipt(items, userId, String(created_by)) })),
    payments: await q(
      `select s.id, g.name as "group", s.amount, s.method, s.status, s.created_at, s.confirmed_at,
              (s.from_user = $1) as you_paid
       from "Settlement" s join "Group" g on g.id = s.group_id
       where s.deleted_at is null and (s.from_user = $1 or s.to_user = $1) order by s.created_at`
    ),
    personalExpenses: await q(
      `select id, description, amount, currency, category, created_at from "PersonalExpense"
       where user_id = $1 and deleted_at is null order by created_at`
    ),
  };
}
