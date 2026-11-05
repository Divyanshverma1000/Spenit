/**
 * orderPrompt.ts — what we ask the vision model for ONE order screenshot
 * (BulkOrderSplit_Plan.md §3.1). Sent in JSON mode; lib/orderExtract validates the answer.
 *
 * Strict JSON Schema mode was tried first but Groq answered 400 for qwen3.8-27b, which
 * doubled every request and hit the free-tier token limit, so the shape is spelled out here.
 *
 * The rules come from real screenshots (Blinkit, Zepto, Instamart): crossed-out MRPs,
 * shipment tabs that repeat items, "Product discount" rows already inside item prices.
 * The model only reads; lib/orderExtract.ts and the client do all checking and joining.
 */

export const ORDER_EXTRACT_PROMPT = `You read ONE screenshot of an Indian quick-commerce / food / shopping order (Blinkit, Zepto, Swiggy Instamart, BigBasket, Swiggy, Zomato, Amazon, Flipkart, JioMart, DMart) and return exactly what it shows as JSON.

RULES
1. Copy numbers EXACTLY as printed. Never calculate, round or guess. If a value is not visible, use null.
2. A product row often shows two prices. The crossed-out (struck-through, usually grey) one is the MRP. lineTotal = the price actually paid for that row (not crossed out). Put the crossed-out one in mrp, else null.
3. qty = how many units were bought ("2 x Milk", "100 g x 2", "Qty 2", "x2"). Default 1. Pack/size text such as "500 g", "1 set (3 pcs)", "1 pack (5 pcs)", "270 ml", "Pack of 2" is the variant, NOT qty. In "1 pc • 1 unit" the qty is 1.
4. items = products only, top to bottom as shown. If a product row is cut off at the screen edge and its name or price is not visible, leave that row out.
5. fees = charges added on the bill: delivery | handling | platform | small_cart | packaging | tip | late_night | surge | tax | other. A fee shown as FREE, ₹0 or crossed out is not charged: leave it out.
6. discounts = only amounts subtracted on the bill BELOW the item total (coupon, offer discount, promo, wallet). Positive numbers.
   NOT discounts: "Product discount" / "MRP discount" / "You saved" / "Savings" rows, and crossed-out totals — those are already inside the item prices.
7. itemTotal = the printed item total row ("Item total", "Item Total", "Item Bill", "Basket value"). Use the price that is NOT crossed out. null if not visible.
8. grandTotal = the final amount paid ("Grand Total", "Bill total", "Total Bill", "To Pay", "Order total"). Use the price that is NOT crossed out. null if not visible.
9. itemCount = the number in a heading like "5 items", "13 items in this order", "Completed | 8 items". Use the WHOLE-order count, not a per-shipment count ("4 items in shipment"). null if not visible.
10. orderId exactly as printed without "Order", "ORDER #" or "#" (e.g. "UHISJNSOQ27227", "ORD41691704471", "249970716902473"). orderDate as YYYY-MM-DD only if a date is printed (a time alone like "Arrived at 6:54 pm" is not a date).
11. page.hasHeader = the top of the order is visible (order id heading, "Order summary", item-count heading). page.hasTotal = the grand total row is visible.
12. Some apps split one order into shipments. Return every product row visible in this screenshot, from all shipments shown, each row once.
13. Ignore app chrome: status bar, ratings, "Order again", "Repeat order", "Get help", addresses, phone numbers, names, payment method, ads.
14. short = what the item IS in 1-2 plain lowercase words, no brand, no size, no flavour: "Amul Taaza Toned Milk 1 L" -> "milk", "Lay's India's Magic Masala" -> "chips", "Dove Hair Fall Rescue Shampoo" -> "shampoo", "Harvest Gold White Bread" -> "bread", "Coca-Cola 750 ml" -> "cola", "Fresh Onion" -> "onions".
15. confidence = "high" if every price was clearly readable, "medium" if some were hard to read, "low" if many were. List anything you were unsure of in uncertain (short phrases, e.g. "price of Ginger").

OUTPUT — JSON only, exactly these keys:
{
  "platform": "blinkit"|"zepto"|"instamart"|"bigbasket"|"swiggy"|"zomato"|"amazon"|"flipkart"|"jiomart"|"dmart"|"other",
  "orderId": string|null,
  "orderDate": "YYYY-MM-DD"|null,
  "itemCount": integer|null,
  "items": [{ "name": string, "short": string, "variant": string|null, "qty": number, "lineTotal": number, "mrp": number|null }],
  "fees": [{ "kind": "delivery"|"handling"|"platform"|"small_cart"|"packaging"|"tip"|"late_night"|"surge"|"tax"|"other", "label": string, "amount": number }],
  "discounts": [{ "label": string, "amount": number }],
  "itemTotal": number|null,
  "grandTotal": number|null,
  "page": { "hasHeader": boolean, "hasTotal": boolean },
  "confidence": "high"|"medium"|"low",
  "uncertain": [string]
}

Platform hints: Blinkit = green "Repeat Order", "Bill details", order id starts "ORD". Zepto = pink "Order Again", "Bill Summary", shipments. Instamart = "ORDER #", "TOTAL ORDER BILL DETAILS", "Item Bill".`;
