# Going Global: Spenit Beyond India

*Written 13 Nov 2026. Trigger: first real users in London (flat-shares and friend groups).*

> **Goal:** someone in London signs up and never sees a ₹, a UPI button, a GST line or
> an India-only picture. Their group runs in £, they pay each other the way Londoners do,
> and scanning a Tesco receipt or a Deliveroo order just works. Indian users see **no
> change**.

---

## 1. What's India-only today (audit)

| Area | Where | What's hard-coded |
|---|---|---|
| **Money formatting** | ~25 separate formatters (`inr`, `rupees`, `formatINR`, `money`…) in 28 files | `₹` symbol + `toLocaleString("en-IN")` (Indian grouping 1,00,000) |
| **Currency in data** | `Expense.currency` default `'INR'` (column exists, unused) · `PersonalExpense.currency` default `'INR'` · **no currency on `Group` or `Settlement`** · AI drafts default `"INR"` | Everything assumes INR |
| **Dates** | ~20 `toLocaleDateString("en-IN")` calls | Day-month order is the same in the UK, but locale should follow the user |
| **Day boundaries** | `personal_expenses.ts` `TZ = "Asia/Kolkata"` · `personalAiContext.ts` IST | London "today" ends 5½ hours later. Monthly totals and budgets would be off. |
| **Paying back** | Settle Up "Pay via UPI" · `upi://` deep links in `settlements.ts`, `owe.ts` · profile "UPI ID" · owe page UPI buttons | UPI doesn't exist in the UK |
| **Settlement methods** | `'upi' \| 'cash' \| 'other'` | No bank transfer, Monzo, Revolut, PayPal |
| **AI bill reader** | `orderPrompt.ts`: Blinkit/Zepto/Swiggy hints, CGST/SGST, GSTIN, ₹ | Works on UK receipts by luck, not design. Doesn't report the currency. |
| **Platforms** | `Platform` = blinkit, zepto, instamart, bigbasket, swiggy, zomato, amazon, flipkart, jiomart, dmart | No Deliveroo, Uber Eats, Just Eat, Tesco, Sainsbury's, Ocado… |
| **Quick add** | `quickAdd.ts`: `₹ / rs / inr` amounts, keywords like chai, sabzi, kirana, Blinkit | "£4.50 pret" doesn't parse the £. No Tesco/TfL/council tax keywords. |
| **AI chat** | Answers say ₹, category hints mention Blinkit | |
| **Copy** | "UPI" in Welcome, Add sheet, scan screens, testing checklist, profile | |
| **Art** | `home-hero.webp` (bindi, kurta, bangles: clearly Indian) · `settled-celebration.webp` (₹ coins) | The other 9 illustrations and 16 avatars are neutral ✅ |
| **Legal** | `lib/legal.ts` `COUNTRY: "India"`, DPDP Act wording | UK users need UK GDPR basics |
| **Ops** | Admin dashboard in IST and ₹ | Fine, internal only. **No change.** |

**Already global ✅:** Google sign-in, WhatsApp sharing, Web Push, the PWA, Cloudflare
(edge worldwide), English UI, the 16 animal avatars, most illustrations.

---

## 2. The model: who has a currency?

```
 User   → country, home currency, locale, timezone      (detected, editable in Profile)
 Group  → currency                                       (picked at creation, defaults to creator's)
 Expense / Settlement → currency                         (= group currency in Phase 1)
 PersonalExpense → currency                              (= user's home currency)
```

**Key rule (Phase 1): one currency per group.** A London flat-share is in £, a Goa trip
in ₹. Balances, settle-up and debt simplification stay single-currency, so **no
exchange rates and no rounding disputes**. Multi-currency inside one group (a Paris
weekend for the London flat) is Phase 2.

**Totals across groups** (Home "You're owed", Your spending): never add £ to ₹. Show
each currency separately: *"You're owed £120 · ₹1,200"*. Converting is Phase 2, and is
then only an *estimate* label.

---

## 3. Phase 1: "London-ready" (the build)

### 3.1 Region and onboarding
- **Detect** on first sign-in: `navigator.language` (`en-GB`) + timezone (`Europe/London`)
  → suggest *United Kingdom · £ GBP*. One confirm card: "You're in the UK? We'll use £."
  Editable in **Profile → Region**.
- New `User` columns: `country`, `currency`, `locale`, `timezone`. Backfill existing users
  to `IN / INR / en-IN / Asia/Kolkata` (**zero change for India**).
- Supported at launch: **India (₹), United Kingdom (£)**, plus a generic fallback for
  **€ / $** (formatting and bank-transfer settle-up, no special payment apps yet).

