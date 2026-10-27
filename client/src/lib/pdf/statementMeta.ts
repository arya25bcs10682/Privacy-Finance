/**
 * Bank Statement Metadata Parser for HDFC, ICICI, and SBI
 * Extracts bank identity, statement date range, opening balance, and closing balance.
 */

import { type StatementSummary } from "./statementSummary";

export interface StatementMetadata {
  bank?: "HDFC" | "ICICI" | "SBI" | string;
  startDate?: string; // Normalized YYYY-MM-DD
  endDate?: string; // Normalized YYYY-MM-DD
  openingBalance?: number;
  closingBalance?: number;
  summary?: StatementSummary | null;
}

const MONTH_MAP: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

export function parseFlexibleDate(dateStr: string): string | undefined {
  if (!dateStr) return undefined;
  const clean = dateStr.trim();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return clean;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = clean.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, "0");
    const month = dmyMatch[2].padStart(2, "0");
    let year = dmyMatch[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }

  // DD-Mon-YYYY or DD Mon YYYY (e.g. 15-Jan-2026 or 15 Jan 2026)
  const dMonYMatch = clean.match(/^(\d{1,2})[-/\s]+([a-zA-Z]{3})[-/\s]+(\d{2,4})$/);
  if (dMonYMatch) {
    const day = dMonYMatch[1].padStart(2, "0");
    const monStr = dMonYMatch[2].toLowerCase();
    const month = MONTH_MAP[monStr] || "01";
    let year = dMonYMatch[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }

  return undefined;
}

export function extractStatementMetadata(rawText: string): StatementMetadata {
  const meta: StatementMetadata = {};

  // 1. Detect Bank (Rule 6: HDFC, ICICI, SBI only)
  if (/HDFC\s*BANK/i.test(rawText)) {
    meta.bank = "HDFC";
  } else if (/ICICI\s*BANK/i.test(rawText)) {
    meta.bank = "ICICI";
  } else if (/STATE\s*BANK\s*OF\s*INDIA|SBI/i.test(rawText)) {
    meta.bank = "SBI";
  }

  // Extract date range from header text if explicitly declared
  const periodMatch =
    rawText.match(/Statement\s*Period\s*:\s*([^\n\r]+?)(?:to|-)\s*([^\n\r]+)/i) ||
    rawText.match(/Period\s*:\s*([^\n\r]+?)(?:to|-)\s*([^\n\r]+)/i) ||
    rawText.match(/From\s*Date\s*:\s*([^\n\r]+?)\s*To\s*Date\s*:\s*([^\n\r]+)/i);

  if (periodMatch) {
    const start = parseFlexibleDate(periodMatch[1]);
    const end = parseFlexibleDate(periodMatch[2]);
    if (start) meta.startDate = start;
    if (end) meta.endDate = end;
  }

  // NOTE: Never read opening/closing balance from statement text or LLM.
  // Balances are computed from parsed transaction rows.
  return meta;
}

/**
 * Computes openingBalance from first parsed row (row.balance minus a credit, or plus a debit)
 * and closingBalance from last parsed row's balance.
 */
export function computeStatementBalances(
  transactions: Array<{ balance?: number; amount?: number; type?: "debit" | "credit" | string; isExcluded?: boolean }>
): { openingBalance?: number; closingBalance?: number } {
  const activeRows = transactions.filter((t) => !t.isExcluded);
  if (activeRows.length === 0) return {};

  const firstRow = activeRows[0];
  const lastRow = activeRows[activeRows.length - 1];

  let openingBalance: number | undefined;
  if (typeof firstRow.balance === "number" && !isNaN(firstRow.balance) && typeof firstRow.amount === "number") {
    const rawOpening =
      firstRow.type === "credit"
        ? firstRow.balance - firstRow.amount
        : firstRow.balance + firstRow.amount;
    openingBalance = Math.round(rawOpening * 100) / 100;
  }

  let closingBalance: number | undefined;
  if (typeof lastRow.balance === "number" && !isNaN(lastRow.balance)) {
    closingBalance = Math.round(lastRow.balance * 100) / 100;
  }

  return { openingBalance, closingBalance };
}

/**
 * Derives the period from the min and max row dates.
 */
export function deriveStatementPeriod(
  transactions: Array<{ date?: string; isExcluded?: boolean }>
): { startDate?: string; endDate?: string } {
  const validDates = transactions
    .filter((t) => !t.isExcluded && t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date))
    .map((t) => t.date as string)
    .sort();

  if (validDates.length === 0) return {};

  return {
    startDate: validDates[0],
    endDate: validDates[validDates.length - 1],
  };
}

/**
 * Derives opening balance, closing balance, and date range from parsed transaction rows.
 */
export function deriveStatementMetadataFromTransactions(
  transactions: Array<{
    date?: string;
    balance?: number;
    amount?: number;
    type?: "debit" | "credit" | string;
    isExcluded?: boolean;
  }>,
  existingMeta?: StatementMetadata
): StatementMetadata {
  const meta: StatementMetadata = { ...existingMeta };
  const balances = computeStatementBalances(transactions);
  const period = deriveStatementPeriod(transactions);

  if (balances.openingBalance !== undefined) meta.openingBalance = balances.openingBalance;
  if (balances.closingBalance !== undefined) meta.closingBalance = balances.closingBalance;
  if (!meta.startDate && period.startDate) meta.startDate = period.startDate;
  if (!meta.endDate && period.endDate) meta.endDate = period.endDate;

  return meta;
}
