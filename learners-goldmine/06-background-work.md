# 06 · Background Work: Queues, Fan-out and Retries

> **In one line:** if the user doesn't need to see the result right now, don't make them
> wait for it. And don't trust "it probably ran" either.

---

## 1. Sync vs async

**Synchronous:** the request waits until the work is done. **Asynchronous:** the
request records "this needs doing" and returns. Someone else does the work.

| Work in Spenit | User needs it now? | Should be |
|---|---|---|
| Save expense | ✅ yes | Sync |
| Push "New expense added" to 5 friends | ❌ | Async |
| Update usage counters | ❌ | Async (batched) |
| Read a bill with AI | Half: they're watching a spinner | **Async with progress** at scale |
| Recalculate insights | ❌ | Async / scheduled |
| Send the weekly summary (future) | ❌ | Scheduled job |
| Delete an account's data | ❌ (confirm now, finish later) | Async with a guarantee |

---

## 2. A real bug class in our code: fire-and-forget on serverless

In `routes/expenses.ts`, push is sent like this:

```ts
;(async () => {
  const members = await pool.query(...);
  await sendToUsers(memberIds, {...});
})();                       // not awaited
res.status(201).json(expense);
```

On a **long-running server** (Node on a VM), this works: the process keeps running and
the promise finishes.

On **Cloudflare Workers** (and AWS Lambda, Vercel Functions…), the platform may stop
the request's work shortly after the response is sent, **unless you tell it to wait**.
Also, our per-request DB connection is closed when the response finishes. Pushes may
work most of the time in testing and then quietly drop under load.

**The immediate fix:** register the work with `waitUntil`:

```ts
import { waitUntil } from "cloudflare:workers";
waitUntil(notifyGroup(groupId, payload));   // response goes out now, the Worker stays alive for this
```

`waitUntil` keeps the Worker alive (up to a time limit) after responding. It's not a
**guarantee**, though. If the push service is down for 10 minutes, the notification is still lost.

> **Lesson:** "serverless" changes the rules of background work. Anything not awaited,
> not `waitUntil`-ed and not queued is **best effort at most**.

---

## 3. Message queues

### The concept
A **queue** is a durable list of jobs. **Producers** add messages. **Consumers** take
them, do the work, and **acknowledge** (ack) them. Un-acked messages come back for
another try.

```
  API (producer) ──► [ queue: notify(G,exp1) notify(G,exp2) scan(img7) … ] ──► consumer workers
        returns immediately                durable, survives crashes             retry on failure
```

### What a queue buys you
1. **Durability:** jobs survive crashes and deploys.
2. **Retries:** failed jobs come back automatically.
3. **Smoothing (load levelling):** a spike of 10,000 jobs is processed at a steady rate
   the downstream can handle (Groq, push services, the DB).
4. **Decoupling:** the API doesn't care how long push takes.

### Delivery guarantees (important vocabulary)

| Guarantee | Meaning | Reality |
|---|---|---|
| At-most-once | Never duplicated, may be lost | Fire-and-forget |
| **At-least-once** | Never lost, **may be duplicated** | What almost every real queue gives you |
| Exactly-once | Never lost, never duplicated | Mostly a myth end-to-end. You build it from at-least-once + **idempotent consumers** |

> **So consumers must be idempotent:** processing the same message twice must have the
> same effect as once. For push: store `notification_id` and skip if already sent. For
> scans: the result is keyed by job id.

### Retries done right
- **Exponential backoff:** wait 1 s, 2 s, 4 s, 8 s… so you don't hammer a struggling service.
- **Jitter:** add randomness (`delay × random(0.5–1.5)`) so 10,000 failed jobs don't all
  retry at the same instant.
- **Max attempts, then a Dead Letter Queue (DLQ):** after N failures, park the
  message in a DLQ for a human to look at, instead of retrying forever ("poison message").

### Options on our platform

| Option | Notes |
|---|---|
| **Cloudflare Queues** | Native to Workers, batches, retries, DLQ. Our natural choice. |
| Postgres as a queue (`SELECT … FOR UPDATE SKIP LOCKED`) | Zero new infrastructure. Great up to thousands of jobs/min. Uses DB capacity. |
| AWS SQS / Google Pub/Sub | If we ever leave Cloudflare |
| Kafka | A *log*, not just a queue: replayable streams, huge throughput. Overkill until we have many teams consuming the same events. |

