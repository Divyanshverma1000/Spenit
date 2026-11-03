import { describe, it, expect } from "vitest";
import { normalizeOrder, groundOrder, checkTotals, numbersInText, needsVisionBackup, toMoney } from "./orderExtract";

const OCR = `blinkit
Order ID: ORD12345678
Delivered on 2 Nov 2026
Amul Taaza Toned Milk | 1 L | 2 x | ₹54
Pintola Peanut Butter Crunchy | 1 kg | %349 ₹399
Maggi Masala Noodles | 4 x 70 g | 256
Item total | ₹459
Handling charge | ₹9
Delivery charge | FREE ₹0
Coupon discount | -₹20
Grand total | ₹448`;

const AI_JSON = {
  platform: "Blinkit",
  orderId: "ORD12345678",
  orderDate: "2026-11-02",
  items: [
    { name: "Amul Taaza Toned Milk", variant: "1 L", qty: 2, unitPrice: 27, lineTotal: 54 },
    { name: "Pintola Peanut Butter Crunchy", variant: "1 kg", qty: 1, unitPrice: 349, lineTotal: 349 },
    { name: "Maggi Masala Noodles", variant: "4 x 70 g", qty: 1, unitPrice: null, lineTotal: "₹56" },
    { name: "", lineTotal: 10 },
  ],
  fees: [
    { kind: "handling", label: "Handling charge", amount: 9 },
    { kind: "delivery", label: "Delivery charge", amount: 0 },
  ],
  discounts: [{ label: "Coupon discount", amount: 20 }],
  grandTotal: 448,
  page: { hasHeader: true, hasTotal: true },
};

describe("toMoney", () => {
  it("parses printed prices", () => {
    expect(toMoney("₹1,284.00")).toBe(1284);
    expect(toMoney("Rs. 54")).toBe(54);
    expect(toMoney(-20)).toBe(20);
    expect(toMoney("FREE")).toBeNull();
  });
});

describe("numbersInText", () => {
  it("accepts a rupee sign misread as a leading digit", () => {
    const n = numbersInText("Maggi 256");
    expect(n.has(256)).toBe(true);
    expect(n.has(56)).toBe(true);
  });
});

describe("normalizeOrder", () => {
  it("cleans the model output", () => {
    const o = normalizeOrder(AI_JSON);
    expect(o.platform).toBe("blinkit");
    expect(o.items).toHaveLength(3); // nameless row dropped
    expect(o.items[2].lineTotal).toBe(56);
    expect(o.fees).toHaveLength(1); // free delivery dropped
    expect(o.orderDate).toBe("2026-11-02");
  });

  it("fills lineTotal from qty × unitPrice", () => {
    const o = normalizeOrder({ items: [{ name: "Eggs", qty: 2, unitPrice: 45 }] });
    expect(o.items[0].lineTotal).toBe(90);
  });
});

describe("groundOrder", () => {
  it("passes numbers that appear in the OCR text", () => {
    const o = normalizeOrder(AI_JSON);
    expect(groundOrder(o, OCR)).toBe(1);
  });

  it("flags invented numbers", () => {
    const o = normalizeOrder({ ...AI_JSON, items: [{ name: "Ghee", qty: 1, lineTotal: 612 }] });
    groundOrder(o, OCR);
    expect(o.items[0].grounded).toBe(false);
  });
});

describe("grounding against real Tesseract output", () => {
  // Actual rows produced by lib/ocr.ts on a synthetic Blinkit screenshot: ₹ read as 3 or %.
  const REAL_OCR = `Order ID: ORD47219834512
Amul Taaza Toned Fresh Milk | 354
1L-2x
Pintola All Natural Peanut Butter | 3349
Maggi 2-Minute Masala Noodles | 56
Farm Fresh Eggs (6 pcs) | 48
Item total | 507
Handling charge | 39
Delivery charge | FREE
Coupon discount | -%20
Grand total | 496`;

  it("accepts the true prices behind a misread rupee sign", () => {
    const o = normalizeOrder({
      items: [
        { name: "Amul Taaza Toned Fresh Milk", qty: 2, lineTotal: 54 },
        { name: "Pintola All Natural Peanut Butter", qty: 1, lineTotal: 349 },
        { name: "Maggi 2-Minute Masala Noodles", qty: 1, lineTotal: 56 },
        { name: "Farm Fresh Eggs", qty: 1, lineTotal: 48 },
      ],
      fees: [{ kind: "handling", label: "Handling charge", amount: 9 }],
      discounts: [{ label: "Coupon discount", amount: 20 }],
      grandTotal: 496,
    });
    expect(groundOrder(o, REAL_OCR)).toBe(1);
    expect(checkTotals(o).status).toBe("ok");
  });
});

describe("checkTotals", () => {
  it("adds up", () => {
    const t = checkTotals(normalizeOrder(AI_JSON));
    expect(t.status).toBe("ok");
    expect(t.computedTotal).toBe(448);
  });

  it("reports the difference", () => {
    const t = checkTotals(normalizeOrder({ ...AI_JSON, grandTotal: 500 }));
    expect(t.status).toBe("mismatch");
    expect(t.difference).toBe(52);
  });

  it("knows when the total is missing", () => {
    expect(checkTotals(normalizeOrder({ ...AI_JSON, grandTotal: null })).status).toBe("no_total");
  });
});

describe("needsVisionBackup", () => {
  it("not for a clean screenshot", () => {
    const o = normalizeOrder(AI_JSON);
    expect(needsVisionBackup(o, groundOrder(o, OCR), 92)).toBe(false);
  });
  it("yes when nothing was found", () => {
    expect(needsVisionBackup(normalizeOrder({}), 0, 40)).toBe(true);
  });
});
