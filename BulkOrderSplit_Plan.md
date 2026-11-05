# Bulk Order Split — Product & Engineering Plan

> **Problem.** Rahul's flat orders from Blinkit / Zepto / Instamart / BigBasket several times a week.
> Each order mixes his own items, items for everyone, and items for just two people
> (Milk → Rahul + Shrey, Peanut butter → Shrey + Andy). Typing that into a splitter, item by item,
> order by order, is so slow that people give up and the money just goes untracked.
>
> **Promise.** *Drop in a pile of order screenshots. In seconds Spenit gives you every order with
> every item. You only tap to fix who shares what — and next week it already knows.*

Target: **10 orders / ~40 items logged in under 2 minutes, with the totals proven to match the bills.**

---

## 1. What exists today (and why it isn't enough)

| Piece | Today | Gap for this flow |
|---|---|---|
| `POST /ai/parse-receipt` ([ai.ts](backend/src/routes/ai.ts)) | All images go into **one** vision call and come back as **one** receipt | 8 screenshots of 5 orders get merged into one fake bill |
| `GroqProvider.parseReceiptImage` | Items `{name, amount}`, `max_completion_tokens: 1024` | No qty, fees, discounts, order id, date, platform. A 30-item order gets cut off |
| [ReceiptItemAssigner](frontend/components/ReceiptItemAssigner.tsx) | Per-item avatar chips, all members selected by default | One order only; one tap per person per item; no memory |
| `fairshare` split ([expenses.ts](backend/src/routes/expenses.ts)) | personal amounts + leftover split equally among **all** participants | Delivery / handling fees get charged to people who had no items in that order |
| Totals check | None | Nothing tells the user "this bill adds up", so they can't trust it |

We keep the parts that work: compressing images in the browser, the "AI only suggests, the user confirms" rule, idempotent expense creation, and `receipt_data` jsonb.

---

## 2. The flow (what the user experiences)

```
 ┌──────────┐   ┌─────────────────┐   ┌────────────────────┐   ┌──────────────┐   ┌──────────┐
 │ 1. DROP  │ → │ 2. READING…     │ → │ 3. SORT IT OUT     │ → │ 4. CHECK     │ → │ 5. SAVED │
 │ pick/    │   │ orders appear   │   │ orders → items     │   │ who owes what│   │ N expenses│
 │ share N  │   │ one by one      │   │ tap to fix people  │   │ add all      │   │ + undo   │
 │ images   │   │ (live)          │   │                    │   │              │   │          │
 └──────────┘   └─────────────────┘   └────────────────────┘   └──────────────┘   └──────────┘
```

### Step 1 — Drop
- Entry points: group page **"Import orders"** button, and the global Scan tab.
- Pick many screenshots at once, any order, duplicates allowed (we remove them).
- **Android:** Spenit appears in the system **Share** sheet (PWA Web Share Target). The user selects 6 screenshots in Gallery → Share → Spenit → choose group. No app switching.
- Accepted: screenshots of the order-detail screen, long scrolling screenshots, photos of paper bills, and later PDF invoices (§6).

### Step 2 — Reading (live, not a spinner)
- Every image is sent **on its own** (3 at a time). Order cards drop in as each one finishes:
  `Blinkit · 2 Nov · 14 items · ₹1,284 ✓ adds up`
- One bad image fails alone with a "Retry" button; the rest keep going.
- Screenshots of the **same order** (top half / bottom half) are joined into one card automatically.
- An order that is **already in the group** shows `Already added on 2 Nov` and is skipped by default.

### Step 3 — Sort it out (the core screen)
One card per order, collapsed to a header + status. Inside, a list of items.

Fast ways to assign, from most to least automatic:

1. **Remembered from last time.** "Amul Taaza Milk 1L" was Rahul + Shrey last week → it comes pre-filled, with a small *remembered* tag. After a few weeks most items are already right. (§5)
2. **Order-level default.** Each order card has a one-tap default: `Everyone` / `Just me` / `Custom…`. Items with no memory take this.
3. **Person brush.** Tap Andy's avatar in the top bar → Andy is now the "brush". Tap items to add or remove Andy. Far faster than chips on every row when one person is involved in many items.
4. **Swipes.** Swipe right = *just mine*, swipe left = *everyone*.
5. **Select many.** Long-press to select several items → apply people to all of them.
6. **Skip order.** Whole order was personal → one tap, it's left out (or sent to My Spends, §5).

