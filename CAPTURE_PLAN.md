# Capturing spending: plan

## What people actually have in their hands

A group of flatmates or friends in India spends money in a handful of shapes. For each shape: what proof they have, and what they need from Spenit.

| Shape | What they have | What they need |
|---|---|---|
| **Quick-commerce order** (Blinkit, Zepto, Instamart, BigBasket) | Order screenshots, often 2–4 per order | Item-by-item split, fees shared fairly ✅ *built* |
| **Food delivery** (Swiggy, Zomato) | Order screenshot | Same: items, delivery fee, packaging, tip, GST, coupons. Works through the same reader, but the app only says "orders" |
| **Online shopping** (Amazon, Flipkart, Myntra) | Order screenshot | Usually one person's thing, sometimes shared. Same reader |
| **Restaurant or café bill** | A **paper bill** photographed at the table | Item-by-item (*"I didn't have the drinks"*), with CGST/SGST, service charge, discount and round-off shared fairly. **Gap: only the early "Scan bill" stub on Home, which keeps no items, fees or taxes, and isn't in groups at all** |
| **Supermarket bill** (DMart, Reliance, kirana) | Paper bill, often long | Same as restaurant bills. **Gap** |
| **A UPI payment** (GPay, PhonePe, Paytm, BHIM) | "₹540 paid to Ramesh Kirana" screenshot | The most common proof in India. One amount, who was paid, when. Usually split equally. **Gap** |
| **Paying a friend back** | "₹500 paid to Suryansh" UPI screenshot | Not a bill: it's a **settle-up**. Should record the payment, not add an expense. **Gap** |
| **Cab, train, flight, movie, event** (Uber, Ola, Rapido, IRCTC, MakeMyTrip, BookMyShow) | Booking or ride screenshot | One amount, a category, split among those who went. **Gap**, same as a UPI payment |
| **Utility bills** (electricity, wifi, gas, water) | Bill screenshot or PDF | One amount, split among flatmates. **Gap** (photo/screenshot); PDF later |
| **Cash** | Nothing | Typed by hand or by AI text ✅ *built* |

**The insight:** people don't think "order vs receipt vs payment". They think **"I have a picture of what we spent"**. Spenit should take *any* such picture and work out what it is.

## What changes

### 1. One "Scan or upload" for everything, inside every group
- One button in the group: **Add → Scan or upload**, opening the camera or the gallery.
- Each picture is read and classified:
  - **itemized:** an order or a printed receipt with items. Goes to the existing item-by-item sorter.
  - **payment:** a UPI payment, ticket, ride or utility bill with one total. Becomes one line the whole group shares, editable.
  - **payback:** a payment *to someone in the group*. Offered as a **settle-up** ("This was me paying Suryansh back"), saved as a payment, not a bill.
- Screenshots of the same order still join automatically. Receipts and payments stand alone.

### 2. The reader understands paper bills and payments
- **Merchant name** (restaurants and shops), so bills are titled "Café Mocha · 12 Nov", not "Order".
- **Charges:** CGST/SGST/VAT/GST as tax, service charge, round-off (up = charge, down = discount), tips.
- **Quantities and line totals** on long supermarket bills.
- **Payments:** amount, who was paid (payee), date, the UPI app, and a **category** guess (Travel for Uber, Utilities for electricity…).

### 3. Clear ways in
- **In a group:** one **Add** button with four choices:
  1. Scan or upload (bills, receipts, orders, payments)
  2. Type it (AI)
  3. Enter manually
  4. Record a payment (settle up)
- **On Home**, "Scan bill" asks *which group* (or *just me*), then opens that group's scanner.
- **In Your spending:** **Scan a bill** in quick add reads it and prefills your own expense.

### 4. Retire the old stub
The old Home scan (one-line prompt, no fees or tax, no items saved) is replaced by the above.

## Not in this round
- **PDFs** (e-bills, invoices): needs PDF-to-image in the browser.
- **Bank SMS / statement import:** a separate feature, with privacy concerns.
- **Recurring bills** (rent, wifi every month).
- **Splitting by nights or seats** (hotel stays, tickets): can be done in the sorter by hand for now.
