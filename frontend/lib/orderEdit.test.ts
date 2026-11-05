import { describe, expect, it } from "vitest";
import { draftFromExpense, toExpenseBody } from "./orderImport";

const saved = {
  amount: "214.00",
  payers: [{ userId: "d" }],
  receiptData: {
    source: "order_import", platform: "blinkit", orderId: "ORD1", orderKey: "blinkit:ORD1", orderDate: "2026-11-05", billTotal: 214,
    items: [
      { name: "Amul Milk", short: "milk", variant: "1 L", qty: 2, lineTotal: 140, sharedBy: ["d", "a"] },
      { name: "Chips", qty: 1, lineTotal: 60, sharedBy: ["a"], visible: true },
    ],
    fees: [{ label: "Delivery", amount: 30 }],
    discounts: [{ label: "Coupon", amount: 16 }],
    feePolicy: "equal",
  },
};

describe("editing an imported order", () => {
  it("round-trips through the item editor without losing anything", () => {
    const d = draftFromExpense(saved)!;
    expect(d.payerId).toBe("d");
    expect(d.items).toHaveLength(2);
    const body = toExpenseBody(d);
    expect(body.amount).toBe(214);
    expect(body.receiptData.items).toEqual([
      { name: "Amul Milk", short: "milk", variant: "1 L", qty: 2, lineTotal: 140, sharedBy: ["d", "a"] },
      { name: "Chips", visible: true, variant: null, qty: 1, lineTotal: 60, sharedBy: ["a"] },
    ]);
    expect(body.receiptData.fees).toEqual([{ label: "Delivery", amount: 30 }]);
    expect(body.receiptData.discounts).toEqual([{ label: "Coupon", amount: 16 }]);
    expect(body.receiptData.feePolicy).toBe("equal");
    expect(body.receiptData.orderKey).toBe("blinkit:ORD1");
  });
  it("refuses bills with items hidden from this viewer, and other kinds", () => {
    expect(draftFromExpense({ ...saved, receiptData: { ...saved.receiptData, items: [{ name: null, lineTotal: 5, sharedBy: ["x"], masked: true }] } })).toBeNull();
    expect(draftFromExpense({ ...saved, receiptData: [{ id: "1", label: "x", amount: "5", sharedBy: [] }] })).toBeNull();
  });
});
