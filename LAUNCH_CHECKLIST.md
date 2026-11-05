# Spenit — Launch Checklist

Written 5 Nov 2026 from an audit of the code. Tick items as they land. Order = suggested order of work.
**P0** = must be done before real users · **P1** = before public launch · **P2** = soon after.

---

## 1. Trust & group safety (P0)

What happens today, from the code:

- **A wrong claim can't be undone.**
  - Joining with the invite link and picking a placeholder name ("I'm Pratik") moves all of that placeholder's history onto the joiner, then deletes the placeholder (`transferUserReferences` in `routes/groups.ts`).
  - If Pratik taps "Sourabh" by mistake, he becomes Sourabh: Sourabh's debts, expenses and avatar.
  - Nobody can fix it. There's no undo, no leave, and the admin can't remove a real member.
- **Admin can remove placeholders only**, and only when they have no history.
- **Edits and deletes leave no trace.** An expense can be changed or soft-deleted by its creator or the admin. Other members only see the new numbers (plus an "edited" date), not what changed or who did it.

### 1a. Wrong-claim fix (the Pratik / Sourabh case)

- [x] **Confirm before claiming.** The join screen asks "You'll take over Sourabh's ₹1,240 balance and 6 expenses. Is this you?", with the amount and history shown.
  - If the admin set a phone or email hint on the placeholder, show it. Warn if the joiner's account name doesn't match ("Your account is *Pratik Shah*").
- [x] **Record every claim.** New `MemberClaim` table:
  - who claimed which placeholder, and when
  - the placeholder's name and avatar
  - the exact rows moved (payer / split / settlement / item ids)
- [x] **"Not me — undo".**
  - The person who claimed can undo for 7 days.
  - The admin can undo any time.
  - Undo puts the placeholder back exactly as it was, moves the rows back, and leaves the person in the group as a fresh member with no history.
  - They can then claim the right name (Pratik).
- [x] **Admin "Reassign"** does undo plus the correct claim in one step, from the member's menu.
- [x] **Notify everyone affected:** the admin, plus whoever the claimed placeholder owed or was owed by. Example: "Pratik joined as Sourabh — wrong? Tap to fix".
- [x] **Leave group.** Allowed when your balance is settled. If not settled, offer "Settle up first". The admin can remove a real member once they're settled. Their past expenses stay, shown as "Left the group".

### 1b. Mischief and mistakes

