/**
 * Personal spending: what you spent on your own, plus your share of every group bill,
 * by month (India time). See PERSONAL_SPENDING_PLAN.md.
 *
 *   GET    /personal_expenses/overview?month=YYYY-MM   everything the Spending tab shows
 *   POST   /personal_expenses                          { description, amount, category?, spentAt? }
 *   PUT    /personal_expenses/:id                      same fields
 *   DELETE /personal_expenses/:id                      (soft) · POST /:id/restore undoes it
 *   PUT    /personal_expenses/budget                   { amount | null }
 *   GET    /personal_expenses                          plain list (kept for older clients)
 */
import { Router, Request, Response } from "express";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { parseAmount, amountError } from "../lib/limits";

const router = Router();

export const CATEGORIES = ["Food", "Groceries", "Travel", "Shopping", "Stay", "Fuel", "Medical", "Utilities", "Entertainment", "Misc"] as const;
const MAX_NAME = 80;
const TZ = "Asia/Kolkata";

const monthOf = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null);
const prevMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};

/** Validate a create/update body. Returns the clean values or an error message. */
function readBody(body: Record<string, unknown>):
  | { ok: true; description: string; amount: number; category: string; spentAt: Date | null }
  | { ok: false; error: string } {
  const description = typeof body.description === "string" ? body.description.trim().replace(/\s+/g, " ") : "";
  if (!description) return { ok: false, error: "Say what it was for" };
  if (description.length > MAX_NAME) return { ok: false, error: `Keep it under ${MAX_NAME} characters` };
  const amount = parseAmount(body.amount);
  if (amount === null) return { ok: false, error: amountError() };
  const category = (CATEGORIES as readonly string[]).includes(String(body.category)) ? String(body.category) : "Misc";
  let spentAt: Date | null = null;
  if (body.spentAt !== undefined && body.spentAt !== null && body.spentAt !== "") {
    const d = new Date(String(body.spentAt));
    const now = Date.now();
    if (Number.isNaN(d.getTime()) || d.getTime() > now + 36 * 3600_000 || d.getTime() < now - 3 * 365 * 86_400_000) {
      return { ok: false, error: "Pick a date in the last 3 years" };
    }
    spentAt = d;
  }
  return { ok: true, description, amount, category, spentAt };
}

const ROW = `id, description, amount::float as amount, category, spent_at as "spentAt", created_at as "createdAt"`;

// ─── GET /personal_expenses/overview?month=YYYY-MM ────────────────────────────
router.get("/overview", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const nowMonth = new Date().toLocaleDateString("en-CA", { timeZone: TZ }).slice(0, 7);
  const month = monthOf(req.query.month) ?? nowMonth;
  const prev = prevMonth(month);

  // One source for "what I spent": personal entries + my share of group bills.
  const spending = `
    select 'personal'::text as kind, p.id::text as id, p.description, p.amount::float as amount,
           coalesce(p.category, 'Misc') as category, p.spent_at as at, null::uuid as group_id, null::text as group_name
    from "PersonalExpense" p where p.user_id = $1 and p.deleted_at is null
    union all
    select 'group', e.id::text, e.description, es.share_amount::float, coalesce(e.category, 'Misc'), e.created_at, g.id, g.name
    from "ExpenseSplit" es
    join "Expense" e on e.id = es.expense_id and e.deleted_at is null
    join "Group" g on g.id = e.group_id
    where es.user_id = $1 and es.share_amount > 0`;
  const inMonth = (m: string) => `to_char(at at time zone '${TZ}', 'YYYY-MM') = '${m}'`;

  const [entries, prevTotal, budget, frequent] = await Promise.all([
    pool.query(`select * from (${spending}) s where ${inMonth(month)} order by at desc limit 500`, [userId]),
    pool.query(`select coalesce(sum(amount), 0)::float as total from (${spending}) s where ${inMonth(prev)}`, [userId]),
    pool.query('select monthly_budget::float as budget from "User" where id = $1', [userId]),
    // Things you log often (last 90 days): one tap to log again.
    pool.query(
      `select description, amount::float as amount, coalesce(category, 'Misc') as category, count(*)::int as times
       from "PersonalExpense" where user_id = $1 and deleted_at is null and spent_at > now() - interval '90 days'
       group by description, amount, category having count(*) >= 2
       order by count(*) desc, max(spent_at) desc limit 6`,
      [userId]
    ),
  ]);

  const rows = entries.rows as { kind: "personal" | "group"; id: string; description: string; amount: number; category: string; at: string; group_id: string | null; group_name: string | null }[];
  const r2 = (n: number) => Math.round(n * 100) / 100;
  let personal = 0, groups = 0;
  const byCat = new Map<string, { total: number; count: number }>();
  const byDay = new Map<string, number>();
  for (const e of rows) {
    if (e.kind === "personal") personal += e.amount; else groups += e.amount;
    const c = byCat.get(e.category) ?? { total: 0, count: 0 };
    c.total += e.amount; c.count++; byCat.set(e.category, c);
    const day = new Date(e.at).toLocaleDateString("en-CA", { timeZone: TZ });
    byDay.set(day, (byDay.get(day) ?? 0) + e.amount);
  }
  const [y, mo] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: TZ });

  res.set("Cache-Control", "no-store");
  res.json({
    month,
    isCurrentMonth: month === nowMonth,
    today,
    daysInMonth,
    total: r2(personal + groups),
    personalTotal: r2(personal),
    groupShareTotal: r2(groups),
    prevMonth: prev,
    prevTotal: r2(prevTotal.rows[0]?.total ?? 0),
    budget: budget.rows[0]?.budget ?? null,
    byCategory: [...byCat].map(([category, v]) => ({ category, total: r2(v.total), count: v.count })).sort((a, b) => b.total - a.total),
    byDay: Array.from({ length: daysInMonth }, (_, i) => {
      const day = `${month}-${String(i + 1).padStart(2, "0")}`;
      return { day, total: r2(byDay.get(day) ?? 0) };
    }),
    entries: rows.map((e) => ({
      kind: e.kind, id: e.id, description: e.description, amount: r2(e.amount), category: e.category, at: e.at,
      ...(e.kind === "group" ? { groupId: e.group_id, groupName: e.group_name } : {}),
    })),
    frequent: frequent.rows,
    categories: CATEGORIES,
  });
});

