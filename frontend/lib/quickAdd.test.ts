import { describe, expect, it } from "vitest";
import { guessCategory, parseQuickAdd } from "./quickAdd";

const thu = new Date("2026-11-05T10:00:00"); // a Thursday

describe("parseQuickAdd", () => {
  it("reads name and amount in any order", () => {
    expect(parseQuickAdd("chai 20", thu)).toEqual({ description: "Chai", amount: 20, category: "Food", daysAgo: 0 });
    expect(parseQuickAdd("20 chai", thu)).toEqual({ description: "Chai", amount: 20, category: "Food", daysAgo: 0 });
  });
  it("understands rupee signs, commas, k and decimals", () => {
    expect(parseQuickAdd("rent ₹12,000", thu)?.amount).toBe(12000);
    expect(parseQuickAdd("rent 12000", thu)?.category).toBe("Stay");
    expect(parseQuickAdd("shoes 1.5k", thu)).toMatchObject({ amount: 1500, category: "Shopping" });
    expect(parseQuickAdd("medicines 340.50 rs", thu)).toMatchObject({ amount: 340.5, category: "Medical" });
  });
  it("understands when", () => {
    expect(parseQuickAdd("uber 340 yesterday", thu)).toMatchObject({ description: "Uber", amount: 340, category: "Travel", daysAgo: 1 });
    expect(parseQuickAdd("movie 300 monday", thu)).toMatchObject({ daysAgo: 3, category: "Entertainment" });
    expect(parseQuickAdd("lunch 150 thursday", thu)?.daysAgo).toBe(7);
  });
  it("needs an amount", () => {
    expect(parseQuickAdd("chai", thu)).toBeNull();
    expect(parseQuickAdd("", thu)).toBeNull();
    expect(parseQuickAdd("chai 0", thu)).toBeNull();
  });
  it("names a bare amount", () => {
    expect(parseQuickAdd("250", thu)).toEqual({ description: "Expense", amount: 250, category: "Misc", daysAgo: 0 });
  });
});

describe("guessCategory", () => {
  it("knows common Indian spends", () => {
    expect(guessCategory("Blinkit order")).toBe("Groceries");
    expect(guessCategory("Petrol fill")).toBe("Fuel");
    expect(guessCategory("Jio recharge")).toBe("Utilities");
    expect(guessCategory("Something new")).toBe("Misc");
  });
});
