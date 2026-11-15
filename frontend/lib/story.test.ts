import { describe, expect, it } from "vitest";
import { dayTotals, fromServer, looksLikeStory, sharesOf, toExpenseBody, type StoryBill } from "./story";

const all = ["me", "s", "a"];
const bill = (b: Partial<StoryBill>): StoryBill => ({ key: "k", description: "x", amount: 0, category: "Misc", paidBy: "me", question: null, sharedBy: all, extras: [], quote: "", ...b });

// The mall day from the story
const day: StoryBill[] = [
  bill({ key: "1", description: "Leather Jacket", amount: 5500, sharedBy: ["me"] }),
  bill({ key: "2", description: "Heater", amount: 1200, paidBy: "s", sharedBy: ["s"] }),
  bill({ key: "3", description: "Carpet", amount: 1200, paidBy: null, sharedBy: ["me", "a"] }),
  bill({ key: "4", description: "Movie Tickets", amount: 980 }),
  bill({ key: "5", description: "Dinner", amount: 5600, paidBy: "a", extras: [{ id: "i1", label: "ice cream", amount: "120", sharedBy: ["s"] }, { id: "i2", label: "gulab jamun", amount: "150", sharedBy: ["me"] }] }),
  bill({ key: "6", description: "Cab Home", amount: 380, paidBy: "s" }),
];

describe("story", () => {
  it("spots a story by its amounts", () => {
    expect(looksLikeStory("Cab for 128 between me and suryansh")).toBe(false);
    expect(looksLikeStory("I bought a jacket for 5500 and suryansh bought a heater for 1,200")).toBe(true);
  });

  it("splits a bill with extras: own add-ons first, the rest equally", () => {
    expect(sharesOf(day[4])).toEqual({ me: 1926.67, s: 1896.67, a: 1776.66 });
  });

  it("adds up the day per person, leaving out bills still missing a payer", () => {
    const t = dayTotals(day);
    expect(t.total).toBe(14860);
    // me: paid 5500 + 980; share 5500 + 326.67 + 1926.67 + 126.67 (each bill adds up to the paisa)
    expect(t.people.me).toEqual({ paid: 6480, share: 7880.01, net: -1400.01 });
    expect(t.people.a.net).toBe(3370.02); // paid 5600; share 326.66 + 1776.66 + 126.66
  });

  it("personal-spending and skipped bills drop out of the group day", () => {
    const t = dayTotals(day.map((b) => (b.key === "1" ? { ...b, toPersonal: true } : b.key === "2" ? { ...b, skip: true } : b)));
    expect(t.total).toBe(14860 - 5500 - 1200);
  });

  it("saves exact shares that add up to the bill, with the items as the record", () => {
    const body = toExpenseBody(day[4]);
    expect(body.splitType).toBe("exact");
    expect(Object.fromEntries(body.participants.map((p) => [p.userId, p.shareAmount]))).toEqual({ me: 1926.67, s: 1896.67, a: 1776.66 });
    expect(body.participants.reduce((a, p) => a + p.shareAmount, 0)).toBeCloseTo(5600, 5);
    expect(body.receiptData).toHaveLength(2);
  });

  it("an item two people shared is split between them only", () => {
    const heater = bill({ amount: 3000, extras: [{ id: "h", label: "heater", amount: "1200", sharedBy: ["me", "s"] }] });
    expect(sharesOf(heater)).toEqual({ me: 1200, s: 1200, a: 600 });
  });

  it("turns the server's one-person extras into editable items", () => {
    const [b] = fromServer([{ ...bill({ key: "d" }), extras: [{ userId: "s", amount: 150, what: "ice cream" }] }]);
    expect(b.extras).toEqual([{ id: "d-x0", label: "ice cream", amount: "150", sharedBy: ["s"] }]);
  });
});