---

## 4. Fan-out: one event, many recipients

"Expense added in a 40-person group" means 39 notifications, and each person may have 2
phones, so ~78 push requests.

```
  expense.created ──► [queue] ──► fan-out consumer:
                                   for each member (except author):
                                     for each PushSubscription:
                                       enqueue push(sub, payload)   ──► [push queue] ──► sender
```

- Splitting "work out who to notify" from "send each push" means one dead phone
  (HTTP 410 Gone → delete the subscription, which we already do) doesn't slow the others.
- **Coalescing:** if someone adds 12 scanned orders in one go, send **one** push ("Riya
  added 12 orders") instead of 12. We already do this for batch imports ("Orders added").
- **Rate per recipient:** never send someone more than N pushes a minute. Collapse with
  the `tag` field (we set `tag: expense-{groupId}`, so the phone replaces instead of stacking).

---

## 5. The outbox pattern (reliable "save and then notify")

### The problem: dual writes
```
 1. INSERT expense   ✅
 2. enqueue push     ❌ (queue is down, or the Worker died between 1 and 2)
```
The expense exists but nobody is ever told. Or, if you enqueue first and the insert
fails, people are told about an expense that doesn't exist.

### The pattern
Write the event **into the database, in the same transaction** as the data:

```sql
BEGIN;
  INSERT INTO "Expense" …;
  INSERT INTO "Outbox" (topic, payload) VALUES ('expense.created', '{…}');
COMMIT;   -- both or neither
```

A **relay** (a cron or a consumer) reads unsent `Outbox` rows, publishes them to the queue,
and marks them sent. At-least-once, never lost, never "notified about nothing".

> Fun fact: **Spenit's phone app already uses this idea**. `lib/outbox.ts` stores
> offline expenses in IndexedDB with an idempotency key and sends them later. The server-side
> outbox is the same idea in the opposite direction.

**Advanced:** instead of polling an Outbox table, read the **WAL** directly with
**Change Data Capture (CDC)**, e.g. Debezium or Supabase Realtime. Every committed change becomes
an event, with no extra table.

---

## 6. AI scanning as an async job (at scale)

Today a scan is one long HTTP request (1–4 s). At launch scale:

```
 Phone ──POST /scans──► API: store job {id, status: queued} ──► 202 Accepted {jobId}
                         │
                         └─► [scan queue] ──► consumer (rate-limited to the provider quota)
                                                  │  calls Groq / fallback provider
                                                  └─► job {status: done, result}
 Phone ──GET /scans/:id (or push / WebSocket)──► "done" → shows the result
```

- **Why:** a 429 from Groq becomes "wait in the queue a little" instead of "failed".
- **UX:** *"Reading your bill… 3 ahead of you"* is honest and calm.
- **Bonus:** jobs can be **prioritised** (paying users or first-time users first) and
  **batched** (some providers give ~50% off for batch inference).

> **Choice:** keep the sync scan until we see 429s. Then move to queue + polling. It's a
> contained change: the import page already has a "Reading" step.

---

## 7. Scheduled jobs (cron)

We already have one: every 4 hours, housekeeping (clean old idempotency keys, keep the
DB awake). At scale, add:
- the nightly **balance reconciliation** (chapter 04),
- **counter flush** and roll-ups for the dashboard,
- **soft-delete purge** after the retention window (privacy promise),
- the **backup verification** restore test (chapter 11).

**Rules:** jobs must be **idempotent** (safe to run twice), **resumable** (process in
chunks with a cursor), and **observable** (log "started/finished/rows").

---

### Self-check

1. Why can fire-and-forget work locally but drop notifications on Workers?
2. Queues are "at-least-once". What must the consumer be, and how do you make push idempotent?
3. Explain the dual-write problem and how the outbox pattern solves it.
4. Why add jitter to retries?
5. Sketch the async scan flow. What does the phone show while waiting?
