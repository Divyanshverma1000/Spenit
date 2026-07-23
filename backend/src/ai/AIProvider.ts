/**
 * AIProvider.ts — The interface contract for all AI capabilities (Architecture.md §6)
 *
 * This interface is STABLE across all versions. Swapping providers (Groq → OpenAI,
 * free tier → paid) is a config change only — never a rewrite of call sites.
 *
 * Architecture hard rules (Architecture.md §2):
 *   - AI NEVER writes to the database
 *   - AI NEVER computes balances
 *   - AI NEVER invents users, amounts, or financial state
 *   - AI ONLY: interprets, extracts, categorizes, explains, summarizes, drafts
 *   - Every parsed result is shown as an editable confirm-card before any POST
 */

// ── Group context passed to every parse call ───────────────────────────────────

export interface GroupMember {
  id: string;       // UUID — the only identifier that matters for writes
  name: string;     // display name, may collide (two "Prashant"s)
  username: string; // unique handle for disambiguation
}

// ── Category system ────────────────────────────────────────────────────────────

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

// ── Core draft types ───────────────────────────────────────────────────────────

export interface ParsedPayer {
  userId: string;
  amountPaid: number;
}

export interface ParsedParticipant {
  userId: string;
  shareAmount?: number; // only for 'exact' split
}

/**
 * The structured draft the AI returns. Everything in here is editable by the user
 * on the confirm-card before it is submitted to POST /expenses.
 */
export interface ParsedExpenseDraft {
  description: string;
  amount: number | null;
  currency: string;
  splitType: "equal" | "exact" | "fairshare";
  category: ExpenseCategory | null;
  payers: ParsedPayer[];
  participants: ParsedParticipant[];

  /** 0–1. If < 0.4, show a low-confidence warning on the confirm card. */
  confidence: number;

  /**
   * Human-readable strings explaining what the parser couldn't resolve.
   * E.g. "Could not resolve 'Prashant' — two members match. Please select."
   */
  ambiguities: string[];

  /** Set by duplicate-detection in the route, not by the LLM. */
  possibleDuplicate: boolean;

  /** The original raw text input, preserved for display. */
  rawText: string;
}

/**
 * Fallback response when AI is unavailable. The frontend uses this to fall back
 * to the manual form with a graceful toast. Architecture.md §6: "AI availability
 * never blocks core app usage — this is a hard rule, not a nice-to-have."
 */
export interface AIFallback {
  fallback: true;
  reason: "timeout" | "parse_error" | "network" | "config_error" | "rate_limit";
  /** Any trivially extractable data (e.g. a number from the text) for pre-filling */
  partialAmount?: number;
  rawText: string;
}

export type ParseResult = ParsedExpenseDraft | AIFallback;

// ── Stub types for future capabilities ────────────────────────────────────────

export interface ParsedReceiptDraft {
  merchant: string | null;
  total: number | null;
  tax: number | null;
  date: string | null;
  items: { name: string; amount: number }[];
  draft: ParsedExpenseDraft | null; // null = needs manual fill
}

export interface Transfer {
  from: string;
  to: string;
  fromName: string;
  toName: string;
  amount: string;
}

export interface SpendStats {
  groupName: string;
  totalAmount: number;
  expenseCount: number;
  byCategory: Record<string, number>;
  topPayer: string;
}

export interface QueryResult {
  question: string;
  data: Record<string, unknown>;
}

export interface LedgerQueryResponse {
  answer: string;
  filters?: {
    categories?: string[];
    userIds?: string[];
  };
}

// ── The interface — stable across all versions ─────────────────────────────────

export interface AIProvider {
  /**
   * Parse natural-language text into an expense draft.
   * Group context allows the parser to map names → userIds deterministically.
   * Never returns a draft with invented users — unresolved names become ambiguities.
   */
  parseExpenseText(
    input: string,
    groupContext: GroupMember[]
  ): Promise<ParseResult>;

  /**
   * Parse receipt image (base64 or URL) into a draft.
   * [PHASE 6B — STUBBED]: returns a fallback with partialAmount if detectable.
   */
  parseReceiptImage(
    imageData: string,
    groupContext: GroupMember[]
  ): Promise<ParseResult>;

  /**
   * Phrase a settlement simplification in natural language.
   * [PHASE 6C — STUBBED]
   */
  phraseSettlementExplanation(transfers: Transfer[]): Promise<string>;

  /**
   * Summarize spend stats for a group or user.
   * [TIER 1 — STUBBED]
   */
  phraseSpendSummary(stats: SpendStats): Promise<string>;

  /**
   * Answer a natural-language ledger question using backend-computed data.
   * Also returns structured filters if the user asks to "show" specific records.
   */
  answerLedgerQuery(
    question: string,
    context: { members: GroupMember[]; expenses: any[]; settlements: any[]; balances: any[] }
  ): Promise<LedgerQueryResponse>;
}
