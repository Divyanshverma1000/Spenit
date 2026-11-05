/**
 * Joining real order screenshots (12 screenshots, 8 orders) in the order the user picked
 * them. Numbers are copied from the screenshots; each fixture is what the vision model
 * should return for that one image.
 *
 * Run from backend/: npm run test:frontend
 */
import { describe, it, expect } from "vitest";
import { draftTotals, itemCountCheck, joinPieces, type ExtractedOrder, type Piece } from "./orderImport";

type Row = [name: string, lineTotal: number, qty?: number];
const order = (o: Partial<ExtractedOrder> & { rows: Row[] }): ExtractedOrder => ({
  platform: "other", orderId: null, orderDate: null, itemCount: null, fees: [], discounts: [],
  itemTotal: null, grandTotal: null, page: { hasHeader: false, hasTotal: false }, confidence: "high", uncertain: [],
  ...o,
  items: o.rows.map(([name, lineTotal, qty = 1]) => ({ name, variant: null, qty, lineTotal, mrp: null })),
});
const fee = (label: string, amount: number) => ({ kind: "other", label, amount });

const HEADER = { hasHeader: true, hasTotal: false };
const TOTAL = { hasHeader: false, hasTotal: true };
const BOTH = { hasHeader: true, hasTotal: true };
const NONE = { hasHeader: false, hasTotal: false };

// Zepto order UHISJNSOQ27227 (5 items, ₹1412)
const zeptoShipment2Tab = order({
  platform: "zepto", orderId: "UHISJNSOQ27227", itemCount: 5, itemTotal: 1412, grandTotal: 1412, page: BOTH,
  rows: [["Status Cotton Feel Double Geometric Bedsheet", 310], ["Joyo Plastics Pedal Bin 11.2 Ltr", 245], ["Happy Mail Matchbox", 10], ["Joyo Use Me Dust Bin 7 Ltr", 135]],
});
const zeptoOverview = order({
  platform: "zepto", orderId: "UHISJNSOQ27227", itemCount: 5, page: HEADER,
  rows: [["Cello Kleeno Compacto Spin Mop", 712], ["Status Cotton Feel Double Geometric Bedsheet", 310], ["Joyo Plastics Pedal Bin 11.2 Ltr", 245], ["Happy Mail Matchbox", 10], ["Joyo Use Me Dust Bin 7 Ltr", 135]],
});
// Zepto order TSOORNSOL54775 (6 items, ₹767)
const zeptoB_bottom = order({
  platform: "zepto", orderId: "TSOORNSOL54775", itemCount: 6, itemTotal: 767, grandTotal: 767, page: BOTH,
  rows: [["Proclean Double Hockey Toilet Brush", 110], ["Gebi Lovely Sink Brush", 63], ["Godrej Aer Lavender Bloom Power Pocket", 63]],
});
const zeptoB_top = order({
  platform: "zepto", orderId: "TSOORNSOL54775", itemCount: 6, page: HEADER,
  rows: [["Bahamas Men's Slippers", 234], ["Gala Double Lip Wiper", 227], ["Godrej Aer Sea Breeze Power Pocket", 70], ["Proclean Double Hockey Toilet Brush", 110], ["Gebi Lovely Sink Brush", 63], ["Godrej Aer Lavender Bloom Power Pocket", 63]],
});
// Instamart — single screenshots with full bills
const insta1 = order({
  platform: "instamart", orderId: "249970716902473", itemCount: 8, itemTotal: 203, grandTotal: 209, page: BOTH,
  fees: [fee("Delivery Fee", 16), fee("Handling Fee", 6.01)], discounts: [{ label: "Offer Discount", amount: 16 }],
  rows: [["Fortune Sugar", 77], ["Bournvita Pouch", 30], ["Amul Taaza Milky Milk", 30], ["NOICE Fresh Lime Soda", 1], ["MAGGI 2-Minute Noodles", 45, 3], ["MAGGI Double Masala Noodles", 20]],
});
const insta2 = order({
  platform: "instamart", orderId: "252073643954700", itemCount: 8, itemTotal: 683, grandTotal: 691, page: BOTH,
  fees: [fee("Delivery Fee", 16), fee("Handling Fee", 7.98)], discounts: [{ label: "Offer Discount", amount: 16 }],
  rows: [["Dettol Dish Gel Refill", 228], ["Indian Tomato", 27], ["Cosco Shuttlecocks", 253], ["Robusta Banana", 34], ["Organic Lady's Finger", 24], ["[Combo] Green Chilli", 34], ["[Combo] Organic Lady's Finger", 46], ["[Combo] Mint & Coriander", 37]],
});
const insta3 = order({
  platform: "instamart", orderId: "252597032918452", itemCount: 3, itemTotal: 553, grandTotal: 565, page: BOTH,
  fees: [fee("Delivery Fee", 18), fee("Handling Fee", 12)], discounts: [{ label: "Offer Discount", amount: 18 }],
  rows: [["Supreme Harvest Pistachio", 375], ["Awsum Carrot Walnut Cake", 29], ["Ambrane Mobile Holder", 149]],
});
// Blinkit 13-item order in THREE screenshots; only the bottom one shows the order id.
const blinkitBottom = order({
  platform: "blinkit", orderId: "ORD41691704471", itemTotal: 605, grandTotal: 614, page: TOTAL, fees: [fee("Handling charge", 9)],
  rows: [["Amul Moti Toned Milk", 33], ["Maggi Magic Cubes", 35], ["Organically Grown Cabbage", 42], ["Table White Eggs (6 pcs)", 60]],
});
const blinkitMiddle = order({
  platform: "blinkit", page: NONE,
  rows: [["Catch Chole Masala", 77], ["Spring Onion", 32], ["French Beans - 250 g", 32], ["Amul Moti Toned Milk", 33], ["Maggi Magic Cubes", 35], ["Organically Grown Cabbage", 42], ["Table White Eggs (6 pcs)", 60]],
});
const blinkitTop = order({
  platform: "blinkit", itemCount: 13, page: HEADER,
  rows: [["Orange Carrot", 21], ["Lemon", 58], ["Tata Sampann Rajma", 84], ["Mother Dairy Buttermilk", 40, 4], ["Kabuli Chana", 55], ["Ginger", 36], ["Catch Chole Masala", 77], ["Spring Onion", 32]],
});
// Blinkit single screenshots
const blinkit7 = order({
  platform: "blinkit", itemCount: 7, page: HEADER,
  rows: [["Tata Salt", 32], ["Catch Chaat Masala", 75], ["Catch Black Pepper", 85], ["Lemon", 54], ["Hommade Chatpati Chutney", 68], ["Nature Good White Eggs (30)", 268], ["Bikaji Sev Bhujia", 93]],
});
const blinkit4 = order({
  platform: "blinkit", itemCount: 4, itemTotal: 249, grandTotal: 258, page: BOTH, fees: [fee("Handling charge", 9)],
  rows: [["Green Chilli", 34, 2], ["Amul Fresh Malai Paneer", 95], ["Desi Tomato - Pack of 2", 77], ["Potato Pack of 2", 43]],
});

