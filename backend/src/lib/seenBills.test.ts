import { describe, expect, it } from "vitest";
import { cleanCandidates, cleanPrint, rank, type StoredBill } from "./seenBills";

const H1 = "a".repeat(24);
const H2 = "b".repeat(24);
const C1 = "c".repeat(24);

const stored = (over: Partial<StoredBill>): StoredBill => ({
  place: "group", expenseId: "e1", groupId: "g1", groupName: "Flat", description: "Blinkit order",
  amount: 540, addedAt: "2026-11-05T10:00:00.000Z", addedBy: null, addedByMe: true, orderDate: "2026-11-05",
  imageHashes: [], orderKey: null, contentsHash: null, ...over,
});

describe("cleanPrint", () => {
  it("drops malformed hashes and keeps the rest", () => {
    expect(cleanPrint({ imageHashes: [H1, "nope", H1, 4], orderKey: "blinkit:ORD1", contentsHash: "xyz" }))
      .toEqual({ imageHashes: [H1], orderKey: "blinkit:ORD1", contentsHash: null });
  });
  it("is null when there is nothing to look for", () => {
    expect(cleanPrint({ imageHashes: [], orderKey: "" })).toBeNull();
    expect(cleanPrint(null)).toBeNull();
  });
  it("candidates need a ref", () => {
    expect(cleanCandidates([{ ref: "d1", orderKey: "x:1" }, { orderKey: "x:2" }])).toHaveLength(1);
  });
});

describe("rank", () => {
  const cand = { ref: "d1", imageHashes: [H1], orderKey: "blinkit:ORD1", contentsHash: C1 };

  it("finds nothing when no print matches", () => {
    expect(rank([cand], [stored({ imageHashes: [H2], orderKey: "zepto:9" })], "g1")).toEqual([]);
  });

  it("names the strongest kind of match", () => {
    const m = rank([cand], [stored({ expenseId: "byItems", contentsHash: C1 }), stored({ expenseId: "byShot", imageHashes: [H1] })], "g1");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ ref: "d1", how: "screenshot", expenseId: "byShot", sameGroup: true });
    expect(m[0]).not.toHaveProperty("imageHashes");
  });

  it("same items and total is still reported, so a reorder can be confirmed", () => {
    expect(rank([cand], [stored({ contentsHash: C1 })], "g1")[0].how).toBe("contents");
  });

  it("prefers the group being added to, then the newest", () => {
    const other = stored({ expenseId: "other", groupId: "g2", orderKey: "blinkit:ORD1", addedAt: "2026-11-10T00:00:00Z" });
    const here = stored({ expenseId: "here", orderKey: "blinkit:ORD1" });
    expect(rank([cand], [other, here], "g1")[0].expenseId).toBe("here");
    const newer = stored({ expenseId: "newer", orderKey: "blinkit:ORD1", addedAt: "2026-11-09T00:00:00Z" });
    expect(rank([cand], [here, newer], "g1")[0].expenseId).toBe("newer");
  });

  it("finds personal bills too", () => {
    const m = rank([cand], [stored({ place: "personal", groupId: null, groupName: null, imageHashes: [H1] })], null);
    expect(m[0]).toMatchObject({ place: "personal", sameGroup: false });
  });
});
