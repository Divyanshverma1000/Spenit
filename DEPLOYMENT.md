# Deploying Spenit (free, always on)

Target: **20–100 testing users, ₹0/month, no sleeping API.**

```
 Phone / PWA
     │  https://spenit.vercel.app                       (Vercel: frontend + /api proxy)
     ▼
 Next.js ──/api/*──►  https://spenit-api.divyanshverma0428.workers.dev   (Cloudflare Worker, free plan)
                              │  Hyperdrive (connection pooling)
                              ▼
                        Postgres (Supabase free)
```

## Where things stand

| Piece | State |
|---|---|
| API on Cloudflare Workers | **Live**: `https://spenit-api.divyanshverma0428.workers.dev` |
| Secrets (JWT, push keys) | **Set** on the Worker |
| Database | **Connected** (Supabase via Hyperdrive, all 9 migrations applied, `/health` reports `postgres: ok`) |
| Frontend (Vercel) | **Your next step:** point `BACKEND_URL` at the Worker (section 3, step C), then redeploy |

If the database is ever unreachable the API answers `503 DB_UNAVAILABLE` (see section 5); `/ping` always answers.

---

## How the pieces connect (and why IPv6 doesn't matter)

Only **three things ever talk to Postgres**, and none of them is a user's phone:

```
 Phone / PWA ──https──► Vercel ──/api/* proxied over https──► Cloudflare Worker ──Hyperdrive──► Supabase
 (IPv4 or IPv6,         (static app +                          (spenit-api)        (Cloudflare's     (Postgres)
  irrelevant)            /api proxy)                                                 network)

 1. The Worker, at runtime, through Hyperdrive    <- all real traffic. Cloudflare's network speaks IPv6,
                                                     so it reaches Supabase's IPv6-only "direct" host.
 2. The Worker's 4-hourly heartbeat               <- same path as 1.
 3. Your PC, only when you run `npm run cf:connect-db` (schema changes)
                                                  <- your home network has no IPv6, so the script uses
                                                     Supabase's free IPv4 "Session pooler" for this step.
```

- A user's phone talks only to Vercel (`https://spenit.vercel.app/api/...`). Vercel forwards that to the Worker. The phone never opens a database connection, so its network type is irrelevant.
- Supabase charges for an **IPv4 add-on** only for clients that must reach the *direct* host over IPv4. We don't: Cloudflare uses IPv6, and the one-off migration from your PC uses the free pooler. **You do not need to pay for anything.**
- Verified live: Hyperdrive config `spenit-db` points at the direct host `db.<ref>.supabase.co:5432`, and `/health` reports `postgres: ok`.
- If Supabase ever stops serving the direct host to Cloudflare, point Hyperdrive at the pooler instead: `npx wrangler hyperdrive update <id> --connection-string="<Session pooler string>" --caching-disabled`.

**Hyperdrive query caching is OFF** (the script sets `--caching-disabled`). Cloudflare turns it on by default for 60 seconds and does not clear it when you write, so right after adding an expense a refresh could show the old list. Don't re-enable it.

---

## 1. Why a Worker, and what it needs

Cloudflare's free plan runs **Workers**, not servers. There is no Postgres on Cloudflare (D1 is SQLite, which would mean rewriting every query), and Cloudflare Containers need the paid plan. So the API runs as a Worker (`backend/src/worker.ts`, the same Express code as the Node build) and Postgres lives at a provider next to it, reached through **Hyperdrive**.

| Limit (Workers **Free**) | Value | Why it's fine here |
|---|---|---|
| Requests/day | 100,000 (resets 00:00 UTC) | 100 users × ~60 requests ≈ 6,000/day |
| Start-up time | 1 s | Measured: 60 ms |
| CPU per request | 10 ms | See "Watching CPU" below: cold starts measured 30–48 ms and were accepted; a warm request cost 1 ms |
| Memory | 128 MB | Bundle is 1.5 MB |
| Hyperdrive | 10 configs, ~20 origin connections | We use 1 config |

| Database (free) | Limits | Notes |
|---|---|---|
| **Supabase** (recommended) | 500 MB, pauses after 7 days of **no** activity | No compute-hour cap. Use the **Direct connection** string with Hyperdrive. |
| Neon | 1 GB, 100 compute-hours/month | Works too; watch the compute hours. |

