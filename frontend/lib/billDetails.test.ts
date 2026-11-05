import { describe, expect, it } from "vitest";
import { myPart, readBill } from "./billDetails";

const receipt = {
  source: "order_import",
  platform: "blinkit",
  orderId: "123",
  items: [
    { name: "Milk", lineTotal: 60, sharedBy: ["a", "b", "c"] },
    { name: null, variant: null, qty: null, lineTotal: 199, sharedBy: ["b"], masked: true },
    { name: "Cola", lineTotal: 40, sharedBy: ["a"], visible: true },
  ],
  fees: [{ label: "Delivery", amount: 30 }, { label: "", amount: 0 }],
  discounts: [{ label: "Coupon", amount: 10 }],
  feePolicy: "proportional",
};

describe("readBill", () => {
  it("reads an imported order", () => {
    const b = readBill(receipt)!;
    expect(b.items).toHaveLength(3);
    expect(b.items[1]).toMatchObject({ index: 1, name: null, masked: true, owner: "b" });
    expect(b.items[0].owner).toBe(null);
    expect(b.items[2]).toMatchObject({ owner: "a", visible: true });
    expect(b.fees).toEqual([{ label: "Delivery", amount: 30 }]);
    expect(b.itemsTotal).toBe(299);
    expect(b.extras).toBe(20);
  });
  it("ignores other expense kinds", () => {
    expect(readBill(null)).toBe(null);
    expect(readBill([{ id: "1", label: "x", amount: "5", sharedBy: ["a"] }])).toBe(null);
    expect(readBill({ items: [] })).toBe(null);
  });
});

describe("myPart", () => {
  it("lists my items and puts the rest of my share under fees", () => {
    const p = myPart(readBill(receipt)!, "a", 62.08);
    expect(p.items.map((i) => i.mine)).toEqual([20, 40]);
    expect(p.itemsTotal).toBe(60);
    expect(p.extras).toBe(2.08);
  });
});

import { billSummary, shortLabel } from "./billDetails";

describe("billSummary", () => {
  it("names the priciest things first and counts the rest", () => {
    const r = {
      items: [
        { name: "Harvest Gold White Bread 400 g", lineTotal: 45, sharedBy: ["a", "b"] },
        { name: "Amul Taaza Toned Milk", short: "milk", lineTotal: 68, sharedBy: ["a", "b"] },
        { name: "Lay's India's Magic Masala Potato Chips (52 g)", lineTotal: 20, sharedBy: ["a"] },
        { name: "Amul Gold Milk", short: "milk", lineTotal: 34, sharedBy: ["b"] },
        { name: null, lineTotal: 199, sharedBy: ["b"], masked: true },
      ],
    };
    expect(billSummary(r)).toBe("Milk, white bread, potato chips +2");
  });
  it("never leaks private items", () => {
    expect(billSummary({ items: [{ name: null, lineTotal: 9, sharedBy: ["b"], masked: true }] })).toBe("1 private item");
  });
  it("guesses a label from the name", () => {
    expect(shortLabel({ name: "Dove Hair Fall Rescue Shampoo 340 ml" })).toBe("rescue shampoo");
    expect(shortLabel({ name: "Coca-Cola 750 ml", short: "cola" })).toBe("cola");
  });
});
