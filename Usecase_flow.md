# Use-Case Flow — Real Scenarios
### How the app actually gets used, feature by feature — this is the "why it's better" made concrete

This document exists so that "better than Splitwise" isn't an abstract claim. Every
feature below is shown doing real work in a real scenario. When building a stage in
`AI_Prompts.md`, cross-check the feature being built against its scenario here — if
the implementation doesn't produce the experience described below, something's
drifted.

---

## Scenario A: The Rajasthan Trip (v0/v1 core loop)

### 1. Forming the group (replaces a friend/search system entirely)

You open the app, tap **New Group**, name it "Rajasthan Trip," pick a cover icon.
The app immediately gives you a **shareable link**
(`app.link/g/rajasthan-x7k2`) and a **QR code**.

- You paste the link into the trip WhatsApp group.
- Anyone who taps it lands on a group preview page ("Divyansh invited you to
  Rajasthan Trip — 1 member so far") and joins with one tap after Google sign-in.
- No search, no "is this the right Prashant," no request/accept friction — the
  link **is** the trust boundary.
- If everyone's physically together, showing the QR code and letting people scan
  it in person is even faster — good for "we just met at the hostel and are
  splitting a cab."

This is the direct fix for the identity-confusion problem: there is no username
search at all, so there's no "wrong person with the same name" scenario possible.
The only way into a group is a link/QR a real member shared.

### 2. Adding an expense — natural language AI entry

Day 1, you pay for dinner. Instead of a multi-field form, you tap **Add Expense**
and type or speak:

> "Dinner at Thali House, 2400 rupees, split equally between me, Aman, Riya and Karan"

Groq parses this into structured data — amount ₹2400, payer you, participants the
4 named people (matched against group members by name/username), split type equal
— and shows a **pre-filled confirmation card** before saving. You tap confirm. If
it mis-parses a name or amount, you edit that one field manually. The AI is a
shortcut, never a black box you have to blindly trust — this is the
"AI-is-a-parser-not-a-source-of-truth" principle from `Architecture.md` §2, made
visible in the UI.

If two group members are both named "Prashant," the confirm-card disambiguates
them as `Prashant K. (@prashant.k)` and `Prashant S. (@prashant.s)` — this is
exactly why `DB_Design.md`'s `username` field exists from v0, even though most
groups won't hit this case immediately.

### 3. Itemized splitting (v1+/Tier 1 — the messy real case)

Day 2, big group dinner, not everyone had the same dishes. You snap a photo of the
receipt. OCR + Groq structure it into line items (butter chicken ₹450, dal
makhani ₹300, 4× roti ₹120, 2× cold drink ₹160, tax/service ₹95). You tap each
item and assign who ate it. Tax/service auto-distributes proportionally. This is
the exact case Splitwise handles clumsily — you get a clean per-person breakdown
instead of guessing an equal split that's unfair to the two people who only had a
cold drink.

*(Not in v0 — this is the first Tier 1 feature to build once v0 is validated.)*

### 4. Recurring expenses, same app, different context (v1+/Tier 1)

Separately, you and your roommate have a "Flat 3B" group for rent + electricity.
You mark rent as recurring (monthly, fixed 50/50 split). The app auto-creates the
expense entry each month and just notifies you both. This shows the app isn't
just a trip splitter — it quietly handles the boring recurring stuff too.

### 5. The balance screen — the actual differentiator (v0, core)

Open the group any time and see, instantly:

> **You are owed ₹1,850 overall**
> Aman owes you ₹600 · Riya owes you ₹450 · You owe Karan ₹200 *(net: you're owed
> ₹850 from him, shown as one number)*

No transaction list to scroll through, no double-counting confusion. Tap into a
person to see the underlying transactions if you want the detail — but the
default view is the answer, not the ledger.

Zoom out to the **home dashboard** and see this net-owed/net-owing number rolled
up **across every group and every 1:1** — Rajasthan Trip, Flat 3B, and anything
else — as one combined "you're owed ₹X overall" figure. Splitwise never gives you
this cross-group total.

### 6. Settling up — with confirmation, so nothing goes stale (v0, core)

Trip's ending. You tap **Settle Up** with Karan. The debt-simplification algorithm
(`Architecture.md` §7) runs across the whole group first — instead of 6 separate
payments between 4 people, it works out the minimum transfers needed (e.g., "Karan
pays Divyansh ₹850, Riya pays Aman ₹200" settles everyone), explained in plain
language: *"Instead of 4 payments, only 2 are needed."*

You tap **Settle with Karan** → a UPI deep link is generated, pre-filled with the
exact amount → Karan pays through his own UPI app → taps **"I've paid"** in-app →
you get a notification and confirm you received it. Only then does the balance
clear to zero. This two-way confirmation stops the classic Splitwise problem of a
balance quietly going stale because someone paid in cash and forgot to log it —
and if that happens anyway, either side can log a manual "paid in cash" settlement
for the other to confirm.

### 7. After the trip — AI insight (v1+/Tier 1)

A few days later:

> "Rajasthan Trip: ₹18,400 spent across 12 expenses. Food was your biggest
> category (44%), followed by travel (31%). You paid ₹9,200 upfront and were owed
> ₹1,850 net."

This uses the same Groq call pattern as expense parsing — it's just phrasing
numbers your backend already computed correctly. No risk of the AI inventing
wrong totals (`Architecture.md` §2).

### 8. Ask-your-ledger assistant (Tier 2, optional/lightweight)

Anytime, type into a simple chat box: *"How much did I spend on food this month
across all groups?"* The backend runs the actual query against your expense data;
Groq phrases the answer naturally. It never does the math itself.

---

## Scenario B: The New Friend Group Onboarding (v0 launch day)

A group of 12 friends decides to try the app instead of Splitwise for an upcoming
trip.

1. One person creates the group, shares the link in the group's WhatsApp.
2. Each friend taps the link, signs in with Google (one tap — this is why v0
   deliberately drops email/OTP, see `ProductDetailIDEA.md` §8), and lands
   directly in the group.
3. Someone adds the first expense via typed natural language. It parses
   correctly. Word spreads in the group chat: "oh this is actually easier than
   Splitwise."
4. Over the following weeks, usage settles into a pattern: expenses added via NL
   text most of the time, occasionally via the manual Equal/Exact form when the
   AI mis-parses something or the expense is unusual.
5. At the end of the trip, settle-up runs, debt-simplification reduces a tangle of
   IOUs into 2–3 UPI payments, everyone pays and confirms.
6. This is the real "does v0 work" test described in `ProgressTracker.md`'s "done"
   criteria — nothing else about v0 matters if this loop doesn't feel obviously
   better than Splitwise to the actual friend group using it.

---

## Scenario C: Why the Friend-Graph Was Removed (Design Rationale, Not Just a Decision)

Early planning considered a Splitwise-style friend system (search by username/email,
send/accept friend requests, a persistent friends list independent of groups). This
was deliberately cut. Reasoning, made concrete:

- **The bug it prevents:** in a system with friend search by name, "add Prashant as
  a friend" is ambiguous the moment there are two Prashants anywhere in the
  searchable user base — not just within your own groups. This is a real,
  recurring confusion in Splitwise-style apps.
- **What replaces it:** the group-link/QR model means the *only* way to end up in a
  group with someone is that a current group member shared the link or showed the
  QR code directly to them. There is no global user search surface at all in v0/v1.
  This maps exactly onto how people actually form these groups in real life — a
  WhatsApp share, not a search.
- **What this costs:** you can't pre-add a "friend" before sharing a group with
  them, and there's no persistent cross-group "friends list" UI. This is an
  accepted tradeoff — it was not asked for by the target v0 friend group, and
  `DB_Design.md`'s schema doesn't need a `Friendship` table because of this
  decision (one less table, one less identity-resolution surface to get wrong).
- **If this changes later:** if a future tier genuinely needs friend-search (e.g.,
  a public v2 with cross-group social features), that's a new decision requiring
  its own explicit design discussion — not something to quietly reintroduce because
  it "seems easy to add." The `username` field already in the v0 schema (see
  `DB_Design.md` §2) is what would make that addition possible later without a
  redesign, but building the actual search/friend-request feature is out of scope
  until that decision is made deliberately.

---

## Scenario D: A Groq Free-Tier Failure, Handled Gracefully (v0 operational reality)

Groq's free tier has rate limits. At v0 scale (10–20 users) this is expected to be
comfortably inside headroom, but the failure path must still work correctly the
one time it isn't:

1. A user types a natural-language expense while Groq's free tier is temporarily
   rate-limited or slow.
2. The app doesn't hang or error out on the user. Per the fallback discipline in
   `Architecture.md` §6, it falls back immediately to the manual Equal/Exact form,
   pre-populated with whatever could be trivially extracted (e.g. a number found
   in the text), if anything.
3. The failure is logged (prompt size, latency, failure reason) per
   `Architecture.md` §6 — this becomes real usage data for deciding whether v0.1
   needs a paid Groq tier or a second provider.
4. The user experience is: "the AI shortcut didn't work this one time, I filled a
   short form instead" — never "the app is broken."

This is the concrete test for the "AI availability never blocks core app usage"
architectural rule — if this scenario ever produces a hard failure instead of a
graceful fallback, that's a bug against `Architecture.md` §6, not a Groq problem.

---

## Cross-Reference

- Why each of these features exists at a product level: `ProductDetailIDEA.md`
- How each feature is technically implemented: `Architecture.md`
- Exact schema backing each scenario: `DB_Design.md`
- Which stage builds which scenario's features: `AI_Prompts.md` /
  `ProgressTracker.md`