/**
 * balance.ts — Pure balance computation functions.
 *
 * Architecture.md §3 — The computation formula (unchanged v0 → all future tiers):
 *
 *   net_balance(user, group) =
 *       sum(amounts they're owed from ExpenseSplit as a PAYER in ExpensePayer)
 *     − sum(amounts they OWE from ExpenseSplit as a PARTICIPANT)
 *     − net effect of CONFIRMED Settlements only
 *
 * Key rules:
 *   - No DB calls inside this file — takes data as plain arguments.
 *   - No side effects — fully deterministic, unit-testable in isolation.
 *   - Pending and rejected settlements MUST NOT affect the balance.
 *   - All arithmetic with Decimal to avoid IEEE 754 errors.
 */

import { Decimal } from "decimal.js";

// ─── Input types (plain data, no DB dependencies) ────────────────────────────

export interface ExpenseRow {
  id: string;
  groupId: string;
  /** deleted expenses (deleted_at != null) must be filtered OUT before passing in */
  deletedAt: Date | null;
}

export interface ExpensePayerRow {
  expenseId: string;
  userId: string;
  amountPaid: string; // numeric string e.g. "250.00"
}

export interface ExpenseSplitRow {
  expenseId: string;
  userId: string;
  shareAmount: string; // numeric string e.g. "125.00"
}

export interface SettlementRow {
  id: string;
  groupId: string;
  fromUser: string; // who paid
  toUser: string;   // who received
  amount: string;   // numeric string
  status: "pending" | "confirmed" | "rejected";
}

// ─── Output type ─────────────────────────────────────────────────────────────

/**
 * Net balance for one user within one group.
 * Positive = they are owed money (creditor).
 * Negative = they owe money (debtor).
 */
export interface NetBalance {
  userId: string;
  groupId: string | null; // null for cross-group total
  netAmount: string; // fixed 2dp, e.g. "600.00" or "-250.00"
  /** convenience: "owed" (positive) | "owes" (negative) | "settled" (zero) */
  direction: "owed" | "owes" | "settled";
}

/**
 * Pairwise balance between two users within a group.
 * fromUser owes toUser `netAmount`.
 */
export interface PairwiseBalance {
  fromUser: string;
  toUser: string;
  groupId: string;
  netAmount: string; // always positive — direction encoded in from/to
}

// ─── computeNetBalance ────────────────────────────────────────────────────────

/**
 * Compute the net balance for a single user in a single group.
 *
 * Parameters:
 *   userId        — the user whose balance to compute
 *   groupId       — the group context (null = cross-group, but pass group-scoped data)
 *   expenses      — all ACTIVE (non-deleted) Expense rows for the group
 *   payers        — all ExpensePayer rows for those expenses
 *   splits        — all ExpenseSplit rows for those expenses
 *   settlements   — all Settlement rows for the group (all statuses)
 *
 * Formula (Architecture.md §3):
 *   net = (sum of amounts paid by userId in ExpensePayer for group's expenses)
 *       - (sum of share_amount for userId in ExpenseSplit for group's expenses)
 *       - (sum of confirmed settlements received by userId)
 *       + (sum of confirmed settlements paid by userId)
 *
 * Wait — let me be precise. The formula in §3 is:
 *   net_balance = sum(owed to them as payer) − sum(they owe as participant) − net effect of confirmed settlements
 *
 * "owed to them as payer" = for each expense where userId paid X:
 *   they are owed X back from the other participants (proportionally split out in ExpenseSplit)
 *   BUT their own split share_amount is what they owe themselves, which nets out.
 *   Simplest correct form: +amountPaid (what they put in) − shareAmount (their own obligation)
 *
 * More precisely for pairwise logic across the whole group:
 *   net = sum(amountPaid for userId) − sum(shareAmount for userId)
 *         adjusted by confirmed settlements:
 *           - confirmed settlements where toUser == userId: +amount (someone paid them)
 *           - confirmed settlements where fromUser == userId: -amount (they paid someone)
 */
export function computeNetBalance(
  userId: string,
  groupId: string | null,
  expenses: ExpenseRow[],
  payers: ExpensePayerRow[],
  splits: ExpenseSplitRow[],
  settlements: SettlementRow[]
): NetBalance {
  // Build set of active expense IDs for this group
  const activeExpenseIds = new Set(
    expenses.filter((e) => e.deletedAt === null).map((e) => e.id)
  );

  // What they paid into expenses
  const totalPaid = payers
    .filter((p) => p.userId === userId && activeExpenseIds.has(p.expenseId))
    .reduce((acc, p) => acc.plus(new Decimal(p.amountPaid)), new Decimal(0));

  // What their own obligation is (their share)
  const totalOwed = splits
    .filter((s) => s.userId === userId && activeExpenseIds.has(s.expenseId))
    .reduce((acc, s) => acc.plus(new Decimal(s.shareAmount)), new Decimal(0));

  // Net from expenses: paid more than share = creditor; less = debtor
  let net = totalPaid.minus(totalOwed);

  // Settlements — CONFIRMED ONLY (Architecture.md §3: pending/rejected must NOT affect balance)
  const confirmedSettlements = settlements.filter((s) => s.status === "confirmed");

  for (const s of confirmedSettlements) {
    if (s.fromUser === userId) {
      // They paid someone → reduces what they owe (they're a debtor settling)
      net = net.plus(new Decimal(s.amount));
    }
    if (s.toUser === userId) {
      // Someone paid them → reduces what they're owed (they're a creditor being settled)
      net = net.minus(new Decimal(s.amount));
    }
  }

  const netFixed = net.toDecimalPlaces(2);
  const netNum = netFixed.toNumber();

  return {
    userId,
    groupId,
    netAmount: netFixed.abs().toFixed(2),
    direction: netNum > 0 ? "owed" : netNum < 0 ? "owes" : "settled",
  };
}

// ─── computePairwiseBalances ──────────────────────────────────────────────────

/**
 * Compute the signed net balance between EVERY pair of users in a group.
 * This is what powers the debt-simplification algorithm.
 *
 * Returns a map: userId → netAmount (Decimal, positive = creditor, negative = debtor)
 * This is the input format for simplifyDebts().
 *
 * Uses the same formula as computeNetBalance but for all users at once.
 */
export function computeAllNetBalances(
  memberIds: string[],
  expenses: ExpenseRow[],
  payers: ExpensePayerRow[],
  splits: ExpenseSplitRow[],
  settlements: SettlementRow[]
): Map<string, Decimal> {
  const balances = new Map<string, Decimal>();

  for (const userId of memberIds) {
    const activeExpenseIds = new Set(
      expenses.filter((e) => e.deletedAt === null).map((e) => e.id)
    );

    const totalPaid = payers
      .filter((p) => p.userId === userId && activeExpenseIds.has(p.expenseId))
      .reduce((acc, p) => acc.plus(new Decimal(p.amountPaid)), new Decimal(0));

    const totalOwed = splits
      .filter((s) => s.userId === userId && activeExpenseIds.has(s.expenseId))
      .reduce((acc, s) => acc.plus(new Decimal(s.shareAmount)), new Decimal(0));

    let net = totalPaid.minus(totalOwed);

    // CONFIRMED settlements only
    const confirmedSettlements = settlements.filter((s) => s.status === "confirmed");
    for (const s of confirmedSettlements) {
      if (s.fromUser === userId) net = net.plus(new Decimal(s.amount));
      if (s.toUser === userId) net = net.minus(new Decimal(s.amount));
    }

    balances.set(userId, net.toDecimalPlaces(2));
  }

  return balances;
}
