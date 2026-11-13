# 03 · Launch Day: The Fire

> **In one line:** systems rarely fall over all at once. They break **one bottleneck at
> a time, in order**. Knowing that order ahead of time is the whole game.

This chapter is a story. It's Diwali week. A creator with 2 million followers posts:
*"This app split our whole Goa trip from one bill photo."* Here's how the next 24 hours
go **if we do nothing**, then how they go if we prepare.

---

## Part 1: The day without preparation

### 19:00 · The post goes live
Signups jump from ~50/hour to **20,000/hour**. Google sign-in is fine (Google
scales). Inserting `User` rows is fine (a few per second).

> **Lesson:** the front door is rarely the first thing to break. It's what people do
> *after* they get in.

### 19:20 · AI scans start failing
Everyone tries the headline feature: scanning a bill. All of them use **our one Groq
key**. Groq limits each account by **requests per minute** and **tokens per minute**.
We hit the ceiling. Groq returns `429 Too Many Requests`.

- **What users see:** "Couldn't read that picture", over and over.
- **Why it's bad:** the feature from the viral post is the one that's broken. Every new
  user's first moment is a failure.
- **Our per-user limit (20/min) doesn't help:** it stops *one* user from spamming. It does
  nothing about *50,000 users each scanning once*.

> **Bottleneck #1: shared upstream quota.** One limit shared by every user is a single point
> of failure.

### 19:45 · The group screen gets slow
Thousands of new groups get created, and each one fills up with scanned orders. Opening a
group runs 4 queries, including "every expense" and "compute balances". The balance cache
lives **in each Worker copy's memory**. There are now hundreds of copies, so almost every
request misses the cache and recomputes from Postgres.

- Database CPU climbs from 10% to 90%.
- Queries that took 2 ms now take 200 ms.

> **Bottleneck #2: the database CPU,** made worse by a cache that doesn't work across copies.

