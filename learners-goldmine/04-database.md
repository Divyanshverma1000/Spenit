# 04 · The Database: Heart of the System

> **In one line:** app servers are cattle, the database is a pet. Most of scaling is
> protecting one Postgres from work it doesn't need to do.

This is the longest chapter. Take it in sections.

---

## 1. Connections and pooling

### The concept
A Postgres connection is expensive. Each one is a separate **process** on the database
server using ~5–10 MB of RAM. Setting one up takes a TLS handshake plus authentication,
which is 20–100 ms. So databases cap connections (often 60–500), and opening one per
request is slow.

A **connection pool** keeps a few connections open and lends them to requests:

```
  1,000 requests ──► [ Pool: 20 warm connections ] ──► Postgres
                       each request borrows one for ~5 ms, then returns it
```

### Pooling modes (PgBouncer, Supavisor and Hyperdrive work like this)

| Mode | A connection is lent for… | Good | Catch |
|---|---|---|---|
| **Session** | the client's whole session | Everything works | Few clients per connection |
| **Transaction** | one transaction | Hundreds of clients share 20 connections | No session features (session `SET`, advisory locks, some prepared statements) |
| **Statement** | one statement | Most sharing | No multi-statement transactions |

### Spenit today
- Every Worker request gets **one** connection through **Hyperdrive** (Cloudflare's
  pooler, which sits near the database and keeps warm connections).
- Transactions get their own dedicated connection.
- Backups connect through Supabase's **session pooler** (port 5432).

### What breaks, and our choice
Pooling hides the cost of *opening* connections, but not the cost of *holding* them.
If queries slow down, every pooled connection is busy and requests queue up. **The
real fix is always making queries shorter** (indexes, caching, less data per query).

> **Choice:** keep Hyperdrive. Watch "connections in use" on Supabase. At ~70% of the
> limit, first look for slow queries, *then* raise compute.

---

## 2. Indexes: the 1,000x speed-up

### The concept
Without an index, `WHERE group_id = 'X'` reads **every row** (a "sequential scan"). With a
**B-tree index**, Postgres jumps straight to the rows, in O(log n). For 10 M rows that's
~23 steps instead of 10 M.

```
               [ M ]                  B-tree on group_id:
            /        \                 like a phone book,
        [ D ]        [ T ]             open in the middle and
       /    \       /    \             halve each step
    [A-C] [E-L]  [N-S] [U-Z] ──► row pointers
```

### Composite indexes: order matters
`idx_expense_group_created ON "Expense"(group_id, created_at)` serves:
- ✅ `WHERE group_id = $1`
- ✅ `WHERE group_id = $1 ORDER BY created_at DESC LIMIT 50`: already sorted, no extra sort step
- ❌ `WHERE created_at > now() - interval '1 day'` alone: the leading column is missing

**Leftmost-prefix rule:** a composite index helps queries that filter on its *first*
column(s).

### Spenit today (good news)
We already have the important ones:

| Index | Serves |
|---|---|
| `Expense(group_id, created_at)` | Group screen, ordered by time |
| `GroupMember(user_id)` + PK `(group_id, user_id)` | "my groups" and "am I a member?" |
| `ExpenseSplit(user_id)`, `ExpensePayer(user_id)` | Personal totals across groups |
| `Settlement(group_id, status)` | Balances use only confirmed settlements |
| `PersonalExpense(user_id, spent_at desc) WHERE deleted_at IS NULL` | A **partial index**: smaller, skips deleted rows |
| `GroupActivity(group_id, created_at desc, id desc)` | Activity feed with a stable cursor |

### How to find a missing index
```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM "Expense" WHERE group_id = '…' ORDER BY created_at DESC LIMIT 50;
```
Look for `Seq Scan` on a big table (bad) versus `Index Scan` (good). On Supabase,
`pg_stat_statements` lists the slowest queries by **total time**. Fix the top 5 and
you've usually fixed 80% of the load.

### The cost of indexes
Each index makes **writes** slower (every insert updates every index) and uses RAM and disk.
Spenit is read-heavy, so that's a good trade, but don't index everything.

---

## 3. Pagination: never return "everything"

### The problem
`listGroupExpenses` returns **every** expense in the group. Fine for 30, painful for 3,000.

### Offset vs cursor

| | Offset: `LIMIT 50 OFFSET 1000` | Cursor ("keyset"): `WHERE (created_at, id) < ($last_ts, $last_id) LIMIT 50` |
|---|---|---|
| Speed on page 100 | Slow: Postgres still reads and skips 5,000 rows | Fast: jumps straight there via the index |
| New rows while scrolling | Duplicates or skips | Stable |
| "Jump to page 37" | Easy | Not possible (fine for a feed) |

