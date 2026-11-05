import { describe, it, expect } from "vitest";
import { normalizeOrder, checkTotals, toMoney } from "./orderExtract";
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
