/**
 * Shared AI types — mirrors the backend AIProvider.ts interface
 * for use by frontend components without importing backend code.
 */

export const EXPENSE_CATEGORIES = [
  "Food",
  "Travel",
  "Shopping",
  "Stay",
  "Fuel",
  "Medical",
  "Utilities",
  "Entertainment",
  "Misc",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const CATEGORY_EMOJI: Record<ExpenseCategory, string> = {
  Food: "🍽️",
  Travel: "✈️",
  Shopping: "🛍️",
  Stay: "🏨",
  Fuel: "⛽",
  Medical: "💊",
  Utilities: "💡",
  Entertainment: "🎬",
  Misc: "📦",
};

export interface ParsedPayer {
  userId: string;
  amountPaid: number;
}

export interface ParsedParticipant {
  userId: string;
  shareAmount?: number;
}

export interface ParsedExpenseDraft {
  description: string;
  amount: number | null;
  currency: string;
  splitType: "equal" | "exact" | "fairshare";
  category: ExpenseCategory | null;
  payers: ParsedPayer[];
  participants: ParsedParticipant[];
  confidence: number;
  ambiguities: string[];
  possibleDuplicate: boolean;
  rawText: string;
}

export interface AIFallback {
  fallback: true;
  reason: "timeout" | "parse_error" | "network" | "config_error" | "rate_limit";
  partialAmount?: number;
  rawText: string;
  stubMessage?: string;
}
