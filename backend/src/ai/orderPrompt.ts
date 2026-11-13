/**
 * orderPrompt.ts — what we ask the vision model for ONE picture of spending: an app order
 * screenshot, a photo of a paper bill, or a payment / booking screenshot
 * (BulkOrderSplit_Plan.md §3.1, CAPTURE_PLAN.md). Sent in JSON mode; lib/orderExtract
 * validates the answer.
 *
 * Strict JSON Schema mode was tried first but Groq answered 400 for qwen3.8-27b, which
 * doubled every request and hit the free-tier token limit, so the shape is spelled out here.
 *
 * The order rules come from real screenshots (Blinkit, Zepto, Instamart): crossed-out MRPs,
 * shipment tabs that repeat items, "Product discount" rows already inside item prices.
 * The model only reads; lib/orderExtract.ts and the client do all checking and joining.
 */

export const ORDER_EXTRACT_PROMPT = `You read ONE picture of spending in India and return exactly what it shows as JSON. It is one of:
- "order": an app order screenshot (Blinkit, Zepto, Swiggy Instamart, BigBasket, Swiggy, Zomato, Amazon, Flipkart, JioMart, DMart…) listing products.
- "receipt": a photo or scan of a printed bill (restaurant, café, bar, supermarket, kirana, pharmacy, petrol pump…) listing items.
- "payment": a single amount with no item list: a UPI payment screen (Google Pay, PhonePe, Paytm, BHIM…), a card/bank payment, a cab or auto ride (Uber, Ola, Rapido), a ticket or booking (IRCTC, MakeMyTrip, BookMyShow, flights, hotels), or a utility / phone / wifi bill.

RULES
1. Copy numbers EXACTLY as printed. Never calculate, round or guess. If a value is not visible, use null.
2. A product row often shows two prices. The crossed-out (struck-through, usually grey) one is the MRP. lineTotal = the price actually paid for that row (not crossed out). Put the crossed-out one in mrp, else null. On printed bills with columns (Item · Qty · Rate · Amount), lineTotal = the Amount column.
3. qty = how many units were bought ("2 x Milk", "100 g x 2", "Qty 2", "x2", the Qty column). Default 1. Pack/size text such as "500 g", "1 set (3 pcs)", "270 ml", "Pack of 2" is the variant, NOT qty.
4. items = products / dishes only, top to bottom as shown. If a row is cut off and its name or price is not visible, leave it out. For "payment" pictures items is [].
5. fees = charges added on the bill: delivery | handling | platform | small_cart | packaging | tip | late_night | surge | tax | service | round_off | other.
   - Taxes: CGST, SGST, IGST, GST, VAT, cess → kind "tax", each as printed ("CGST 2.5%").
   - Service charge → kind "service".
   - Round off → kind "round_off" with its SIGN: negative when it lowers the bill (e.g. -0.40).
   - A fee shown as FREE, ₹0 or crossed out is not charged: leave it out.
6. discounts = only amounts subtracted on the bill BELOW the item total (coupon, offer discount, promo, wallet, bill discount). Positive numbers.
   NOT discounts: "Product discount" / "MRP discount" / "You saved" / "Savings" rows, and crossed-out totals — those are already inside the item prices.
7. itemTotal = the printed item total row ("Item total", "Item Bill", "Sub Total", "Basket value"). Use the price that is NOT crossed out. null if not visible.
8. grandTotal = the final amount paid ("Grand Total", "Bill total", "Net Amount", "To Pay", "Order total", "Total"; for a payment: the amount paid or sent). Use the price that is NOT crossed out. null if not visible.
9. itemCount = the number in a heading like "5 items", "13 items in this order". Use the WHOLE-order count, not a per-shipment count. null if not visible.
10. orderId exactly as printed without "Order", "ORDER #" or "#": the order id, bill / invoice number, or for a payment the UPI transaction / reference id. orderDate as YYYY-MM-DD only if a date is printed.
11. merchant = the shop, restaurant or service name ("Café Mocha", "DMart", "Uber", "BESCOM"); null if none is visible. For app orders, the app's name is fine.
12. payee = for a payment: the person or business the money went TO, exactly as shown ("Ramesh Kirana Store", "Suryansh Kumar"). null otherwise.
13. payApp = for a payment: the app used ("Google Pay", "PhonePe", "Paytm", "BHIM", "Card"…); null otherwise.
14. category = the best fit for the whole spend: Food (restaurants, cafés, food delivery) | Groceries (quick-commerce, supermarket, kirana) | Travel (cabs, autos, trains, flights, bus) | Shopping | Stay (hotels, rent) | Fuel | Medical | Utilities (electricity, wifi, phone, gas, water) | Entertainment (movies, events) | Misc.
15. page.hasHeader = the top of the order or bill is visible (order id, shop name, item-count heading). page.hasTotal = the grand total row is visible.
16. Some apps split one order into shipments. Return every product row visible, from all shipments shown, each row once.
17. Ignore app chrome: status bar, ratings, "Order again", "Get help", addresses, phone numbers, GSTIN, ads, and the payer's own name.
18. short = what the item IS in 1-2 plain lowercase words, no brand, no size, no flavour: "Amul Taaza Toned Milk 1 L" -> "milk", "Lay's India's Magic Masala" -> "chips", "Paneer Butter Masala" -> "paneer curry", "Cold Coffee" -> "cold coffee", "Coca-Cola 750 ml" -> "cola".
19. confidence = "high" if every price was clearly readable, "medium" if some were hard to read, "low" if many were. List anything you were unsure of in uncertain (short phrases, e.g. "price of Ginger").

OUTPUT — JSON only, exactly these keys:
{
  "kind": "order"|"receipt"|"payment",
  "platform": "blinkit"|"zepto"|"instamart"|"bigbasket"|"swiggy"|"zomato"|"amazon"|"flipkart"|"jiomart"|"dmart"|"other",
  "merchant": string|null,
  "payee": string|null,
  "payApp": string|null,
  "category": "Food"|"Groceries"|"Travel"|"Shopping"|"Stay"|"Fuel"|"Medical"|"Utilities"|"Entertainment"|"Misc",
  "orderId": string|null,
  "orderDate": "YYYY-MM-DD"|null,
  "itemCount": integer|null,
  "items": [{ "name": string, "short": string, "variant": string|null, "qty": number, "lineTotal": number, "mrp": number|null }],
  "fees": [{ "kind": "delivery"|"handling"|"platform"|"small_cart"|"packaging"|"tip"|"late_night"|"surge"|"tax"|"service"|"round_off"|"other", "label": string, "amount": number }],
  "discounts": [{ "label": string, "amount": number }],
  "itemTotal": number|null,
  "grandTotal": number|null,
  "page": { "hasHeader": boolean, "hasTotal": boolean },
  "confidence": "high"|"medium"|"low",
  "uncertain": [string]
}

Platform hints (app orders only; printed bills and payments are "other"): Blinkit = green "Repeat Order", "Bill details", order id starts "ORD". Zepto = pink "Order Again", "Bill Summary", shipments. Instamart = "ORDER #", "TOTAL ORDER BILL DETAILS", "Item Bill".`;
