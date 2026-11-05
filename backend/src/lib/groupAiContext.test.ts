import { describe, expect, it } from "vitest";
import { buildGroupContext, itemKind } from "./groupAiContext";

const members = [
  { id: "d", name: "Divyansh" },
  { id: "s", name: "Suryansh", isPlaceholder: true },
  { id: "a", name: "Ankit" },
];
const order = {
  id: "e1",
  description: "Blinkit order",
  amount: "300.00",
  category: "Shopping",
  createdAt: "2026-11-05T09:00:00Z",
  createdBy: { id: "d", name: "Divyansh" },
  payers: [{ userId: "d", name: "Divyansh", amountPaid: "300.00" }],
  splits: [
    { userId: "d", name: "Divyansh", shareAmount: "100.00" },
    { userId: "s", name: "Suryansh", shareAmount: "150.00" },
    { userId: "a", name: "Ankit", shareAmount: "50.00" },
  ],
  receiptData: {
    items: [
      { name: "Amul Taaza Toned Milk 1 L", short: "milk", qty: 2, lineTotal: 120, sharedBy: ["d", "s", "a"] },
      { name: "Harvest Gold Bread", lineTotal: 30, sharedBy: ["d", "s", "a"] },
      { name: null, lineTotal: 150, sharedBy: ["s"], masked: true },
    ],
    fees: [{ label: "Delivery", amount: 0 }],
  },
};

describe("buildGroupContext", () => {
  const ctx = buildGroupContext({
    groupName: "KPA6",
    viewerId: "d",
    members,
    expenses: [order],
    settlements: [
      { amount: "50", status: "pending", createdAt: "2026-11-05T10:00:00Z", fromUser: { id: "a", name: "Ankit" }, toUser: { id: "d", name: "Divyansh" } },
    ],
    balance: {
      memberBalances: [
        { userId: "d", name: "Divyansh", signedAmount: "200.00" },
        { userId: "s", name: "Suryansh", signedAmount: "-150.00" },
        { userId: "a", name: "Ankit", signedAmount: "-50.00" },
      ],
      simplifiedTransfers: [
        { from: "s", to: "d", amount: "150.00", fromName: "Suryansh", toName: "Divyansh" },
        { from: "a", to: "d", amount: "50.00", fromName: "Ankit", toName: "Divyansh" },
      ],
    },
    today: new Date("2026-11-05T12:00:00Z"),
  });

  it("says who owes what and what is still due", () => {
    expect(ctx.text).toContain("Divyansh (you): should get back ₹200.00");
    expect(ctx.text).toContain("Suryansh: owes ₹150.00");
    expect(ctx.text).toContain("Suryansh pays Divyansh (you) ₹150.00");
  });
  it("explains pending payments", () => {
    expect(ctx.text).toContain("Ankit paid Divyansh (you) ₹50.00 · waiting for Divyansh (you) to confirm, NOT counted");
  });
  it("totals items by kind with my part", () => {
    expect(ctx.text).toContain("- milk: ₹120.00 · you ₹40.00 · 1x");
    expect(ctx.text).toContain("- gold bread: ₹30.00 · you ₹10.00 · 1x");
    expect(ctx.text).toContain("private items (only the person who had them can see what they were): ₹150.00 in 1 rows");
  });
  it("lists each bill with items, never naming private ones", () => {
    expect(ctx.text).toContain('[E1] 2026-11-05 "Blinkit order" ₹300.00');
    expect(ctx.text).toContain("private item ₹150.00 [Suryansh]");
    expect(ctx.refs).toEqual({ E1: "e1" });
  });
  it("keeps totals for bills cut from the list", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ ...order, id: `x${i}` }));
    const big = buildGroupContext({ groupName: "G", viewerId: "d", members, expenses: many, settlements: [], balance: null, budget: 3000 });
    expect(big.text).toContain("200 expenses, ₹60000.00 in all");
    expect(big.text).toMatch(/and \d+ older expenses not listed/);
    expect(big.text.length).toBeLessThan(12000);
  });
});

describe("itemKind", () => {
  it("prefers the model's short name", () => {
    expect(itemKind({ name: "Amul Milk", short: "Milk " })).toBe("milk");
    expect(itemKind({ name: "Lay's Magic Masala Potato Chips (52 g)" })).toBe("potato chips");
  });
});
