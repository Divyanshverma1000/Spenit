import { describe, expect, it } from "vitest";
import { buildPersonalContext } from "./personalAiContext";

const me = { id: "d", name: "Divyansh" };
const now = new Date("2026-11-06T12:00:00Z");

describe("buildPersonalContext", () => {
  const text = buildPersonalContext({
    me,
    budget: 15000,
    today: now,
    personal: [{ description: "Dosa breakfast", amount: 55, category: "Food", at: "2026-11-06T03:00:00Z" }],
    groupBills: [
      {
        description: "Blinkit order", groupName: "KPA6", category: "Groceries", at: "2026-11-05T10:00:00Z", total: 300, myShare: 100,
        receiptData: { items: [
          { name: "Amul Taaza Milk 1 L", short: "milk", lineTotal: 120, sharedBy: ["d", "s", "a"] },
          { name: "Chips", lineTotal: 60, sharedBy: ["s"] },
          { name: null, lineTotal: 90, sharedBy: ["d", "a"], masked: true },
        ] },
      },
      {
        description: "Zepto order", groupName: "KPA6", category: "Groceries", at: "2026-10-20T10:00:00Z", total: 80, myShare: 40,
        receiptData: { items: [{ name: "Amul Gold Milk", short: "milk", lineTotal: 80, sharedBy: ["d", "s"] }] },
      },
    ],
  });

  it("answers item questions from group bills: your part only", () => {
    expect(text).toContain("- milk: ₹40.00 · ₹80.00 · 2x · Blinkit order (KPA6), Zepto order (KPA6)");
    expect(text).not.toContain("chips:"); // you weren't sharing the chips
  });
  it("counts own entries and group shares per month", () => {
    expect(text).toContain("- 2026-11: ₹155.00 (own ₹55.00, group shares ₹100.00)");
    expect(text).toContain("- 2026-10: ₹40.00 (own ₹0.00, group shares ₹40.00)");
    expect(text).toContain("MONTHLY BUDGET: ₹15000.00");
  });
  it("maps everyday words to categories and never names private items", () => {
    expect(text).toContain("Shopping: shopping, fashion");
    expect(text).toContain("other people's private items you shared: ₹45.00");
    expect(text).not.toMatch(/null/);
  });
});