> **Choice:** cursor pagination on `(created_at, id)`. The group screen loads the latest
> 50. Balances come from the **summary** (next section), not from loading every row.

---

## 4. Denormalisation and summary tables

### The concept
**Normalised** = each fact stored once, computed when needed (we compute balances
from every expense and settlement). **Denormalised** = also store the *result*, kept
up to date on every write.

### Spenit's case
A balance is `sum(paid) − sum(owed) ± confirmed settlements`. Today we recompute it
from scratch (with a cache). At scale, keep a running total instead:

```sql
CREATE TABLE "GroupBalance" (
  group_id uuid, user_id uuid, net numeric(12,2),
  PRIMARY KEY (group_id, user_id)
);
-- In the SAME transaction as INSERT Expense:
UPDATE "GroupBalance" SET net = net + $delta WHERE group_id = $g AND user_id = $u;
```

| | Recompute (today) | Running total |
|---|---|---|
| Read cost | O(expenses in group) | O(members): tiny |
| Write cost | Tiny | A few extra updates per write |
| Risk | None, always correct | Totals can drift if code has a bug, so you need a **reconciliation job** that recomputes nightly and compares |

> **Choice:** keep recompute + cache until 1M users. Add `GroupBalance` when the group
> screen p95 goes above ~300 ms. Keep the recompute function as the **source of truth** for the
> nightly check. It's already unit-tested.

---

## 5. Transactions, isolation and locks (correctness under concurrency)

### ACID in one breath
**A**tomic: all or nothing. **C**onsistent: rules hold. **I**solated: concurrent
transactions don't see each other's half-done work. **D**urable: once committed, it
survives a crash (thanks to the WAL, next section).

### A real Spenit race
Two people settle the same debt at the same moment:
```
  T1: read balance (₹500 owed) ──► insert settlement ₹500
  T2: read balance (₹500 owed) ──► insert settlement ₹500   ← paid twice!
```

**Fixes:**
- `SELECT … FOR UPDATE` locks the rows you read, so T2 waits for T1.
- Or the `SERIALIZABLE` isolation level: Postgres detects the conflict and aborts one,
  and the app retries.
- Or a **unique constraint / idempotency key**: the database itself rejects the duplicate.

> **Rule:** let the database enforce correctness (constraints, transactions). Code checks
> alone are not enough under concurrency.

### Hot rows (bottleneck #4 from chapter 03)
`UsageDaily(day, metric)` is updated by every AI call. Row locks make the updates wait in single file.

| Fix | How | Trade-off |
|---|---|---|
| **Batch** | Each Worker keeps counts in memory and flushes once a minute | Can lose ≤1 minute of counts if a copy dies (fine for analytics) |
| **Sharded counter** | `(day, metric, shard 0–15)`, each write picks a random shard, reads `SUM` | 16x less waiting, slightly more complex reads |
| **Move out of Postgres** | Send events to an analytics store (Workers Analytics Engine, ClickHouse, PostHog) | One more system to run |

> **Choice:** batching now (simple). Analytics Engine when we need richer dashboards.
> The same goes for `RateCounter`: at high volume, move exact limits to Redis or Durable Objects (chapter 08).

---

## 6. WAL: what "writes ahead" really means

### The concept
Postgres never writes your data straight into the table files first. It writes a record
of the change to the **Write-Ahead Log (WAL)**, an append-only file, and flushes *that*
to disk. Only then does it say "COMMIT OK". The table files are updated later, in the
background.

```
 INSERT ─► [WAL: "add row X to Expense"] ─fsync─► "COMMIT OK" to the app
                     │
                     ├─► later: table/index pages updated (checkpoint)
                     ├─► crash? replay the WAL on restart → nothing lost   (Durability)
                     ├─► stream the WAL to replicas → read replicas         (Replication)
                     └─► archive the WAL → point-in-time recovery            (Backups, ch. 11)
```

Why it's genius: appending to one file is **much** faster than updating random places
in many files. And that same log powers crash safety, replicas *and* backups.
**Remember the WAL. It explains half of database engineering.**

---

## 7. Read replicas: "reads from replica, writes to primary"

### The concept
The primary streams its WAL to one or more **replicas**. Replicas replay it and serve
**read-only** queries. Writes still go to the single primary.

```
                 writes ─► ┌─────────┐ ── WAL stream ──► ┌──────────┐
   Worker ─────────────────│ PRIMARY │                   │ REPLICA 1│ ◄─ reads
                           └─────────┘ ── WAL stream ──► ┌──────────┐
                                                         │ REPLICA 2│ ◄─ reads
                                                         └──────────┘
```

Spenit is ~95% reads, so two replicas can take most of the load off the primary.

### The catch: replication lag
Replicas are usually **milliseconds to seconds** behind. So this can happen:

