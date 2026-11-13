# 10 · Frontend, Edge and Offline

> **In one line:** the cheapest server request is one the phone never makes. A good
> PWA is itself a scaling tool.

---

## 1. CDN and the edge

A **CDN** (content delivery network) keeps copies of files in data centres near
users. A user in Patna gets the app's JavaScript from a nearby city, not from the US.

| What | Where it's served | Scales by |
|---|---|---|
| App JS/CSS/fonts (`/_next/static/*`) | Vercel CDN, **immutable**, cached forever (file names contain a content hash) | The CDN, essentially free |
| Static pages (privacy, terms, testing) | Pre-rendered at build ("○ Static" in the build output) | The CDN |
| Dynamic pages (`/groups/[id]` etc.) | Rendered per request, but the data loads client-side from our API | Vercel functions (light) |
| API | Cloudflare Workers, nearest city | Cloudflare |

**Lesson: content hashing.** A file named `main.a8f3c1.js` never changes. If it changes, it gets
a new name. That's why it can be cached "forever" safely, and why a deploy never serves a
half-old, half-new app.

---

## 2. The PWA as a load shield

### The service worker (`public/sw.js`)
A script the browser runs in the background, between our app and the network:

| Request | Strategy | Effect |
|---|---|---|
| Static assets, icons, illustrations | **Cache-first** | Never hits the network after the first load |
| Page navigations | **Stale-while-revalidate** | Opens instantly from cache, refreshes in the background |
| API calls | Not touched | Data caching lives in React Query |
| Push messages | Shows the notification, opens the right screen | |

### React Query + IndexedDB (data on the phone)
- Every API answer is kept in memory **and saved to IndexedDB** for a week.
- Opening the app shows the saved data **immediately** and refreshes in the background.
- `staleTime: 30 s`: a screen opened twice within 30 s doesn't refetch.
- `refetchOnWindowFocus` replaced the old 30-second polling. **Polling is a scaling
  smell.** 1M phones polling every 30 s would be 33k req/s of pure waste.

### The outbox (offline writes)
Expenses created offline are stored on the phone with an **idempotency key** and sent
when the network returns. At scale, this also turns a server hiccup into a **delay**
instead of **data loss**.

> **Scaling insight:** with good client caching, maybe half of "opens" need no server
> data at all, or only a cheap "anything changed since version N?" check. That directly
> halves the read numbers in chapter 02.

---

## 3. Making each request cheaper

| Technique | What | Spenit status |
|---|---|---|
| **One call per screen** | `GET /groups/:id/overview` instead of 4 calls | ✅ |
| **Pagination** | Only the latest 50 expenses | ⏳ needed (chapter 04) |
| **Conditional requests (ETag / 304)** | Server sends a fingerprint of the data; the phone asks "changed since ETag X?" and gets an empty `304 Not Modified` if not | ⏳ easy win: pair it with a group `version` |
| **Compression** | gzip/brotli on JSON | ✅ Cloudflare does it |
| **Image compression on device** | 2000 px, JPEG 85% before upload | ✅ |
| **Prefetch** | Load the next likely screen in idle time | ✅ Next.js `<Link>` prefetch |

---

## 4. Real-time updates without melting the servers

Today friends see new expenses when they reopen the app (or via push). Real-time
("Suryansh is adding Dinner…") options:

| Option | How | Scale cost |
|---|---|---|
| Polling | Ask every N seconds | Wasteful (see above) |
| Long polling | Request stays open until there's news | Better, still heavy |
| **Server-Sent Events** | One-way stream from server to phone | Good for feeds |
| **WebSockets** | Two-way live connection | Best UX. Needs a place to hold connections. |

On Cloudflare, **Durable Objects** can hold WebSockets for a group (one object per
group, with "hibernation" so idle connections cost almost nothing). That pairs with the
per-group cache idea from chapter 05.

> **Choice:** push + refetch-on-focus is enough until users ask for live collaboration.

---

## 5. App updates at scale

With a service worker, users keep running the **old** app until it updates. So:
- **The API must stay backward compatible** for at least a few versions. Old phones will
  call old endpoints with old payloads. Add fields, don't rename or remove them
  (the "expand and contract" idea from chapter 11).
- Bump the SW `VERSION` to drop old caches when needed.
- Add an `appVersion` header on requests (we already send it with feedback), so we can see
  how many users are on old versions before removing anything.

---

### Self-check

1. Why can files with a content hash in their name be cached forever?
2. What does stale-while-revalidate give the user, and what does it give the server?
3. Why is polling a scaling smell? Do the maths for 1M phones every 30 s.
4. Why must the API stay backward compatible when the app is a PWA?
