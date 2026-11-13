# 01 · Spenit Today

> **In one line:** before you can scale a system, you have to be able to draw it, and
> trace one request through it from the tap to the database and back.

---

## 1. The pieces

| Piece | What it is | Where it runs | Scales how? |
|---|---|---|---|
| **Frontend** | Next.js 16 app, installed as a PWA | Vercel (CDN worldwide) | Mostly static files on a CDN. Scales almost for free. |
| **API** | Express app on a Cloudflare Worker | Cloudflare's edge, 300+ cities | Cloudflare starts more copies ("isolates") as traffic grows. |
| **Database** | Postgres | Supabase, one region, **one primary** | Doesn't scale by itself. **This is our bottleneck.** |
| **DB connection pool** | Cloudflare Hyperdrive | Cloudflare, near the database | Keeps warm connections, so each Worker doesn't open a new one. |
| **AI** | Groq: `gpt-oss-120b` for text, `qwen3.8-27b` for vision | Groq's cloud | Limited by our account's rate limits and our wallet. |
| **Push** | Web Push (VAPID) via Google FCM / Apple APNs | Their servers | They scale. *We* have to send one request per phone. |
| **Backups** | GitHub Action running `pg_dump`, encrypted | GitHub runners | Nightly. Fine up to a few GB. |
| **Housekeeping** | Worker cron every 4 hours | Cloudflare | Cleans old idempotency keys and keeps Supabase awake. |

### The key idea: stateless vs stateful

- The **Worker is stateless.** Any copy can answer any request, because nothing important
  lives in its memory. So copying it 1,000 times is safe, and Cloudflare does it for us.
- **Postgres is stateful.** The data lives *there*. You can't just "start another
  Postgres" and split traffic, because both copies would need the same data. Most of
  this guide is about this one fact.

> **Rule of thumb:** push state *down* into the database (or a cache or queue), and keep
> the compute layer stateless. Then the compute layer scales horizontally for free, and
> you only have to think hard about one layer.

---

## 2. Follow one request: "Add expense"

Riya adds "Dinner ₹1,200" to the Goa group.

```
 1. Phone      Riya taps Save. The app gives the request an Idempotency-Key (a random id).
               If she's offline, it goes to the Outbox in IndexedDB and is sent later.
 2. Network    POST https://spenit-api…workers.dev/expenses   (JSON, ~1 KB)
 3. Cloudflare The closest data centre (say Mumbai) runs a Worker copy.
               ├─ Rate limiters check her IP and account   (RL_GLOBAL, RL_WRITE)
               ├─ JWT checked: who is this?               (no DB call needed)
               └─ Express router → expenses.ts
 4. Hyperdrive Worker asks for a DB connection. Hyperdrive hands over a warm one.
 5. Postgres   BEGIN
               ├─ Is Riya a member of this group?          (SELECT)
               ├─ Has this Idempotency-Key been seen?      (SELECT/INSERT)
               ├─ INSERT Expense, INSERT ExpenseSplit × N
               └─ COMMIT  → Postgres writes it to the WAL first (see chapter 04)
 6. Cache      Balance cache entries for the group are deleted (invalidated).
 7. Response   201 Created → Riya's phone shows it instantly.
 8. After      Push "New expense added" goes to the other 3 members.
               (Today this runs as "fire-and-forget" after the response. See chapter 06
               for why that's risky on Workers.)
```

**Things to notice:**

- Steps 3 and 4 happen near Riya (the edge), but step 5 always travels to **one** database
  in **one** region. If our Supabase is in Mumbai, users in the US pay a ~250 ms round trip
  on every query. Hyperdrive helps with *connection setup*, not with *distance*.
- The Idempotency-Key in step 1 means that if her network drops after step 5 and the
  app retries, no duplicate expense is created. This is an important production pattern,
  and we already have it.
- Step 8 is the only step the user doesn't need to wait for. That's a hint that it
  belongs in a queue.

---

## 3. Follow a read: "Open the group"

`GET /groups/:id/overview` returns everything the group screen needs in one call:

