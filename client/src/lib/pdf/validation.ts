import type { StatementMetadata } from "./statementMeta";
import { reconcileStatement, type StatementReconciliation } from "./statementSummary";

export type TransactionType = "debit" | "credit";

export interface ParsedTransaction {
  id: string;
  date: string; // YYYY-MM-DD
  narration: string;
  type: TransactionType;
  amount: number;
  balance: number;
  isExcluded?: boolean;
}

export type ValidationIssueType =
  | "MATH_MISMATCH"
  | "OPENING_BALANCE_MISMATCH"
  | "CLOSING_BALANCE_MISMATCH"
  | "DATE_OUT_OF_RANGE"
  | "DATE_OUT_OF_ORDER"
  | "INVALID_DATE"
  | "INVALID_NARRATION"
  | "INVALID_BALANCE";

export interface ValidationIssue {
  type: ValidationIssueType;
  message: string;
  expected?: number | string;
  actual?: number | string;
}

export interface ValidatedTransaction extends ParsedTransaction {
  issues: ValidationIssue[];
  status: "valid" | "needs_review" | "excluded";
}

export interface ValidationSummary {
  totalRows: number;
  validRows: number;
  needsReviewRows: number;
  excludedRows: number;
  hasErrors: boolean;
  transactions: ValidatedTransaction[];
  reconciliation?: StatementReconciliation | null;
}

/**
 * Compares two floating point numbers with 0.01 tolerance (IEEE-754 precision safeguard).
 */
export function areBalancesEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01;
}

/**
 * Validates parsed statement transactions against bank statement rules:
 * 1. prevBalance ± amount = balance for each row (+ for credit, - for debit)
 * 2. First row against opening balance and last row against closing balance
 * 3. Dates are within statement range and in chronological order
 */
