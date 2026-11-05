import { describe as suite, expect, it } from "vitest";
import { changes, dayLabel, describe, sentence, type ActivityItem, type Snapshot } from "./activity";

const snap = (amount: string, shares: [string, string, string][]): Snapshot => ({
  description: "Dinner",
  amount,
  paidBy: [{ userId: "r", name: "Rahul", amount }],
  shares: shares.map(([userId, name, a]) => ({ userId, name, amount: a })),
});
const item = (kind: string, summary: Record<string, unknown>, actor = { id: "r", name: "Rahul" }, targetUser: string | null = null): ActivityItem => ({
  id: 1, kind, actor, expenseId: "e", expenseDeleted: false, settlementId: null, targetUser, summary, createdAt: "2026-11-05T10:00:00Z",
});

suite("activity", () => {
  it("lists each change in an edit as old → new", () => {
    const before = snap("500.00", [["r", "Rahul", "250.00"], ["d", "Divyansh", "250.00"]]);
    const after = snap("5000.00", [["r", "Rahul", "500.00"], ["d", "Divyansh", "4500.00"]]);
    expect(changes(before, after)).toEqual([
      { label: "Total", from: "₹500", to: "₹5,000" },
      { label: "Rahul", from: "₹250", to: "₹500" },
      { label: "Divyansh", from: "₹250", to: "₹4,500" },
    ]);
    const d = describe(item("expense_edited", { before, after }));
    expect(d.label).toBe("Edited");
    expect(d.amount).toBe("₹5,000");
    expect(d.parts[0]).toEqual({ t: "person", text: "Rahul", id: "r" });
  });
  it("says You for your own actions and explains name fixes", () => {
    expect(sentence(item("expense_deleted", { before: snap("300.00", []) }), "r")).toBe("You deleted Dinner");
    expect(sentence(item("member_claimed", { accountName: "Pratik Shah", placeholderName: "Sourabh" }))).toBe("Pratik Shah joined as Sourabh");
    const undo = describe(item("claim_undone", { claimerName: "Pratik Shah", placeholderName: "Sourabh" }, { id: "d", name: "Divyansh" }, "p"));
    expect(undo.label).toBe("Name fix");
    expect(undo.parts.map((p) => p.text).join(" ")).toBe("Divyansh undid Pratik Shah joining as Sourabh");
  });
  it("groups by day", () => {
    const now = new Date("2026-11-05T18:00:00");
    expect(dayLabel("2026-11-05T09:00:00", now)).toBe("Today");
    expect(dayLabel("2026-11-04T23:00:00", now)).toBe("Yesterday");
  });
});
