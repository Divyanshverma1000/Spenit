# 05 · Caching: Remembering Answers

> **In one line:** the fastest query is the one you don't run. A cache stores an
> answer close to where it's needed, and the hard part is knowing when that answer is
> no longer true.

> *"There are only two hard things in computer science: cache invalidation and naming
> things."* (Phil Karlton)

---

## 1. The layers (closest to the user first)

```
  ┌─ 1. Phone memory        React Query in-memory cache            0 ms
  ├─ 2. Phone storage       React Query persisted to IndexedDB     ~5 ms, works offline
  ├─ 3. Service worker      cached app shell, icons, illustrations ~5 ms
  ├─ 4. CDN / edge          Vercel CDN for pages and assets         ~10–30 ms
  ├─ 5. Shared app cache    Redis / Cloudflare KV / Durable Object  ~1–20 ms
  ├─ 6. Worker memory       a Map inside one Worker copy            0 ms, but per copy
  └─ 7. Database            Postgres buffer cache (RAM)             ~1 ms if in RAM
                            then disk                               ~5–10 ms
```

Every layer you serve from is a request the layers below never see. **Spenit already
uses layers 1–4 well.** Layer 5 is the missing one.

---

## 2. The Worker-memory trap (a lesson from our own code)

`src/lib/cache.ts` keeps balances in a `Map` in memory, with an optional Redis.
That's perfect on **one long-running server**: every request hits the same memory.

On **Cloudflare Workers**, though:

```
  Request 1 ─► Worker copy A  (caches balance for group G in A's memory)
  Request 2 ─► Worker copy B  (empty memory → miss → database)
  Request 3 ─► Worker copy C  (miss → database)
  Expense added via copy A ─► A deletes its entry, but B and C may still hold old values!
```

Two problems:
1. **Low hit rate:** there are many copies, each with its own small memory.
2. **Stale data across copies:** invalidating in one copy doesn't clear the others.
   Today that's covered by short TTLs and the fact that copies come and go quickly, but
   it's a correctness risk for money.

> **Lesson:** a cache must be **shared** by every server that can change the data, or it
> must hold only data that's fine to be stale. This is why "it worked on my laptop"
> caching breaks in a distributed system.

---

## 3. Caching patterns

### Cache-aside (lazy loading): the one we use
```
 read:  value = cache.get(k)
        if miss: value = db.query(); cache.set(k, value, ttl)
 write: db.write(); cache.delete(k)          ← invalidate, don't update
```
- ✅ Simple. The cache only holds what's actually read.
- ⚠️ The first read after a change is a miss (slower).
- **Why delete instead of update?** If two writes race, "update cache" can leave the
  *older* value in the cache. Deleting is always safe: the next read refills it.

### Write-through
Write to the cache **and** the database together. Reads always hit. Every write pays
the extra cost, and you cache things nobody reads.

