import { describe, expect, it } from "vitest";
import { cleanStory } from "./storyParse";

const ids = ["me", "s", "a"];

describe("cleanStory", () => {
  it("keeps good bills, asks when the payer is unknown, drops ghosts", () => {
    const { bills } = cleanStory({
      bills: [
        { description: "leather jacket", amount: 5500, category: "Shopping", paidBy: "me", sharedBy: ["me"] },
        { description: "Carpet", amount: 1200, paidBy: null, sharedBy: ["a", "me"], question: "Who paid for the carpet, you or Ankit?" },
        { description: "Dinner", amount: "5,600", category: "Food", paidBy: "a", sharedBy: ["me", "s", "a"],
          extras: [{ userId: "s", amount: 120, what: "ice cream" }, { userId: "me", amount: 150, what: "gulab jamun" }] },
        { description: "Cab home", amount: 380, paidBy: "s", sharedBy: ["me", "s", "a", "ghost"] },
        { description: "nothing", amount: 0 },
      ],
    }, ids);
    expect(bills.map((b) => b.description)).toEqual(["Leather jacket", "Carpet", "Dinner", "Cab home"]);
    expect(bills[1].paidBy).toBeNull();
    expect(bills[1].question).toBe("Who paid for the carpet, you or Ankit?");
    expect(bills[2].amount).toBe(5600);
    expect(bills[2].extras).toEqual([{ userId: "s", amount: 120, what: "ice cream" }, { userId: "me", amount: 150, what: "gulab jamun" }]);
    expect(bills[3].sharedBy).toEqual(["me", "s", "a"]);
    expect(bills[3].category).toBe("Travel"); // "cab" → Travel when the model gave none
  });

  it("drops extras that don't fit (one person, or more than the bill)", () => {
    const { bills } = cleanStory({ bills: [
      { description: "Snacks", amount: 100, paidBy: "me", sharedBy: ["me"], extras: [{ userId: "me", amount: 20 }] },
      { description: "Pizza", amount: 100, paidBy: "me", sharedBy: ["me", "a"], extras: [{ userId: "me", amount: 100 }] },
      { description: "Lunch", amount: 300, paidBy: "me", sharedBy: ["me", "a"], extras: [{ userId: "s", amount: 50 }] },
    ] }, ids);
    expect(bills.every((b) => b.extras.length === 0)).toBe(true);
  });

  it("everyone shares when the story didn't say", () => {
    const { bills } = cleanStory({ bills: [{ description: "Movie", amount: 980, paidBy: "me" }] }, ids);
    expect(bills[0].sharedBy).toEqual(ids);
  });
});
