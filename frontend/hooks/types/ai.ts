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

export const CATEGORY_ICONS: Record<ExpenseCategory, string> = {
  Food: "UtensilsCrossed",
  Travel: "Plane",
  Shopping: "ShoppingBag",
  Stay: "Building2",
  Fuel: "Fuel",
  Medical: "Pill",
  Utilities: "Lightbulb",
  Entertainment: "Film",
  Misc: "Package",
};

export interface ParsedPayer {
  userId: string;
  amountPaid: number;
}

export interface ParsedParticipant {
  userId: string;
  shareAmount?: number;
  personalAmount?: number;
}

export interface ParsedExpenseDraft {
  description: string;
  amount: number | null;
  currency: string;
  splitType: "equal" | "exact" | "fairshare";
  category: ExpenseCategory | null;
  payers: ParsedPayer[];
  participants: ParsedParticipant[];

  /** Optional line items extracted from a receipt scan for interactive assignment */
  extractedItems?: { name: string; amount: number }[];

  /** 0–1. If < 0.4, show a low-confidence warning on the confirm card. */
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
