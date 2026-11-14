import { describe, it, expect } from "vitest";
import { normalizeOrder, checkTotals, toMoney, fixDecimalSlips } from "./orderExtract";
import { parseModelJson } from "../ai/GroqProvider";

// Model answers shaped like real screenshots (numbers copied from the bills).

/** Instamart: has an "Offer Discount" that IS subtracted, and a ₹6.01 handling fee. */
const INSTAMART = {
  platform: "instamart",
  orderId: "ORDER #249970716902473",
  orderDate: null,
  itemCount: 8,
  items: [
    { name: "Fortune Sugar", variant: null, qty: 1, lineTotal: 77, mrp: null },
    { name: "Bournvita Chocolate Nutrition Drink Pouch", variant: null, qty: 1, lineTotal: 30, mrp: null },
    { name: "Amul Taaza Milky Milk", variant: null, qty: 1, lineTotal: 30, mrp: null },
    { name: "NOICE Fresh Lime Soda (No Preservatives)", variant: null, qty: 1, lineTotal: 1, mrp: null },
    { name: "MAGGI 2-Minute Instant Noodles", variant: null, qty: 3, lineTotal: 45, mrp: null },
    { name: "MAGGI Double Masala Noodles", variant: null, qty: 1, lineTotal: 20, mrp: null },
  ],
  fees: [
    { kind: "delivery", label: "Delivery Fee", amount: 16 },
    { kind: "handling", label: "Handling Fee", amount: 6.01 },
  ],
  discounts: [{ label: "Offer Discount", amount: 16 }],
  itemTotal: 203,
  grandTotal: 209,
  page: { hasHeader: true, hasTotal: true },
  confidence: "high",
  uncertain: [],
};

/** Blinkit: "Product discount" is already inside the item prices — must not be subtracted. */
const BLINKIT = {
  platform: "blinkit",
  orderId: null,
  orderDate: null,
  itemCount: 4,
  items: [
    { name: "Green Chilli", variant: "100 g", qty: 2, lineTotal: 34, mrp: 40 },
    { name: "Amul Fresh Malai Paneer", variant: "200 g", qty: 1, lineTotal: 95, mrp: null },
    { name: "Desi Tomato - Pack of 2", variant: "2 x 500 g", qty: 1, lineTotal: 77, mrp: 95 },
    { name: "Potato Pack of 2", variant: "2 x 1 kg", qty: 1, lineTotal: 43, mrp: 51 },
  ],
  fees: [
    { kind: "handling", label: "Handling charge", amount: 9 },
    { kind: "delivery", label: "Delivery charges", amount: 0 },
  ],
  discounts: [{ label: "Product discount", amount: 32 }],
  itemTotal: 249,
  grandTotal: 258,
  page: { hasHeader: true, hasTotal: true },
  confidence: "high",
  uncertain: [],
};

/** Zepto shipment-2 tab: 4 of the order's 5 items, but the WHOLE order's bill summary. */
const ZEPTO_SHIPMENT_TAB = {
  platform: "zepto",
  orderId: "#UHISJNSOQ27227",
  orderDate: null,
  itemCount: 5,
  items: [
    { name: "Status Cotton Feel Double Geometric Bedsheet", variant: "1 set (3 pcs)", qty: 1, lineTotal: 310, mrp: 479 },
    { name: "Joyo Plastics Pedal Bin 11.2 Ltr Printed Assorted", variant: "1 pc", qty: 1, lineTotal: 245, mrp: 516 },
    { name: "Happy Mail Matchbox", variant: "1 pack (5 pcs)", qty: 1, lineTotal: 10, mrp: null },
    { name: "Joyo Use Me Dust Bin 7 Ltr Assorted", variant: "1 pc", qty: 1, lineTotal: 135, mrp: 186 },
  ],
  fees: [],
  discounts: [],
  itemTotal: 1412,
  grandTotal: 1412,
  page: { hasHeader: true, hasTotal: true },
  confidence: "high",
  uncertain: [],
};

describe("toMoney", () => {
  it("parses printed prices", () => {
    expect(toMoney("₹1,284.00")).toBe(1284);
    expect(toMoney("Rs. 54")).toBe(54);
    expect(toMoney(-20)).toBe(20);
    expect(toMoney("FREE")).toBeNull();
    expect(toMoney(null)).toBeNull();
  });
});

