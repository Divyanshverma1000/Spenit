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
import { stageOf, usefulness } from "../lib/peopleStage";

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

  // What people told us (Profile → Report a problem / Share an idea): newest first.
  const feedback = await q(`
    select f.id::int as id, f.kind, f.message, f.page, f.app_version, f.device, f.status, f.created_at,
           coalesce(u.name, 'Deleted user') as name, u.email
    from "Feedback" f left join "User" u on u.id = f.user_id
    order by (f.status = 'new') desc, f.created_at desc limit 30
  `);
  const [fbCounts] = await q(`select count(*) filter (where status = 'new')::int as open, count(*)::int as total from "Feedback"`);

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
    feedback: { open: fbCounts?.open ?? 0, total: fbCounts?.total ?? 0, items: feedback },
    revenue: null, // payments aren't set up yet
  });
});

/**
 * GET /admin/people — everyone who signed up, for getting to know the first users.
 * Who they are, how they found Spenit, how often they come back and what they use.
 * Counts and group names only: never what's on anyone's bills.
 */
router.get("/people", requireAuth, requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  const { rows } = await pool.query(`
    select u.id, u.name, u.email, u.avatar_url, u.created_at, u.last_seen_at,
      (u.groq_api_key is not null) as own_key,
      jsonb_array_length(coalesce(u.groq_extra_keys, '[]'::jsonb))::int as extra_keys,
      exists (select 1 from "PushSubscription" p where p.user_id = u.id) as push,
      coalesce((select array_agg((${IST}::date - a.day)::int order by a.day desc)
                from "UserActiveDay" a where a.user_id = u.id and a.day > ${IST}::date - 30), '{}') as active_ago,
      (select count(*) from "UserActiveDay" a where a.user_id = u.id)::int as active_days_total,
      (select count(*) from "Expense" e where e.created_by = u.id and e.deleted_at is null)::int as bills,
      (select count(*) from "Expense" e where e.created_by = u.id and e.deleted_at is null and e.split_type = 'itemized')::int as imports,
      (select coalesce(sum(e.amount), 0) from "Expense" e where e.created_by = u.id and e.deleted_at is null)::float as money_added,
      (select max(e.created_at) from "Expense" e where e.created_by = u.id and e.deleted_at is null) as last_bill_at,
      (select count(*) from "Settlement" s where s.initiated_by = u.id and s.deleted_at is null)::int as payments,
      (select count(*) from "PersonalExpense" pe where pe.user_id = u.id and pe.deleted_at is null)::int as personal,
      (select coalesce(jsonb_object_agg(metric, n), '{}'::jsonb) from (
         select metric, sum(count)::int as n from "UserUsageDaily" x
         where x.user_id = u.id and x.day > ${IST}::date - 30 group by metric) t) as ai30,
      (select coalesce(jsonb_agg(jsonb_build_object('name', g.name, 'members', mc.n, 'mine', g.created_by = u.id) order by gm.joined_at), '[]'::jsonb)
       from "GroupMember" gm join "Group" g on g.id = gm.group_id and g.deleted_at is null
       cross join lateral (select count(*)::int as n from "GroupMember" m where m.group_id = g.id) mc
       where gm.user_id = u.id) as groups,
      (select jsonb_build_object('group', g.name, 'by', coalesce(cu.name, 'someone'), 'claimed',
                exists (select 1 from "MemberClaim" c where c.claimed_by = u.id and c.group_id = g.id and c.undone_at is null))
       from "GroupMember" gm join "Group" g on g.id = gm.group_id left join "User" cu on cu.id = g.created_by
       where gm.user_id = u.id and g.created_by <> u.id and gm.joined_at < u.created_at + interval '1 day'
       order by gm.joined_at limit 1) as came_via
    from "User" u
    where u.is_placeholder = false and u.deleted_at is null
    order by u.last_seen_at desc nulls last
    limit 500
  `);

  const now = new Date();
  const people = rows.map((r) => {
    const activeAgo = (r.active_ago as number[]) ?? [];
    const ai = (r.ai30 ?? {}) as Record<string, number>;
    const groups = (r.groups ?? []) as { name: string; members: number; mine: boolean }[];
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      avatarUrl: r.avatar_url,
      joinedAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      cameVia: r.came_via ?? null,
      stage: stageOf({ createdAt: new Date(r.created_at), lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at) : null, activeAgo }, now),
      usefulness: usefulness({
        activeAgo, bills: r.bills, imports: r.imports, payments: r.payments, groups: groups.length,
        chats: ai.chat_questions ?? 0, personal: r.personal,
      }),
      activeAgo,
      activeDaysTotal: r.active_days_total,
      groups,
      counts: {
        bills: r.bills, imports: r.imports, payments: r.payments, personal: r.personal,
        moneyAdded: Math.round(r.money_added), lastBillAt: r.last_bill_at,
        scans30d: (ai.order_reads ?? 0) + (ai.receipt_scans ?? 0),
        chats30d: ai.chat_questions ?? 0,
        aiCalls30d: ai.ai_calls ?? 0,
      },
      setup: { push: r.push, ownKey: r.own_key, extraKeys: r.extra_keys },
    };
  });

  // Who brought people in: the group creators new people joined through.
  const brought = new Map<string, { name: string; people: number; active: number }>();
  for (const p of people) {
    if (!p.cameVia) continue;
    const k = p.cameVia.by as string;
    const b = brought.get(k) ?? { name: k, people: 0, active: 0 };
    b.people++;
    if (["hooked", "regular", "new"].includes(p.stage)) b.active++;
    brought.set(k, b);
  }

  res.set("Cache-Control", "no-store");
  res.json({ generatedAt: now.toISOString(), people, inviters: [...brought.values()].sort((a, b) => b.people - a.people).slice(0, 10) });
});

export default router;