**R2 is not used.** Spenit stores no files (receipt photos are read and discarded), so there is nothing to put in R2. Don't create buckets for it.

> Your account already has other projects' resources (D1 `rouse` and `nudge`, R2 `rouse-sounds`). Spenit never touches them.

---

## 2. What's already done

- Worker `spenit-api` deployed, with a cron trigger every 4 hours: a real database query (the keep-alive heartbeat, see section 5) plus tidying old idempotency keys.
- Secrets set via Cloudflare: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (freshly generated), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_MAILTO` (your existing push keys, so the frontend's key still matches).
- Settings in [`backend/wrangler.jsonc`](backend/wrangler.jsonc): `FRONTEND_URL=https://spenit.vercel.app`, `GOOGLE_CLIENT_ID`, `NODE_ENV=production`.
- Not set on purpose: `GROQ_API_KEY`. Users can add their own Groq key in Profile. To add a server-wide one later: `cd backend && npx wrangler secret put GROQ_API_KEY`.

---

## 3. What you need to do (about 15 minutes)

### A. Create the database (Supabase)
1. supabase.com → **New project**, region **Southeast Asia (Singapore)**. Save the database password.
2. Project → **Connect** → copy the **Direct connection** string:
   `postgresql://postgres:<PASSWORD>@db.<ref>.supabase.co:5432/postgres`

### B. Connect it to the Worker (one command)
In PowerShell:
```powershell
cd "C:\Desktop Data\Amaze\_SPENIT\backend"
npm run cf:connect-db -- 'postgresql://postgres:<PASSWORD>@db.<ref>.supabase.co:5432/postgres'
```
It will: create all tables, create a Hyperdrive config on your Cloudflare account, wire it into the Worker, deploy, and check `/health`. It never prints your password. At the end it should say `postgres: "ok"`.

**Good to know**
- Supabase's *Direct connection* host has only an IPv6 address, which many home networks (including most in India) can't reach, so you may see `ENOTFOUND` or `ENETUNREACH` at step 1. You don't need to do anything: the script notices, finds your project's IPv4 **Session pooler** by itself, and finishes the migration through it. Cloudflare reaches the direct host fine, so the live API still uses that.
- If your password contains special characters (`@ # / ? $ %` ...) either reset it to letters and digits (Supabase > Project Settings > Database > Reset database password) or URL-encode it. In PowerShell wrap the whole connection string in **single** quotes `'...'` so `$` isn't expanded.
- "The database rejected the password" means just that: check the password you used when creating the project.

### C. Point the frontend at the Worker (Vercel)
Vercel → your project → Settings → Environment Variables → set

| Variable | Value |
|---|---|
| `BACKEND_URL` | `https://spenit-api.divyanshverma0428.workers.dev` (no trailing slash) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | your Google client id (already set) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | your existing public push key (already set) |

Do **not** set `NEXT_PUBLIC_API_URL`. Then **Redeploy** (Deployments → ⋯ → Redeploy).

### D. Google sign-in
Google Cloud Console → Credentials → your OAuth Web client → *Authorized JavaScript origins* must include `https://spenit.vercel.app` (and any custom domain you add).

### E. Smoke test
- [ ] Open https://spenit.vercel.app and sign in with Google.
- [ ] Create a group, add a person who hasn't joined, add an expense.
- [ ] Open the invite link in a private window, join, claim a name.
- [ ] Settle Up shows the diagram. Install the PWA, go offline, add an expense, go online: it syncs once.

---

## 4. Watching CPU (free plan)

The free plan advertises 10 ms of CPU per request. Measured on the live Worker: the **first request after a cold start** used ~30–48 ms and Cloudflare still reported `outcome: ok`; a warm request used **1 ms**. Database-heavy endpoints (group overview) are the ones to watch once real data exists:

```powershell
cd backend
npm run cf:tail          # live logs; leave it open while you click around the app
```
Look for `"outcome": "exceededCpu"`. If it appears regularly, the fix is Cloudflare's **Workers Paid plan ($5/month flat)**, which raises the limit to 30 s of CPU. No code changes needed. The dashboard also shows CPU time under Workers & Pages → spenit-api → Metrics.

---

## 5. If the free database goes quiet (Supabase pausing)

