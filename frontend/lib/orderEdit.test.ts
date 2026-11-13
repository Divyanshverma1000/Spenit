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

describe("order name", () => {
  it("keeps the saved name when editing, and uses a typed one", () => {
    const d = draftFromExpense({ ...saved, description: "Weekly veggies" })!;
    expect(toExpenseBody(d).description).toBe("Weekly veggies");
    expect(toExpenseBody({ ...d, title: "  " }).description).toBe("Blinkit · 5 Nov order");
  });
});

import { toDraft, matchMember, isReady } from "./orderImport";

describe("receipts and payments in the sorter", () => {
  const members = [{ id: "me", name: "Divyansh Verma" }, { id: "s", name: "Suryansh" }, { id: "a", name: "Ankit" }];
  const base = { platform: "other" as const, orderId: null, orderDate: "2026-11-12", itemCount: null, fees: [], discounts: [], itemTotal: null, page: { hasHeader: true, hasTotal: true }, confidence: "high" as const, uncertain: [] };

  it("a UPI payment to a shop becomes one shared line titled by the payee", () => {
    const d = toDraft({ ...base, kind: "payment", payee: "Ramesh Kirana Store", category: "Groceries", items: [], grandTotal: 540 }, [0], "me", ["me", "s", "a"], members);
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({ name: "Ramesh Kirana Store", lineTotal: 540, sharedBy: ["me", "s", "a"] });
    expect(d.settleWith).toBeNull();
    const body = toExpenseBody(d);
    expect(body.description).toBe("Ramesh Kirana Store · 12 Nov");
    expect(body.category).toBe("Groceries");
    expect(body.receiptData.kind).toBe("payment");
  });

  it("money sent to someone in the group is offered as paying them back", () => {
    const d = toDraft({ ...base, kind: "payment", payee: "SURYANSH KUMAR", items: [], grandTotal: 500 }, [0], "me", ["me", "s", "a"], members);
    expect(d.payeeMember).toBe("s");
    expect(d.settleWith).toBe("s");
    expect(isReady(d)).toBe(true);
  });

  it("never matches yourself or an unclear name", () => {
    expect(matchMember("Divyansh V", members, "me")).toBeNull();
    expect(matchMember("Kumar Stores", members, "me")).toBeNull();
  });

  it("a printed bill keeps its shop name and taxes", () => {
    const d = toDraft({ ...base, kind: "receipt", merchant: "Café Mocha", category: "Food", items: [{ name: "Cold Coffee", variant: null, qty: 2, lineTotal: 300, mrp: null }], fees: [{ kind: "tax", label: "CGST 2.5%", amount: 7.5 }], grandTotal: 307.5 }, [0], "me", ["me", "s"], members);
    const body = toExpenseBody(d);
    expect(body.description).toBe("Café Mocha · 12 Nov");
    expect(body.category).toBe("Food");
    expect(body.amount).toBe(307.5);
  });
});