### 20:10 · The death spiral
Slow queries hold connections longer (Little's Law: L = λ × W). Connections run out.
New requests wait, then time out. The phone app **retries**. Now we get even more
requests. Postgres is at 100% CPU, answering requests whose callers already gave up.

- **What users see:** spinners, then "Network error". The whole app is down, not just AI.
- **On social media:** *"lol the viral app is dead"*. This is the moment the brand gets hurt.

> **Bottleneck #3: retry storms and no load shedding.** When the system can't keep up,
> rejecting some requests quickly is kinder than accepting all of them slowly.

### 20:30 · Hot rows
Every AI call runs `UPDATE "UsageDaily" SET count = count + 1 WHERE day = today AND
metric = 'ai_calls'`. Thousands per minute, **all on the same row**. Postgres locks a row
while it's updated, so they wait in single file. The AI path slows down even when Groq
answers.

> **Bottleneck #4: lock contention on hot rows.** A counter that's "cheap" at 10/min is a
> traffic jam at 10,000/min.

### 21:00 · Notifications go quiet
Push notifications are sent *after* the response, as "fire-and-forget". Under load,
Cloudflare ends a Worker's work soon after the response is sent unless that work is
registered with `waitUntil`. Some notifications never go out. Friends don't see expenses
being added, so they don't open the app.

> **Bottleneck #5: unreliable background work.** Work that "usually happens" isn't
> reliable work.

### 22:00 · The bill
Groq usage for the evening: ~400k scans plus the retries. Supabase got bumped to a
bigger compute size in a panic. Nobody set a **budget alert**. We find out the cost a
week later.

> **Bottleneck #6: cost.** Viral growth with a free product can hurt your bank account
> before it hurts your servers.

### Next morning · The damage
- Play Store / App Store-style reviews: *"Doesn't work"*, *"Scanning broken"*.
- 60% of last night's signups never come back.
- Engineers are fixing things live, with no plan.

---

## Part 2: The bottleneck map

| # | Bottleneck | Breaks at ~ | User impact | Brand impact | Fix (chapter) |
|---|---|---|---|---|---|
| 1 | Shared Groq quota | a few hundred scans/min | AI fails for **everyone** | Headline feature broken | Multiple providers, queue, per-user daily quota, on-device OCR (07) |
| 2 | DB CPU on group reads | ~1,000 queries/s on small compute | Everything slow | "Laggy app" | Shared cache, paging, indexes, bigger compute, replicas (04, 05) |
| 3 | Retry storm, no shedding | DB saturated | Full outage | "Dead app" | Timeouts, backoff with jitter, circuit breakers, load shedding (09) |
| 4 | Hot counter rows | thousands of updates/min on one row | AI path slow | Indirect | Batch or shard the counters, or move them to analytics (04) |
| 5 | Fire-and-forget push | Under load | Missed notifications | "My friends never see it" | `waitUntil` now, a queue later (06) |
| 6 | No cost guardrails | Any spike | — | Company risk | Budgets, alerts, kill switches, per-user quotas (07, 12) |
| 7 | Big groups unpaged | 1,000+ expenses in a group | Slow group screen | "Slow for big groups" | Cursor pagination, summary tables (04) |
| 8 | Single region | Supabase regional outage | Full outage | Hours down | Point-in-time recovery, cross-region replica later (11) |

---

## Part 3: The same night, prepared

Here's the same post with the chapters of this guide applied.

**19:00.** Signups spike. The **invite-only waitlist** switch is on standby, but we
don't need it yet.

**19:20.** Scans spike. Scans now go into a **queue**. The app shows *"Reading your
bill… usually 5 seconds"*. A worker pulls jobs at the speed Groq allows. When Groq says
429, the **router** sends overflow to the second provider. Each user's first **3 scans a
day are free on our key**, and after that we offer the manual flow. Phone-side OCR sends
text instead of images for simple bills, which is ~10x cheaper.

**19:45.** Group reads spike. Balances are cached in **one shared cache** (Redis/KV) and
invalidated on write. The group screen loads the **latest 50 expenses** and pages the rest.
Hit rate is 90%+. DB CPU stays at 35%.

**20:10.** A slow query shows up. **Alerts** fire (p95 latency > 800 ms). The phone
app's retries use **exponential backoff with jitter**, so they don't all come back at
once. The API **sheds load**: if DB latency is high, non-essential endpoints (activity
feed, insights) return "try later" first, so saving an expense keeps working.

**20:30.** Counters are batched: each Worker sums them up and writes once a minute. No hot rows.

**21:00.** Push goes into a **queue with retries**. Every notification arrives.

**22:00.** The **budget alert** pings at 50% of the monthly AI budget. The **kill switch**
`AI_SCAN_FREE_DAILY=3 → 1` is one setting change, with no deploy.

**Next morning.** Reviews say *"Insanely fast"*. The status page shows one 4-minute
incident, explained in plain words.

---

## Part 4: Protecting the brand when things *do* break

Things *will* break. Users forgive outages. They don't forgive **silence** or **lost
data**. The playbook:

### 1. Degrade, don't die
Rank features by how much they matter, and turn them off from the bottom up:

```
 MUST WORK (never turn off)      add expense, see balance, settle up, offline outbox
 SHOULD WORK                     group screen full history, push notifications
 NICE TO HAVE (turn off first)   AI scan, AI chat, insights, activity feed, avatars
```

Each "nice to have" gets a **feature flag** we can turn off without deploying. When AI
is off, the app says *"Scanning is taking a break. Type it in, takes 10 seconds"*, not an
error.

### 2. Never lose a write
- The **outbox** on the phone already holds expenses while offline. The same idea covers
  server trouble: if the API returns 503, keep it in the outbox and retry later.
- The **idempotency key** makes those retries safe.
- *Users accept "saved on your phone, will sync". They never accept "your expense is gone."*

### 3. Talk, early and honestly
- A **status page** (e.g. a simple page on a different host from our app) saying
  what's affected, what still works, and when we'll update next.
- An in-app **banner** fed by a flag: *"Scanning is slow right now, everything else
  works."*
- Post updates every 30 minutes even when there's no news. Silence reads as "they
  don't know".

### 4. A waitlist is a feature, not a failure
If growth is faster than capacity, **gate signups** behind invites ("Join the waitlist,
or ask a friend on Spenit to invite you"). Spenit spreads through groups anyway, so
invite-only fits the product, and scarcity reads as demand. It's much better than
letting in 1M people to a broken app.

### 5. Write the postmortem
After every incident, write a short, **blameless** postmortem: timeline, root cause,
what went well, what we'll change. Publish a summary. It turns an outage into trust.

---

### Self-check

1. Why doesn't a per-user rate limit protect us from a shared upstream quota?
2. What's a retry storm, and which two techniques stop it?
3. Order these to switch off first under load: settle up, AI chat, activity feed, add expense.
4. Why is "invite-only" a good fit for Spenit specifically?
