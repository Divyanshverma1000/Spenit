/**
 * seenBills.ts: "have I added this bill before?"
 *
 * A scanned bill carries up to three prints, strongest first:
 *   screenshot  SHA-256 of the picture file: the very same screenshot was picked again
 *   order       platform + order / bill / UPI reference number
 *   contents    hash of the shop, total and every item with its price
 * None of them blocks a save. The same items and total can be a genuine reorder, and the
 * person decides; we only remind them, with when and where it was added before.
 * The pure parts (clean, rank) are tested in seenBills.test.ts.
 */
import pool from "../db/pool";

export type SeenHow = "screenshot" | "order" | "contents";

export interface BillPrint {
  imageHashes: string[];
  orderKey: string | null;
  contentsHash: string | null;
}

export interface SeenCandidate extends BillPrint {
  /** the caller's id for this bill, echoed back */
  ref: string;
}

export interface SeenMatch {
  ref: string;
  how: SeenHow;
  place: "group" | "personal";
  expenseId: string;
  groupId: string | null;
  groupName: string | null;
  /** the group the person is adding to right now */
  sameGroup: boolean;
  description: string;
  amount: number;
  addedAt: string;
  addedBy: string | null;
  addedByMe: boolean;
  orderDate: string | null;
}

const HEX = /^[0-9a-f]{16,64}$/;
const MAX_HASHES = 20;
export const MAX_CANDIDATES = 50;

/** Keep only well-formed prints. Returns null when nothing is left to look for. */
export function cleanPrint(raw: unknown): BillPrint | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const imageHashes = Array.isArray(r.imageHashes)
    ? Array.from(new Set(r.imageHashes.filter((h): h is string => typeof h === "string" && HEX.test(h)))).slice(0, MAX_HASHES)
    : [];
  const orderKey = typeof r.orderKey === "string" && r.orderKey.length > 0 && r.orderKey.length <= 120 ? r.orderKey : null;
  const contentsHash = typeof r.contentsHash === "string" && HEX.test(r.contentsHash) ? r.contentsHash : null;
  if (imageHashes.length === 0 && !orderKey && !contentsHash) return null;
  return { imageHashes, orderKey, contentsHash };
}

export function cleanCandidates(raw: unknown): SeenCandidate[] {
  if (!Array.isArray(raw)) return [];
  const out: SeenCandidate[] = [];
  for (const c of raw.slice(0, MAX_CANDIDATES)) {
    const p = cleanPrint(c);
    const ref = (c as { ref?: unknown })?.ref;
    if (p && typeof ref === "string" && ref.length > 0 && ref.length <= 80) out.push({ ref, ...p });
  }
  return out;
}

/** A stored bill, as read back from either table. */
export interface StoredBill extends BillPrint {
  place: "group" | "personal";
  expenseId: string;
  groupId: string | null;
  groupName: string | null;
  description: string;
  amount: number;
  addedAt: string;
  addedBy: string | null;
  addedByMe: boolean;
  orderDate: string | null;
}

const STRENGTH: Record<SeenHow, number> = { screenshot: 3, order: 2, contents: 1 };

function howMatched(c: SeenCandidate, b: BillPrint): SeenHow | null {
  if (c.imageHashes.some((h) => b.imageHashes.includes(h))) return "screenshot";
  if (c.orderKey && c.orderKey === b.orderKey) return "order";
  if (c.contentsHash && c.contentsHash === b.contentsHash) return "contents";
  return null;
}

/**
 * The one earlier bill to remind about for each candidate: the strongest kind of match,
 * then one in the group being added to, then the newest.
 */
export function rank(cands: SeenCandidate[], stored: StoredBill[], groupId: string | null): SeenMatch[] {
  const out: SeenMatch[] = [];
  for (const c of cands) {
    let best: { m: SeenMatch; score: number } | null = null;
    for (const b of stored) {
      const how = howMatched(c, b);
      if (!how) continue;
      const sameGroup = !!groupId && b.groupId === groupId;
      const score = STRENGTH[how] * 10 + (sameGroup ? 1 : 0);
      const newer = best && score === best.score && new Date(b.addedAt) > new Date(best.m.addedAt);
      if (!best || score > best.score || newer) {
        const { imageHashes: _i, orderKey: _o, contentsHash: _c, ...rest } = b;
        best = { score, m: { ref: c.ref, how, sameGroup, ...rest } };
      }
    }
    if (best) out.push(best.m);
  }
  return out;
}