> Riya adds an expense (written to the primary) → her app refreshes the group (read from
> a replica that hasn't caught up) → **her expense isn't there.** She adds it again. Now
> there are two.

This is the **read-your-writes** problem. Solutions:

| Approach | How | Notes |
|---|---|---|
| **Sticky primary after write** | For ~5 s after a user writes, send *their* reads to the primary | Simple, the common choice |
| **LSN tracking** | The write returns the WAL position (LSN). Reads wait until the replica has caught up to it | Exact, more complex |
| **Client-side truth** | The app already shows the new expense optimistically (React Query) | We already do this: it hides most lag |
| **Critical reads on primary** | Balances before settling up always read the primary | Money correctness |

### Consistency models (vocabulary)
- **Strong consistency:** every read sees the latest write (primary only).
- **Eventual consistency:** reads catch up "soon" (replicas, caches).
- **Read-your-writes:** *you* always see *your own* writes, even if others lag.

> **Choice:** when DB CPU stays above 60% after caching and query fixes, add one replica.
> Route: activity feed, insights, admin dashboard, "my groups" list → replica. Settle-up,
> balances right after a write, anything about money → primary. Plus sticky primary
> for 5 s after each write.

---

## 8. Vertical vs horizontal scaling

| | Vertical ("bigger box") | Horizontal ("more boxes") |
|---|---|---|
| How | More CPU/RAM for the primary | Replicas for reads, shards for writes |
| Effort | A button on Supabase | Weeks of engineering |
| Limit | The biggest machine (~64–128 vCPU) | Practically none |
| Downtime | Brief restart | None, if done well |

> **Truth most tutorials skip:** vertical scaling goes *very* far. A big Postgres handles
> tens of thousands of simple queries/sec. Most companies with a few million users run
> on **one big primary plus a few replicas**. Do it first, and stay as long as you can.

---

## 9. Partitioning and sharding (the last resort)

### Partitioning (same database, split table)
Split `Expense` into child tables by time (`Expense_2026_11`, `Expense_2026_12`…).
Queries for recent data only touch recent partitions. Old ones can be archived. Postgres
does this natively (`PARTITION BY RANGE (created_at)`).
**When:** single tables pass ~100 M rows, or you need to drop old data cheaply.

### Sharding (many databases, split data)
Each database holds a **slice** of the data. Rows are routed by a **shard key**.

**Spenit's natural shard key is `group_id`.** Almost every query is "inside one
group": expenses, splits, settlements and balances all belong to a group. Put a group's rows on
one shard, and most queries touch only one database.

```
 hash(group_id) % 4 ─► shard 0 │ shard 1 │ shard 2 │ shard 3
```

**What gets hard:**
- **Cross-shard queries:** "all my groups and my total balance" spans shards. Answer it
  with a per-user summary table, kept up to date via events.
- **Re-sharding:** moving from 4 to 8 shards means moving data. Use **consistent hashing**
  or a lookup table (`group_id → shard`) so you only move what you must.
- **Transactions across shards:** avoid them by design (keep a group on one shard).
- **Personal spending:** shard by `user_id` instead, or keep it on its own database.

Tools: **Citus** (Postgres extension, distributed tables), **Vitess**-style routers,
or managed options (Neon, PlanetScale-for-Postgres, AWS Aurora Limitless).

> **Choice:** we don't shard until **writes** outgrow the biggest single primary. By the
> maths in chapter 02, that's well past 10M users for an app like ours. But we design
> **as if** we might: every group-scoped table carries `group_id`, and queries stay
> inside one group. That costs nothing today and keeps the door open.

---

## 10. Maintenance basics (things that bite quietly)

- **MVCC and VACUUM:** Postgres never overwrites a row. An update creates a new version and
  marks the old one dead. **VACUUM** cleans up the dead versions. Tables with heavy
  updates (counters!) bloat if autovacuum can't keep up. Watch "dead tuples".
- **Long transactions** block VACUUM and hold locks. Never keep a transaction open while
  calling AI or another network service.
- **Connection timeouts:** set `statement_timeout` (e.g. 5 s) so one bad query can't
  hold a connection forever.
- **Soft deletes** (`deleted_at`) keep rows around forever. Add partial indexes
  (`WHERE deleted_at IS NULL`) and archive old deleted rows.

---

### Self-check

1. Why does pooling fix "too many connections" but not "slow queries"?
2. Write the cursor-pagination `WHERE` clause for the next page after `(t, id)`.
3. Riya adds an expense and refreshes, and it's missing. Name the problem and two fixes.
4. Why is `group_id` a good shard key for Spenit, and which feature does it make hard?
5. What three things does the WAL power?
6. When would you add a `GroupBalance` running-total table, and what keeps it honest?
