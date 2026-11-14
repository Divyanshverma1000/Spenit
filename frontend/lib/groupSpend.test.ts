import { describe, expect, it } from "vitest";
import { billSpend, groupSpend, personalOwner, shortINR } from "./groupSpend";

const bill = (amount: number, split: Record<string, number>, payer = "a", receiptData?: unknown) => ({
  id: Math.random().toString(36),
  amount: String(amount),
  receiptData,
  payers: [{ userId: payer, amountPaid: String(amount) }],
  splits: Object.entries(split).map(([userId, v]) => ({ userId, name: userId.toUpperCase(), shareAmount: String(v) })),
});

describe("groupSpend", () => {
  // a trip of 4: a, b, c, d
  const dinner = bill(4000, { a: 1000, b: 1000, c: 1000, d: 1000 });
  const shopping = bill(15000, { a: 7500, b: 7500 });
  const myJacket = bill(3000, { a: 3000 });

  it("tells whole-group, some-of-you and personal money apart", () => {
    const s = groupSpend([dinner, shopping, myJacket], 4, "a");
    expect(s.total).toBe(22000);
    expect(s.everyone).toBe(4000);
    expect(s.some).toBe(15000);
    expect(s.personal).toBe(3000);
    expect(s.bills).toEqual({ everyone: 1, some: 1, personal: 1 });
    expect(s.me).toEqual({ paid: 22000, share: 11500 });
  });

  it("counts an imported order item by item, with fees following the items", () => {
    const order = bill(330, { a: 230, b: 50, c: 50 }, "a", {
      items: [
        { name: "Shampoo", lineTotal: 200, sharedBy: ["a"] },
        { name: "Bread", lineTotal: 100, sharedBy: ["a", "b", "c"] },
      ],
    });
    // 300 of items, 330 paid (₹30 fees): personal 220, shared by some 110
    expect(billSpend(order, 4)).toEqual({ everyone: 0, some: 110, personal: 220 });
    expect(personalOwner(order)).toBeNull();
  });

  it("knows a bill that's one person's own", () => {
    expect(personalOwner(myJacket)).toEqual({ userId: "a", name: "A" });
    expect(personalOwner(dinner)).toBeNull();
  });

  it("writes amounts short", () => {
    expect(shortINR(50000)).toBe("₹50k");
    expect(shortINR(8400)).toBe("₹8.4k");
    expect(shortINR(123456)).toBe("₹1.2L");
    expect(shortINR(950)).toBe("₹950");
  });
});
