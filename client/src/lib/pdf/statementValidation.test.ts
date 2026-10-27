import { describe, it, expect } from "vitest";
import {
  validateStatementTransactions,
  updateTransactionAndValidate,
  toggleExcludeAndValidate,
  type ParsedTransaction,
} from "./validation";
import {
  extractStatementMetadata,
  computeStatementBalances,
  deriveStatementPeriod,
  deriveStatementMetadataFromTransactions,
  type StatementMetadata,
} from "./statementMeta";

// ============================================================================
// FAKE BANK STATEMENT FIXTURES (HDFC, ICICI, SBI)
// ============================================================================

const HDFC_STATEMENT_TEXT = `
================================================================================
HDFC BANK LIMITED
Branch: KANJURMARG, MUMBAI | IFSC: HDFC0000123
Account No: 50100492817291 (Savings Account)
Statement Period : 01/01/2026 to 31/01/2026
Opening Balance : INR 25,000.00
Closing Balance : INR 42,500.00
================================================================================
Date        Narration                             Chq/Ref No   Withdrawal   Deposit      Closing Balance
02/01/2026  SALARY CREDIT FROM ACME CORP         00001928     0.00         30,000.00    55,000.00
05/01/2026  UPI-SWIGGY FOOD ORDER-982137         UPI982137    500.00       0.00         54,500.00
12/01/2026  MSEB ELECTRICITY BILL MUMBAI         00049182     2,000.00     0.00         52,500.00
25/01/2026  RENT PAYMENT JAN 2026                NEFT19283    10,000.00    0.00         42,500.00
================================================================================
Total Withdrawals: 12,500.00 | Total Deposits: 30,000.00
`;

const ICICI_STATEMENT_TEXT = `
================================================================================
ICICI BANK LIMITED
Branch: INDIRANAGAR, BENGALURU | IFSC: ICIC0000456
Account Number: 001201592819
Statement From: 01-Feb-2026 to 28-Feb-2026
Opn Bal: 10,000.00
Cls Bal: 18,200.00
================================================================================
Transaction Date   Description                   Cheque No   Debit (INR)   Credit (INR)   Balance (INR)
02-Feb-2026        NEFT-INWARD-FREELANCE-PAY     REF10091    0.00          15,000.00      25,000.00
10-Feb-2026        AMAZON INDIA RETAIL BENGALURU REF10092    4,500.00      0.00           20,500.00
20-Feb-2026        ATM CASH WDL KORAMANGALA      REF10093    2,300.00      0.00           18,200.00
================================================================================
`;

const SBI_STATEMENT_TEXT = `
================================================================================
STATE BANK OF INDIA
Branch: CONNAUGHT PLACE, NEW DELHI | IFSC: SBIN0000691
Account: 30918274619
Period: 01/03/2026 to 31/03/2026
Balance B/F : 5,000.00
Balance C/F : 12,350.00
================================================================================
Txn Date    Value Date  Description                Ref No/Cheque  Debit      Credit     Balance
01/03/2026  01/03/2026  QUARTERLY INTEREST CREDIT  REF99100       0.00       350.00     5,350.00
15/03/2026  15/03/2026  TRANSFER FROM RELATIVE     REF99200       0.00       10,000.00  15,350.00
28/03/2026  28/03/2026  SIP MUTUAL FUND NIPPON     REF99300       3,000.00   0.00       12,350.00
================================================================================
`;

const validHdfcTransactions: ParsedTransaction[] = [
  {
    id: "hdfc-1",
    date: "2026-01-02",
    narration: "SALARY CREDIT FROM ACME CORP",
    type: "credit",
    amount: 30000,
    balance: 55000,
  },
  {
    id: "hdfc-2",
    date: "2026-01-05",
    narration: "UPI-SWIGGY FOOD ORDER-982137",
    type: "debit",
    amount: 500,
    balance: 54500,
  },
  {
    id: "hdfc-3",
    date: "2026-01-12",
    narration: "MSEB ELECTRICITY BILL MUMBAI",
    type: "debit",
    amount: 2000,
    balance: 52500,
  },
  {
    id: "hdfc-4",
    date: "2026-01-25",
    narration: "RENT PAYMENT JAN 2026",
    type: "debit",
    amount: 10000,
    balance: 42500,
  },
];

