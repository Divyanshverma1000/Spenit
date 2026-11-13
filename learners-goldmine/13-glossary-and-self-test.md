# 13 · Glossary and Self-Test

> Every term from this guide, in plain words, plus questions to test yourself, the way an
> interviewer would ask them.

---

## Glossary (A–Z)

| Term | Plain meaning | Ch. |
|---|---|---|
| **ACID** | Transactions are Atomic, Consistent, Isolated, Durable | 04 |
| **At-least-once** | A message is never lost but may arrive twice. Consumers must be idempotent. | 06 |
| **Backoff (exponential)** | Wait longer after each failed retry: 1 s, 2 s, 4 s… | 06, 09 |
| **B-tree index** | Sorted tree that finds rows in O(log n) | 04 |
| **Bulkhead** | Separate pools so one slow feature can't starve others | 09 |
| **BYOK** | Bring Your Own Key: the user supplies their AI API key | 07 |
| **Cache-aside** | Read: check cache → else DB → fill cache. Write: DB → delete cache key. | 05 |
| **Cache stampede** | Many requests miss the same expired key at once and all hit the DB | 05 |
| **CDC** | Change Data Capture: turning database changes (from the WAL) into events | 06 |
| **CDN** | Servers worldwide holding copies of files near users | 10 |
| **Circuit breaker** | Stop calling a failing dependency for a while, then test it again | 09 |
| **Connection pool** | A few warm DB connections shared by many requests | 04 |
| **Consistent hashing** | Spreading keys across nodes so adding a node moves few keys | 04 |
| **Content hashing** | File names include a hash of the contents, so they can be cached forever | 10 |
| **Cursor pagination** | "Rows after (created_at, id) X". Fast and stable at any depth. | 04 |
| **DDoS** | A flood of traffic from many machines | 08 |
| **Dead Letter Queue (DLQ)** | Where messages go after too many failed attempts | 06 |
| **Death spiral** | Slow → connections pile up → slower → retries → down | 02, 03 |
| **Denormalisation** | Storing computed results (e.g. balances) alongside the raw data | 04 |
| **Durable Object** | Cloudflare: one single-threaded, consistent object per key, with storage | 05 |
| **Edge** | Running code in data centres near users | 01 |
| **Error budget** | The allowed unreliability: 100% − SLO | 09 |
| **ETag / 304** | Data fingerprint; "not modified" responses cost almost nothing | 10 |
| **Eventual consistency** | Copies agree "soon", not instantly | 04, 05 |
| **Expand and contract** | Change schemas in safe steps so old and new code both work | 11 |
| **Fan-out** | One event turning into many messages (one push per member's phone) | 06 |
| **Feature flag / kill switch** | Turn features on/off without deploying | 09 |
| **Graceful degradation** | Offer a lesser version instead of failing (AI → manual form) | 03, 09 |
| **Horizontal scaling** | More machines | 04 |
| **Hot row** | A row many requests update at once, so they wait on its lock | 04 |
| **Hyperdrive** | Cloudflare's database connection pooler/accelerator | 01, 04 |
| **Idempotency** | Doing it twice has the same effect as once (Idempotency-Key) | 01, 06 |
| **Isolate** | One running copy of a Worker | 01 |
| **Isolation level** | How much concurrent transactions see of each other (Read Committed, Serializable…) | 04 |
| **Jitter** | Randomness in retry delays so clients don't retry in sync | 06 |
| **JWT** | A signed token proving who you are; checked without a DB call | 08 |
| **Little's Law** | L = λ × W: concurrency = rate × time each request spends | 02 |
| **Load shedding** | Rejecting low-priority work quickly when overloaded | 03, 09 |
| **Lock contention** | Requests waiting for each other's locks | 04 |
| **LSN** | Log Sequence Number: a position in the WAL | 04 |
| **MVCC** | Postgres keeps row versions so reads don't block writes; VACUUM cleans the old ones | 04 |
| **Outbox pattern** | Save the event in the same transaction as the data, publish it later | 06 |
| **p95 / p99** | The latency that 95% / 99% of requests are faster than | 09 |
| **Partitioning** | Splitting one big table into child tables (e.g. by month) | 04 |
| **PITR** | Point-in-time recovery: restore to any second, via WAL archiving | 11 |
| **PWA** | Progressive Web App: a website that installs and works like an app | 10 |
| **Rate limiting** | Capping requests per client per time window | 08 |
| **Read replica** | A read-only copy of the DB fed by the WAL stream | 04 |
| **Read-your-writes** | You always see your own changes, even if others see them later | 04 |
| **Replication lag** | How far a replica is behind the primary | 04 |
| **RPO / RTO** | Max data loss / max time to recover | 11 |
| **Sharding** | Splitting data across several databases by a key (`group_id`) | 04 |
| **SLI / SLO / SLA** | Measurement / target / contract | 09 |
| **Stale-while-revalidate** | Serve the old copy now, refresh it in the background | 05, 10 |
| **Stateless** | Holds no data between requests, so any copy can serve anyone | 01 |
| **Token (AI)** | Unit of text a model reads or writes; billed per million | 07 |
| **Token bucket** | Rate limiter allowing bursts up to B with average rate R | 08 |
| **TTL** | Time to live: how long a cache entry is valid | 05 |
| **Vertical scaling** | A bigger machine | 04 |
| **WAL** | Write-Ahead Log: changes are logged before tables are touched. Powers durability, replication, PITR. | 04 |
| **waitUntil** | Tells a serverless platform to keep working after the response is sent | 06 |

---

## Self-test: 25 interview-style questions

**Warm-up**
1. What's the difference between vertical and horizontal scaling? Which does our API use, and which does our DB use?
2. Why is a stateless service easy to scale?
3. Explain p50 vs p99 to a non-engineer.
4. What does an index cost you?
5. What does Little's Law say, and how does it explain a death spiral?

**Database**
6. Walk through what happens on `COMMIT` in Postgres, including the WAL.
7. Design read routing for Spenit with one replica. Which queries go where, and why?
8. Riya's new expense disappears after refresh. Diagnose it and give three fixes.
9. Offset vs cursor pagination: which, and why, for the expense list?
10. Two people settle the same debt at once. How do you stop a double payment?
11. When would you shard Spenit, by what key, and what becomes hard?

**Caching**
12. Why did our in-memory cache give a poor hit rate on Workers?
13. Cache-aside: why delete on write instead of updating?
14. Design caching for the group screen, with invalidation.

**Async and reliability**
15. Why might fire-and-forget push notifications disappear on Workers?
16. Explain the outbox pattern and the problem it solves.
17. How do you make a queue consumer idempotent?
18. Draw a circuit breaker for the AI provider.
19. Set an SLO for "add expense", and compute the monthly error budget.

**AI and cost**
20. Compute the monthly AI bill for 500k scans at 2,500 in / 800 out tokens.
21. Why isn't BYOK the answer for a consumer app? What is?
22. Give the five biggest levers to cut AI cost.
23. When does self-hosting a model make sense?

**Product and brand**
24. The app is melting on launch night. What do you turn off first, and how do you talk to users?
25. Why is "invite-only" a good scaling tool for Spenit?

---

## Answer hints

- **1** API: horizontal (Workers). DB: vertical (+ replicas later).
- **5** L = λW. Slower queries raise W, so connections in use (L) explode past the limit.
- **8** Replication lag / read-your-writes → sticky primary for 5 s, LSN wait, optimistic UI.
- **10** `SELECT … FOR UPDATE`, SERIALIZABLE + retry, or a unique/idempotency constraint.
- **12** Many isolates, each with its own memory. Also, invalidation in one doesn't clear the others.
- **15** No `waitUntil` → the Worker may stop after responding; the DB connection closes too.
- **19** 99.95% → 0.05% × 30 days ≈ 21.6 minutes.
- **20** 500k × (2500×0.30 + 800×0.60)/1e6 = 500k × $0.00123 ≈ **$615**.
- **22** Skip AI when possible, on-device OCR, smaller images, model routing, caching (image hash + prompt).
- **24** Turn off activity feed and insights, then AI (to the manual form). Keep add/settle. Status page + in-app banner, updates every 30 min.

---

## Where to go next (free resources)

- *Designing Data-Intensive Applications*, Martin Kleppmann. The book for chapters 04–06.
- Google's **SRE Book** (free online): SLOs, error budgets, incidents (chapter 09).
- **Use The Index, Luke** (use-the-index-luke.com): indexes, explained brilliantly.
- **PostgreSQL docs**: "WAL Internals", "Routine Vacuuming", "Explicit Locking".
- **Cloudflare docs**: Workers, Durable Objects, Queues, Hyperdrive.
- **ByteByteGo / System Design Primer** (GitHub): visual overviews of every topic here.
- Read **public postmortems** (GitHub, Cloudflare, Slack blogs). They're the best free lessons in production engineering.