Per order also: **Paid by** (default = me; changeable because Shrey may have ordered and sent me the screenshots), and **fees & discounts** handling (§4).

A sticky bar shows progress: `6 of 8 orders ready · 3 items need a look`.

### Step 4 — Check
- Per person: `Shrey owes you ₹1,120 · Andy owes you ₹1,220 · Your own items ₹640`.
- Each order shows its proof: `items ₹1,240 + fees ₹64 − discount ₹20 = ₹1,284 = bill total ✓`.
- **Add 8 expenses** → one request, all or nothing.

### Step 5 — Saved
- Toast with **Undo** (soft-deletes the batch). Group members get one push: *"Rahul added 8 orders from Blinkit & Zepto"*, not 8 pushes.
- Each expense opens to its item list; editing it re-opens the same assigner.

---

## 3. Extraction pipeline (where reliability comes from)

> **Update 2026-11-05 — decided after testing 12 real screenshots: vision model first, no OCR.**
> Tesseract read item names well but misread the ₹ sign in most prices (`₹310` → `2310`,
> `₹135` → `35`, `₹94 ₹77` → `394377`), so OCR text cannot be trusted for money.
> Built pipeline: each screenshot → `qwen/qwen3.8-27b` (strict JSON Schema) → `lib/orderExtract`
> (normalize + totals) → phone joins screenshots by order id or shared rows, in any pick order.
> Stitching screenshots into one image was rejected: Groq gives each image a fixed ~2k-token
> budget, so a stitched image shrinks the text. §3.0–3.1 below are the earlier OCR design, kept for history.

**OCR first, AI second, vision only as a backup.** The AI only turns text into structure. Joining, checking and all money math are plain code.

```
            on the phone                         server (text AI, cheap + fast)          code, not AI
image ─► [OCR → text rows with positions] ─► [text → strict order JSON] ─► [numbers exist in OCR?] ─► [join] ─► [totals add up?] ─► cards
                │ low OCR confidence (photo of paper bill)                       │ fails
                └──────────────────────────────► [vision model on that one image] ◄┘
```

### 3.0 Why OCR first
| | Vision model reads image | OCR → text AI (chosen) |
|---|---|---|
| Digits | Can invent or round a digit, and we can't tell | Digits come from OCR. **Every number in the AI's answer must appear in the OCR text** — otherwise it's rejected. This makes made-up numbers impossible |
| Cost / speed | ~1–2k image tokens, slower vision models | ~400 text tokens on Groq `llama-3.3-70b` (already used), very fast. A Spenit-paid key with a free quota becomes affordable |
| Privacy | Image leaves the phone | Only text leaves the phone |
| Joining screenshots of one order | Hard | Easy: overlapping text lines at the boundary match exactly |
| Model churn | Groq vision models change often | Text models are stable; OCR doesn't change |
| Weak spots | — | Loses **strike-through** (MRP ₹60 crossed, paid ₹54) and struggles with **camera photos** of paper bills |

Fixes for the weak spots:
- Two prices on one item row → take the **lower** one as paid (apps always show MRP higher). The totals check catches the rare miss.
- OCR confidence low, numbers not found, or totals off → send **only that image** to the vision model (with the OCR text as a hint). Expect this for photos, rarely for app screenshots.

### 3.0.1 OCR engine
- **Tesseract.js in the browser** (Web Worker, English fast model ~4 MB, cached by the service worker). App screenshots are clean digital text, which is Tesseract's best case. ~1–3 s per image on a mid phone; 2 workers in parallel.
- Use its word boxes to rebuild **rows**: group words by vertical position and keep the right-aligned price on the same row as the item name (`Amul Taaza 1 L | 2 x | ₹54 ₹60`). Layout is what makes the text AI accurate.
- Not chosen: Google ML Kit (native apps only, not a PWA); cloud OCR like Google Vision / Azure receipts (another account, cost, images leave phone) — keep as an option if Tesseract benchmarks badly.
- Not chosen: hand-written parsers per app (no AI at all). Free, but break every time Blinkit or Zepto changes their screen.