- [x] **Activity log per group**, visible to all members: added / edited / deleted expense, payments, joins, claims, undos, role changes. Each edit stores a before/after snapshot, so "₹500 → ₹5,000 by Rahul" is visible.
- [ ] **Notify people whose share changes** when an expense is edited or deleted. Example: "Rahul changed 'Dinner': your share ₹300 → ₹900".
- [x] **Restore deleted expenses** from the activity log (admin or creator). Already soft-deleted in the DB, so this is mostly UI.
- [ ] **"Flag this expense"** (dispute): marks it for the group with a reason, notifies the creator and admin, and shows a badge until resolved. It doesn't block balances.
- [ ] **Payments need the receiver's confirmation.** Already true for settlements; keep it. Nobody can mark themselves as "paid" alone.
- [ ] **Admin tools:** transfer the admin role, make a co-admin, remove a settled member, lock the group (read-only).
- [ ] **Limits:** cap the amount per expense (e.g. 10× the group's biggest so far, with a warning), invite-link expiry and regeneration, rate-limit expense creation per user.

## 2. Legal & policies (P0)

Today `privacy/page.tsx` and `terms/page.tsx` are ~4 short paragraphs, and **"Last updated" shows today's date on every visit**. That isn't a real date and could be called misleading.

- [x] **Privacy policy rewrite** with a fixed effective date and a version. It must cover:
  - **What we collect:** Google account name, email and photo; profile photo uploads; group, expense and item data; receipt and order screenshots; push tokens; IP and device logs.
  - **Who processes it:**
    - Google (sign-in)
    - Supabase (database)
    - Cloudflare (API)
    - Vercel (app hosting)
    - Groq (AI). Screenshots and questions go **through our server** to Groq, often with *our* key, so the current text ("sent directly… your own key") is no longer accurate.
    - Web Push providers
  - Where data is stored (region), how long it's kept, and how to delete it.
  - **Group data is shared with the group.** Your expenses are visible to the other members; private items are masked.
  - Children: not for under-13s (16 in the EU).
  - Contact / grievance officer email.
- [x] **Terms of service:**
  - Spenit records who owes whom. It is **not** a payment service and doesn't hold money.
  - AI may be wrong; check amounts.
  - Acceptable use; account termination; liability cap; governing law.
  - Pricing and refunds, needed once paid plans exist.
- [ ] **India — DPDP Act 2023:** notice and consent at sign-up, a grievance officer, a way to access, correct and erase data, breach notification.
- [ ] **EU/UK — GDPR, if global:** lawful basis, data export, erasure, processor list, cookie notice. We only use essential storage, so no tracking-consent banner is needed unless analytics is added.
- [x] **Delete my account** (P0, also required by app stores):
  - Profile → Delete account, with a confirmation.
  - Personal data is erased and photos removed.
  - In groups, the person becomes "Deleted user" so balances stay correct for everyone else.
- [x] **Export my data** (JSON/CSV) from Profile.
- [x] Consent checkbox and policy links on the sign-in page; a "policy updated" notice when the version changes.
- [ ] **Placeholders contain other people's names** (and maybe phone numbers). Mention this in the policy, and erase them when the group is deleted.

> Note: these pages need a short review by a lawyer before a paid launch. I can draft them, but a draft isn't legal advice.

## 3. Global-ready (P1)

Today the app is India-only in places:
- `₹` / INR / `en-IN` formatting is hardcoded in ~21 frontend files.
- "Blinkit, Zepto, Instamart" appear in the UI, and the AI prompt is tuned to Indian apps.

- [ ] **Currency per group**, chosen at creation and defaulting from the device locale. Use `Intl.NumberFormat` everywhere through one `formatMoney(amount, currency)` helper, so no `₹` is left in components. The DB already has `Expense.currency`.
- [ ] **Number and date formats from the device locale**, not `en-IN`.
- [ ] **Neutral wording:** "Split an order: drop screenshots from any delivery or shopping app". Show local examples only by country (Blinkit/Zepto for IN, Instacart/DoorDash for US, Deliveroo for UK…).
- [ ] **Extraction prompt made app-agnostic**, keeping Indian hints as examples. Test on non-Indian receipts (USD, EUR, GBP; different tax/tip lines).
- [ ] **Payment methods:** UPI only for India; elsewhere "bank transfer / cash / other".
- [ ] Language: English first; keep strings in one place to translate later (Hindi first?).

## 4. PWA and real-device testing (P0)

Test on a low-end Android (Chrome), an iPhone (Safari + home-screen install), and desktop Chrome.

- [ ] Install → icon, splash and name are correct; opening from the home screen lands on Home when signed in.
- [ ] Sign in with Google in the installed app, including on iOS. Sign-out clears cached data.
- [ ] **Offline:** add an expense offline, it queues and syncs when back online, with no duplicates (idempotency keys). Edit is blocked offline with a clear message.
- [ ] **Update flow:** after a deploy, the app picks up the new version without a manual clear (service worker version bump plus a "New version — tap to refresh" prompt).
- [ ] Push notifications: permission prompt, delivery, tap opens the right group (Android; iOS 16.4+ installed only).
- [ ] Invite link: opens in the browser and in the installed app; works when signed out (sign in, then back to the join screen); expired or invalid link.
- [ ] Import orders: 1, 5 and 15 screenshots; rate limit and retry; huge images; HEIC from iPhone; a non-order image.
- [ ] Camera / scan receipt on Android and iOS.
- [ ] Every screen at 320px width, in dark and light mode, with large system font; no text cut off or hidden behind the bottom nav.
- [ ] Slow 3G: every screen shows a loader or the cached data, never a blank page.
- [ ] Two people editing the same group at once; deleting while someone else has it open.
- [ ] Back button (Android) closes sheets before leaving the page.

## 5. Production clean-up (P0)

- [ ] **Import screen debug panel** (tokens, model, raw failure) → admins only or removed.
- [ ] **19 `console.log` lines in the backend** → a structured logger (`info`/`warn`/`error`) with no personal data, item names or keys in logs.
- [ ] `/ai/test-key` and `/ping`: keep, but rate-limit them.
- [ ] **Groq API keys are stored in plain text** (`User.groq_api_key`). Encrypt them at rest (AES-GCM with a Worker secret), and never send them back to the client.
- [ ] **Leaked Groq key:** revoke the one pasted into ChatGPT earlier, and rotate `GROQ_API_KEY` on the Worker.
- [ ] Remove the unused files: `images/shiba.*`, `Travel_Buddies.png`, `sharing_expense_at_cafe.png` and the large PNGs in `public/` if nothing uses them.
- [ ] CORS allow-list contains only production domains; cookies are `Secure` + `SameSite`.
- [ ] Env check: `NODE_ENV=production` on the Worker. The config guard already refuses to start with missing secrets in production.
- [ ] Error screens: a friendly 404/500 page, never a stack trace.

## 6. Security (P0 → P1)

- [ ] **Run Claude Code's built-in security review**, `/security-review`. It's already in this setup, no install needed. Run it on the whole backend first, then on every change before deploy.
- [ ] Also `/code-review high` on risky changes (auth, money, claims).
- [ ] **Authorization tests for every route:** a non-member gets 403 on everything for a group; members can't edit others' expenses; private items never leave the server; the photo route leaks nothing else.
- [ ] Input limits on every body: string lengths, item counts, amounts, image size (partly done).
- [ ] **Rate limits that survive scale.** Today they're in memory per Worker instance, so each copy counts separately. Move them to Cloudflare Rate Limiting rules or a Durable Object / KV counter for auth, AI and writes.
- [ ] Dependency audit (`npm audit`) in CI; Dependabot on GitHub.
- [ ] Secrets only in Worker / Vercel secrets; scan git history for leaks (`gitleaks`).
- [ ] Supabase: row-level security on, or the DB reachable only through Hyperdrive; automated backups on, and a restore tested once.
- [ ] Security headers on the frontend (CSP, HSTS, frame-ancestors) via `next.config` headers.

## 7. Monitoring (P1)

- [ ] **Error tracking:** Sentry on the frontend (with source maps) and the Worker. Alert on new errors.
- [ ] **Uptime:** an external check on `/health` every minute (Better Stack / UptimeRobot), alerting by email/WhatsApp.
- [ ] **Worker metrics:** Cloudflare dashboard + Workers Logs / Logpush. Track error rate, p95 latency, CPU time.
- [ ] **AI health:** success and failure rate per reason (rate_limit, timeout, model_unavailable), tokens per day vs. the Groq quota. Alert when the server key nears its limit.
- [ ] **DB:** Supabase usage alerts (connections, storage, slow queries).
- [ ] Product events (privacy-safe, no item names): sign-up, group created, expense added, import done, settle-up, chat question. These feed the admin dashboard (§9).

## 8. Load and scaling (P1)

- [ ] **Already scales well:** the Workers API runs at the edge and scales automatically; Vercel serves the frontend from a CDN; Hyperdrive pools the DB connections.
- [ ] **Bottlenecks to fix before growth:**
  - **Groq rate limits.** The free tier is a few thousand tokens per minute. Need a paid Groq plan or per-user keys, a queue for imports, and a fallback model.
  - **Postgres.** Add indexes for the hot queries (group overview, balances); check `EXPLAIN` on a group with 1,000 expenses.
  - **Balance cache.** In memory today; move it to KV or keep it per-request so all instances agree.
  - **Group overview payload.** It sends every expense with item lists; paginate after ~200 expenses.
- [ ] **Load test** with k6: 500 concurrent users browsing groups, and 50 importing at once. Watch errors and p95 latency.
- [ ] Set Cloudflare / Supabase / Vercel spend limits and alerts so a spike can't run up a big bill.

## 9. Admin dashboard (P1)

An internal page (`/admin`, owner accounts only, enforced on the server) showing:

- **Users:** total, new today / 7d / 30d, daily and monthly active (DAU/MAU), retention by sign-up week.
- **Live:** active in the last 5 minutes.
- **Usage:**
  - groups created
  - expenses per day
  - imports per day, with success rate
  - AI chat questions
  - settle-ups
  - top features
- **AI:** calls, failures by reason, tokens per day, cost estimate.
- **Revenue (after payments):** paying users, MRR, new and cancelled subscriptions, trial → paid conversion.
- **Health:** error rate, p95 latency, last deploy.

Built from a small `Event` table (or a daily rollup table) written by the API, so no third-party analytics and no personal data leaves us.

## 10. Payments (P2, after user testing)

- [ ] **Plan:** free during testing; then ~₹100 per 3 months (or a local equivalent price per country).
  - Decide what stays free (e.g. manual splitting) and what's paid (AI import, chat, unlimited groups).
- [ ] **Provider:**
  - India: Razorpay (UPI AutoPay + cards).
  - Global: Stripe.
  - If it's ever shipped on the Play Store as an app, Google Play Billing rules apply to digital subscriptions.
- [ ] Webhooks → a `Subscription` table; the server checks entitlements, never the client.
- [ ] GST invoice for India; refund and cancellation policy in the terms; receipts by email.
- [ ] Test mode end to end before charging anyone.

## 11. Before inviting the first users

- [ ] Support channel: an in-app "Report a problem" (sends logs plus a screenshot) and a support email.
- [ ] Onboarding: the first-run screen explains groups, invite, import and settle in 3 cards.
- [ ] Seed a demo group for screenshots and app-store listings.
- [ ] Backups verified, rollback plan written (previous Worker version, Vercel instant rollback).
