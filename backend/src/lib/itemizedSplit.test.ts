import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import { computeItemizedShares, ItemizedInput } from "./itemizedSplit";

const RAHUL = "rahul";
const SHREY = "shrey";
const ANDY = "andy";

const base = (over: Partial<ItemizedInput>): ItemizedInput => ({
  amount: new Decimal(0),
  payerId: RAHUL,
  items: [],
  fees: [],
  discounts: [],
  feePolicy: "proportional",
  ...over,
});

const asMap = (r: ReturnType<typeof computeItemizedShares>) => {
  if (!r.ok) throw new Error(r.error);
  return Object.fromEntries(r.shares.map((s) => [s.userId, s.shareAmount.toFixed(2)]));
};

describe("computeItemizedShares", () => {
  it("splits each item among only its people", () => {
    const r = computeItemizedShares(
      base({
        amount: new Decimal(354),
        items: [
          { lineTotal: 54, sharedBy: [RAHUL, SHREY] }, // milk
          { lineTotal: 300, sharedBy: [SHREY, ANDY] }, // peanut butter
        ],
      })
    );
    expect(asMap(r)).toEqual({ rahul: "27.00", shrey: "177.00", andy: "150.00" });
  });

  it("spreads fees in proportion to items and never charges people outside the order", () => {
    const r = computeItemizedShares(
      base({
        amount: new Decimal(110),
        items: [
          { lineTotal: 75, sharedBy: [RAHUL] },
          { lineTotal: 25, sharedBy: [SHREY] },
        ],
        fees: [{ amount: 10 }],
      })
    );
    expect(asMap(r)).toEqual({ rahul: "82.50", shrey: "27.50" });
  });

  it("equal fee policy splits extras evenly among people with items", () => {
    const r = computeItemizedShares(
      base({
        amount: new Decimal(110),
        feePolicy: "equal",
        items: [
          { lineTotal: 75, sharedBy: [RAHUL] },
          { lineTotal: 25, sharedBy: [SHREY] },
        ],
        fees: [{ amount: 10 }],
      })
    );
    expect(asMap(r)).toEqual({ rahul: "80.00", shrey: "30.00" });
  });

  it("payer fee policy puts extras on the payer, even with no items of their own", () => {
    const r = computeItemizedShares(
      base({
        amount: new Decimal(110),
        feePolicy: "payer",
        items: [{ lineTotal: 100, sharedBy: [SHREY] }],
        fees: [{ amount: 10 }],
      })
    );
    expect(asMap(r)).toEqual({ shrey: "100.00", rahul: "10.00" });
  });

  it("subtracts discounts proportionally", () => {
    const r = computeItemizedShares(
      base({
        amount: new Decimal(90),
        items: [
          { lineTotal: 50, sharedBy: [RAHUL] },
          { lineTotal: 50, sharedBy: [ANDY] },
        ],
        discounts: [{ amount: 10 }],
      })
    );
    expect(asMap(r)).toEqual({ rahul: "45.00", andy: "45.00" });
  });

  it("rounds to the paisa and always sums to the bill", () => {
    const r = computeItemizedShares(
      base({
        amount: new Decimal(100),
        items: [{ lineTotal: 91, sharedBy: [RAHUL, SHREY, ANDY] }],
        fees: [{ amount: 9 }],
      })
    );
    if (!r.ok) throw new Error(r.error);
    const total = r.shares.reduce((a, s) => a.plus(s.shareAmount), new Decimal(0));
    expect(total.toFixed(2)).toBe("100.00");
    const cents = r.shares.map((s) => s.shareAmount.mul(100).toNumber());
    expect(Math.max(...cents) - Math.min(...cents)).toBeLessThanOrEqual(1);
  });

  it("rejects totals that don't match the amount", () => {
    const r = computeItemizedShares(
      base({ amount: new Decimal(120), items: [{ lineTotal: 100, sharedBy: [RAHUL] }] })
    );
    expect(r.ok).toBe(false);
  });

  it("rejects items with nobody on them", () => {
    const r = computeItemizedShares(base({ amount: new Decimal(10), items: [{ lineTotal: 10, sharedBy: [] }] }));
    expect(r.ok).toBe(false);
  });
});
