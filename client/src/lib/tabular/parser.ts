import * as XLSX from "xlsx";
import {
  parseFlexibleDate,
  extractStatementMetadata,
  deriveStatementMetadataFromTransactions,
  type StatementMetadata,
} from "../pdf/statementMeta";
import type { ParsedTransaction } from "../pdf/validation";

export interface BankColumnMapping {
  bank: string;
  dateColumn: string;
  narrationColumn: string;
  debitColumn?: string;
  creditColumn?: string;
  amountColumn?: string;
  typeColumn?: string;
  balanceColumn: string;
}

export interface TabularParseResult {
  headers: string[];
  detectedMapping: BankColumnMapping;
  detectedBank: string;
  metadata: StatementMetadata;
  rawRows: string[][];
  headerRowIndex: number;
}

// Regex patterns for header detection
const HEADER_PATTERNS = {
  date: /(?:^|[_\s])(txn[_\s]?date|trans(?:action)?[_\s]?date|posting[_\s]?date|value[_\s]?date|date)(?:[_\s]|$)/i,
  narration: /(?:^|[_\s])(narration|description|particulars?|remarks?|details?|memo|transaction[_\s]?particulars)(?:[_\s]|$)/i,
  debit: /(?:^|[_\s])(debit[_\s]?amt(?:ount)?|withdrawal[_\s]?(?:amt|amount)?|dr[_\s]?amt(?:ount)?|withdrawal|debit|dr)(?:[_\s]|$)/i,
  credit: /(?:^|[_\s])(credit[_\s]?amt(?:ount)?|deposit[_\s]?(?:amt|amount)?|cr[_\s]?amt(?:ount)?|deposit|credit|cr)(?:[_\s]|$)/i,
  balance: /(?:^|[_\s])(closing[_\s]?bal(?:ance)?|running[_\s]?bal(?:ance)?|available[_\s]?bal(?:ance)?|balance|bal)(?:[_\s]|$)/i,
  amount: /(?:^|[_\s])(txn[_\s]?amt(?:ount)?|net[_\s]?amt(?:ount)?|transaction[_\s]?amount|amount)(?:[_\s]|$)/i,
  type: /(?:^|[_\s])(dr[\s/_]?cr|trans(?:action)?[_\s]?type|type)(?:[_\s]|$)/i,
};

function parseNumber(val: unknown): number {
  if (typeof val === "number") return val;
  if (!val) return 0;
  const str = String(val).replace(/[^\d.-]/g, "").trim();
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

/**
 * Finds the best header matching a regex among available headers.
 */
function findBestHeader(headers: string[], regex: RegExp): string | undefined {
  return headers.find((h) => regex.test(h.trim()));
}

/**
 * Detects the bank name from raw text or headers.
 */
export function detectBankName(rawText: string): "HDFC" | "ICICI" | "SBI" | string {
  if (/HDFC\s*BANK/i.test(rawText)) return "HDFC";
  if (/ICICI\s*BANK/i.test(rawText)) return "ICICI";
  if (/STATE\s*BANK\s*OF\s*INDIA|SBI/i.test(rawText)) return "SBI";
  return "Custom Bank";
}

/**
 * Parses raw CSV or XLSX bytes and auto-detects columns, header row, and statement metadata.
 */
export function parseTabularData(fileData: ArrayBuffer | Uint8Array): TabularParseResult {
  const workbook = XLSX.read(fileData, { type: "array", raw: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new Error("The selected file does not contain any readable sheets.");
  }

  // Convert to 2D array of strings
  const rawRows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  }) as string[][];

  if (rawRows.length === 0) {
    throw new Error("The selected sheet is completely empty.");
  }

  // Combine top/bottom text to extract bank name, opening/closing balance, period
  const allText = rawRows
    .slice(0, 30)
    .concat(rawRows.slice(-15))
    .map((r) => r.join(" "))
    .join("\n");

  const metadata = extractStatementMetadata(allText);
  const detectedBank = detectBankName(allText);
  if (!metadata.bank && detectedBank !== "Custom Bank") {
    metadata.bank = detectedBank;
  }

  // Find the header row by scoring rows against expected columns
  let bestRowIndex = 0;
  let maxScore = -1;

  for (let r = 0; r < Math.min(rawRows.length, 30); r++) {
    const row = rawRows[r].map((cell) => String(cell || "").trim());
    if (row.length === 0) continue;

    let score = 0;
    if (row.some((c) => HEADER_PATTERNS.date.test(c))) score += 2;
    if (row.some((c) => HEADER_PATTERNS.narration.test(c))) score += 2;
    if (row.some((c) => HEADER_PATTERNS.debit.test(c))) score += 1.5;
    if (row.some((c) => HEADER_PATTERNS.credit.test(c))) score += 1.5;
    if (row.some((c) => HEADER_PATTERNS.balance.test(c))) score += 2;
    if (row.some((c) => HEADER_PATTERNS.amount.test(c))) score += 1;

    if (score > maxScore) {
      maxScore = score;
      bestRowIndex = r;
    }
  }

  const rawHeaders = rawRows[bestRowIndex] || [];
  const headers = rawHeaders.map((h, i) => String(h || "").trim() || `Column_${i + 1}`);

  // Auto-detect columns
  const dateCol = findBestHeader(headers, HEADER_PATTERNS.date) || headers[0] || "";
  const narrCol = findBestHeader(headers, HEADER_PATTERNS.narration) || headers[1] || "";
  const debitCol = findBestHeader(headers, HEADER_PATTERNS.debit);
  const creditCol = findBestHeader(headers, HEADER_PATTERNS.credit);
  const balCol = findBestHeader(headers, HEADER_PATTERNS.balance) || headers[headers.length - 1] || "";
  const amountCol = findBestHeader(headers, HEADER_PATTERNS.amount);
  const typeCol = findBestHeader(headers, HEADER_PATTERNS.type);

  const detectedMapping: BankColumnMapping = {
    bank: detectedBank,
    dateColumn: dateCol,
    narrationColumn: narrCol,
    debitColumn: debitCol || (amountCol ? undefined : headers[2]),
    creditColumn: creditCol || (amountCol ? undefined : headers[3]),
    amountColumn: !debitCol && !creditCol ? amountCol : undefined,
    typeColumn: !debitCol && !creditCol ? typeCol : undefined,
    balanceColumn: balCol,
  };

  const previewTxs = extractTransactionsFromTabular(rawRows, bestRowIndex, detectedMapping);
  const derivedMeta = deriveStatementMetadataFromTransactions(previewTxs, metadata);

  return {
    headers,
    detectedMapping,
    detectedBank,
    metadata: derivedMeta,
    rawRows,
    headerRowIndex: bestRowIndex,
  };
}