describe("Statement Metadata Extraction & Transaction Derivation", () => {
  it("extracts bank and never reads opening/closing balance from statement text", () => {
    const metaHdfc = extractStatementMetadata(HDFC_STATEMENT_TEXT);
    expect(metaHdfc.bank).toBe("HDFC");
    expect(metaHdfc.openingBalance).toBeUndefined();
    expect(metaHdfc.closingBalance).toBeUndefined();

    const metaIcici = extractStatementMetadata(ICICI_STATEMENT_TEXT);
    expect(metaIcici.bank).toBe("ICICI");
    expect(metaIcici.openingBalance).toBeUndefined();
    expect(metaIcici.closingBalance).toBeUndefined();

    const metaSbi = extractStatementMetadata(SBI_STATEMENT_TEXT);
    expect(metaSbi.bank).toBe("SBI");
    expect(metaSbi.openingBalance).toBeUndefined();
    expect(metaSbi.closingBalance).toBeUndefined();
  });

  it("derives openingBalance from first row, closingBalance from last row, and period from min/max dates", () => {
    const hdfcBalances = computeStatementBalances(validHdfcTransactions);
    expect(hdfcBalances.openingBalance).toBe(25000); // 55000 - 30000 credit
    expect(hdfcBalances.closingBalance).toBe(42500); // last row balance

    const hdfcPeriod = deriveStatementPeriod(validHdfcTransactions);
    expect(hdfcPeriod.startDate).toBe("2026-01-02");
    expect(hdfcPeriod.endDate).toBe("2026-01-25");

    const derived = deriveStatementMetadataFromTransactions(validHdfcTransactions, { bank: "HDFC" });
    expect(derived.bank).toBe("HDFC");
    expect(derived.openingBalance).toBe(25000);
    expect(derived.closingBalance).toBe(42500);
    expect(derived.startDate).toBe("2026-01-02");
    expect(derived.endDate).toBe("2026-01-25");
  });
});

describe("HDFC Statement Validation", () => {
  const hdfcMeta: StatementMetadata = {
    bank: "HDFC",
    openingBalance: 25000,
    closingBalance: 42500,
    startDate: "2026-01-01",
    endDate: "2026-01-31",
  };



  it("validates a clean HDFC statement with 100% valid rows", () => {
    const summary = validateStatementTransactions(validHdfcTransactions, hdfcMeta);

    expect(summary.totalRows).toBe(4);
    expect(summary.validRows).toBe(4);
    expect(summary.needsReviewRows).toBe(0);
    expect(summary.hasErrors).toBe(false);
    expect(summary.transactions.every((t) => t.status === "valid")).toBe(true);
  });

  it("flags row when running balance math is incorrect (prevBalance - amount != balance)", () => {
    const corruptedTxs: ParsedTransaction[] = [
      ...validHdfcTransactions.map((tx) => ({ ...tx })),
    ];
    // Introduce OCR / LLM calculation glitch on row 2:
    // 55000 - 500 = 54500, but LLM output 54000
    corruptedTxs[1].balance = 54000;

    const summary = validateStatementTransactions(corruptedTxs, hdfcMeta);

    expect(summary.hasErrors).toBe(true);
    expect(summary.needsReviewRows).toBeGreaterThanOrEqual(1);

    const flaggedRow = summary.transactions.find((t) => t.id === "hdfc-2");
    expect(flaggedRow).toBeDefined();
    expect(flaggedRow?.status).toBe("needs_review");
    expect(flaggedRow?.issues.some((i) => i.type === "MATH_MISMATCH")).toBe(true);
  });

  it("flags next row when running balance math is broken by corrupted first row", () => {
    const corruptedTxs: ParsedTransaction[] = [
      ...validHdfcTransactions.map((tx) => ({ ...tx })),
    ];
    // First row balance corrupted: 55000 changed to 50000
    corruptedTxs[0].balance = 50000;

    const summary = validateStatementTransactions(corruptedTxs, hdfcMeta);
    expect(summary.hasErrors).toBe(true);

    const secondRow = summary.transactions[1];
    expect(secondRow.status).toBe("needs_review");
    expect(secondRow.issues.some((i) => i.type === "MATH_MISMATCH")).toBe(true);
  });
});