// The exact pick order the user used.
const PICKED = [
  zeptoShipment2Tab, zeptoOverview, zeptoB_bottom, zeptoB_top, insta1, insta2, insta3,
  blinkitBottom, blinkitMiddle, blinkitTop, blinkit7, blinkit4,
];
const pieces = (orders: ExtractedOrder[]): Piece[] => orders.map((o, index) => ({ index, order: o }));

describe("joinPieces on the real screenshots", () => {
  const joined = joinPieces(pieces(PICKED));

  it("finds 8 orders in 12 screenshots", () => {
    expect(joined).toHaveLength(8);
  });

  it("every order adds up to its bill, or honestly has no bill", () => {
    for (const j of joined) {
      const t = draftTotals(j.order);
      if (j.order.grandTotal !== null) expect({ id: j.order.orderId, s: t.status }).toEqual({ id: j.order.orderId, s: "ok" });
    }
    expect(joined.filter((j) => draftTotals(j.order).status === "no_total")).toHaveLength(1); // Blinkit 7-item
  });

  it("Zepto: the shipment tab and the overview repeat rows — counted once (5 items, ₹1412)", () => {
    const z = joined.find((j) => j.order.orderId === "UHISJNSOQ27227")!;
    expect(z.sources).toEqual([0, 1]);
    expect(z.order.items).toHaveLength(5);
    expect(draftTotals(z.order).itemsTotal).toBe(1412);
    expect(itemCountCheck(z.order)).toEqual({ printed: 5, ok: true });
  });

  it("Zepto: two overlapping screenshots → 6 items, ₹767", () => {
    const z = joined.find((j) => j.order.orderId === "TSOORNSOL54775")!;
    expect(z.order.items).toHaveLength(6);
    expect(draftTotals(z.order)).toMatchObject({ itemsTotal: 767, status: "ok" });
  });

  it("Blinkit: bottom, middle and top picked in REVERSE order still join → 13 items, ₹614", () => {
    const b = joined.find((j) => j.order.orderId === "ORD41691704471")!;
    expect(b.sources).toEqual([7, 8, 9]);
    expect(b.order.items).toHaveLength(13);
    expect(b.order.items[0].name).toBe("Orange Carrot"); // the top screenshot leads
    expect(draftTotals(b.order)).toMatchObject({ itemsTotal: 605, computed: 614, status: "ok" });
    expect(itemCountCheck(b.order)).toEqual({ printed: 13, ok: true });
  });

  it("Instamart counts units, not rows (8 items = 6 rows incl. 3 x Maggi)", () => {
    const i = joined.find((j) => j.order.orderId === "249970716902473")!;
    expect(itemCountCheck(i.order)).toEqual({ printed: 8, ok: true });
  });

  it("same item at a different price never joins two orders (Lemon ₹58 vs ₹54)", () => {
    const seven = joined.find((j) => j.order.items.some((it) => it.name === "Tata Salt"))!;
    expect(seven.sources).toEqual([10]);
  });

  it("pick order does not matter", () => {
    const shuffled = [...PICKED].reverse();
    expect(joinPieces(pieces(shuffled))).toHaveLength(8);
  });

  it("two different order tops that share an item stay separate", () => {
    const a = order({ platform: "blinkit", page: HEADER, itemCount: 2, rows: [["Milk", 33], ["Bread", 40]] });
    const b = order({ platform: "blinkit", page: HEADER, itemCount: 2, rows: [["Milk", 33], ["Eggs", 60]] });
    expect(joinPieces(pieces([a, b]))).toHaveLength(2);
  });
});