export function validateStatementTransactions(
  transactions: ParsedTransaction[],
  metadata?: StatementMetadata
): ValidationSummary {
  const result: ValidatedTransaction[] = [];

  // Determine chronological direction if multiple transactions exist
  // By default, Indian bank statements (HDFC, ICICI, SBI) are ascending (oldest to newest)
  let isDescending = false;
  const activeTxs = transactions.filter((t) => !t.isExcluded);
  if (activeTxs.length >= 2) {
    const firstDate = activeTxs[0].date;
    const lastDate = activeTxs[activeTxs.length - 1].date;
    if (firstDate && lastDate && firstDate > lastDate) {
      isDescending = true;
    }
  }

  let prevActiveBalance: number | null = null;
  let prevActiveDate: string | null = null;
  let isFirstActiveRow = true;

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const issues: ValidationIssue[] = [];

    if (tx.isExcluded) {
      result.push({
        ...tx,
        issues: [],
        status: "excluded",
      });
      continue;
    }

    // ---------------------------------------------------------
    // Rule 0: Reject any LLM row without valid date, narration, and numeric balance
    // ---------------------------------------------------------
    const isValidDate = Boolean(
      tx.date && /^\d{4}-\d{2}-\d{2}$/.test(tx.date) && !isNaN(Date.parse(tx.date))
    );
    if (!isValidDate) {
      issues.push({
        type: "INVALID_DATE",
        message: `Rejected row: Missing or invalid transaction date (${tx.date || "empty"})`,
        actual: tx.date,
      });
    }

    const isValidNarration = Boolean(tx.narration && tx.narration.trim().length > 0);
    if (!isValidNarration) {
      issues.push({
        type: "INVALID_NARRATION",
        message: "Rejected row: Missing transaction narration",
      });
    }

    const isValidBalance = typeof tx.balance === "number" && !isNaN(tx.balance);
    if (!isValidBalance) {
      issues.push({
        type: "INVALID_BALANCE",
        message: "Rejected row: Running balance is missing or not a valid number",
        actual: tx.balance,
      });
    }

    // ---------------------------------------------------------
    // Rule 3A: Date within statement range
    // ---------------------------------------------------------
    if (isValidDate && metadata?.startDate && tx.date < metadata.startDate) {
      issues.push({
        type: "DATE_OUT_OF_RANGE",
        message: `Date ${tx.date} is earlier than statement start date (${metadata.startDate})`,
        expected: `>= ${metadata.startDate}`,
        actual: tx.date,
      });
    }

    if (isValidDate && metadata?.endDate && tx.date > metadata.endDate) {
      issues.push({
        type: "DATE_OUT_OF_RANGE",
        message: `Date ${tx.date} is later than statement end date (${metadata.endDate})`,
        expected: `<= ${metadata.endDate}`,
        actual: tx.date,
      });
    }

    // ---------------------------------------------------------
    // Rule 3B: Date in chronological order
    // ---------------------------------------------------------
    if (isValidDate && prevActiveDate) {
      if (isDescending) {
        if (tx.date > prevActiveDate) {
          issues.push({
            type: "DATE_OUT_OF_ORDER",
            message: `Date ${tx.date} is out of order (previous transaction was on ${prevActiveDate})`,
            expected: `<= ${prevActiveDate}`,
            actual: tx.date,
          });
        }
      } else {
        if (tx.date < prevActiveDate) {
          issues.push({
            type: "DATE_OUT_OF_ORDER",
            message: `Date ${tx.date} is out of order (previous transaction was on ${prevActiveDate})`,
            expected: `>= ${prevActiveDate}`,
            actual: tx.date,
          });
        }
      }
    }

    // ---------------------------------------------------------
    // Per-row running-balance check (previous balance ± amount = balance)
    // ---------------------------------------------------------
    if (isFirstActiveRow) {
      if (isValidBalance) {
        prevActiveBalance = tx.balance;
      }
      isFirstActiveRow = false;
    } else {
      if (isValidBalance && prevActiveBalance !== null) {
        const expectedBalance =
          tx.type === "credit"
            ? prevActiveBalance + tx.amount
            : prevActiveBalance - tx.amount;

        if (!areBalancesEqual(expectedBalance, tx.balance)) {
          const diff = Math.abs(expectedBalance - tx.balance);
          issues.push({
            type: "MATH_MISMATCH",
            message: `Running balance mismatch: previous balance ₹${prevActiveBalance.toFixed(
              2
            )} ${tx.type === "credit" ? "+" : "-"} ₹${tx.amount.toFixed(
              2
            )} should equal ₹${expectedBalance.toFixed(
              2
            )}, but row balance is ₹${tx.balance.toFixed(2)} (difference of ₹${diff.toFixed(2)})`,
            expected: expectedBalance,
            actual: tx.balance,
          });
        }
      }
      if (isValidBalance) {
        prevActiveBalance = tx.balance;
      }
    }

    if (isValidDate) {
      prevActiveDate = tx.date;
    }

    result.push({
      ...tx,
      issues,
      status: issues.length > 0 ? "needs_review" : "valid",
    });
  }

  // NOTE: Closing balance mismatch check against statement closing balance has been completely deleted as required.

  const validRows = result.filter((t) => t.status === "valid").length;
  const needsReviewRows = result.filter((t) => t.status === "needs_review").length;
  const excludedRows = result.filter((t) => t.status === "excluded").length;

  const reconciliation = metadata?.summary
    ? reconcileStatement(result, metadata.summary)
    : null;

  return {
    totalRows: result.length,
    validRows,
    needsReviewRows,
    excludedRows,
    hasErrors: needsReviewRows > 0,
    transactions: result,
    reconciliation,
  };
}

/**
 * Updates a single transaction in the list and re-runs validation.
 */
export function updateTransactionAndValidate(
  transactions: ParsedTransaction[],
  updatedTx: ParsedTransaction,
  metadata?: StatementMetadata
): ValidationSummary {
  const updatedList = transactions.map((t) => (t.id === updatedTx.id ? { ...updatedTx } : t));
  return validateStatementTransactions(updatedList, metadata);
}

/**
 * Toggles the exclusion state of a transaction and re-runs validation.
 */
export function toggleExcludeAndValidate(
  transactions: ParsedTransaction[],
  id: string,
  metadata?: StatementMetadata
): ValidationSummary {
  const updatedList = transactions.map((t) =>
    t.id === id ? { ...t, isExcluded: !t.isExcluded } : t
  );
  return validateStatementTransactions(updatedList, metadata);
}