**The rule (from Supabase's docs):** a free project is paused when it gets too little database activity over **7 days**. You get an email about a week before and another when it pauses. Its data is kept (you have about a year to resume it), but **nothing resumes it automatically**: someone must click **Resume project** in the Supabase dashboard. Paid projects are never paused.

With 20–100 people using Spenit this won't happen, because normal use is far above "a few requests a day". The risk is a **quiet stretch** (exams, holidays, a launch that stalls). Three layers cover it:

1. **Built-in heartbeat (already deployed).** Every 4 hours the Worker runs a real query against the database (`[heartbeat] database ok (N users)` in the logs) so the database always has activity, even if no human opens the app. Supabase says this kind of regular real traffic is what keeps a project running, though it is not a formal guarantee.
2. **Friendly failure, no data loss.** If the database is ever unavailable (paused, waking, network), the API answers **503 `DB_UNAVAILABLE`** with `Retry-After`, not a crash. Screens keep showing cached data, and expenses people add are kept on their phone and retried automatically (the offline queue treats 5xx as "try again later").
3. **An email the moment it breaks (recommended, 3 minutes).** Add a free monitor at uptimerobot.com: *HTTP(s)* monitor, URL `https://spenit-api.divyanshverma0428.workers.dev/health`, every 5 minutes, alert to your email. `/health` returns 503 when Postgres is unreachable, so you get an email within minutes instead of hearing it from users. (`/ping` would stay green; use `/health`.) It also adds a little more database activity.

**If it does pause:** supabase.com → your organization → the project → **Resume project** → confirm. It comes back with all data in a few minutes and the app recovers on its own (no redeploy needed). Check with `npm run cf:tail`: the next heartbeat logs `database ok`.

**Want zero babysitting?** Your options, cheapest first:
- **Supabase Pro** (paid): projects are never paused.
- **Neon free**: it never "pauses until you click"; the compute sleeps after 5 minutes and wakes by itself on the next query. The trade-off is a 100 compute-hour monthly budget, and I haven't verified how Hyperdrive's pooled connections interact with Neon's auto-suspend, so test it before relying on it. Switching is just a new connection string: `npm run cf:connect-db -- "<neon string>"`.

## 6. Day-to-day

| Task | Command (in `backend/`) |
|---|---|
| Deploy a code change | `npm run cf:deploy` |
| Live logs | `npm run cf:tail` |
| Run it locally in Cloudflare's runtime | copy `.dev.vars.example` to `.dev.vars`, start Docker, `npm run cf:dev` |
| Roll back | `npx wrangler rollback` |
| Change a secret | `npx wrangler secret put NAME` |
| New database migration | add `backend/migrations/0NN_name.sql`, then re-run step B (it is idempotent) |

Backups: Supabase free has none. Occasionally: `pg_dump "<connection string>" > spenit-backup-<date>.sql`.

## 7. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Everything returns *"not configured correctly"* | Database not connected yet (section 3B), or a secret is missing: `npm run cf:tail` shows the exact `[config] ERROR`. |
| `/health` says postgres unreachable, API answers 503 `DB_UNAVAILABLE` | The database is down: most likely a **paused Supabase project** (section 5). Resume it in the Supabase dashboard. If it was never connected or the password changed, re-run step B. |
| 502 / "Failed to fetch" in the app | `BACKEND_URL` wrong on Vercel, or not redeployed after changing it. |
| Google sign-in "origin not allowed" | Add the exact Vercel URL to *Authorized JavaScript origins*. |
| Requests fail late in the day with Cloudflare error 1015/1027 | Hit the free 100,000 requests/day limit (resets 00:00 UTC). Upgrade to Paid or reduce traffic. |
| `exceededCpu` in the logs | See section 4. |

## 8. Alternative: Render + Docker

The same backend also runs as a normal Node server (`backend/Dockerfile`, `render.yaml`), for example on Render's free web service with a keep-alive ping. The code is identical; only the entry point differs (`src/index.ts` instead of `src/worker.ts`). Use it if Workers' CPU limit ever becomes a problem and you'd rather not pay.

## 9. Security checklist

- [ ] `.env`, `.dev.vars` and `wrangler.local.jsonc` are git-ignored. Never commit them.
- [ ] Secrets live only in Cloudflare (`wrangler secret list` shows names, never values).
- [ ] `FRONTEND_URL` lists only your real frontend origins.
- [ ] Rotate `GROQ_API_KEY` in your local `.env` (it was displayed once during development), then set the new one with `wrangler secret put GROQ_API_KEY` if you want a server-wide key.
