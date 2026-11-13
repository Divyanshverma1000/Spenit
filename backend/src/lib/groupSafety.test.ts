import { describe, expect, it } from "vitest";
import { mergeMoves, type ClaimMoves } from "./groupSafety";

const empty = (): ClaimMoves => ({
  payerExpenses: [], splitExpenses: [], createdExpenses: [], receiptExpenses: [],
  settlements: { from_user: [], to_user: [], initiated_by: [], confirmed_by: [] },
});

describe("mergeMoves (undo a claim)", () => {
  it("adds what was added while the name was held to what was recorded at claim time", () => {
    const recorded = { ...empty(), splitExpenses: ["old"], settlements: { ...empty().settlements, from_user: ["s1"] } };
    const since = { ...empty(), splitExpenses: ["old", "blinkit", "wifi"], settlements: { ...empty().settlements, from_user: ["s2"] } };
    const m = mergeMoves(recorded, since);
    expect(m.splitExpenses).toEqual(["old", "blinkit", "wifi"]);
    expect(m.settlements.from_user).toEqual(["s1", "s2"]);
  });

  it("copes with claims recorded before some lists existed", () => {
    const m = mergeMoves({ splitExpenses: ["a"] } as Partial<ClaimMoves>, { ...empty(), payerExpenses: ["b"] });
    expect(m.splitExpenses).toEqual(["a"]);
    expect(m.payerExpenses).toEqual(["b"]);
    expect(m.settlements.to_user).toEqual([]);
  });
});