### Write-behind (write-back)
Write to the cache, flush to the database later. Very fast, but you **can lose data**.
Never for money. Fine for counters (that's our batching plan for `UsageDaily`).

### Read-through / refresh-ahead
The cache refreshes popular keys *before* they expire, so users never see a miss.
Useful for "trending" style data, not for us yet.

---

## 4. Invalidation: the hard part

| Strategy | How | Good for |
|---|---|---|
| **TTL** (time to live) | Entry expires after N seconds | Data that can be a bit stale (insights, avatars) |
| **Explicit delete on write** | The write path deletes affected keys | Balances: we know exactly which keys change |
| **Versioned keys** | Key includes a version: `bal:G:v42`. Writes bump the version | Avoids races, old versions just expire |
| **Event-driven** | Writes publish "group G changed", subscribers clear their caches | Many caches (e.g. per-region) |

**Spenit's balance keys** (from `routes/balance.ts`): adding an expense or settlement
invalidates the group's key **and** every member's cross-group key. Good. Just make
sure it happens on the **shared** cache.

> **Versioned keys trick for Spenit:** keep `Group.version`, a counter bumped on every
> write in the same transaction. Cache key = `overview:{groupId}:{version}`. Reading the
> version is one tiny indexed query, and stale data becomes impossible: a new version
> means a new key.

---

## 5. Cache stampede (thundering herd)

A popular key expires. 500 requests miss at the same moment, and all 500 run the same
expensive query. The database falls over.

**Fixes:**
- **Request coalescing / single-flight:** the first miss computes, the rest wait for
  its result. (Cloudflare **Durable Objects** are a natural fit: one object per group
  means one place computes.)
- **Jittered TTLs:** `ttl = 60 + random(0..15)` so keys don't all expire together.
- **Stale-while-revalidate:** serve the old value while *one* request refreshes it in
  the background. (React Query does exactly this on the phone.)

---

## 6. What to cache in Spenit (and what never)

| Data | Cache? | Where | Invalidation | Why |
|---|---|---|---|---|
| Group balances | ✅ | Shared cache (KV/Redis/DO) | Delete on expense or settlement write | Read on every open, expensive to compute |
| Group overview (latest 50) | ✅ | Shared, versioned key | Version bump | Hottest read |
| "My groups" list | ✅ | Shared, short TTL (30 s) + delete on join/leave | | Opened on every app start |
| User profile / avatar | ✅ | Edge + phone, TTL 1 h | Delete on edit | Rarely changes |
| Static pages, images, icons | ✅ | CDN + service worker, immutable hashed names | New file name on change | Never changes |
| Invite preview (`/g/token`) | ✅ | Edge, 60 s | | Public, gets shared widely, can go viral |
| AI result for the *same image* | ✅ | Hash of image → result, 24 h | | Users retry the same photo (chapter 07) |
| Admin dashboard numbers | ✅ | 60 s TTL | | Fine to be a minute old |
| **Settle-up "confirm" step** | ❌ | — | — | Must read the primary: money |
| **Auth / permissions after leaving a group** | ❌ (or very short) | — | — | Security beats speed |
| **Idempotency checks** | ❌ | — | — | Must be exact |

---

## 7. Choosing the shared cache on our platform

| Option | What it is | Fit for Spenit |
|---|---|---|
| **Cloudflare KV** | Global key-value store, very fast reads, **eventually consistent** (writes take up to ~60 s to reach every location) | Profiles, invite previews, config. **Not** balances (stale too long). |
| **Durable Objects** | One single-threaded object per key, strongly consistent, with built-in storage | **Per-group balance and overview cache**: one object per group, natural single-flight, can even push live updates over WebSockets |
| **Upstash Redis** (HTTP) | Redis that Workers can reach over HTTP | Familiar, works with our existing `cache.ts` Redis path |
| **Self-hosted Redis** | | Not worth running it ourselves at our stage |

> **Choice:** start with **Upstash Redis**, because `cache.ts` already supports `REDIS_URL`, so
> it's a config change plus an HTTP client swap. Move hot per-group state to **Durable
> Objects** when we want live updates ("Suryansh just added Dinner"), since it gives us
> caching, coordination and real-time in one tool.

---

## 8. Measuring a cache

- **Hit rate** = hits ÷ (hits + misses). Aim for 80–95% on hot keys. Under 50% means
  wrong keys, TTL too short, or the per-copy memory problem.
- **Effect on DB:** queries/sec should drop by roughly the hit rate.
- **Staleness incidents:** count "user saw wrong balance" reports. That should be zero.

---

### Self-check

1. Why does an in-memory cache give a low hit rate on Workers?
2. Why do we *delete* the cache key on write instead of updating it?
3. A popular group's cache expires and 300 requests miss at once. Name the problem and two fixes.
4. Why is Cloudflare KV a poor choice for balances, but fine for invite previews?
5. Which Spenit data must **never** come from a cache, and why?