**First task of Phase 1: benchmark** 30–50 real screenshots both ways (OCR→text AI vs vision) and measure exact-number accuracy, totals pass rate and time. The pipeline above is the expected winner; the benchmark confirms it.

### 3.1 Per-image structuring — `POST /ai/extract-order`
Body: `{ ocrRows, ocrConfidence, imageBase64? }` — the image is only included when the phone decides vision backup is needed. One image per call: stays inside Worker and Groq time limits, gives live progress, and lets one image be retried alone.

Schema the model must return:
```jsonc
{
  "platform": "blinkit|zepto|instamart|bigbasket|swiggy|zomato|amazon|flipkart|other",
  "orderId": "string|null",
  "orderDate": "YYYY-MM-DD|null",
  "items": [{ "name": "Amul Taaza Toned Milk", "variant": "1 L", "qty": 2, "unitPrice": 27, "lineTotal": 54 }],
  "fees": [{ "kind": "delivery|handling|platform|small_cart|packaging|tip|late_night|other", "label": "Handling charge", "amount": 9 }],
  "discounts": [{ "label": "Coupon SAVE50", "amount": 50 }],
  "grandTotal": 1284,
  "page": { "hasHeader": true, "hasTotal": true }   // tells us if this is the top, middle or bottom of an order
}
```
- Raise `max_completion_tokens` (≥ 4096); one image = one order section, so output stays bounded.
- Prompt: "copy numbers exactly as printed; the price paid is the one actually charged, not the crossed-out MRP; never guess a missing value — use null".
- Platform-specific hints in the prompt (where each app shows order id, how they print *Handling charge*, *Small cart fee*, *Free delivery ₹0*).

### 3.2 Join pieces (code)
- Same `orderId` → same order. No id → same platform + date + one piece has the header and the other has the total and they were picked next to each other.
- Long orders often overlap at the screenshot boundary: drop items that appear at the bottom of piece A and the top of piece B with the same name, qty and price.
- Remove exact duplicate images on the client first (hash of the compressed bytes).

### 3.3 Check totals (code) — the trust signal
For every order: `Σ lineTotal + Σ fees − Σ discounts` vs `grandTotal`, allowing ₹1 for rounding.
- ✓ **Adds up** → green, collapsed.
- ⚠ **Off by ₹X** → amber, opened, the likely bad rows highlighted (e.g. `qty × unitPrice ≠ lineTotal`). User fixes a number or taps *"Use bill total"*, which puts the difference on a visible *Adjustment* row.
- ✗ **No total found** (screenshot cut) → ask for the missing screenshot or accept items as they are.

Users trust the result because every card *shows* it adds up — not because we say AI is accurate.

### 3.4 Already-added check (code)
Store `platform + orderId` in the expense's `receipt_data`; a partial unique index on `(group_id, receipt_data->>'orderKey')` blocks double imports even across devices. Fallback without id: same platform + date + total.

---

## 4. Money math (server is the authority)

New split type **`itemized`**. The client sends items with who shares each one; the **server** computes shares with `decimal.js` (as it already does), so the client and AI never decide balances.

Rules per order:
1. Each item's `lineTotal` is split equally among its people.
2. **Fees** — default *in proportion to each person's items* (fair: whoever bought more pays more delivery). Option per order: *split equally among people in this order* or *payer pays fees*. People with no items in the order never pay its fees (fixes today's `fairshare` gap).
3. **Discounts** — same rule as fees, but negative.
4. Rounding: largest-remainder to the paisa so shares always sum to the bill exactly.
5. Items that are *just the payer's* stay in the expense with the payer as the only sharer. The expense amount = bill total (easy to match to the bank statement); the payer's own items don't change anyone's balance.

Request body (one order):
```jsonc
{
  "splitType": "itemized",
  "amount": 1284,
  "payers": [{ "userId": "rahul", "amountPaid": 1284 }],
  "receiptData": {
    "source": "order_import", "platform": "blinkit", "orderId": "…", "orderKey": "blinkit:…", "orderDate": "2026-11-02",
    "items": [{ "name": "Milk 1 L", "qty": 2, "lineTotal": 54, "sharedBy": ["rahul", "shrey"] }],
    "fees": [{ "label": "Handling", "amount": 9 }], "discounts": [], "feePolicy": "proportional"
  }
}
```
**`POST /expenses/batch`** — up to ~30 orders, one transaction, one `Idempotency-Key` for the batch, returns created ids (for Undo). Reuses the existing validation per order.

