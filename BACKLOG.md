# Backlog: ideas parked until users ask

Ideas we've thought through but are holding until real demand or feedback shows up.
Each entry has the problem, the plan, and **the signal that tells us to build it**.

---

## 1. "Record a payment" form (part payments, cash received, lending)

*Parked 13 Nov 2026.*

### The problem
"Record a payment" in a group's Add sheet just opens **Settle Up**. Settle Up only pays
the *suggested* debts, in *full*, to the *suggested* person. These real situations
can't be recorded:

| Situation | Today |
|---|---|
| "I paid Rahul back ₹2,000 of the ₹4,000" (part payment) | Not possible, full amount only |
| "Rahul gave me ₹500 cash" (recorded by the receiver) | Not possible. Only the payer can record it; the server rejects `fromUserId` for joined members (admin + placeholder only). |
| "I paid Suryansh directly, not the suggested person" | Not possible |
| "I lent Rahul ₹5,000" (lending / IOU) | Not possible. The workaround (a bill shared only by him) wrongly counts as **his spending** in "Your spending", insights and the assistant. |

**Known bug in the same area:** in Scan & upload, a payment screenshot of *another
member's* payment saved as "Paying X back" sends `fromUserId` for a joined member,
so the server returns 403 and saving fails.

### The plan
Keep **Settle Up** as the one-tap "clear everything" screen. Add a **Record a payment**
sheet (from the Add sheet, plus an "Other amount" link on Settle Up):

- **Who paid → who got it:** defaults to *me → them*, with a swap for "they paid me".
- **Amount:** pre-filled with what's owed between the two, editable for part payments.
- **Cash / UPI** (or bank transfer outside India) + an optional note.
- **A live line explaining the result:** "Clears what you owe Rahul" · "₹2,000 left after
  this" · **"Rahul will owe you ₹5,000"** (that's lending, with no separate feature).
- **Confirmation rule:** if *I paid*, it's pending until they confirm (as today). If *they
  paid me*, I'm the receiver, so it's confirmed straight away.
- **Backend:** allow `fromUserId` for joined members **when the caller is the `toUserId`**
  (the receiver), auto-confirmed. Keep the admin + placeholder rule.
- **Group feed:** show it as "You lent Rahul ₹5,000" when the amount is more than what was owed.

**Not in scope:** interest, due dates, repayment schedules, shop credit books (a different
product, with heavier legal questions).

### Build it when
- 3+ testers or users ask for part payments, recording cash received, or lending, **or**
- feedback shows people adding fake "loan" bills.
