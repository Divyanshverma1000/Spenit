import type { PoolClient } from "pg";
import pool from "../db/pool";

type Queryable = Pick<PoolClient, "query">;

export const MAX_NICKNAME_LENGTH = 30;

/** Trim, collapse inner whitespace, cap length. Returns null for empty input. */
export function normalizeNickname(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/\s+/g, " ").slice(0, MAX_NICKNAME_LENGTH);
  return cleaned.length > 0 ? cleaned : null;
}

export async function getMemberRole(
  groupId: string,
  userId: string,
  db: Queryable = pool
): Promise<string | null> {
  const { rows } = await db.query(
    'select role from "GroupMember" where group_id = $1 and user_id = $2',
    [groupId, userId]
  );
  return rows[0]?.role ?? null;
}

/**
 * Is `name` already used as a display name (nickname, or real name when there is
 * no nickname) by another member of the group?
 */
export async function isDisplayNameTaken(
  db: Queryable,
  groupId: string,
  name: string,
  excludeUserId?: string
): Promise<boolean> {
  const { rows } = await db.query(
    `select 1
     from "GroupMember" gm
     join "User" u on u.id = gm.user_id
     where gm.group_id = $1
       and lower(coalesce(gm.nickname, u.name)) = lower($2)
       and ($3::uuid is null or gm.user_id <> $3::uuid)
     limit 1`,
    [groupId, name, excludeUserId ?? null]
  );
  return rows.length > 0;
}

/** Suggest a free nickname such as "Divyansh 2" based on `base`. */
export async function suggestNickname(
  db: Queryable,
  groupId: string,
  base: string
): Promise<string> {
  for (let i = 2; i < 50; i++) {
    const candidate = `${base.slice(0, MAX_NICKNAME_LENGTH - 3)} ${i}`;
    if (!(await isDisplayNameTaken(db, groupId, candidate))) return candidate;
  }
  return `${base.slice(0, MAX_NICKNAME_LENGTH - 5)} ${Date.now() % 100000}`;
}

/** Tables/columns that reference "User"(id) and must follow a placeholder claim. */
const USER_REFERENCES: Array<[table: string, column: string]> = [
  ["ExpensePayer", "user_id"],
  ["ExpenseSplit", "user_id"],
  ["Expense", "created_by"],
  ["Settlement", "from_user"],
  ["Settlement", "to_user"],
  ["Settlement", "initiated_by"],
  ["Settlement", "confirmed_by"],
];

/** Re-point every row that references `fromUserId` to `toUserId`. */
export async function transferUserReferences(
  db: Queryable,
  fromUserId: string,
  toUserId: string
): Promise<void> {
  for (const [table, column] of USER_REFERENCES) {
    await db.query(`update "${table}" set ${column} = $2 where ${column} = $1`, [
      fromUserId,
      toUserId,
    ]);
  }
}

/** True if any expense/split/settlement row references this user. */
export async function userHasHistory(db: Queryable, userId: string): Promise<boolean> {
  for (const [table, column] of USER_REFERENCES) {
    const { rows } = await db.query(
      `select 1 from "${table}" where ${column} = $1 limit 1`,
      [userId]
    );
    if (rows.length > 0) return true;
  }
  return false;
}
