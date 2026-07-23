/**
 * balance.test.ts — Unit tests for computeNetBalance and computeAllNetBalances.
 *
 * Tests cover:
 * 1. Simple single-payer equal split
 * 2. Multi-payer expense
 * 3. Multi-participant unequal (exact) split
 * 4. Confirmed settlement reduces balance correctly
 * 5. Pending settlement does NOT affect balance (Architecture.md §3 rule)
 * 6. Rejected settlement does NOT affect balance
 * 7. Soft-deleted expense (deletedAt != null) does NOT affect balance
 * 8. Cross-payer scenario: creditor and debtor determined correctly
 */

import { describe, it, expect } from "vitest";
import { Decimal } from "decimal.js";
import {
  computeNetBalance,
  computeAllNetBalances,
  ExpenseRow,
  ExpensePayerRow,
  ExpenseSplitRow,
  SettlementRow,
} from "./balance";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const G1 = "group-1";

// Users
const ALICE = "user-alice";
const BOB = "user-bob";
const CAROL = "user-carol";

// Expense IDs
const EXP1 = "expense-1";
const EXP2 = "expense-2";
const EXP3 = "expense-3";
const EXP_DELETED = "expense-deleted";

// ─── Test 1: Simple single-payer equal split ───────────────────────────────────
describe("computeNetBalance — single payer equal split", () => {
  // Dinner ₹300: Alice paid, split equally 3 ways (₹100 each)
  const expenses: ExpenseRow[] = [{ id: EXP1, groupId: G1, deletedAt: null }];
  const payers: ExpensePayerRow[] = [{ expenseId: EXP1, userId: ALICE, amountPaid: "300.00" }];
  const splits: ExpenseSplitRow[] = [
    { expenseId: EXP1, userId: ALICE, shareAmount: "100.00" },
    { expenseId: EXP1, userId: BOB, shareAmount: "100.00" },
    { expenseId: EXP1, userId: CAROL, shareAmount: "100.00" },
  ];
  const settlements: SettlementRow[] = [];

  it("Alice is owed ₹200 (paid ₹300, owes ₹100 herself)", () => {
    const result = computeNetBalance(ALICE, G1, expenses, payers, splits, settlements);
    expect(result.netAmount).toBe("200.00");
    expect(result.direction).toBe("owed");
  });

  it("Bob owes ₹100", () => {
    const result = computeNetBalance(BOB, G1, expenses, payers, splits, settlements);
    expect(result.netAmount).toBe("100.00");
    expect(result.direction).toBe("owes");
  });

  it("Carol owes ₹100", () => {
    const result = computeNetBalance(CAROL, G1, expenses, payers, splits, settlements);
    expect(result.netAmount).toBe("100.00");
    expect(result.direction).toBe("owes");
  });
});

// ─── Test 2: Multi-payer expense ──────────────────────────────────────────────
describe("computeNetBalance — multi-payer expense", () => {
  // Hotel ₹1000: Alice paid ₹600, Bob paid ₹400.
  // Split equally: ₹333.34, ₹333.33, ₹333.33 (remainder to first)
  const expenses: ExpenseRow[] = [{ id: EXP1, groupId: G1, deletedAt: null }];
  const payers: ExpensePayerRow[] = [
    { expenseId: EXP1, userId: ALICE, amountPaid: "600.00" },
    { expenseId: EXP1, userId: BOB, amountPaid: "400.00" },
  ];
  const splits: ExpenseSplitRow[] = [
    { expenseId: EXP1, userId: ALICE, shareAmount: "333.34" },
    { expenseId: EXP1, userId: BOB, shareAmount: "333.33" },
    { expenseId: EXP1, userId: CAROL, shareAmount: "333.33" },
  ];
  const settlements: SettlementRow[] = [];

  it("Alice: paid 600, owes 333.34 → net owed ₹266.66", () => {
    const result = computeNetBalance(ALICE, G1, expenses, payers, splits, settlements);
    expect(result.netAmount).toBe("266.66");
    expect(result.direction).toBe("owed");
  });

  it("Bob: paid 400, owes 333.33 → net owed ₹66.67", () => {
    const result = computeNetBalance(BOB, G1, expenses, payers, splits, settlements);
    expect(result.netAmount).toBe("66.67");
    expect(result.direction).toBe("owed");
  });

  it("Carol: paid 0, owes 333.33 → net owes ₹333.33", () => {
    const result = computeNetBalance(CAROL, G1, expenses, payers, splits, settlements);
    expect(result.netAmount).toBe("333.33");
    expect(result.direction).toBe("owes");
  });

  it("Total net balances sum to zero (conservation of money)", () => {
    const all = [ALICE, BOB, CAROL].map((u) =>
      computeNetBalance(u, G1, expenses, payers, splits, settlements)
    );
    const total = all.reduce((acc, b) => {
      const signed = b.direction === "owed"
        ? new Decimal(b.netAmount)
        : new Decimal(b.netAmount).negated();
      return acc.plus(signed);
    }, new Decimal(0));
    // Should sum to zero (within ±0.01 due to rounding)
    expect(total.abs().toNumber()).toBeLessThan(0.02);
  });
});

