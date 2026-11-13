# 02 · Numbers First: Back-of-the-Envelope Maths

> **In one line:** "millions of users" means nothing until you turn it into requests per
> second, rows per day and rupees per month. Senior engineers do this maths *before*
> touching code.

---

## 1. Why estimate?

Without numbers you'll either:

- **over-build:** Kafka and sharding for 2,000 users (slow and expensive), or
- **under-build:** a free-tier database on launch day (down in an hour).

The maths takes 15 minutes and tells you **which layer breaks first**. You only need to be
right to within ~3x. It's a tool for **ordering** your work, not for precision.

---

## 2. Numbers every engineer should know (roughly)

| Thing | Time |
|---|---|
| Read from memory (RAM) | ~100 ns |
| Read 1 MB from SSD | ~1 ms |
| Simple indexed Postgres query (same region) | 0.5–2 ms |
| Round trip Mumbai ↔ Mumbai data centre | ~1–5 ms |
| Round trip Mumbai ↔ US East | ~200–250 ms |
| New TLS + Postgres connection from scratch | 20–100 ms (**why we pool**) |
| LLM text answer (Groq, ~300 tokens) | 0.3–1.5 s |
| LLM vision read of a bill | 1–4 s |

| Capacity (rough, for planning) | Number |
|---|---|
| One small Postgres (2 vCPU) running simple indexed queries | 1,000–5,000 queries/sec |
| Typical max Postgres connections on small plans | 60–200 direct |
| Cloudflare Workers | each copy (isolate) serves many requests at once, and Cloudflare runs as many copies as needed |
| Seconds in a day | 86,400 (round to **100,000** for quick maths) |

> **Trick:** "per day ÷ 100,000 ≈ per second". 4.5 M requests/day ≈ 45 req/s on average.

---

## 3. Spenit's numbers: three scenarios

### Assumptions (write them down, every time)

| Assumption | Value | Why |
|---|---|---|
| Daily active ÷ registered (DAU/MAU-ish) | 15% | Utility apps: people open it when they spend |
| API requests per active user per day | 30 | Open app ~4×, each screen ~3–5 calls, a few writes |
| Expenses added per active user per day | 2 | Some log a lot, most a little |
| Bill/order scans per active user per day | 0.3 | Scanning is the "wow" feature, but not daily |
| AI chat questions per active user per day | 0.2 | |
| Peak-hour multiplier | **5×** the average | Dinner time (8–11 pm IST) is when bills happen |
| Launch-day spike multiplier | **20×** | A viral post sends everyone in the same hour |

### The table

| | 10k users | 1M users | 10M users |
|---|---|---|---|
| Daily active (15%) | 1,500 | 150,000 | 1.5 M |
| API requests/day | 45k | 4.5 M | 45 M |
| **Average req/s** | 0.5 | 52 | 520 |
| **Peak req/s (5×)** | 3 | 260 | 2,600 |
| **Launch spike (20×)** | 10 | 1,000 | 10,000 |
| DB queries/s at peak (~4 per request) | 12 | 1,000 | 10,000 |
| Expenses written/day | 3k | 300k | 3 M |
| Writes/s at peak | <1 | 17 | 170 |
| Bill scans/day | 450 | 45k | 450k |
| AI chats/day | 300 | 30k | 300k |

### What the table tells us

1. **Writes are small.** Even at 10M users, ~170 writes/s at peak is easy for one Postgres
   *if* the writes are well indexed and don't fight over hot rows. Spenit is a
   **read-heavy** app (~95% reads). That's why read replicas and caching are our main
   tools, not sharding.
2. **Reads are the pressure.** 1,000 DB queries/s at 1M users is near what a small
   Supabase instance can take. **At 1M users we must have caching and a bigger
   database.** At 10M we need read replicas.
3. **The launch spike is the real enemy,** not the steady state. Ten thousand requests a second
   for one hour is what takes companies down. Chapter 03 is about this.
4. **AI is the most expensive part,** even though it's the smallest by count (chapter 07).

---

## 4. Storage maths

| Row | Approx size (with indexes) |
|---|---|
| Expense (plain) | ~0.5 KB |
| Expense with scanned items (`receipt_data` JSON) | ~2–4 KB |
| ExpenseSplit (one per person) | ~0.2 KB |
| PersonalExpense | ~0.3 KB |

**At 1M users:** 300k expenses/day × (0.5 KB + 4 splits × 0.2 KB), plus 45k scans × 3 KB,
comes to ≈ **0.5 GB/day ≈ 180 GB/year.**

- Postgres is comfortable with this on one machine (hundreds of GB is normal).
- `pg_dump` nightly backups are **not** comfortable at this size: they take hours and
  lock up resources. Switch to managed point-in-time recovery (chapter 11).
- Indexes must fit in RAM for speed. Our hot indexes (by `group_id`, `user_id`) stay
  small even when tables are big. That's why choosing the right index matters more
  than table size.

**We never store bill photos.** Images go to the AI and are thrown away. That's both a
**privacy win** and a **storage win**: 45k images/day × 400 KB would be 18 GB/day.

---

## 5. Bandwidth maths

- Typical API response: 2–20 KB (group overview can be 200 KB+ for big groups: no paging!).
- Bill upload: ~300–600 KB after phone-side compression.
- At 1M users: 4.5M requests × ~10 KB ≈ 45 GB/day out, plus 45k scans × 0.5 MB ≈ 22 GB/day in.
- Cloudflare charges nothing for egress (data going out). On AWS, 45 GB/day would be about $120/month in
  egress alone. **Picking the platform is a cost decision.**

---

## 6. Connections maths (the one that bites first)

- Each Worker request opens **one** DB connection (through Hyperdrive).
- At 1,000 req/s with each request holding a connection for ~20 ms, the *concurrent*
  connections ≈ 1,000 × 0.02 = **20**. Easy.
- But if the database slows down and each request holds its connection for 500 ms, that
  becomes **500** concurrent connections. That's above the limit, so new requests fail, so
  retries pile up, so things get slower still...

This is called a **feedback loop**, or "death spiral". The formula behind it is
**Little's Law**:

> **L = λ × W**
> concurrent things in the system = arrival rate × time each one spends inside

It's the most useful formula in capacity planning. It explains why a *slow* database
turns into an *unavailable* one: the time each request spends inside (W) goes up, so the
connections in use (L) explode. **The fix is never "more connections". It's making W small
again:** faster queries, caching, shedding load.

---

### Self-check

1. If DAU is 300k and each user makes 40 requests, what's the peak req/s with a 5× peak factor?
2. Why is Spenit read-heavy, and what tools does that point us towards?
3. Using Little's Law: 800 req/s, each holding a DB connection for 50 ms. How many connections?
4. Why is *not* storing photos a scaling decision as well as a privacy one?

*(Answers: 1. 300k × 40 = 12 M/day ≈ 120 req/s avg, so ~600 at peak. 3. 800 × 0.05 = 40.)*