describe("ICICI Statement Validation", () => {
  const iciciMeta: StatementMetadata = {
    bank: "ICICI",
    openingBalance: 10000,
    closingBalance: 18200,
    startDate: "2026-02-01",
    endDate: "2026-02-28",
  };

  const validIciciTransactions: ParsedTransaction[] = [
    {
      id: "icici-1",
      date: "2026-02-02",
      narration: "NEFT-INWARD-FREELANCE-PAY",
      type: "credit",
      amount: 15000,
      balance: 25000,
    },
    {
      id: "icici-2",
      date: "2026-02-10",
      narration: "AMAZON INDIA RETAIL BENGALURU",
      type: "debit",
      amount: 4500,
      balance: 20500,
    },
    {
      id: "icici-3",
      date: "2026-02-20",
      narration: "ATM CASH WDL KORAMANGALA",
      type: "debit",
      amount: 2300,
      balance: 18200,
    },
  ];

  it("validates a clean ICICI statement cleanly", () => {
    const summary = validateStatementTransactions(validIciciTransactions, iciciMeta);
    expect(summary.validRows).toBe(3);
    expect(summary.needsReviewRows).toBe(0);
    expect(summary.hasErrors).toBe(false);
  });

  it("flags row when date is out of chronological order", () => {
    const corruptedTxs: ParsedTransaction[] = [
      ...validIciciTransactions.map((tx) => ({ ...tx })),
    ];
    // Row 2 date jumped backwards to Jan
    corruptedTxs[1].date = "2026-01-20";

    const summary = validateStatementTransactions(corruptedTxs, iciciMeta);
    expect(summary.hasErrors).toBe(true);

    const row2 = summary.transactions.find((t) => t.id === "icici-2");
    expect(row2?.status).toBe("needs_review");
    expect(row2?.issues.some((i) => i.type === "DATE_OUT_OF_ORDER")).toBe(true);
    // Also out of range (Jan is outside Feb statement range)
    expect(row2?.issues.some((i) => i.type === "DATE_OUT_OF_RANGE")).toBe(true);
  });

  it("flags row when date exceeds statement end date", () => {
    const corruptedTxs: ParsedTransaction[] = [
      ...validIciciTransactions.map((tx) => ({ ...tx })),
    ];
    // Statement ends 2026-02-28, row 3 is 2026-03-05
    corruptedTxs[2].date = "2026-03-05";

    const summary = validateStatementTransactions(corruptedTxs, iciciMeta);
    expect(summary.hasErrors).toBe(true);

    const row3 = summary.transactions.find((t) => t.id === "icici-3");
    expect(row3?.status).toBe("needs_review");
    expect(row3?.issues.some((i) => i.type === "DATE_OUT_OF_RANGE")).toBe(true);
  });
});

describe("SBI Statement Validation", () => {
  const sbiMeta: StatementMetadata = {
    bank: "SBI",
    openingBalance: 5000,
    closingBalance: 12350,
    startDate: "2026-03-01",
    endDate: "2026-03-31",
  };

  const validSbiTransactions: ParsedTransaction[] = [
    {
      id: "sbi-1",
      date: "2026-03-01",
      narration: "QUARTERLY INTEREST CREDIT",
      type: "credit",
      amount: 350,
      balance: 5350,
    },
    {
      id: "sbi-2",
      date: "2026-03-15",
      narration: "TRANSFER FROM RELATIVE",
      type: "credit",
      amount: 10000,
      balance: 15350,
    },
    {
      id: "sbi-3",
      date: "2026-03-28",
      narration: "SIP MUTUAL FUND NIPPON",
      type: "debit",
      amount: 3000,
      balance: 12350,
    },
  ];

  it("validates a clean SBI statement cleanly", () => {
    const summary = validateStatementTransactions(validSbiTransactions, sbiMeta);
    expect(summary.validRows).toBe(3);
    expect(summary.needsReviewRows).toBe(0);
    expect(summary.hasErrors).toBe(false);
  });

  it("flags last row with MATH_MISMATCH when row balance is corrupted and verifies no closing balance mismatch check exists", () => {
    const corruptedTxs: ParsedTransaction[] = [
      ...validSbiTransactions.map((tx) => ({ ...tx })),
    ];
    // Last row balance corrupted: 15350 - 3000 should be 12350, but corrupted to 11000
    corruptedTxs[2].balance = 11000;

    const summary = validateStatementTransactions(corruptedTxs, sbiMeta);
    expect(summary.hasErrors).toBe(true);

    const lastRow = summary.transactions[summary.transactions.length - 1];
    expect(lastRow.status).toBe("needs_review");
    expect(lastRow.issues.some((i) => i.type === "MATH_MISMATCH")).toBe(true);
    // Requirement 2: Delete "Closing balance mismatch" check against statement closing balance entirely
    expect(lastRow.issues.some((i) => i.type === "CLOSING_BALANCE_MISMATCH")).toBe(false);
  });
});

