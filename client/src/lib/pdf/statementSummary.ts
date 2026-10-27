/**
 * Bank Statement Summary Parser & Reconciler
 * Locates summary table, extracts deterministic metadata, and reconciles parsed transactions.
 */

export interface StatementSummary {
  openingBalance: number;
  drCount: number;
  crCount: number;
  totalDebits: number;
  totalCredits: number;
  closingBalance: number;
}

export interface ReconciliationMismatch {
  field: "openingBalance" | "closingBalance" | "drCount" | "crCount" | "totalDebits" | "totalCredits";
  label: string;
  expected: number;
  actual: number;
  message: string;
}

export interface StatementReconciliation {
  isReconciled: boolean;
  mismatches: ReconciliationMismatch[];
  summary: StatementSummary;
  actual: {
    openingBalance: number;
    closingBalance: number;
    drCount: number;
    crCount: number;
    totalDebits: number;
    totalCredits: number;
  };
}

/**
 * Normalises whitespace in text (collapses multiple spaces, tabs, and non-breaking spaces into single space)
 */
export function normalizeWhitespace(text: string): string {
  if (!text) return "";
  return text.replace(/[\u00A0\t ]+/g, " ");
}

/**
 * Finds the earliest match of /brought\s*forward/i that has /(dr|cr)\s*count/i
 * within the next ~300 characters across the whole document text.
 * Returns the index in text where the marker begins, or -1 if no match.
 */
export function findSummaryMarkerIndex(documentText: string): number {
  if (!documentText) return -1;
  const normalized = normalizeWhitespace(documentText);
  const bfRegex = /brought\s*forward/gi;
  let match: RegExpExecArray | null;

  while ((match = bfRegex.exec(normalized)) !== null) {
    const bfIdx = match.index;
    const windowAfter = normalized.slice(bfIdx, bfIdx + 300);
    if (/(dr|cr)\s*count/i.test(windowAfter)) {
      let lineStart = normalized.lastIndexOf("\n", bfIdx);
      if (lineStart === -1) {
        lineStart = 0;
      } else {
        lineStart = lineStart + 1;
      }

      // Check if preceding line is "Statement Summary"
      const textBefore = normalized.slice(0, Math.max(0, lineStart - 1)).trimEnd();
      const lastLineBefore = textBefore.slice(textBefore.lastIndexOf("\n") + 1).trim();
      if (/statement\s*summary/i.test(lastLineBefore)) {
        const stmtSummaryIdx = normalized.lastIndexOf(lastLineBefore, lineStart - 1);
        const prevLineStart = normalized.lastIndexOf("\n", Math.max(0, stmtSummaryIdx - 1));
        lineStart = prevLineStart !== -1 ? prevLineStart + 1 : 0;
      }

      return lineStart;
    }
  }

  return -1;
}

export function findSummarySectionIndex(text: string): number {
  return findSummaryMarkerIndex(text);
}

/**
 * Truncates document pages at the summary marker.
 * Drops everything from that match onward, including later pages. If no match, keeps everything.
 * Logs only counts: whether the marker was found, its page number, and the number of characters kept. No statement text.
 */
export function truncatePagesAtSummaryMarker<
  T extends { pageNumber: number; rawText: string; redacted?: { redactedText: string } }
