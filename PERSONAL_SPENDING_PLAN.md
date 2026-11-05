# Personal spending: product plan

## The problem with what's there

The Personal tab is a manual diary: type a name, an amount, pick a category, save. It shows one lifetime total. Three things make it a feature nobody keeps using:

1. **It asks people to do work and gives nothing back.** No month, no trend, no "am I spending too much?".
2. **It ignores what Spenit already knows.** Every group bill already records *your share*. Someone who splits groceries, rent and dinners in groups has most of their spending in Spenit already, but Personal shows ₹0.
3. **Logging is slow.** A full page, four fields and a save button, for a ₹20 chai. People stop after day two.

## The idea

**"Your real spending, without the work."**

Personal becomes the one place that answers *"where did my money go this month?"*:

- **Your share of every group bill flows in automatically.** No double entry, no setup. The first time you open it, it's already full.
- **The rest is logged in two seconds.** Type `chai 20` and press enter. Or tap a chip for something you log often ("Chai ₹20", "Auto ₹60").
- **It tells you something every time you open it:** this month vs last month, where the money went, and whether you're on track for your budget.

People don't ask for a budget tracker or a category chart. They ask *"why am I always broke at the end of the month?"* This answers that with one look.

## What the user sees

### Spending (the tab)
1. **Month switcher:** `‹ November 2026 ›`
2. **Hero:** "You spent **₹12,340** in November".
   - "₹8,200 on your own · ₹4,140 your share in groups"
   - a "12% less than October" chip
   - With a budget: a progress bar, "₹2,660 left · ₹295 a day for 9 days", and a calm "On track" / "Over budget by ₹540". Without one: "Set a monthly budget".
3. **Quick add**, always in reach: a field saying `chai 20, auto 60 yesterday…`. Typing shows a live preview: ☕ *Chai · ₹20 · Food · Today*. Enter saves.
   - Below it, chips for frequent entries, which save in one tap.
   - "More options" opens the full sheet.
4. **Where it went:** each category with an icon, amount, share of the month and a bar, biggest first.
5. **Every day:** a small bar for each day of the month, so spikes stand out. Tap a bar to see that day's total.
6. **Timeline:** grouped by day ("Today ₹340", "Yesterday ₹1,120", …).
   - **Personal entries** can be edited or deleted with a tap.
   - **Group shares** show the group's name and "your share", and open the group.
7. **Ask the assistant** (existing): "How much did I spend on food this month?"

### Add / edit sheet (replaces the Add Log page)
A bottom sheet, not a new page:
1. **Amount first:** big, numeric keypad.
2. **What for:** with suggestions as you type.
3. **Category:** icon chips, guessed from the name ("uber" → Travel), so you rarely touch it.
4. **When:** Today / Yesterday / pick a date (older expenses can be logged).
5. **Save.** In edit mode there's also Delete, with Undo.

## Decisions
- **Group shares are read-only here.** Change them in the group, where everyone sees the change.
- **Payments between friends (settle-ups) aren't spending,** so they're never counted. Only your share of bills.
- **Quick add is parsed on the phone**, with no AI: instant, free, works offline.
- **Months follow India time.** Same categories as group bills, so one chart covers both.
- **The budget is per person and optional.** "On track" compares the share of the budget spent with the share of the month gone.

## Build order
1. **Backend:**
   - when each expense happened (`spent_at`), so older ones can be logged
   - a monthly budget
   - edit
   - one `overview?month=` call returning totals, last month, categories, days, the timeline (personal + group shares), the budget and frequent entries
   - amount and name checks
2. **Quick-add parser** with tests: "chai 20", "20 chai", "uber 340 yesterday", "rent 12000".
3. **The new Spending page and the add/edit sheet**, in light and dark, at phone width.
4. **Assistant and dashboard counters** stay as they are.

## Later (not in this build)
- recurring expenses (rent, subscriptions)
- a weekly summary notification
- CSV export of spending
- receipt photo on a personal entry
- multiple currencies (part of the global-ready work)
