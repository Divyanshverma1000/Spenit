# 09 · Reliability and Observability

> **In one line:** you can't fix what you can't see, and you can't promise what you
> haven't measured. Reliability is a number you choose, then defend.

---

## 1. SLI, SLO, SLA, and error budgets

| Term | Meaning | Spenit example |
|---|---|---|
| **SLI** (indicator) | A measurement | % of `POST /expenses` that succeed in < 1 s |
| **SLO** (objective) | The target for that measurement | 99.9% over 30 days |
| **SLA** (agreement) | A promise with penalties, for paying customers | None yet |
| **Error budget** | 100% − SLO | 0.1% of 30 days ≈ **43 minutes** of "bad" a month |

### Why error budgets are brilliant
They turn "move fast" vs "be stable" from an argument into a number:
- Budget left → ship features, take risks.
- Budget spent → freeze risky launches, fix reliability.

### Suggested Spenit SLOs (by importance)

| Journey | SLO |
|---|---|
| Add expense succeeds (incl. offline sync later) | 99.95% |
| Open group screen < 1.5 s (p95) | 99.5% |
| Settle-up records correctly | 99.95% |
| AI scan returns a result **or a clean fallback** | 99% |
| Push delivered within 1 minute | 98% |

> **Nines in time:** 99% ≈ 7.3 h down/month. 99.9% ≈ 43 min. 99.99% ≈ 4.3 min. Each nine
> costs roughly **10x more** effort. Pick nines per journey, not for the whole app.

---

## 2. Percentiles, not averages

The average latency hides the pain. If 99 requests take 100 ms and 1 takes 10 s, the
average is ~200 ms ("fine!"), but 1 in 100 users waited 10 seconds.

- **p50** (median): typical experience.
- **p95 / p99:** the unlucky users. With 30 requests per session, *most* users hit your
  p99 at least once a day.

**Watch p95 and p99.** Alert on them.

---

## 3. The three pillars of observability

| Pillar | What | Answers | Spenit today → at scale |
|---|---|---|---|
| **Logs** | Text/JSON events | "What happened to *this* request?" | Workers observability + `ErrorDaily` fingerprints → structured JSON logs with a **request id**, shipped to a log store (Logpush → R2/ClickHouse/Grafana Loki) |
| **Metrics** | Numbers over time | "How is the *system* doing?" | `UsageDaily`, admin dashboard → time-series (Workers Analytics Engine, Prometheus/Grafana) for req/s, error %, p95, DB CPU, cache hit rate, queue depth, AI tokens |
| **Traces** | One request's path through every service, with timings | "*Where* did these 2 seconds go?" | None → OpenTelemetry traces: Worker span → DB query spans → Groq span |

**The request id** is the cheapest powerful trick: generate one at the edge, log it
everywhere, return it in a header, and show it on the in-app error screen. Then a user report
("it failed at 9:41") turns into one exact log search.

---

## 4. What to alert on (and what not to)

**Alert on symptoms users feel:**
- Error rate on key endpoints > 1% for 5 min
- p95 latency of group screen > 1.5 s for 10 min
- AI fallback rate > 20%
- Queue depth growing for 15 min (consumers can't keep up)
- DB CPU > 80%, connections > 80% of limit
- AI spend > daily budget × 0.8

**Don't alert on** every single error. That's noise, and people learn to ignore it
("alert fatigue"). Our current "first error of each kind per day → admin push" is a
good small-scale version. At scale, route by severity: **page** (wake someone) vs
**ticket** (look tomorrow).

---

## 5. Resilience patterns

### Timeouts everywhere
Every network call needs a timeout: DB (statement_timeout ~5 s), Groq (~20 s for vision),
push (~5 s). **No timeout = infinite wait = connection held = death spiral** (chapter 02).

### Retries with exponential backoff + jitter
Retry only **idempotent** operations (or those with idempotency keys, like our writes).
Cap the attempts. Add randomness.

### Circuit breaker
```
 CLOSED (normal) ──too many failures──► OPEN (fail fast, use fallback)
      ▲                                     │ after cooldown
      └──── success ◄── HALF-OPEN (let a few requests try) ◄──┘
```
Stops wasting time and capacity on a dependency that's down, and gives it room to recover.

### Bulkheads
Separate pools for separate work, like compartments in a ship: if AI calls get slow, they
mustn't use up the connections that "save expense" needs. In practice: separate
queues, separate rate limits, and separate timeouts for AI vs core routes.

### Load shedding
When overloaded, **reject the least important work first, and quickly** (503 + Retry-After),
so the most important work stays fast. Priority order from chapter 03: add expense >
balances > group screen > AI > insights > activity feed.

### Graceful degradation
Every feature has a "lesser" mode: AI → manual form (✅ we do this), live balance →
cached balance with "updated 2 min ago", push → in-app badge on next open.

### Feature flags and kill switches
Config (e.g. Cloudflare KV or a `Config` table, cached 30 s) that turns features
off **without a deploy**: `ai_scan_enabled`, `ai_free_daily`, `signups_open`,
`activity_feed_enabled`. Rehearse flipping them.

---

## 6. Incidents: what to do when it's on fire

1. **Detect:** an alert or a user report.
2. **Declare:** one person is the **incident lead** (coordinates, doesn't debug).
3. **Mitigate first, fix later:** roll back the deploy, flip the kill switch, scale up the DB.
   Stop the bleeding before looking for the root cause.
4. **Communicate:** status page + in-app banner, regular updates (chapter 03).
5. **Resolve and verify:** metrics back to normal.
6. **Postmortem within 48 h:** blameless timeline, root cause ("5 whys"), action items with owners.

**Runbooks:** short "if X, do Y" pages for known failures. Examples: "Groq 429 storm",
"DB CPU at 100%", "push failing", "bad deploy". Writing them is half the preparation.

---

## 7. Testing for scale before users do

- **Load testing:** tools like **k6**, Artillery or Locust replay realistic journeys
  (open app → open group → add expense → scan) at 1x, 5x and 20x expected peak against a
  **staging** copy. Find the knee in the latency curve.
- **Soak testing:** steady load for hours (finds memory leaks and slow-growing tables).
- **Chaos testing (small):** in staging, make Groq return 429s or slow the DB by 500 ms,
  then check that fallbacks and timeouts behave.
- **Game day:** practise an incident with the team, including flipping kill switches.

---

### Self-check

1. Your SLO is 99.9% monthly. How much downtime is your error budget?
2. Why alert on p95, not average latency?
3. Draw the circuit breaker states and when each changes.
4. What's the difference between load shedding and graceful degradation?
5. In an incident, why "mitigate first, fix later"?