```
 Promise.all([
   getGroupDetail(id),          → group + members
   listGroupExpenses(id),       → EVERY expense in the group (no paging)
   listGroupSettlements(id),    → every settlement
   getGroupBalance(id),         → computed from all expenses + settlements (cached)
 ])
```

**Two lessons hide in here:**

1. **`Promise.all` looks parallel but isn't, here.** On Workers, each request gets
   **one** Postgres connection, and one Postgres connection runs **one query at a time**.
   The four queries queue up on that connection. It's still fine (each is fast), but
   "parallel in code" is not "parallel in the database".
2. **No paging.** A group with 5,000 expenses sends all 5,000 every time it opens. At
   launch scale, big groups (hostels, offices, clubs) will exist, and this becomes the
   slowest screen in the app. Fix: cursor pagination (chapter 04).

---

## 4. Where the data lives

| Table | What | Grows with | Hot? |
|---|---|---|---|
| `User` | accounts | signups | read on every group screen |
| `Group`, `GroupMember` | groups and who's in them | groups × members | read on almost every request (membership checks) |
| `Expense`, `ExpenseSplit` | the money | **activity, fastest-growing** | read on every group screen |
| `Settlement` | payments back | activity | read with balances |
| `PersonalExpense` | your own spending | daily logging | per user only |
| `PushSubscription` | one row per phone | installs | read on every push |
| `IdempotencyKey` | retry protection | every write (cleaned after 7 days) | written on every write |
| `RateCounter` | exact AI limits | every AI call | **one hot row per user per minute** |
| `UsageDaily`, `UserActiveDay`, `ErrorDaily` | admin dashboard numbers | per day | **`UsageDaily` has a few very hot rows** (chapter 04, §8) |

> **"Hot"** means many requests touch the same rows at the same time. Hot rows cause
> **lock contention**: requests wait in line for each other. They're often the first
> thing to break under load, before raw capacity runs out.

---

## 5. What's already good (we did these on purpose)

You don't have to start from zero. These choices already make Spenit easier to scale:

- **Stateless API on the edge.** Horizontal scaling comes for free.
- **Hyperdrive pooling.** Thousands of Worker copies don't each open their own
  Postgres connection.
- **Idempotency keys** on writes. Retries are safe.
- **Offline outbox** on the phone. A bad network doesn't lose writes.
- **React Query cache persisted to IndexedDB.** Screens open instantly from the phone's
  copy and fewer requests reach us (chapter 10).
- **Rate limits in three layers:** Cloudflare's approximate limiter, a per-copy memory
  limiter, and an *exact* Postgres limiter for AI (chapter 08).
- **Images are compressed on the phone** before upload (max 2000 px, JPEG 85%).
- **Graceful AI fallback.** If AI fails, the user is sent to the manual form.
- **Telemetry in our own DB** with an admin dashboard and push alerts on new errors.
- **Encrypted nightly backups.**

## 6. What's fragile (the rest of this guide fixes these)

| Fragile thing | Breaks when | Chapter |
|---|---|---|
| One Postgres primary, small compute | ~a few hundred busy queries/sec, or too many connections | 04 |
| Balance cache lives in each Worker's memory | Always: copies don't share memory, so hit rate is low | 05 |
| Group screen loads every expense | Big groups (1,000+ expenses) | 04 |
| Push sent after the response, without `waitUntil` | Worker shuts down early → lost notifications | 06 |
| One Groq account key for everyone | Groq org rate limit or bill spikes | 07 |
| `UsageDaily` counter rows | Thousands of AI calls/min all updating the same row | 04 |
| Backups via `pg_dump` nightly | Data > a few GB; we can lose up to 24 h of data | 11 |
| Single region | Supabase region outage = full outage | 11 |

---

### Self-check

1. Why can Cloudflare copy our API 1,000 times, but Supabase can't copy our database the same way?
2. In "Add expense", which step could move to a queue, and why?
3. Why doesn't `Promise.all` make four queries run at the same time on our Worker?