>(
  pages: T[]
): {
  truncatedPages: T[];
  markerFound: boolean;
  pageNumber: number | null;
  charsKept: number;
  cleanedText: string;
} {
  if (pages.length === 0) {
    console.log(`[Summary Truncation] markerFound=false, pageNumber=null, charsKept=0`);
    return {
      truncatedPages: [],
      markerFound: false,
      pageNumber: null,
      charsKept: 0,
      cleanedText: "",
    };
  }

  // 1. Normalise whitespace on each page's text first
  const normalizedPages = pages.map((p) => ({
    ...p,
    rawText: normalizeWhitespace(p.rawText),
    redacted: p.redacted
      ? {
          ...p.redacted,
          redactedText: normalizeWhitespace(p.redacted.redactedText || p.rawText || ""),
        }
      : undefined,
  }));

  // 2. Build cumulative text across all pages while tracking page boundaries
  const pageBoundaries: { pageIndex: number; pageNumber: number; startIdx: number; endIdx: number }[] = [];
  let fullDocText = "";

  for (let i = 0; i < normalizedPages.length; i++) {
    const p = normalizedPages[i];
    const pageText = p.redacted?.redactedText || p.rawText;
    if (i > 0) fullDocText += "\n";
    const startIdx = fullDocText.length;
    fullDocText += pageText;
    const endIdx = fullDocText.length;
    pageBoundaries.push({
      pageIndex: i,
      pageNumber: p.pageNumber,
      startIdx,
      endIdx,
    });
  }

  // 3. Find earliest match of /brought\s*forward/i that has /(dr|cr)\s*count/i within next ~300 characters across whole document text
  const markerOffset = findSummaryMarkerIndex(fullDocText);

  // If no match, keep everything
  if (markerOffset === -1) {
    const charsKept = fullDocText.length;
    console.log(`[Summary Truncation] markerFound=false, pageNumber=null, charsKept=${charsKept}`);
    return {
      truncatedPages: normalizedPages,
      markerFound: false,
      pageNumber: null,
      charsKept,
      cleanedText: fullDocText,
    };
  }

  // Find which page contains the marker
  let matchPageNumber = normalizedPages[0].pageNumber;
  let matchPageIndex = 0;

  for (const b of pageBoundaries) {
    if (markerOffset >= b.startIdx && markerOffset <= b.endIdx) {
      matchPageNumber = b.pageNumber;
      matchPageIndex = b.pageIndex;
      break;
    }
  }

  // Drop later pages: keep earlier pages in full, truncate matching page
  const truncatedPages: T[] = [];
  for (let i = 0; i < matchPageIndex; i++) {
    truncatedPages.push(normalizedPages[i]);
  }

  const matchingPage = normalizedPages[matchPageIndex];
  const pageStart = pageBoundaries[matchPageIndex].startIdx;
  const cutInPage = Math.max(0, markerOffset - pageStart);
  const trimmedRaw = matchingPage.rawText.slice(0, cutInPage).trimEnd();
  const trimmedRedacted = matchingPage.redacted
    ? matchingPage.redacted.redactedText.slice(0, cutInPage).trimEnd()
    : undefined;

  const hasRemainingContent =
    trimmedRaw.length > 0 || (trimmedRedacted !== undefined && trimmedRedacted.length > 0);

  if (hasRemainingContent) {
    truncatedPages.push({
      ...matchingPage,
      rawText: trimmedRaw,
      redacted: matchingPage.redacted && trimmedRedacted !== undefined
        ? {
            ...matchingPage.redacted,
            redactedText: trimmedRedacted,
          }
        : undefined,
    });
  }

  const cleanedText = fullDocText.slice(0, markerOffset).trimEnd();
  const charsKept = cleanedText.length;

  // Log only counts: whether marker was found, its page number, and chars kept. No statement text.
  console.log(
    `[Summary Truncation] markerFound=true, pageNumber=${matchPageNumber}, charsKept=${charsKept}`
  );

  return {
    truncatedPages,
    markerFound: true,
    pageNumber: matchPageNumber,
    charsKept,
    cleanedText,
  };
}

/**
 * Extracts numbers from a string, stripping commas, currency symbols, and Dr/Cr suffixes.
 */
function extractNumericTokens(str: string): number[] {
  // Matches positive or negative numbers with optional comma separators and optional Dr/Cr suffixes
  const regex = /(?:INR|Rs\.?)?\s*(-?[0-9]+(?:,[0-9]+)*(?:\.[0-9]+)?|\.[0-9]+)\s*(?:(?:Dr|Cr|\(Dr\)|\(Cr\))\b\.?)?/gi;
  const numbers: number[] = [];
  let m: RegExpExecArray | null;

  while ((m = regex.exec(str)) !== null) {
    const raw = m[1].replace(/,/g, "");
    const parsed = parseFloat(raw);
    if (!isNaN(parsed)) {
      numbers.push(parsed);
    }
  }
  return numbers;
}

/**
 * Parses the removed summary section with deterministic code.
 * Finds the six numeric values that follow the headers, strips commas and Dr/Cr suffixes,
 * and maps them to {openingBalance, drCount, crCount, totalDebits, totalCredits, closingBalance}.
 * If exactly six numbers aren't found, returns null without failing the import.
 */
