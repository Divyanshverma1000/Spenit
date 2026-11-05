/**
 * Admin dashboard data (GET /admin/stats). Only for the accounts listed in ADMIN_EMAILS.
 *
 * Counts only, no personal content: how many people use Spenit (today, this week, this
 * month, right now), what they use, what the AI costs, and which errors are happening.
 * Days are India time.
 */
import { Router, Request, Response, NextFunction } from "express";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { adminEmails } from "../lib/telemetry";

const router = Router();

/**
 * AI price estimate, US$ per million tokens (input, output). Rough: update from Groq's
 * pricing page if it changes. Calls made with people's own keys are on their bill, not
 * ours, so this is the upper bound of what the server key costs.
 */
const AI_PRICE_PER_M = { in: 0.15, out: 0.6 };

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const admins = adminEmails();
  const me = await pool.query('select lower(email) as email from "User" where id = $1 and deleted_at is null', [req.user!.userId]);
  if (!admins.length || !me.rows[0]?.email || !admins.includes(me.rows[0].email)) {
    res.status(403).json({ error: "Admins only" });
    return;
  }
  next();
}

const IST = `(now() at time zone 'Asia/Kolkata')`;
const DAY = (col: string) => `((${col}) at time zone 'Asia/Kolkata')::date`;

router.get("/stats", requireAuth, requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p).then((r) => r.rows);
  const realUsers = `"User" u where u.is_placeholder = false and u.deleted_at is null`;

  const [people] = await q(`
    select
      (select count(*) from ${realUsers})::int as total,
      (select count(*) from ${realUsers} and ${DAY("u.created_at")} = ${IST}::date)::int as new_today,
      (select count(*) from ${realUsers} and u.created_at > now() - interval '7 days')::int as new_7d,
      (select count(*) from ${realUsers} and u.created_at > now() - interval '30 days')::int as new_30d,
      (select count(*) from ${realUsers} and u.last_seen_at > now() - interval '5 minutes')::int as live,
      (select count(*) from "UserActiveDay" where day = ${IST}::date)::int as dau,
      (select count(distinct user_id) from "UserActiveDay" where day > ${IST}::date - 7)::int as wau,
      (select count(distinct user_id) from "UserActiveDay" where day > ${IST}::date - 30)::int as mau,
      (select count(*) from "User" where is_placeholder = true and deleted_at is null)::int as not_joined
  `);

  // Of the people who signed up 8–30 days ago, how many came back in the last 7 days.
  const [retention] = await q(`
    with cohort as (select id from "User" where is_placeholder = false and deleted_at is null
                    and created_at between now() - interval '30 days' and now() - interval '8 days')
    select (select count(*) from cohort)::int as cohort,
           (select count(distinct a.user_id) from "UserActiveDay" a join cohort c on c.id = a.user_id
            where a.day > ${IST}::date - 7)::int as returned
  `);

  const [product] = await q(`
    select
      (select count(*) from "Group" where deleted_at is null)::int as groups,
      (select count(*) from "Expense" where deleted_at is null)::int as expenses,
      (select count(*) from "Expense" where deleted_at is null and split_type = 'itemized')::int as imported_orders,
      (select count(*) from "Settlement" where deleted_at is null and status = 'confirmed')::int as payments_confirmed,
      (select coalesce(sum(amount), 0) from "Expense" where deleted_at is null)::float as money_tracked,
      (select count(*) from "Group" g where deleted_at is null and exists (
         select 1 from "Expense" e where e.group_id = g.id and e.created_at > now() - interval '7 days'))::int as active_groups_7d
  `);

  // 30 days, one row per day.
  const series = await q(`
    with days as (select generate_series(${IST}::date - 29, ${IST}::date, interval '1 day')::date as day)
    select d.day::text as day,
      (select count(*) from "UserActiveDay" a where a.day = d.day)::int as active,
      (select count(*) from "User" u where u.is_placeholder = false and ${DAY("u.created_at")} = d.day)::int as signups,
      (select count(*) from "Expense" e where e.deleted_at is null and ${DAY("e.created_at")} = d.day)::int as expenses,
      (select count(*) from "Expense" e where e.deleted_at is null and e.split_type = 'itemized' and ${DAY("e.created_at")} = d.day)::int as imports,
      (select count(*) from "Settlement" s where s.deleted_at is null and ${DAY("s.created_at")} = d.day)::int as payments,
      (select count(*) from "Group" g where ${DAY("g.created_at")} = d.day)::int as groups,
      coalesce((select sum(count) from "UsageDaily" x where x.day = d.day and x.metric = 'ai_calls'), 0)::int as ai_calls,
      coalesce((select sum(count) from "UsageDaily" x where x.day = d.day and x.metric = 'ai_failures'), 0)::int as ai_failures,
      coalesce((select sum(count) from "UsageDaily" x where x.day = d.day and x.metric = 'chat_questions'), 0)::int as chat_questions,
      coalesce((select sum(count) from "UsageDaily" x where x.day = d.day and x.metric = 'ai_tokens_in'), 0)::bigint as tokens_in,
      coalesce((select sum(count) from "UsageDaily" x where x.day = d.day and x.metric = 'ai_tokens_out'), 0)::bigint as tokens_out,
      coalesce((select sum(count) from "ErrorDaily" x where x.day = d.day), 0)::int as errors
    from days d order by d.day
  `);

  const errors = await q(`
    select fingerprint, source, message, path, sum(count)::int as count, max(last_at) as last_at, min(first_at) as first_at
    from "ErrorDaily" where day > ${IST}::date - 7
    group by fingerprint, source, message, path
    order by max(last_at) desc limit 20
  `);

  const tokensIn = series.reduce((a, d) => a + Number(d.tokens_in), 0);
  const tokensOut = series.reduce((a, d) => a + Number(d.tokens_out), 0);
  res.set("Cache-Control", "no-store");
  res.json({
    generatedAt: new Date().toISOString(),
    people: { ...people, retention },
    product,
    ai: {
      calls30d: series.reduce((a, d) => a + d.ai_calls, 0),
      failures30d: series.reduce((a, d) => a + d.ai_failures, 0),
      chat30d: series.reduce((a, d) => a + d.chat_questions, 0),
      tokensIn30d: tokensIn,
      tokensOut30d: tokensOut,
      costUsd30d: Math.round(((tokensIn / 1e6) * AI_PRICE_PER_M.in + (tokensOut / 1e6) * AI_PRICE_PER_M.out) * 100) / 100,
      pricePerMillion: AI_PRICE_PER_M,
    },
    series: series.map((d) => ({ ...d, tokens_in: Number(d.tokens_in), tokens_out: Number(d.tokens_out) })),
    errors,
    revenue: null, // payments aren't set up yet
  });
});

export default router;