/**
 * Extracts and maps rows from the tabular file into standard ParsedTransaction format.
 */
export function extractTransactionsFromTabular(
  rawRows: string[][],
  headerRowIndex: number,
  mapping: BankColumnMapping
): ParsedTransaction[] {
  const headers = rawRows[headerRowIndex].map((h, i) => String(h || "").trim() || `Column_${i + 1}`);

  const dateIdx = headers.indexOf(mapping.dateColumn);
  const narrIdx = headers.indexOf(mapping.narrationColumn);
  const debitIdx = mapping.debitColumn ? headers.indexOf(mapping.debitColumn) : -1;
  const creditIdx = mapping.creditColumn ? headers.indexOf(mapping.creditColumn) : -1;
  const amountIdx = mapping.amountColumn ? headers.indexOf(mapping.amountColumn) : -1;
  const typeIdx = mapping.typeColumn ? headers.indexOf(mapping.typeColumn) : -1;
  const balIdx = headers.indexOf(mapping.balanceColumn);

  const transactions: ParsedTransaction[] = [];

  for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || row.length === 0) continue;

    const rawDate = dateIdx >= 0 ? String(row[dateIdx] || "").trim() : "";
    if (!rawDate) continue;

    const parsedDate = parseFlexibleDate(rawDate);
    if (!parsedDate) continue; // Skip non-date rows (such as summary or empty lines)

    const narration = narrIdx >= 0 ? String(row[narrIdx] || "").trim() : "Transaction";

    let amount = 0;
    let type: "debit" | "credit" = "debit";

    if (debitIdx >= 0 && creditIdx >= 0) {
      const debitVal = parseNumber(row[debitIdx]);
      const creditVal = parseNumber(row[creditIdx]);

      if (creditVal > 0) {
        amount = creditVal;
        type = "credit";
      } else if (debitVal > 0) {
        amount = debitVal;
        type = "debit";
      } else {
        continue; // Skip lines with 0 amount
      }
    } else if (amountIdx >= 0) {
      const amtVal = parseNumber(row[amountIdx]);
      amount = Math.abs(amtVal);

      if (typeIdx >= 0) {
        const typeStr = String(row[typeIdx] || "").toLowerCase();
        type = typeStr.includes("cr") || typeStr.includes("credit") || typeStr.includes("dep") ? "credit" : "debit";
      } else {
        type = amtVal >= 0 ? "credit" : "debit";
      }
    } else {
      continue;
    }

    const balance = balIdx >= 0 ? parseNumber(row[balIdx]) : 0;

    transactions.push({
      id: `tab-${r}-${Date.now()}`,
      date: parsedDate,
      narration,
      type,
      amount,
      balance,
      isExcluded: false,
    });
  }

  return transactions;
}