describe("Needs-Review User Actions: Editing & Excluding Rows", () => {
  const hdfcMeta = extractStatementMetadata(HDFC_STATEMENT_TEXT);

  it("allows user to edit a faulty row to fix balance mismatch", () => {
    // Start with a row with an amount typo: amount was typed as 50 instead of 500
    const initialTxs: ParsedTransaction[] = [
      {
        id: "tx-1",
        date: "2026-01-02",
        narration: "SALARY",
        type: "credit",
        amount: 30000,
        balance: 55000,
      },
      {
        id: "tx-2",
        date: "2026-01-05",
        narration: "SWIGGY",
        type: "debit",
        amount: 50, // Typo! Should be 500
        balance: 54500, // 55000 - 50 = 54950 != 54500
      },
      {
        id: "tx-3",
        date: "2026-01-25",
        narration: "RENT",
        type: "debit",
        amount: 12000,
        balance: 42500, // 54500 - 12000 = 42500 (matches closing balance)
      },
    ];

    // Initial validation fails on tx-2
    const initialSummary = validateStatementTransactions(initialTxs, hdfcMeta);
    expect(initialSummary.needsReviewRows).toBe(1);
    expect(initialSummary.transactions.find((t) => t.id === "tx-2")?.status).toBe("needs_review");

    // User edits tx-2: fixes amount to 500
    const fixedTx: ParsedTransaction = {
      ...initialTxs[1],
      amount: 500,
    };

    const revalidatedSummary = updateTransactionAndValidate(initialTxs, fixedTx, hdfcMeta);

    // After fix, all rows should be valid!
    expect(revalidatedSummary.needsReviewRows).toBe(0);
    expect(revalidatedSummary.validRows).toBe(3);
    expect(revalidatedSummary.hasErrors).toBe(false);
    expect(revalidatedSummary.transactions.every((t) => t.status === "valid")).toBe(true);
  });

  it("allows user to exclude a phantom / erroneous row", () => {
    // LLM accidentally hallucinated an extra row between tx-1 and tx-3
    const txsWithHallucination: ParsedTransaction[] = [
      {
        id: "tx-1",
        date: "2026-01-02",
        narration: "SALARY",
        type: "credit",
        amount: 30000,
        balance: 55000,
      },
      {
        id: "tx-phantom",
        date: "2026-01-10",
        narration: "DUPLICATE OR BAD ROW",
        type: "debit",
        amount: 9999,
        balance: 9999, // Complete math mismatch
      },
      {
        id: "tx-3",
        date: "2026-01-25",
        narration: "RENT",
        type: "debit",
        amount: 12500,
        balance: 42500, // 55000 - 12500 = 42500
      },
    ];

    const initialSummary = validateStatementTransactions(txsWithHallucination, hdfcMeta);
    expect(initialSummary.hasErrors).toBe(true);

    // User marks tx-phantom as excluded
    const afterExcludeSummary = toggleExcludeAndValidate(
      txsWithHallucination,
      "tx-phantom",
      hdfcMeta
    );

    expect(afterExcludeSummary.excludedRows).toBe(1);
    expect(afterExcludeSummary.needsReviewRows).toBe(0);
    expect(afterExcludeSummary.validRows).toBe(2);
    expect(afterExcludeSummary.hasErrors).toBe(false);

    const phantom = afterExcludeSummary.transactions.find((t) => t.id === "tx-phantom");
    expect(phantom?.status).toBe("excluded");
    expect(phantom?.isExcluded).toBe(true);
  });

  it("handles decimal precision safely (e.g. 0.1 + 0.2 floating point anomaly)", () => {
    // 1000.10 + 200.20 in JS is 1200.3000000000002
    const precisionTxs: ParsedTransaction[] = [
      {
        id: "tx-prec-1",
        date: "2026-01-02",
        narration: "OPENING TEST",
        type: "credit",
        amount: 200.2,
        balance: 1200.3,
      },
      {
        id: "tx-prec-2",
        date: "2026-01-05",
        narration: "ADDITIONAL TEST",
        type: "credit",
        amount: 100.05,
        balance: 1300.35,
      },
    ];

    const meta = {
      openingBalance: 1000.1,
      closingBalance: 1300.35,
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    };

    const summary = validateStatementTransactions(precisionTxs, meta);
    expect(summary.hasErrors).toBe(false);
    expect(summary.validRows).toBe(2);
  });
});