// ─── PUT /personal_expenses/budget ────────────────────────────────────────────
router.put("/budget", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const raw = (req.body ?? {}).amount;
  const amount = raw === null || raw === "" || raw === 0 ? null : parseAmount(raw);
  if (raw !== null && raw !== "" && raw !== 0 && amount === null) { res.status(400).json({ error: amountError("The budget") }); return; }
  await pool.query('update "User" set monthly_budget = $2 where id = $1', [req.user!.userId, amount]);
  res.json({ budget: amount });
});

// ─── GET /personal_expenses (plain list) ──────────────────────────────────────
router.get("/", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const result = await pool.query(
    `select ${ROW}, currency, created_at from "PersonalExpense" where user_id = $1 and deleted_at is null order by spent_at desc limit 1000`,
    [req.user!.userId]
  );
  res.json(result.rows);
});

// ─── POST /personal_expenses ──────────────────────────────────────────────────
router.post("/", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const b = readBody(req.body ?? {});
  if (!b.ok) { res.status(400).json({ error: b.error }); return; }
  const result = await pool.query(
    `insert into "PersonalExpense" (user_id, description, amount, category, spent_at)
     values ($1, $2, $3, $4, coalesce($5, now())) returning ${ROW}`,
    [req.user!.userId, b.description, b.amount, b.category, b.spentAt]
  );
  res.status(201).json(result.rows[0]);
});

// ─── PUT /personal_expenses/:id ───────────────────────────────────────────────
router.put("/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const b = readBody(req.body ?? {});
  if (!b.ok) { res.status(400).json({ error: b.error }); return; }
  const result = await pool.query(
    `update "PersonalExpense" set description = $3, amount = $4, category = $5, spent_at = coalesce($6, spent_at), updated_at = now()
     where id = $1 and user_id = $2 and deleted_at is null returning ${ROW}`,
    [req.params.id, req.user!.userId, b.description, b.amount, b.category, b.spentAt]
  );
  if (result.rows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
  res.json(result.rows[0]);
});

// ─── DELETE /personal_expenses/:id · POST /:id/restore ────────────────────────
router.delete("/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const r = await pool.query(
    'update "PersonalExpense" set deleted_at = now(), updated_at = now() where id = $1 and user_id = $2 and deleted_at is null returning id',
    [req.params.id, req.user!.userId]
  );
  if (r.rows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ message: "Deleted", id: req.params.id });
});

router.post("/:id/restore", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const r = await pool.query(
    `update "PersonalExpense" set deleted_at = null, updated_at = now() where id = $1 and user_id = $2 and deleted_at is not null returning ${ROW}`,
    [req.params.id, req.user!.userId]
  );
  if (r.rows.length === 0) { res.status(404).json({ error: "Nothing to restore" }); return; }
  res.json(r.rows[0]);
});

export default router;