// ─── Test 3: Exact (unequal) split ────────────────────────────────────────────
describe("computeNetBalance — exact unequal split", () => {
  // Dinner ₹900, Alice paid all.
  // Split: Alice ₹100, Bob ₹300, Carol ₹500
  const expenses: ExpenseRow[] = [{ id: EXP1, groupId: G1, deletedAt: null }];
  const payers: ExpensePayerRow[] = [{ expenseId: EXP1, userId: ALICE, amountPaid: "900.00" }];
  const splits: ExpenseSplitRow[] = [
    { expenseId: EXP1, userId: ALICE, shareAmount: "100.00" },
    { expenseId: EXP1, userId: BOB, shareAmount: "300.00" },
    { expenseId: EXP1, userId: CAROL, shareAmount: "500.00" },
  ];
  const settlements: SettlementRow[] = [];

  it("Alice: paid 900, owes 100 → net owed ₹800", () => {
    const result = computeNetBalance(ALICE, G1, expenses, payers, splits, settlements);
    expect(result.netAmount).toBe("800.00");
    expect(result.direction).toBe("owed");
  });

  it("Bob: paid 0, owes 300 → net owes ₹300", () => {
    const result = computeNetBalance(BOB, G1, expenses, payers, splits, settlements);
    expect(result.netAmount).toBe("300.00");
    expect(result.direction).toBe("owes");
  });

  it("Carol: paid 0, owes 500 → net owes ₹500", () => {
    const result = computeNetBalance(CAROL, G1, expenses, payers, splits, settlements);
    expect(result.netAmount).toBe("500.00");
    expect(result.direction).toBe("owes");
  });
});

// ─── Test 4: Confirmed settlement reduces balance ─────────────────────────────
describe("computeNetBalance — confirmed settlement adjusts balance", () => {
  // Same expense as Test 3: Alice owed ₹800 from Bob+Carol
  const expenses: ExpenseRow[] = [{ id: EXP1, groupId: G1, deletedAt: null }];
  const payers: ExpensePayerRow[] = [{ expenseId: EXP1, userId: ALICE, amountPaid: "900.00" }];
  const splits: ExpenseSplitRow[] = [
    { expenseId: EXP1, userId: ALICE, shareAmount: "100.00" },
    { expenseId: EXP1, userId: BOB, shareAmount: "300.00" },
    { expenseId: EXP1, userId: CAROL, shareAmount: "500.00" },
  ];

  // Bob confirmed-pays Alice ₹300 (settles his full share)
  const settlements: SettlementRow[] = [
    {
      id: "settle-1",
      groupId: G1,
      fromUser: BOB,
      toUser: ALICE,
      amount: "300.00",
      status: "confirmed",
    },
  ];

  it("Alice: was owed ₹800, Bob paid ₹300 → now owed ₹500", () => {
    const result = computeNetBalance(ALICE, G1, expenses, payers, splits, settlements);
    expect(result.netAmount).toBe("500.00");
    expect(result.direction).toBe("owed");
  });

  it("Bob: owed ₹300, paid ₹300 confirmed → now settled (₹0)", () => {
    const result = computeNetBalance(BOB, G1, expenses, payers, splits, settlements);
    expect(result.netAmount).toBe("0.00");
    expect(result.direction).toBe("settled");
  });

  it("Carol: still owes ₹500 (her settlement is unrelated)", () => {
    const result = computeNetBalance(CAROL, G1, expenses, payers, splits, settlements);
    expect(result.netAmount).toBe("500.00");
    expect(result.direction).toBe("owes");
  });
});

// ─── Test 5: PENDING settlement must NOT affect balance ────────────────────────
describe("computeNetBalance — pending settlement does NOT affect balance", () => {
  const expenses: ExpenseRow[] = [{ id: EXP1, groupId: G1, deletedAt: null }];
  const payers: ExpensePayerRow[] = [{ expenseId: EXP1, userId: ALICE, amountPaid: "300.00" }];
  const splits: ExpenseSplitRow[] = [
    { expenseId: EXP1, userId: ALICE, shareAmount: "100.00" },
    { expenseId: EXP1, userId: BOB, shareAmount: "100.00" },
    { expenseId: EXP1, userId: CAROL, shareAmount: "100.00" },
  ];

  // Bob claims to have paid (pending — not yet confirmed)
  const settlements: SettlementRow[] = [
    {
      id: "settle-pending",
      groupId: G1,
      fromUser: BOB,
      toUser: ALICE,
      amount: "100.00",
      status: "pending", // ← MUST NOT count
    },
  ];

  it("Alice still shows owed ₹200 (pending payment does not count)", () => {
    const result = computeNetBalance(ALICE, G1, expenses, payers, splits, settlements);
    expect(result.netAmount).toBe("200.00");
    expect(result.direction).toBe("owed");
  });

  it("Bob still owes ₹100 (his pending payment does not count)", () => {
    const result = computeNetBalance(BOB, G1, expenses, payers, splits, settlements);
    expect(result.netAmount).toBe("100.00");
    expect(result.direction).toBe("owes");
  });
});

