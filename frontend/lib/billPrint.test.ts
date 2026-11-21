import { describe, expect, it } from "vitest";
import { contentsHash, contentsText, seenWords, type SeenMatch } from "./billPrint";

const order = {
  platform: "blinkit", grandTotal: 214, orderDate: "2026-11-05",
  items: [{ name: "Amul Milk 500ml", lineTotal: 34 }, { name: "Bread", lineTotal: 50 }],
};

describe("contentsText", () => {
  it("is the same whatever order the items were read in", () => {
    expect(contentsText(order)).toBe(contentsText({ ...order, items: [...order.items].reverse() }));
  });
  it("ignores case and punctuation in names", () => {
    expect(contentsText(order)).toBe(contentsText({ ...order, items: [{ name: "amul milk, 500ML", lineTotal: 34 }, { name: "BREAD", lineTotal: 50 }] }));
  });
  it("changes with the price, the total or the shop", () => {
    const base = contentsText(order);
    expect(contentsText({ ...order, items: [{ name: "Bread", lineTotal: 55 }, order.items[0]] })).not.toBe(base);
    expect(contentsText({ ...order, grandTotal: 220 })).not.toBe(base);
    expect(contentsText({ ...order, platform: "zepto" })).not.toBe(base);
  });
  it("needs a name and date when there are no items", () => {
    expect(contentsText({ grandTotal: 500, items: [] })).toBeNull();
    expect(contentsText({ payee: "Ramesh Dhaba", grandTotal: 500, items: [] })).toBeNull();
    expect(contentsText({ payee: "Ramesh Dhaba", grandTotal: 500, orderDate: "2026-11-05", items: [] })).toBeTruthy();
  });
  it("hashes to a short hex print", async () => {
    expect(await contentsHash(order)).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe("seenWords", () => {
  const m: SeenMatch = {
    ref: "d1", how: "contents", place: "group", expenseId: "e1", groupId: "g2", groupName: "Goa trip", sameGroup: false,
    description: "Blinkit order", amount: 214, addedAt: "2026-11-05T09:30:00.000Z", addedBy: "Suryansh", addedByMe: false, orderDate: "2026-11-05",
  };
  it("says what, how much, when, who and where", () => {
    const w = seenWords(m, new Date("2026-11-21"));
    expect(w.title).toBe("Same items and total as an earlier bill");
    expect(w.detail).toContain("Blinkit order · ₹214 · ordered 5 Nov · added 5 Nov");
    expect(w.detail).toContain("by Suryansh in Goa trip");
    expect(w.hint).toContain("reorder");
  });
  it("says 'you' and 'this group' or 'your own spending'", () => {
    expect(seenWords({ ...m, addedByMe: true, sameGroup: true }).detail).toMatch(/by you in this group$/);
    expect(seenWords({ ...m, place: "personal", addedByMe: true }).detail).toMatch(/in your own spending$/);
  });
});