describe("normalizeOrder", () => {
  it("keeps items, fees and the subtracted offer discount (Instamart)", () => {
    const o = normalizeOrder(INSTAMART);
    expect(o.orderId).toBe("249970716902473");
    expect(o.items).toHaveLength(6);
    expect(o.items[4]).toMatchObject({ qty: 3, lineTotal: 45 });
    expect(o.fees.map((f) => f.amount)).toEqual([16, 6.01]);
    expect(o.discounts).toEqual([{ label: "Offer Discount", amount: 16 }]);
    expect(o.itemCount).toBe(8);
  });

  it("drops FREE fees and the Blinkit 'Product discount' row", () => {
    const o = normalizeOrder(BLINKIT);
    expect(o.fees).toEqual([{ kind: "handling", label: "Handling charge", amount: 9 }]);
    expect(o.discounts).toEqual([]);
    expect(o.items[0]).toMatchObject({ qty: 2, lineTotal: 34, mrp: 40 });
  });

  it("keeps usable rows when the model returns junk ones", () => {
    const o = normalizeOrder({
      platform: "Zepto",
      items: [{ name: "", lineTotal: 10 }, { name: "Matchbox", short: " Matches ", lineTotal: "₹10" }, { name: "Mop", lineTotal: null }],
      grandTotal: "₹10",
      confidence: "weird",
    });
    expect(o.platform).toBe("zepto");
    expect(o.items).toEqual([{ name: "Matchbox", short: "matches", variant: null, qty: 1, lineTotal: 10, mrp: null }]);
    expect(o.page.hasTotal).toBe(true);
    expect(o.confidence).toBe("medium");
  });

  it("survives a completely empty answer", () => {
    const o = normalizeOrder(null);
    expect(o.items).toEqual([]);
    expect(checkTotals(o).status).toBe("no_items");
  });
});

describe("checkTotals", () => {
  it("Instamart adds up within rounding (203 + 16 + 6.01 − 16 = 209.01 vs 209)", () => {
    const t = checkTotals(normalizeOrder(INSTAMART));
    expect(t.status).toBe("ok");
    expect(t.itemsMatchPrinted).toBe(true);
    expect(t.difference).toBe(-0.01);
  });

  it("Blinkit adds up once the product discount is not double-counted", () => {
    const t = checkTotals(normalizeOrder(BLINKIT));
    expect(t.status).toBe("ok");
    expect(t.computedTotal).toBe(258);
  });

  it("a single Zepto shipment tab does NOT reconcile to the whole-order total", () => {
    const t = checkTotals(normalizeOrder(ZEPTO_SHIPMENT_TAB));
    expect(t.itemsTotal).toBe(700);
    expect(t.status).toBe("mismatch");
    expect(t.difference).toBe(712); // the missing shipment-1 mop
    expect(t.itemsMatchPrinted).toBe(false);
  });

  it("no grand total visible → no_total, not a failure", () => {
    const t = checkTotals(normalizeOrder({ ...BLINKIT, grandTotal: null, itemTotal: null, page: { hasHeader: true, hasTotal: false } }));
    expect(t.status).toBe("no_total");
    expect(t.itemsMatchPrinted).toBeNull();
  });
});

describe("parseModelJson", () => {
  it("reads plain, fenced and <think>-prefixed answers", () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('<think>hmm {not json}</think>\n{"a":1}')).toEqual({ a: 1 });
    expect(parseModelJson('Here you go: {"a":1} hope that helps')).toEqual({ a: 1 });
  });
  it("returns undefined for non-JSON", () => {
    expect(parseModelJson("")).toBeUndefined();
    expect(parseModelJson("sorry, I can't read this")).toBeUndefined();
  });
});