---

## 5. Getting faster every week

### Item memory (biggest time-saver, no AI)
Table `ItemSplitRule (group_id, item_key, user_ids uuid[], times_used, last_used_at)`.
- `item_key` = cleaned name: lowercase, without sizes/pack counts/brand noise (`"amul taaza toned milk 1 l"` → `"amul taaza toned milk"`), plus a looser fallback key (`"milk"`).
- Written when the batch is saved, from what the user finally chose (so corrections are learned).
- Read on import: exact key first, then the looser key. Shown with a *remembered* tag; never silently hidden.

### Send my own items to My Spends
Toggle on the Check screen: items that are *just mine* also get logged as Personal Expenses (the feature already exists), so personal tracking happens for free.

### Saved draft
The whole import is saved on the device (IndexedDB, like the existing outbox) after every change. Closing the app at order 6 of 10 loses nothing.

---

## 6. Inputs — what we support and why

| Input | Accuracy | Effort for user | When |
|---|---|---|---|
| Screenshots of order details | Good, with total check | Low | **Phase 1** |
| Share sheet → Spenit (Android PWA) | same | Lowest | **Phase 2** |
| PDF invoices (apps let you download / email them) | Best — real text, no image reading | Medium | Phase 2 |
| Forward order emails to `orders+<group>@…` (Cloudflare Email Workers fits our stack) | Best, fully hands-off | One-time setup | Phase 3 |
| Logging into the user's Blinkit/Zepto accounts | — | — | **Not doing**: no public APIs, breaks their terms, risky with credentials |

---

## 7. Phases

### Phase 1 — Works end to end (MVP)
- Benchmark OCR→text AI vs vision on real screenshots (§3.0).
- Frontend: Tesseract.js worker + row rebuilding; vision backup trigger.
- Backend: `POST /ai/extract-order` (OCR text in, strict schema out, number-grounding check, vision backup, platform hints).
- Shared code: join pieces + total check + duplicate check (pure functions, unit tested like `balance.test.ts`).
- Backend: `itemized` split type in `prepareExpense`; `POST /expenses/batch`; unique index on order key (migration `010`).
- Frontend: new route `groups/[id]/import` — Drop → live Reading → Sort it out (order cards, order default, per-item chips, person brush, swipe, skip) → Check → Saved with Undo.
- One combined push for the batch.
- Test set: 30–50 real screenshots across Blinkit, Zepto, Instamart, BigBasket, Swiggy; extend `test-vision.ts` into an accuracy script (items found, numbers exact, totals that add up).

### Phase 2 — Fewer taps
- Item memory (`ItemSplitRule`, migration `011`).
- Share Target in `manifest.json` + service worker handler.
- PDF invoice reading.
- Saved draft in IndexedDB; *just mine → My Spends* toggle.
- Split one item by quantity (3 Maggi packs: 2 for Andy, 1 for me).

### Phase 3 — Hands-off and shared
- **Claim link:** Rahul imports, sends the group a link, everyone ticks their own items; Rahul confirms. The splitting work is shared, not one person's job.
- Email forwarding import.
- Monthly "unlogged orders?" nudge.

---

## 8. How we'll know it works
- **Totals check pass rate** on first read (goal ≥ 90%).
- **% of items the user changed** (should fall week over week as memory kicks in).
- **Time from drop to saved** (goal < 2 min for 10 orders).
- **Imports started vs. finished** (where people drop off).

---

## 9. Decisions needed from you
1. **AI key.** Today every user must paste their own Groq key. For "masses" that stops most people at step 1. Suggest: a Spenit server key for order imports with a monthly free quota per user (e.g. 60 images), own key = unlimited.
2. **One expense per order** (recommended: matches bills, enables duplicate check, easy to edit) **vs. one combined expense per import.**
3. **Default fee rule:** proportional to items (recommended) vs. equal among people in the order.
4. **Keep the screenshots?** Recommended: no — keep only the extracted data (cheaper, more private). Optionally keep a small thumbnail for 30 days.