export function parseStatementSummary(sectionText: string): StatementSummary | null {
  if (!sectionText || !sectionText.trim()) {
    return null;
  }

  // Find the end of the header block
  const headerKeywords = [
    /statement\s*summary/gi,
    /brought\s*forward/gi,
    /dr\s*count/gi,
    /cr\s*count/gi,
    /total\s*debits?/gi,
    /total\s*credits?/gi,
    /closing\s*balance/gi,
  ];

  let maxHeaderEnd = 0;
  for (const rx of headerKeywords) {
    let m: RegExpExecArray | null;
    while ((m = rx.exec(sectionText)) !== null) {
      const end = m.index + m[0].length;
      if (end > maxHeaderEnd) {
        maxHeaderEnd = end;
      }
    }
  }

  const textAfterHeaders = sectionText.slice(maxHeaderEnd);

  // Strategy 1: Check lines after headers for exactly 6 numbers (standard table layout)
  const linesAfterHeaders = textAfterHeaders
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of linesAfterHeaders) {
    const lineNumbers = extractNumericTokens(line);
    if (lineNumbers.length === 6) {
      return {
        openingBalance: lineNumbers[0],
        drCount: lineNumbers[1],
        crCount: lineNumbers[2],
        totalDebits: lineNumbers[3],
        totalCredits: lineNumbers[4],
        closingBalance: lineNumbers[5],
      };
    }
  }

  // Strategy 2: Collect non-footer lines after headers up to any footer keywords
  const nonFooterNumbers: number[] = [];
  for (const line of linesAfterHeaders) {
    if (/\b(?:page\s*\d|generated|printed|disclaimer|statement\s*period)\b/i.test(line)) {
      break;
    }
    nonFooterNumbers.push(...extractNumericTokens(line));
    if (nonFooterNumbers.length === 6) {
      return {
        openingBalance: nonFooterNumbers[0],
        drCount: nonFooterNumbers[1],
        crCount: nonFooterNumbers[2],
        totalDebits: nonFooterNumbers[3],
        totalCredits: nonFooterNumbers[4],
        closingBalance: nonFooterNumbers[5],
      };
    }
  }

  // Strategy 3: Key-value labeled headers in the section
  const opn = sectionText.match(/brought\s*forward[\s.:]*(?:INR|Rs\.?)?\s*([\d,]+\.?\d*)\s*(?:Dr|Cr)?/i);
  const drC = sectionText.match(/dr\s*count[\s.:]*([\d,]+)/i);
  const crC = sectionText.match(/cr\s*count[\s.:]*([\d,]+)/i);
  const drT = sectionText.match(/total\s*debits?[\s.:]*(?:INR|Rs\.?)?\s*([\d,]+\.?\d*)\s*(?:Dr|Cr)?/i);
  const crT = sectionText.match(/total\s*credits?[\s.:]*(?:INR|Rs\.?)?\s*([\d,]+\.?\d*)\s*(?:Dr|Cr)?/i);
  const cls = sectionText.match(/closing\s*balance[\s.:]*(?:INR|Rs\.?)?\s*([\d,]+\.?\d*)\s*(?:Dr|Cr)?/i);

  if (opn && drC && crC && drT && crT && cls) {
    const opnVal = parseFloat(opn[1].replace(/,/g, ""));
    const drCVal = parseInt(drC[1].replace(/,/g, ""), 10);
    const crCVal = parseInt(crC[1].replace(/,/g, ""), 10);
    const drTVal = parseFloat(drT[1].replace(/,/g, ""));
    const crTVal = parseFloat(crT[1].replace(/,/g, ""));
    const clsVal = parseFloat(cls[1].replace(/,/g, ""));

    if (![opnVal, drCVal, crCVal, drTVal, crTVal, clsVal].some(isNaN)) {
      return {
        openingBalance: opnVal,
        drCount: drCVal,
        crCount: crCVal,
        totalDebits: drTVal,
        totalCredits: crTVal,
        closingBalance: clsVal,
      };
    }
  }

  // Strategy 4: If textAfterHeaders in total contains exactly 6 numbers
  const allTokens = extractNumericTokens(textAfterHeaders);
  if (allTokens.length === 6) {
    return {
      openingBalance: allTokens[0],
      drCount: allTokens[1],
      crCount: allTokens[2],
      totalDebits: allTokens[3],
      totalCredits: allTokens[4],
      closingBalance: allTokens[5],
    };
  }

  // Exactly six numbers not found -> return null without failing
  return null;
}

/**
 * Removes the summary section from extracted text and returns the cleaned text
 * and the parsed summary if found.
 */
export function extractAndRemoveSummary(text: string): {
  cleanedText: string;
  removedSection: string | null;
  summary: StatementSummary | null;
} {
  const index = findSummarySectionIndex(text);
  if (index === -1) {
    return {
      cleanedText: text,
      removedSection: null,
      summary: null,
    };
  }

  const cleanedText = text.slice(0, index).trimEnd();
  const removedSection = text.slice(index);

  // Stop before summary, truncate text, do not parse the summary at all
  return {
    cleanedText,
    removedSection,
    summary: null,
  };
}

/**
 * Reconciles parsed statement transactions against the summary table:
 * - Opening balance vs the first row (allowing starting balance before first tx)
 * - Closing balance vs the last row
 * - Debit and credit counts
 * - Debit and credit totals (0.01 tolerance)
 */