// ─── Test 6: REJECTED settlement must NOT affect balance ──────────────────────
describe("computeNetBalance — rejected settlement does NOT affect balance", () => {
  const expenses: ExpenseRow[] = [{ id: EXP1, groupId: G1, deletedAt: null }];
  const payers: ExpensePayerRow[] = [{ expenseId: EXP1, userId: ALICE, amountPaid: "300.00" }];
  const splits: ExpenseSplitRow[] = [
    { expenseId: EXP1, userId: ALICE, shareAmount: "150.00" },
    { expenseId: EXP1, userId: BOB, shareAmount: "150.00" },
  ];

  const settlements: SettlementRow[] = [
    {
      id: "settle-rejected",
      groupId: G1,
      fromUser: BOB,
      toUser: ALICE,
      amount: "150.00",
      status: "rejected", // ← MUST NOT count
    },
  ];

  it("Alice still owed ₹150 (rejected settlement does not count)", () => {
    const result = computeNetBalance(ALICE, G1, expenses, payers, splits, settlements);
    expect(result.netAmount).toBe("150.00");
    expect(result.direction).toBe("owed");
  });
});

// ─── Test 7: Soft-deleted expense must NOT affect balance ──────────────────────
describe("computeNetBalance — soft-deleted expense excluded", () => {
  // Active expense + deleted expense
  const expenses: ExpenseRow[] = [
    { id: EXP1, groupId: G1, deletedAt: null }, // active
    { id: EXP_DELETED, groupId: G1, deletedAt: new Date("2024-01-01") }, // soft-deleted
  ];
  const payers: ExpensePayerRow[] = [
    { expenseId: EXP1, userId: ALICE, amountPaid: "200.00" },
    { expenseId: EXP_DELETED, userId: BOB, amountPaid: "500.00" }, // must be ignored
  ];
  const splits: ExpenseSplitRow[] = [
    { expenseId: EXP1, userId: ALICE, shareAmount: "100.00" },
    { expenseId: EXP1, userId: BOB, shareAmount: "100.00" },
    { expenseId: EXP_DELETED, userId: ALICE, shareAmount: "250.00" }, // must be ignored
    { expenseId: EXP_DELETED, userId: BOB, shareAmount: "250.00" },   // must be ignored
  ];
  const settlements: SettlementRow[] = [];

  it("Alice: only active expense counts → owed ₹100", () => {
    const result = computeNetBalance(ALICE, G1, expenses, payers, splits, settlements);
    expect(result.netAmount).toBe("100.00");
    expect(result.direction).toBe("owed");
  });

  it("Bob: only active expense counts → owes ₹100 (not credited for deleted expense)", () => {
    const result = computeNetBalance(BOB, G1, expenses, payers, splits, settlements);
    expect(result.netAmount).toBe("100.00");
    expect(result.direction).toBe("owes");
  });
});

// ─── Test 8: computeAllNetBalances sums to zero ────────────────────────────────
describe("computeAllNetBalances — all members, conservation of money", () => {
  const expenses: ExpenseRow[] = [
    { id: EXP1, groupId: G1, deletedAt: null },
    { id: EXP2, groupId: G1, deletedAt: null },
  ];
  const payers: ExpensePayerRow[] = [
    { expenseId: EXP1, userId: ALICE, amountPaid: "600.00" },
    { expenseId: EXP2, userId: BOB, amountPaid: "300.00" },
  ];
  const splits: ExpenseSplitRow[] = [
    { expenseId: EXP1, userId: ALICE, shareAmount: "200.00" },
    { expenseId: EXP1, userId: BOB, shareAmount: "200.00" },
    { expenseId: EXP1, userId: CAROL, shareAmount: "200.00" },
    { expenseId: EXP2, userId: ALICE, shareAmount: "150.00" },
    { expenseId: EXP2, userId: BOB, shareAmount: "75.00" },
    { expenseId: EXP2, userId: CAROL, shareAmount: "75.00" },
  ];
  const settlements: SettlementRow[] = [];

  it("All net balances sum to zero", () => {
    const balanceMap = computeAllNetBalances(
      [ALICE, BOB, CAROL],
      expenses, payers, splits, settlements
    );
    const total = Array.from(balanceMap.values()).reduce(
      (acc, b) => acc.plus(b), new Decimal(0)
    );
    expect(total.abs().toNumber()).toBeLessThan(0.01);
  });
});
