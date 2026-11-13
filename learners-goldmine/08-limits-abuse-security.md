# 08 · Limits, Abuse and Security at Scale

> **In one line:** at scale, some of your traffic isn't people. Rate limits, bot
> defence and good secret handling keep the people's share fast and safe.

---

## 1. Why rate limit at all?

1. **Fairness:** one heavy user can't slow everyone down.
2. **Cost:** AI calls cost money (chapter 07).
3. **Safety:** brute-force logins, scraping invite links, spam.
4. **Survival:** a buggy client stuck in a loop shouldn't take down the database.

---

## 2. The algorithms (classic interview topic)

### Fixed window
Count requests in each clock minute. Reset at :00.
- ✅ One counter, trivial.
- ❌ **Boundary burst:** 100 at 12:00:59 and 100 at 12:01:00 means 200 in 2 seconds.
- *Spenit's `strictLimit` (Postgres `RateCounter`) is a fixed window. Fine for AI quotas.*

### Sliding window (log or counter)
Look at the last 60 seconds from *now*. The "log" version stores timestamps (exact,
memory-heavy). The "counter" version blends this window with the previous one (approximate, cheap).

### Token bucket (the most common in practice)
```
  bucket holds up to B tokens; refills at R tokens/sec
  each request takes 1 token; empty bucket → 429
```
- ✅ Allows **short bursts** (up to B) while enforcing an **average rate** (R).
  That matches human behaviour: scanning 5 orders in a row, then nothing for an hour.
- Used by AWS, Stripe, nginx (as "leaky bucket", its close cousin).

### Leaky bucket
Requests queue up and leave at a fixed rate. Smooths output, which is good for protecting a
downstream service (like our Groq calls through a queue).

---

## 3. Where limits live (layers)

| Layer | Spenit today | Strength |
|---|---|---|
| Edge / WAF (Cloudflare) | Ratelimit bindings: global 600/min per IP, auth 60, AI 30, write 120, public 60 | Approximate, per location. Stops floods before our code runs. |
| Per Worker copy (memory) | In-memory limiter | Cheap, but each copy counts on its own |
| Exact, shared | `strictLimit` in Postgres for AI (20/min, 400/day per account) | Exact, but every check is a DB write (a hot row at scale) |

### At scale
- Move exact counters to a store built for them: **Durable Objects** (one per user or
  key, strongly consistent) or **Redis** (`INCR` + `EXPIRE`, atomic).
- Keep limits **per account** for signed-in actions (IP-based limits punish everyone
  behind one college Wi-Fi or mobile carrier NAT, which is very common in India).
- Return `429` with a **`Retry-After`** header, and show a calm message in the app.

---

## 4. Bots and abuse specific to Spenit

| Abuse | Why someone would | Defence |
|---|---|---|
| Fake accounts to farm free AI scans | Free OCR/LLM | Per-account quota + per-device signals + slow down new accounts (fewer free scans on day 1) |
| Scraping invite links `/g/:token` | Find groups, spam | Long random tokens (we use them), rate limit `RL_PUBLIC`, tokens can expire/rotate |
| Owe links `/owe/:token` guessing | See amounts and names | Same: unguessable tokens + rate limits + no sensitive data beyond what's needed |
| Spam groups (add random people) | Phishing | People can't be added without an invite they accept. Report-to-admin flow exists. |
| Huge uploads | Burn bandwidth/AI | Size limit on images, server-side check, compress on the phone |
| Login brute force | Account takeover | We use Google sign-in only (no passwords to guess) |

**Bot detection options:** Cloudflare Turnstile (an invisible, privacy-friendly
challenge) on signup and before AI calls for brand-new accounts. Device fingerprinting
only in privacy-respecting ways.

---

## 5. DDoS (distributed denial of service)

Floods from many machines. Defences, in order:
1. **Be behind a big network.** Cloudflare absorbs volumetric attacks at the edge. We're
   already there.
2. **Cache public pages** so floods are served by the CDN, not us.
3. **WAF rules and rate limits** for application-layer floods (e.g. hammering `/ai/*`).
4. **"Under attack" mode / challenges** temporarily.
5. **Keep the origin hidden:** only Hyperdrive and Cloudflare should reach the database
   (restrict Supabase network access where the plan allows).

---

## 6. Authentication at scale

- **JWTs** (our access tokens) are checked without a database call. Great for scale.
  The trade-off: **you can't revoke a JWT before it expires.** Our access tokens last 7
  days. At scale, shorten access tokens to **15–60 minutes**, and refresh with the
  refresh token (httpOnly cookie, which we already use). Then "log out everywhere" or a
  banned account takes effect within the hour.
- **Key rotation:** support two signing keys at once (`kid` in the JWT header), so the
  JWT secret can be rotated without logging everyone out.
- **Least privilege:** the Worker's database role shouldn't be able to `DROP TABLE`.
  Migrations can run with a separate, more powerful role.

---

## 7. Secrets

- Stored as Worker secrets and GitHub Actions secrets, never in the repo. ✅
- Users' own AI keys are encrypted (AES-GCM, versioned `enc:v1:`). ✅ Versioning means we
  can move to `enc:v2` with a new key and re-encrypt gradually.
- **Rotation plan:** list every secret, who can rotate it, and how. Practise it once
  before launch.
- **Scrub logs:** `safeLog` strips emails, keys and tokens from error reports. ✅

---

## 8. Privacy and Indian law (DPDP Act, 2023)

Things that matter more at scale:
- **Consent and purpose:** we record consent (migration 012) and say what AI processing does.
- **Data minimisation:** don't store bill photos (✅), mask names before AI (✅).
- **Right to erase:** account deletion (✅). At scale it must also reach **backups**
  (expire them on a schedule) and **logs**.
- **Breach readiness:** know what data we hold and where, and have a plan to notify.
- **Data residency:** know which regions our providers process data in (Supabase region,
  Groq, Cloudflare). Self-hosted AI (chapter 07) helps if this becomes a requirement.

---

### Self-check

1. Explain the boundary burst problem of fixed windows and how a token bucket avoids it.
2. Why are IP-based limits a problem for Indian mobile users?
3. What's the trade-off of long-lived JWTs, and how do short access tokens + refresh fix it?
4. List three defences against fake accounts farming free AI scans.