export function reconcileStatement(
  transactions: Array<{
    date: string;
    narration: string;
    type: "debit" | "credit";
    amount: number;
    balance: number;
    isExcluded?: boolean;
  }>,
  summary: StatementSummary | null
): StatementReconciliation | null {
  if (!summary) return null;

  const activeTxs = transactions.filter((t) => !t.isExcluded);
  if (activeTxs.length === 0) {
    return null;
  }

  const mismatches: ReconciliationMismatch[] = [];
  const firstTx = activeTxs[0];
  const lastTx = activeTxs[activeTxs.length - 1];

  // Implied opening balance before the first transaction
  const firstRowStartingBalance =
    firstTx.type === "credit"
      ? firstTx.balance - firstTx.amount
      : firstTx.balance + firstTx.amount;

  // 1. Opening balance check (allow 0.01 tolerance on starting balance or direct first row balance)
  const diffStart = Math.abs(firstRowStartingBalance - summary.openingBalance);
  const diffDirect = Math.abs(firstTx.balance - summary.openingBalance);
  const actualOpening = diffStart <= 0.01 ? firstRowStartingBalance : (diffDirect <= 0.01 ? firstTx.balance : firstRowStartingBalance);

  if (Math.min(diffStart, diffDirect) > 0.01) {
    mismatches.push({
      field: "openingBalance",
      label: "Opening Balance",
      expected: summary.openingBalance,
      actual: actualOpening,
      message: `Opening balance mismatch: Expected ₹${summary.openingBalance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}, got ₹${actualOpening.toLocaleString("en-IN", { minimumFractionDigits: 2 })} (first row)`,
    });
  }

  // 2. Closing balance check vs last row (0.01 tolerance)
  const actualClosing = lastTx.balance;
  if (Math.abs(actualClosing - summary.closingBalance) > 0.01) {
    mismatches.push({
      field: "closingBalance",
      label: "Closing Balance",
      expected: summary.closingBalance,
      actual: actualClosing,
      message: `Closing balance mismatch: Expected ₹${summary.closingBalance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}, got ₹${actualClosing.toLocaleString("en-IN", { minimumFractionDigits: 2 })} (last row)`,
    });
  }

  // 3. Debit count check
  const actualDrCount = activeTxs.filter((t) => t.type === "debit").length;
  if (actualDrCount !== summary.drCount) {
    mismatches.push({
      field: "drCount",
      label: "Debit Count",
      expected: summary.drCount,
      actual: actualDrCount,
      message: `Debit count mismatch: Expected ${summary.drCount}, found ${actualDrCount}`,
    });
  }

  // 4. Credit count check
  const actualCrCount = activeTxs.filter((t) => t.type === "credit").length;
  if (actualCrCount !== summary.crCount) {
    mismatches.push({
      field: "crCount",
      label: "Credit Count",
      expected: summary.crCount,
      actual: actualCrCount,
      message: `Credit count mismatch: Expected ${summary.crCount}, found ${actualCrCount}`,
    });
  }

  // 5. Total debits check (allow 0.01 tolerance)
  const actualTotalDebits = activeTxs
    .filter((t) => t.type === "debit")
    .reduce((sum, t) => sum + t.amount, 0);

  if (Math.abs(actualTotalDebits - summary.totalDebits) > 0.01) {
    mismatches.push({
      field: "totalDebits",
      label: "Total Debits",
      expected: summary.totalDebits,
      actual: actualTotalDebits,
      message: `Total debits mismatch: Expected ₹${summary.totalDebits.toLocaleString("en-IN", { minimumFractionDigits: 2 })}, found ₹${actualTotalDebits.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
    });
  }

  // 6. Total credits check (allow 0.01 tolerance)
  const actualTotalCredits = activeTxs
    .filter((t) => t.type === "credit")
    .reduce((sum, t) => sum + t.amount, 0);

  if (Math.abs(actualTotalCredits - summary.totalCredits) > 0.01) {
    mismatches.push({
      field: "totalCredits",
      label: "Total Credits",
      expected: summary.totalCredits,
      actual: actualTotalCredits,
      message: `Total credits mismatch: Expected ₹${summary.totalCredits.toLocaleString("en-IN", { minimumFractionDigits: 2 })}, found ₹${actualTotalCredits.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
    });
  }

  return {
    isReconciled: mismatches.length === 0,
    mismatches,
    summary,
    actual: {
      openingBalance: actualOpening,
      closingBalance: actualClosing,
      drCount: actualDrCount,
      crCount: actualCrCount,
      totalDebits: actualTotalDebits,
      totalCredits: actualTotalCredits,
    },
  };
}
