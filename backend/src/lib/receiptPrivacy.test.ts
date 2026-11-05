import { describe, expect, it } from "vitest";
import { maskReceipt, restoreMasked, setItemVisibility } from "./receiptPrivacy";

const receipt = {
  source: "order_import",
  items: [
    { name: "Milk", lineTotal: 60, sharedBy: ["a", "b", "c"] },
    { name: "Face wash", qty: 1, lineTotal: 199, sharedBy: ["b"] },
    { name: "Chips", lineTotal: 20, sharedBy: ["c"], visible: true },
    { name: "Cola", lineTotal: 40, sharedBy: ["a"] },
  ],
  fees: [{ label: "Delivery", amount: 30 }],
};

describe("maskReceipt", () => {
  it("hides other people's private items from a member, keeping the price", () => {
    const r = maskReceipt(receipt, "c", "a") as typeof receipt;
    expect(r.items[0].name).toBe("Milk"); // shared
    expect(r.items[1]).toEqual({ name: null, variant: null, qty: null, lineTotal: 199, sharedBy: ["b"], masked: true });
    expect(r.items[2].name).toBe("Chips"); // own item
    expect(r.items[3]).toMatchObject({ name: null, masked: true, lineTotal: 40 });
    expect(r.fees).toEqual(receipt.fees);
  });

  it("shows an item its owner chose to show", () => {
    const r = maskReceipt(receipt, "b", "a") as typeof receipt;
    expect(r.items[2].name).toBe("Chips");
    expect(r.items[1].name).toBe("Face wash");
  });

  it("the person who added the bill sees everything", () => {
    expect(maskReceipt(receipt, "a", "a")).toBe(receipt);
  });

  it("leaves other receipt shapes alone", () => {
    const legacy = [{ id: "1", label: "x", amount: "5", sharedBy: ["b"] }];
    expect(maskReceipt(legacy, "c", "a")).toBe(legacy);
    expect(maskReceipt(null, "c", "a")).toBe(null);
  });
});

describe("restoreMasked", () => {
  it("puts hidden details back when a masked copy is saved", () => {
    const seen = maskReceipt(receipt, "c", "a");
    expect(restoreMasked(seen, receipt)).toEqual(receipt);
  });
});

describe("setItemVisibility", () => {
  it("lets the owner show their own item", () => {
    const r = setItemVisibility(receipt, "b", [1], true);
    expect(r.ok && r.receipt.items![1].visible).toBe(true);
  });
  it("refuses shared items and other people's items", () => {
    expect(setItemVisibility(receipt, "b", [0], true).ok).toBe(false);
    expect(setItemVisibility(receipt, "c", [1], true).ok).toBe(false);
    expect(setItemVisibility(receipt, "b", [9], true).ok).toBe(false);
  });
});
