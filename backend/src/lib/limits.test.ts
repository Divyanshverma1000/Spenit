import { describe, expect, it } from "vitest";
import { parseAmount } from "./limits";

describe("parseAmount", () => {
  it("accepts normal amounts", () => {
    expect(parseAmount(614)).toBe(614);
    expect(parseAmount("230.33")).toBe(230.33);
  });
  it("refuses zero, negatives, text, too many decimals and huge numbers", () => {
    for (const v of [0, -5, "-1", "abc", "", null, undefined, 1.234, 1e12, Infinity, NaN]) expect(parseAmount(v)).toBeNull();
  });
});
