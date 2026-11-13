# 11 · Data Safety and Safe Change

> **In one line:** at scale, the scariest outages are self-inflicted: a bad migration, a
> bad deploy, a backup that doesn't restore. Make change boring.

---

## 1. RPO and RTO: the two backup questions

| Term | Question | Today | Target at scale |
|---|---|---|---|
| **RPO** (Recovery Point Objective) | How much data can we afford to lose? | Up to **24 h** (nightly `pg_dump`) | **≤ 1 minute** |
| **RTO** (Recovery Time Objective) | How long until we're back? | Hours (download, decrypt, restore by hand) | **< 1 hour** |

For a money app, losing a day of expenses is a brand-ending event. Users would have
to re-enter bills, and balances wouldn't match what people already paid.

---

## 2. Backup types

| Type | How | RPO | Good for |
|---|---|---|---|
| **Logical dump** (`pg_dump`) | Exports SQL | Time since the last dump | Small DBs, moving between providers, our **off-site copy** |
| **Physical snapshot** | Copies the disk/files | Time since the snapshot | Fast restores of big DBs |
| **PITR** (point-in-time recovery) | Base snapshot + **continuous WAL archiving** (chapter 04!) | Seconds | "Restore to 21:43:10, just before the bad migration" |

**Our choice:** turn on **Supabase PITR** before real scale (a paid add-on, roughly ~$100/month
per 7 days of retention, check current pricing). Keep the encrypted nightly `pg_dump` to
GitHub as an **independent, off-provider copy**: if our Supabase account itself has a
problem, we still have our data.

### The rule that matters most
> **A backup you haven't restored is not a backup.**
Schedule a monthly job: restore the latest backup into a scratch database, run a few
checks (row counts, a balance check), report pass/fail. We already restore-tested our
encrypted dump once. Make it automatic.

### 3-2-1
**3** copies, on **2** kinds of storage, **1** off-site. PITR on Supabase + snapshots +
encrypted dump on GitHub (or R2/S3) covers it.

---

## 3. Safe schema migrations

Our Worker applies migrations itself (`ensureMigrations`). Great for a small app. At
scale, a migration can **lock a busy table** and freeze the app.

### Dangerous vs safe (Postgres)

| Change | Risk | Safe way |
|---|---|---|
| `CREATE INDEX` on a big table | Blocks writes while building | `CREATE INDEX CONCURRENTLY` |
| `ADD COLUMN … DEFAULT x` | Fine on modern Postgres (11+) | ✅ |
| `ADD COLUMN … NOT NULL` without default | Fails/locks | Add nullable → backfill in batches → add constraint `NOT VALID` → `VALIDATE` |
| Rename / drop a column | Old app versions break | **Expand and contract** (below) |
| Big `UPDATE` backfill | Long locks, WAL flood, replica lag | Batches of 1–10k rows with pauses |

Always set a **`lock_timeout`** (e.g. 3 s) in migrations. If the migration can't get its lock
quickly, it gives up instead of queueing every other query behind it.

### Expand and contract (zero-downtime schema change)
Say we rename `Expense.description` to `Expense.title`:
```
 1. EXPAND    add column title; write BOTH description and title in code
 2. BACKFILL  copy description → title for old rows, in batches
 3. SWITCH    read from title; keep writing both
 4. WAIT      until no old app versions remain (PWA users update slowly, chapter 10)
 5. CONTRACT  stop writing description; later drop it
```
Slower, but **never broken**. Every big company does schema changes this way.

### At scale, move migrations out of the request path
Run them as a **separate deploy step** (CI job with a dedicated DB role), not inside the
Worker on the first request. Then a failed migration fails the deploy, not user requests.

---

## 4. Safe deploys

| Practice | What | Why |
|---|---|---|
| **CI checks** | Tests + type check + build on every push | Catch bugs before users do. We run backend (94) and frontend (41) tests locally today: move them into GitHub Actions. |
| **Staging environment** | A copy of prod with fake data | Try migrations and load tests safely |
| **Gradual rollout** | Cloudflare **gradual deployments** send 1% → 10% → 100% of traffic to the new Worker version | A bad deploy hurts 1% for 5 minutes, not everyone |
| **Instant rollback** | `wrangler rollback` / Vercel "promote previous" | Mitigation in seconds (chapter 09) |
| **Feature flags** | Ship code dark, turn it on later | Separates *deploy* from *release* |
| **Deploy windows** | Not at 9 pm IST (peak bills) | Reduce the blast radius |

---

## 5. Disaster recovery and multi-region

### Failure scenarios
| Scenario | Likelihood | Impact | Plan |
|---|---|---|---|
| Bad deploy | High | Medium | Rollback (minutes) |
| Bad migration / data bug | Medium | High | PITR to just before it (RPO seconds) |
| Supabase instance failure | Low | High | Managed high availability (a standby replica with automatic failover, on higher tiers) |
| Whole region down | Very low | Very high | Cross-region replica + promote, or restore PITR in another region |
| Account/provider problem | Very low | Total | Off-provider encrypted dumps, plus knowing how to stand up Postgres elsewhere |

### Multi-region: do we need it?
- **Read latency** for users far away: Workers are already global, and a **read replica in
  another region** helps reads. Writes still go to the primary.
- **Active-active multi-region writes** (two primaries) is *very* hard: conflicts, clocks,
  money correctness. **Spenit doesn't need it** while our users are mostly in India.
  One primary region (Mumbai), high availability within that region, PITR, and a
  cross-region replica for disaster recovery is the sensible end state.

---

## 6. Data lifecycle

- **Retention:** how long do we keep deleted accounts' data in backups? Write it down,
  enforce it (backup expiry), and say it in the privacy policy.
- **Archival:** expenses older than ~2 years in settled groups can move to cheaper storage
  (partition and detach, chapter 04) while staying readable on request.
- **Exports:** we already let users download their data. At scale, generate exports as a
  **background job** and send a link, rather than building them inside a request.

---

### Self-check

1. Define RPO and RTO. What are ours today, and why isn't that OK for a money app?
2. How does PITR use the WAL?
3. Walk through expand-and-contract for renaming a column.
4. Why is `CREATE INDEX CONCURRENTLY` important on a busy table?
5. Why don't we need active-active multi-region writes?
