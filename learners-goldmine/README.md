# The Learner's Goldmine: Scaling Spenit

> We built Spenit for a few friends. This folder asks one question: what happens when a
> million people show up in a week, and how do we stay standing?
>
> Each chapter teaches a **system design fundamental** using **our own code**. You learn the
> idea, see where Spenit stands today, watch it break under load, and then see what we'd do
> about it and **why**.

---

## How to read this

Read it in order the first time. Every chapter builds on the one before it. After that,
use it as a reference.

| # | Chapter | You'll learn | Read time |
|---|---|---|---|
| 01 | [Spenit today](01-spenit-today.md) | Our architecture, how one request travels, where the data lives | 10 min |
| 02 | [Numbers first](02-numbers-first.md) | Back-of-the-envelope maths: users → requests/sec → rows → GB → ₹ | 12 min |
| 03 | [Launch day: the fire](03-launch-day.md) | A story of what breaks, in order, and how to protect the brand | 15 min |
| 04 | [The database](04-database.md) | Connections, pooling, indexes, WAL, replicas, read-your-writes, partitioning, sharding | 25 min |
| 05 | [Caching](05-caching.md) | Cache layers, cache-aside, invalidation, stampedes, what never to cache | 18 min |
| 06 | [Background work](06-background-work.md) | Queues, fan-out, retries, dead letters, idempotency, the outbox pattern | 15 min |
| 07 | [AI at scale](07-ai-at-scale.md) | Token maths, our own key vs users' keys vs self-hosting, cutting cost 10x | 20 min |
| 08 | [Limits, abuse and security](08-limits-abuse-security.md) | Rate-limit algorithms, bots, DDoS, secrets, privacy law | 15 min |
| 09 | [Reliability and observability](09-reliability-observability.md) | SLOs, error budgets, logs/metrics/traces, alerts, graceful degradation, incidents | 18 min |
| 10 | [Frontend, edge and offline](10-frontend-edge-offline.md) | CDN, static vs dynamic, the PWA, service workers, offline-first writes | 12 min |
| 11 | [Data safety and change](11-data-safety-and-change.md) | Backups, RPO/RTO, safe migrations, zero-downtime deploys, disaster recovery | 15 min |
| 12 | [Roadmap and costs](12-roadmap-and-costs.md) | What we do at each stage, the triggers, and the bill at 1k → 10M users | 12 min |
| 13 | [Glossary and self-test](13-glossary-and-self-test.md) | Every term in one place, plus interview-style questions | 10 min |

---

## The five ideas that matter most

If you remember nothing else, remember these five. Every chapter comes back to them.

1. **Measure before you fix.** Most "scaling problems" are one slow query or one missing
   index. The maths in chapter 02 tells you where to look.
2. **The database is the heart.** App servers are easy to copy a thousand times. The
   database is not. Protect it with pooling, indexes, caching and queues.
3. **Do the slow thing later.** Anything the user doesn't need to see *right now* (push
   notifications, counters, emails) belongs in a queue, not in the request.
4. **Fail small.** When AI is down, typing an expense by hand must still work. When push
   is down, saving must still work. Build things so that one broken part can't take the
   whole app down with it.
5. **Every scaling choice is a trade-off.** Replicas trade freshness for read capacity.
   Caches trade freshness for speed. Queues trade "instant" for "reliable". Good engineers
   name the trade-off out loud.

---

## Our stack, in one picture

```
   Phone (PWA)                     Vercel                Cloudflare                     Supabase
 ┌──────────────┐  HTML/JS/CSS  ┌───────────┐                                         ┌──────────────┐
 │ Next.js app  │ ◄──────────── │  CDN +    │                                         │  Postgres    │
 │ React Query  │               │  Next.js  │                                         │  (one        │
 │ IndexedDB    │   JSON API    └───────────┘   ┌──────────────────┐   Hyperdrive    │   primary)   │
 │ Service      │ ─────────────────────────────►│ Worker (Express) │ ──────────────► │              │
 │ worker       │ ◄─────────────────────────────│ many copies,     │  pooled conns   └──────────────┘
 └──────────────┘                               │ worldwide        │
        ▲                                       └───────┬──────────┘
        │  Web Push (Google/Apple push services)        │ AI calls
        └───────────────────────────────────────────────┤
                                                        ▼
                                                 ┌─────────────┐
                                                 │ Groq (LLMs) │
                                                 └─────────────┘
```

---

## A note on prices

Prices quoted here were checked around **November 2026**. They come from public pricing
pages and third-party trackers, and they change often. Every cost has its **formula**
next to it, so you can plug in today's numbers. Treat the rupee figures as a sense of
size, not a quote.

## Turning this into PDFs

These are plain Markdown files. Diagrams are drawn with text characters, so any Markdown-to-PDF tool
renders them correctly: VS Code "Markdown PDF", `pandoc`, or an online converter.
Example:

```bash
pandoc 04-database.md -o 04-database.pdf
```
