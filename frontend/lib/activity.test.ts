import { describe, expect, it } from "vitest";
import { changes, sentence, type ActivityItem, type Snapshot } from "./activity";

const snap = (amount: string, shares: [string, string, string][]): Snapshot => ({
  description: "Dinner",
  amount,
  paidBy: [{ userId: "r", name: "Rahul", amount }],
  shares: shares.map(([userId, name, a]) => ({ userId, name, amount: a })),
});
const item = (kind: string, summary: Record<string, unknown>, actor = { id: "r", name: "Rahul" }): ActivityItem => ({
  id: 1, kind, actor, expenseId: "e", expenseDeleted: false, settlementId: null, targetUser: null, summary, createdAt: "2026-11-05T10:00:00Z",
});

describe("activity", () => {
  it("shows who changed what in an edit", () => {
    const before = snap("500.00", [["r", "Rahul", "250.00"], ["d", "Divyansh", "250.00"]]);
    const after = snap("5000.00", [["r", "Rahul", "500.00"], ["d", "Divyansh", "4500.00"]]);
    expect(changes(before, after)).toEqual([
      "Total: ₹500 → ₹5,000",
      "Paid by: Rahul ₹500 → Rahul ₹5,000",
      "Rahul: ₹250 → ₹500",
      "Divyansh: ₹250 → ₹4,500",
    ]);
    expect(sentence(item("expense_edited", { before, after }))).toBe('Rahul changed "Dinner"');
  });
  it("says You for your own actions and explains claims", () => {
    expect(sentence(item("expense_deleted", { before: snap("300.00", []) }), "r")).toBe('You deleted "Dinner" (₹300)');
    expect(sentence(item("member_claimed", { accountName: "Pratik Shah", placeholderName: "Sourabh" }))).toBe("Pratik Shah joined as Sourabh");
    expect(sentence(item("claim_undone", { claimerName: "Pratik Shah", placeholderName: "Sourabh" }, { id: "d", name: "Divyansh" }))).toBe(
      "Divyansh undid Pratik Shah joining as Sourabh"
    );
  });
});