const asHashes = (v: unknown): string[] => (Array.isArray(v) ? v.filter((h): h is string => typeof h === "string") : []);

/**
 * Look the candidates up in every group the person is in, and in their own spending.
 * `excludeExpenseId`: the bill being edited, which is of course "the same".
 */
export async function findSeenBills(
  userId: string,
  cands: SeenCandidate[],
  groupId: string | null,
  excludeExpenseId: string | null
): Promise<SeenMatch[]> {
  if (cands.length === 0) return [];
  const keys = Array.from(new Set(cands.map((c) => c.orderKey).filter((k): k is string => !!k)));
  const contents = Array.from(new Set(cands.map((c) => c.contentsHash).filter((k): k is string => !!k)));
  const images = Array.from(new Set(cands.flatMap((c) => c.imageHashes)));

  const group = await pool.query(
    `SELECT e.id, e.group_id, g.name AS group_name, e.description, e.amount::float AS amount, e.created_at,
            e.created_by, COALESCE(gm.nickname, u.name) AS added_by,
            e.receipt_data->>'orderKey' AS order_key, e.receipt_data->>'contentsHash' AS contents_hash,
            e.receipt_data->'imageHashes' AS image_hashes, e.receipt_data->>'orderDate' AS order_date
     FROM "Expense" e
     JOIN "Group" g ON g.id = e.group_id
     JOIN "GroupMember" mine ON mine.group_id = e.group_id AND mine.user_id = $1
     JOIN "User" u ON u.id = e.created_by
     LEFT JOIN "GroupMember" gm ON gm.group_id = e.group_id AND gm.user_id = e.created_by
     WHERE e.deleted_at IS NULL AND e.receipt_data IS NOT NULL AND jsonb_typeof(e.receipt_data) = 'object'
       AND ($5::uuid IS NULL OR e.id <> $5::uuid)
       AND (e.receipt_data->>'orderKey' = ANY($2::text[])
            OR e.receipt_data->>'contentsHash' = ANY($3::text[])
            OR (jsonb_typeof(e.receipt_data->'imageHashes') = 'array'
                AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(e.receipt_data->'imageHashes') h WHERE h = ANY($4::text[]))))
     ORDER BY e.created_at DESC
     LIMIT 100`,
    [userId, keys, contents, images, excludeExpenseId]
  );

  const stored: StoredBill[] = group.rows.map((r) => ({
    place: "group",
    expenseId: r.id,
    groupId: r.group_id,
    groupName: r.group_name,
    description: r.description,
    amount: r.amount,
    addedAt: new Date(r.created_at).toISOString(),
    addedBy: r.created_by === userId ? null : r.added_by,
    addedByMe: r.created_by === userId,
    orderDate: r.order_date,
    imageHashes: asHashes(r.image_hashes),
    orderKey: r.order_key,
    contentsHash: r.contents_hash,
  }));

  // Personal bills: the column arrives with migration 021; until it's applied, skip them.
  try {
    const personal = await pool.query(
      `SELECT id, description, amount::float AS amount, created_at, bill_meta
       FROM "PersonalExpense"
       WHERE user_id = $1 AND deleted_at IS NULL AND bill_meta IS NOT NULL
         AND ($5::uuid IS NULL OR id <> $5::uuid)
         AND (bill_meta->>'orderKey' = ANY($2::text[])
              OR bill_meta->>'contentsHash' = ANY($3::text[])
              OR (jsonb_typeof(bill_meta->'imageHashes') = 'array'
                  AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(bill_meta->'imageHashes') h WHERE h = ANY($4::text[]))))
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId, keys, contents, images, excludeExpenseId]
    );
    for (const r of personal.rows) {
      stored.push({
        place: "personal",
        expenseId: r.id,
        groupId: null,
        groupName: null,
        description: r.description,
        amount: r.amount,
        addedAt: new Date(r.created_at).toISOString(),
        addedBy: null,
        addedByMe: true,
        orderDate: r.bill_meta?.orderDate ?? null,
        imageHashes: asHashes(r.bill_meta?.imageHashes),
        orderKey: r.bill_meta?.orderKey ?? null,
        contentsHash: r.bill_meta?.contentsHash ?? null,
      });
    }
  } catch (err) {
    console.warn("[seen-bills] personal lookup skipped:", (err as Error).message);
  }

  return rank(cands, stored, groupId);
}
