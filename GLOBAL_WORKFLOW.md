# How We Build "Global" Without Touching the Live App

*Companion to [GLOBAL_PLAN.md](GLOBAL_PLAN.md). Written 13 Nov 2026.*

**Promise:** while we build, the live app (spenit.vercel.app + its API + its database) stays
exactly as it is for Indian users. The global work lives in its own branch, its own backend
and its own database. We can keep it or throw it away, and the live app never notices.

---

## 1. Two worlds, side by side

```
                 LIVE (today, unchanged)                    GLOBAL (new, throw-away-able)
 Git branch      main                                        global
 Frontend        spenit.vercel.app  (Vercel Production)      spenit-git-global-<you>.vercel.app  (Vercel Preview)
 Backend         spenit-api.…workers.dev                     spenit-api-staging.…workers.dev
 Database        Supabase project "spenit" (real data)       Supabase project "spenit-staging" (test data, London region)
 Who uses it     everyone                                    you, me, your sister's beta group
 Deployed by     you: git push origin main → Vercel          you: git push origin global → Vercel preview
                 me:  npx wrangler deploy                    me:  npx wrangler deploy --env staging
```

**Why a separate database (not just a separate branch)?** The Worker applies database
migrations by itself. If the staging backend pointed at the real database, the new
`currency`/`country` columns would land in production on the first request. A separate
Supabase project means nothing reaches real data until we decide.

---

## 2. One-time setup (≈ 30 minutes, mostly you)

Things only you can do are marked **YOU**: they involve passwords, secrets or your accounts.

### Step 1: Branch (me)
- Create `global` from `main`. All global work is committed there.
- Add a **staging environment** to `backend/wrangler.jsonc` (`env.staging`: Worker name
  `spenit-api-staging`, its own Hyperdrive, `FRONTEND_URL` = the Vercel preview address, and the
  same rate limits).
- Add npm scripts: `cf:deploy:staging`. Add a **guard**: plain `cf:deploy` (production) refuses to run
  unless the current branch is `main`. That stops me from ever shipping global code to the live API by
  mistake.

### Step 2: Staging database (YOU)
1. Supabase → **New project** → name `spenit-staging`, region **London (eu-west-2)**, which also
   tests UK speed. The free tier allows 2 projects.
2. Copy its **Session pooler** connection string (like the one used for backups).
3. Create the tables. In `backend/`:
   ```bash
   $env:DATABASE_URL="<staging connection string>"; npm run migrate
   ```
   (PowerShell. This runs migrations 001–017 on the **staging** database only.)

### Step 3: Staging Hyperdrive (YOU)
```bash
npx wrangler hyperdrive create spenit-staging --connection-string="<staging connection string>"
```
Send me the **id** it prints (an id isn't a secret). I put it in `env.staging`.

### Step 4: Staging secrets (YOU)
Same names as live. Use **new** values for the JWT secrets (so logins can't cross between worlds);
the others can be copied:
```bash
npx wrangler secret put JWT_ACCESS_SECRET --env staging
npx wrangler secret put JWT_REFRESH_SECRET --env staging
npx wrangler secret put AI_KEY_SECRET --env staging
npx wrangler secret put GROQ_API_KEY --env staging
npx wrangler secret put VAPID_PUBLIC_KEY --env staging
npx wrangler secret put VAPID_PRIVATE_KEY --env staging
npx wrangler secret put VAPID_MAILTO --env staging
npx wrangler secret put ADMIN_EMAILS --env staging
```
(VAPID and Groq can reuse the live values. Push works per site, so there's no clash.)

### Step 5: Vercel preview points at the staging API (YOU)
Vercel → Project → Settings → Environment Variables → add
`NEXT_PUBLIC_API_URL` = `https://spenit-api-staging.<account>.workers.dev`,
environment **Preview**, branch **global** only. Production keeps its value.

### Step 6: Google sign-in on the preview address (YOU)
Google Cloud Console → Credentials → the OAuth client → **Authorized JavaScript origins** → add
`https://spenit-git-global-<your-vercel-scope>.vercel.app` (Vercel shows the exact branch address after
the first push). Same client, one extra line. The live app is unaffected.

### Step 7: First deploy and a smoke test (me + you)
- Me: `npx wrangler deploy --env staging` → check `/health` shows the staging database.
- You: `git push origin global` → open the preview → sign in → create a group → add a bill.

---

## 3. Day-to-day while building

| Situation | What happens |
|---|---|
| I build a global feature | Commit on `global` → I deploy the staging Worker → you push `global` → Vercel preview updates |
| A bug is found in the **live** app | Fixed on `main` (as today), deployed live, then **merged into `global`** so the branches don't drift apart |
| You want to try it | Open the preview address. Install it as a second app if you like (it's a different site, with separate data and login). |
| Your sister's group | Uses the **preview** address as a beta. Tell them up front: *"test version, your data may be reset."* |

**The rules I follow:**
1. On `global`, backend deploys are **always** `--env staging` (the guard enforces it).
2. Live fixes go to `main` first, then flow into `global`, never the other way until we decide.
3. Every new migration is **additive only** (new columns with India defaults). That keeps merging
   later safe.

---

## 4. Decision day: keep or drop

### If we **drop** it
- Delete the `global` branch, the staging Worker (`npx wrangler delete --env staging`), the staging
  Supabase project, the Vercel env var and the extra Google origin.
- The live app never changed. **Nothing to roll back.**

### If we **keep** it: merge, but stay invisible to India
This is where "my Indian users shouldn't see it" is guaranteed by design, not by luck:

- **Existing users** are backfilled to `India · ₹ · Asia/Kolkata`, so their app looks and works the same.
- **New users** whose phone says India get India automatically. Nobody in India is asked to pick a country.
- All global behaviour sits behind a server setting `GLOBAL_REGIONS` (e.g. `GB`). Only users whose
  region is in that list see region features. Set it to empty and everyone is back to today's
  experience, **without a deploy**.
- Merge `global` → `main`, deploy the live Worker (it adds the new columns, which is harmless for old
  code), and you push `main`.
- **Rollback options after merge:** (1) empty `GLOBAL_REGIONS`, which takes seconds; (2) revert the
  merge commit (the new columns can stay; old code ignores them).

### Your sister's beta data
Her test groups live in the staging database. When we keep the feature, either she starts fresh on
the live app, or I write a one-time "move these groups from staging to live" script. Her group is
small, so starting fresh is usually simpler.

---

## 5. Who does what (summary)

| Task | Who |
|---|---|
| Branch, staging config, deploy guard, all code | Me |
| Deploy staging backend (`--env staging`) | Me |
| Deploy live backend (only from `main`) | Me |
| Supabase staging project + migrate | **You** (passwords) |
| Hyperdrive create, then send me the id | **You** |
| `wrangler secret put … --env staging` | **You** (secrets) |
| Vercel Preview env var for `global` | **You** |
| Google OAuth extra origin | **You** |
| `git push origin global` (preview) / `git push origin main` (live) | **You** |
| Merge decision | **You** |