### 3.2 Group currency
- `Group.currency` (default = creator's currency, backfilled to INR). Chosen on **Create group**
  (a small currency chip, pre-selected). Changeable only while the group has no expenses.
- Every expense and settlement saves the group's currency. The server rejects a mismatch.
- `Settlement.currency` column added.

### 3.3 One money formatter
- `lib/money.ts`: `formatMoney(amount, currency, { locale, compact, sign })` built on
  `Intl.NumberFormat`. It handles the symbol, grouping (₹1,00,000 vs £100,000), decimals
  (JPY has none) and negatives.
- Replace all ~25 ad-hoc formatters. Components get the currency from the group (or the
  user for personal screens) through a small `useMoney()` hook.
- Tests: INR Indian grouping, GBP, EUR, whole-number compaction (₹1.2k / £1.2k).

### 3.4 Dates and "today"
- Dates use the user's `locale`, not `en-IN`.
- Server day boundaries (personal spending month/day totals, AI "this month") use the
  **user's timezone**. Sent by the app on each request (`X-Timezone` header), with the stored value as fallback.

### 3.5 Paying people back outside India (the big one)

UPI's magic ("tap → bank app opens with amount filled") has **no universal UK equivalent**.
What Londoners actually use:

| Method | Deep link with amount? | Plan |
|---|---|---|
| **Bank transfer** (Faster Payments: sort code + account no.) | ❌ no standard link | Show the payee's details with **copy buttons** + "I've paid" |
| **Monzo.me** | ✅ `monzo.me/<user>/<amount>` | Open the link |
| **Revolut.me** | ✅ `revolut.me/<user>` (amount in-app) | Open the link |
| **PayPal.me** | ✅ `paypal.me/<user>/<amount>GBP` | Open the link |
| **Cash** | — | "Paid cash", as today |

**"How to pay me"** replaces "UPI ID" in Profile, showing only the methods for your country:
- India: UPI ID (as today).
- UK: Monzo username, Revolut username, PayPal.me, and/or bank details (name on account,
  sort code, account number).
- Others: PayPal.me, IBAN (EU), Venmo (the `venmo_handle` column already exists).

**Settle Up** shows the **payer** buttons for whatever the **payee** has set up: *"Pay £42
with Monzo"*, *"Copy bank details"*, *"Paid cash"*. Each records a pending settlement for
the payee to confirm, exactly as today. Settlement `method` gains `bank`, `monzo`, `revolut`, `paypal`.

**Privacy:** bank details are shown **only** to group members who currently owe that person,
never on the public owe link (the owe link gets Monzo/PayPal links, or "ask X for bank details").

### 3.6 AI reads UK bills
- Pass the **group currency and country** into the reader prompt and the "Type it" parser.
- Prompt additions: £/€ symbols, **VAT** (usually *included* in UK prices: don't add it twice),
  **optional service charge 12.5%** (UK restaurants), tips, "Clubcard/Nectar price" (like Blinkit's
  MRP vs price), UK merchants and apps.
- The reader returns **`currency`**. If it doesn't match the group (a € receipt in a £ group),
  the app warns: "This bill is in €. This group uses £", with Phase 1 options *enter the £ amount*
  or *cancel*.
- `Platform` adds the UK orders that people screenshot: **deliveroo, ubereats, justeat, tesco,
  sainsburys, ocado, asda, morrisons, amazon (shared)**. Everything else is `other` + merchant
  name (already works).
- Indian prompt rules stay. The country decides which hints are emphasised, so India
  accuracy doesn't regress. **Evaluation:** 10 real UK receipts + the existing India set,
  run before shipping.

### 3.7 Quick add and categories
- Parse `£4.50`, `4.50 quid`, `€12`, `$20`, and decimals with pence.
- UK keywords: tesco, sainsburys, aldi, lidl, pret, greggs, deliveroo, tfl, oyster, uber, council
  tax, broadband, energy, rent, netflix…
- The categories stay the same (they're universal). **Add "Rent"/"Bills" under Utilities hints**
  for flat-shares.

### 3.8 Copy
- A tiny `lib/region.ts` gives the country-aware words: `payWord` ("UPI" / "bank transfer"),
  examples in hints ("Blinkit, Zepto…" vs "Tesco, Deliveroo…"), sample names in the
  explainers (Rahul / Sam).
- Sweep: Welcome, Add sheet, scan screens, How-it-works sheet, testing checklist, profile.
- Spelling stays British English, which suits both India and the UK.

### 3.9 Art
| Art | Today | Plan |
|---|---|---|
| `home-hero.webp` | Indian friends (bindi, kurta, bangles) | **Keep for India.** New **global variant**: diverse flatmates in a London-ish kitchen, phone in hand, receipts flying. Picked by country. |
| `settled-celebration.webp` | ₹ coins | **One neutral version**: plain gold coins, no symbol, for everyone |
| The other 9 illustrations + avatars | Neutral | No change |

New art is generated with the **image-gen** skill in the same flat, warm style. Transparent
background WebP, same sizes.

### 3.10 Legal (before any UK user signs up)
- Privacy policy gets a **UK/EU section**: legal basis (contract + legitimate interest), rights
  (access, erase, port, object), the right to complain to the **ICO**, **international
  transfers** (where Supabase/Groq/Cloudflare process data, using standard contractual
  clauses), retention, and that we use **only essential storage** (no tracking cookies,
  so no cookie banner needed).
- Terms: governing law stays India, plus a consumer-rights carve-out for UK users.
- *This is a sensible baseline, not legal advice. Have it reviewed before marketing in the UK.*

### 3.11 Infrastructure check
- **Latency:** the Workers are global, but the database is in one region. If Supabase is in
  Mumbai, London adds ~120 ms per query (~0.5 s on the group screen). It's acceptable for a
  handful of users, and chapter 04/05 of the learner's goldmine covers the fixes (caching,
  replicas). **Verify the Supabase region first.**
- Groq, Push and Google sign-in work worldwide. No change.

---

## 4. Later phases

### Phase 2: multi-currency groups (trips abroad)
- An expense can be in any currency. The app converts to the group currency at the **rate on
  the expense date** (free ECB rates via frankfurter.app, cached daily) and **stores the rate**
  with the expense, so balances never change afterwards.
- The expense shows "€30 (£25.80)". Settle-up stays in the group currency.
- Home totals can show "≈ £X total" as a clearly-labelled estimate.

### Phase 3: the flat-share pack (what a London flat actually needs)
- **Recurring bills:** rent, council tax, broadband and energy, monthly on day N (`is_recurring` +
  `recurrence_rule` columns already exist, unused). The cron creates them and pushes "Rent added".
- **Split by shares/percent:** bigger room pays 40%.
- **Monthly "who owes what" summary** push on the 1st.
- Moving out: settle and leave (the leave flow exists).

### Phase 4: further out
- More languages (next-intl), when a non-English market is targeted.
- US: Venmo / Cash App links. EU: SEPA/IBAN QR (EPC QR code: scannable bank transfer in most EU banking apps).
- Open Banking "pay by bank" (TrueLayer and similar) for real UK deep payments. Costs money,
  needs a company. Only with traction.
- Regional data hosting, if a market requires it.

---

## 5. Build order for Phase 1 (≈ 5–7 working sessions)

| # | Step | Touches | Risk |
|---|---|---|---|
| 1 | Migration 018: `User.country/currency/locale/timezone`, `Group.currency`, `Settlement.currency`, payment-method fields; backfill India | backend | Low (additive) |
| 2 | `lib/money.ts` + `useMoney()`; sweep the ~25 formatters | frontend, wide | Medium (many files, pure swap, tests) |
| 3 | Region detect + confirm card + Profile → Region | both | Low |
| 4 | Group currency on create + server checks | both | Low |
| 5 | Timezone-aware day boundaries | backend | Medium (money totals). Tests. |
| 6 | "How to pay me" + Settle Up methods + owe page | both | Medium (privacy of bank details) |
| 7 | AI: country/currency-aware prompt + UK platforms + quick add £ | both | Medium. Eval on real receipts. |
| 8 | Copy sweep via `lib/region.ts` | frontend | Low |
| 9 | Art: global hero + neutral coins (image-gen) | assets | Low |
| 10 | Privacy/terms UK section | legal pages | Low (review advised) |
| 11 | End-to-end check as a London user (en-GB, Europe/London, £ group, Monzo settle) | — | — |

**Regression guard:** every step keeps India as the default and the existing tests green.
India users never see a "pick your country" prompt (they're backfilled).

---

## 6. Decisions (my recommendation first)

1. **One currency per group for Phase 1?** ✅ Yes. Multi-currency is Phase 2.
2. **Hero art:** ✅ region-specific (keep the Indian one for India, new global one elsewhere).
   The alternative is one diverse image for everyone.
3. **UK payment methods at launch:** ✅ Bank details + Monzo + Revolut + PayPal + cash.
4. **Recurring rent/bills (Phase 3):** pull forward if your sister's flat asks for it first.
   It's likely the most-wanted feature for flat-shares.
