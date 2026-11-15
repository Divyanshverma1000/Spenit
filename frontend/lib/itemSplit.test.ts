import { describe, expect, it } from "vitest";
import { splitWithItems } from "./itemSplit";

const item = (amount: string, sharedBy: string[], label = "x") => ({ id: label + amount, label, amount, sharedBy });

describe("splitWithItems", () => {
  it("takes the items off first and splits the rest equally", () => {
    const s = splitWithItems(5600, [item("150", ["s"], "ice cream"), item("120", ["me"], "gulab jamun")], ["me", "s", "a"]);
    expect(s.itemsTotal).toBe(270);
    expect(s.rest).toBe(5330);
    expect(s.shares).toEqual({ me: 1896.67, s: 1926.67, a: 1776.66 });
    expect(Object.values(s.shares).reduce((a, b) => a + b, 0)).toBeCloseTo(5600, 5);
  });

  it("an item shared by two is split between just those two", () => {
    const s = splitWithItems(3000, [item("1200", ["me", "s"], "heater")], ["me", "s", "a"]);
    expect(s.shares).toEqual({ me: 1200, s: 1200, a: 600 });
  });

  it("someone can owe only for their item, without a slice of the rest", () => {
    const s = splitWithItems(1000, [item("100", ["guest"])], ["me", "a"]);
    expect(s.shares).toEqual({ guest: 100, me: 450, a: 450 });
  });

  it("items nobody is picked for stay in the rest, and are counted", () => {
    const s = splitWithItems(900, [item("300", [])], ["me", "s", "a"]);
    expect(s.unassigned).toBe(1);
    expect(s.shares).toEqual({ me: 300, s: 300, a: 300 });
  });

  it("flags items that cost more than the bill", () => {
    const s = splitWithItems(100, [item("150", ["me"])], ["me", "s"]);
    expect(s.over).toBe(true);
    expect(s.rest).toBe(0);
  });
});
