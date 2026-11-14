import { describe, expect, it } from "vitest";
import { dayTotals, looksLikeStory, sharesOf, toExpenseBody, type StoryBill } from "./story";

const all = ["me", "s", "a"];
const bill = (b: Partial<StoryBill>): StoryBill => ({ key: "k", description: "x", amount: 0, category: "Misc", paidBy: "me", question: null, sharedBy: all, extras: [], quote: "", ...b });

// The mall day from the story
const day: StoryBill[] = [
  bill({ key: "1", description: "Leather Jacket", amount: 5500, sharedBy: ["me"] }),
  bill({ key: "2", description: "Heater", amount: 1200, paidBy: "s", sharedBy: ["s"] }),
  bill({ key: "3", description: "Carpet", amount: 1200, paidBy: null, sharedBy: ["me", "a"] }),
  bill({ key: "4", description: "Movie Tickets", amount: 980 }),
  bill({ key: "5", description: "Dinner", amount: 5600, paidBy: "a", extras: [{ userId: "s", amount: 120, what: "ice cream" }, { userId: "me", amount: 150, what: "gulab jamun" }] }),
  bill({ key: "6", description: "Cab Home", amount: 380, paidBy: "s" }),
];

describe("story", () => {
  it("spots a story by its amounts", () => {
    expect(looksLikeStory("Cab for 128 between me and suryansh")).toBe(false);
    expect(looksLikeStory("I bought a jacket for 5500 and suryansh bought a heater for 1,200")).toBe(true);
  });

  it("splits a bill with extras: own add-ons first, the rest equally", () => {
    expect(sharesOf(day[4])).toEqual({ me: 1926.67, s: 1896.67, a: 1776.67 });
  });

  it("adds up the day per person, leaving out bills still missing a payer", () => {
    const t = dayTotals(day);
    expect(t.total).toBe(14860);
    // me: paid 5500 + 980; share 5500 + 326.67 + 1926.67 + 126.67
    expect(t.people.me).toEqual({ paid: 6480, share: 7880, net: -1400 });
    expect(t.people.a.net).toBe(3370); // paid 5600; share 326.67 + 1776.67 + 126.67
  });

  it("personal-spending and skipped bills drop out of the group day", () => {
    const t = dayTotals(day.map((b) => (b.key === "1" ? { ...b, toPersonal: true } : b.key === "2" ? { ...b, skip: true } : b)));
    expect(t.total).toBe(14860 - 5500 - 1200);
  });

  it("saves extras as personal amounts", () => {
    expect(toExpenseBody(day[4]).participants).toEqual([{ userId: "me", personalAmount: 150 }, { userId: "s", personalAmount: 120 }, { userId: "a" }]);
  });
});