describe("receipts and payments", () => {
  it("reads a restaurant bill: taxes, service charge, a round-off that lowers the bill", () => {
    const o = normalizeOrder({
      kind: "receipt", merchant: "Café Mocha", category: "Food", platform: "other",
      items: [
        { name: "Paneer Butter Masala", short: "paneer curry", qty: 1, lineTotal: 320 },
        { name: "Butter Naan", qty: 4, lineTotal: 240 },
        { name: "Cold Coffee", qty: 2, lineTotal: 300 },
      ],
      fees: [
        { kind: "tax", label: "CGST 2.5%", amount: 21.5 },
        { kind: "tax", label: "SGST 2.5%", amount: 21.5 },
        { kind: "service", label: "Service Charge 5%", amount: 43 },
        { kind: "round_off", label: "Round Off", amount: -0.4 },
      ],
      itemTotal: 860, grandTotal: 945.6,
    });
    expect(o.kind).toBe("receipt");
    expect(o.merchant).toBe("Café Mocha");
    expect(o.category).toBe("Food");
    expect(o.fees.map((f) => f.kind)).toEqual(["tax", "tax", "service"]);
    expect(o.discounts).toEqual([{ label: "Round Off", amount: 0.4 }]);
    expect(checkTotals(o).status).toBe("ok");
  });

  it("reads a UPI payment as one amount with a payee", () => {
    const o = normalizeOrder({ kind: "payment", payee: "Ramesh Kirana Store", payApp: "Google Pay", orderId: "UPI 4210 9988 7712", grandTotal: "₹540", category: "groceries", items: [] });
    expect(o).toMatchObject({ kind: "payment", payee: "Ramesh Kirana Store", payApp: "Google Pay", grandTotal: 540, category: "Groceries", items: [] });
  });

  it("calls an item-less total a payment even if the model didn't", () => {
    expect(normalizeOrder({ grandTotal: 210, merchant: "Uber" }).kind).toBe("payment");
  });
});

describe("decimal slips (Instamart '₹29.0' read as 290)", () => {
  // The real Instamart order: Item Bill ₹444, fees ₹30, offer −₹18, grand total ₹456.
  const raw = {
    kind: "order", platform: "instamart", itemTotal: 444, grandTotal: 456,
    items: [
      { name: "English Oven Premium White Bread", lineTotal: 35 },
      { name: "Custard Apple (Sitaphal)", lineTotal: 96 },
      { name: "Premium Robusta Banana (Kela)", lineTotal: 290 },
      { name: "Amul Processed Cheese Slices", lineTotal: 82 },
      { name: "Coriander Leaves", lineTotal: 90 },
      { name: "Indian Tomato (Tamatar)", lineTotal: 30 },
      { name: "NOICE Fresh Malai Paneer (Handmade Daily)", lineTotal: 990 },
      { name: "Everest Tikhalal Hot & Red Chilli Powder", lineTotal: 64 },
    ],
    fees: [{ kind: "delivery", label: "Delivery Fee", amount: 18 }, { kind: "handling", label: "Handling Fee", amount: 12 }],
    discounts: [{ label: "Offer Discount", amount: 18 }],
  };

  it("fixes exactly the slipped prices so the bill adds up", () => {
    const o = normalizeOrder(raw);
    expect(o.items.map((i) => i.lineTotal)).toEqual([35, 96, 29, 82, 9, 30, 99, 64]);
    expect(checkTotals(o).status).toBe("ok");
    expect(o.uncertain.some((u) => u.includes("Premium Robusta Banana") && u.includes("fixed to 29"))).toBe(true);
  });

  it("works from the grand total when no item total was read", () => {
    const o = normalizeOrder({ ...raw, itemTotal: null });
    expect(o.items.reduce((a, i) => a + i.lineTotal, 0)).toBe(444);
  });

  it("leaves prices alone when no single fix makes it add up", () => {
    const items = [{ name: "A", short: null, variant: null, qty: 1, lineTotal: 200, mrp: null }, { name: "B", short: null, variant: null, qty: 1, lineTotal: 50, mrp: null }];
    expect(fixDecimalSlips(items, 100)).toEqual([]);
    expect(items[0].lineTotal).toBe(200);
  });

  it("leaves a bill that already adds up alone", () => {
    const items = [{ name: "A", short: null, variant: null, qty: 1, lineTotal: 290, mrp: null }];
    expect(fixDecimalSlips(items, 290)).toEqual([]);
  });
});
