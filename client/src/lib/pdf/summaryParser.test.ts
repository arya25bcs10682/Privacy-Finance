import { describe, it, expect } from "vitest";
import {
  findSummarySectionIndex,
  truncatePagesAtSummaryMarker,
  parseStatementSummary,
  extractAndRemoveSummary,
  reconcileStatement,
  type StatementSummary,
} from "./statementSummary";
import {
  validateStatementTransactions,
  type ParsedTransaction,
} from "./validation";
import {
  computeStatementBalances,
  deriveStatementPeriod,
  deriveStatementMetadataFromTransactions,
  type StatementMetadata,
} from "./statementMeta";

describe("Statement Summary Parser & Reconciliation (Fabricated Test Data)", () => {
  describe("1. Summary Section Detection & Removal (extractAndRemoveSummary)", () => {
    it("locates and removes summary section starting with 'Statement Summary' heading and does not parse summary", () => {
      const sampleText = `01/02/2026 SALARY CREDIT 50000.00 CR 75000.00
05/02/2026 GROCERY STORE 2500.00 DR 72500.00
Statement Summary
Brought Forward Dr Count Cr Count Total Debits Total Credits Closing Balance
25000.00 1 1 2500.00 50000.00 72500.00
End of page 1`;

      const { cleanedText, removedSection, summary } = extractAndRemoveSummary(sampleText);

      expect(cleanedText).toBe(
        `01/02/2026 SALARY CREDIT 50000.00 CR 75000.00\n05/02/2026 GROCERY STORE 2500.00 DR 72500.00`
      );
      expect(cleanedText).not.toContain("Statement Summary");
      expect(cleanedText).not.toContain("Brought Forward");
      expect(removedSection).toContain("Statement Summary");
      expect(summary).toBeNull();
    });

    it("locates and truncates summary matching 'Brought Forward' together with 'Dr Count' on the same line", () => {
      const sampleText = `10/03/2026 UTILITY BILL 1200.00 DR 18800.00
Brought Forward  Dr Count  Cr Count  Total Debits  Total Credits  Closing Balance
20,000.00        1         0         1,200.00      0.00           18,800.00
Page 2 Footer Note`;

      const { cleanedText, removedSection, summary } = extractAndRemoveSummary(sampleText);

      expect(cleanedText).toBe("10/03/2026 UTILITY BILL 1200.00 DR 18800.00");
      expect(cleanedText).not.toContain("Brought Forward");
      expect(cleanedText).not.toContain("Page 2 Footer Note");
      expect(removedSection).toContain("Brought Forward");
      expect(summary).toBeNull();
    });

    it("locates and truncates summary when 'Brought Forward' and 'Dr Count' span adjacent lines", () => {
      const sampleText = `15/03/2026 RENT PAYMENT 15000.00 DR 5000.00
Brought Forward
Dr Count  Cr Count  Total Debits  Total Credits  Closing Balance
20000.00  1         0         15000.00      0.00           5000.00
Later Page 3 Content`;

      const { cleanedText, removedSection, summary } = extractAndRemoveSummary(sampleText);

      expect(cleanedText).toBe("15/03/2026 RENT PAYMENT 15000.00 DR 5000.00");
      expect(cleanedText).not.toContain("Brought Forward");
      expect(cleanedText).not.toContain("Later Page 3 Content");
      expect(removedSection).toContain("Brought Forward");
      expect(summary).toBeNull();
    });

    it("does NOT match 'Closing Balance' alone because it is a column header in the transaction table", () => {
      const sampleText = `Txn Date | Value Date | Narration | Chq/Ref | Withdrawal | Deposit | Closing Balance
01/01/2026 | 01/01/2026 | ATM CASH | 12345 | 500.00 | | 9500.00
02/01/2026 | 02/01/2026 | UPI CREDIT | 67890 | | 1000.00 | 10500.00`;

      const { cleanedText, removedSection, summary } = extractAndRemoveSummary(sampleText);

      // Should keep entire text intact without truncating
      expect(cleanedText).toBe(sampleText);
      expect(removedSection).toBeNull();
      expect(summary).toBeNull();
      expect(findSummarySectionIndex(sampleText)).toBe(-1);
    });

    it("does NOT remove 'Brought Forward' when it appears alone as opening balance without Dr Count", () => {
      const sampleText = `HDFC Bank Statement
Opening Balance Brought Forward: 15,000.00
10/03/2026 COFFEE SHOP 150.00 DR 14850.00`;

      const { cleanedText, removedSection, summary } = extractAndRemoveSummary(sampleText);

      expect(cleanedText).toBe(sampleText);
      expect(removedSection).toBeNull();
      expect(summary).toBeNull();
    });

    it("if no summary is found, process everything as before", () => {
      const normalText = `01/02/2026 GROCERY STORE 500.00 DR 4500.00\n02/02/2026 COFFEE SHOP 200.00 DR 4300.00`;
      const { cleanedText, removedSection, summary } = extractAndRemoveSummary(normalText);
      expect(cleanedText).toBe(normalText);
      expect(removedSection).toBeNull();
      expect(summary).toBeNull();
    });

    it("returns correct index with findSummarySectionIndex", () => {
      const text = "Tx1\nTx2\nStatement Summary\nBrought Forward Dr Count";
      const idx = findSummarySectionIndex(text);
      expect(idx).toBe(8);
      expect(findSummarySectionIndex("No summary here")).toBe(-1);
    });
  });

  describe("2. Deterministic Parsing of 6 Numeric Values (parseStatementSummary)", () => {
    it("parses numbers with commas and Dr/Cr suffixes correctly", () => {
      const summarySection = `Brought Forward | Dr Count | Cr Count | Total Debits | Total Credits | Closing Balance
14,500.75 Cr | 12 | 6 | 45,210.50 Dr | 80,000.00 Cr | 49,290.25 Cr`;

      const summary = parseStatementSummary(summarySection);

      expect(summary).toEqual({
        openingBalance: 14500.75,
        drCount: 12,
        crCount: 6,
        totalDebits: 45210.5,
        totalCredits: 80000.0,
        closingBalance: 49290.25,
      });
    });

    it("parses key-value labeled summary format", () => {
      const summarySection = `STATEMENT SUMMARY:
Brought Forward: INR 10,000.00
Dr Count: 5
Cr Count: 2
Total Debits: 3,500.00
Total Credits: 8,000.00
Closing Balance: INR 14,500.00`;

      const summary = parseStatementSummary(summarySection);

      expect(summary).toEqual({
        openingBalance: 10000.0,
        drCount: 5,
        crCount: 2,
        totalDebits: 3500.0,
        totalCredits: 8000.0,
        closingBalance: 14500.0,
      });
    });

    it("returns null without failing if fewer than 6 numbers are present", () => {
      const invalidSection = `Statement Summary
Brought Forward Dr Count Cr Count Total Debits Total Credits Closing Balance
10000.00 5 2 3500.00 8000.00`; // Only 5 numbers

      const summary = parseStatementSummary(invalidSection);
      expect(summary).toBeNull();
    });

    it("returns null if text is empty or blank", () => {
      expect(parseStatementSummary("")).toBeNull();
      expect(parseStatementSummary("   \n  ")).toBeNull();
    });
  });

  describe("3. Statement Reconciliation (reconcileStatement)", () => {
    const summary: StatementSummary = {
      openingBalance: 10000.0,
      drCount: 2,
      crCount: 1,
      totalDebits: 3000.0,
      totalCredits: 5000.0,
      closingBalance: 12000.0,
    };

    const validTxs: ParsedTransaction[] = [
      {
        id: "tx-1",
        date: "2026-04-01",
        narration: "FABRICATED VENDOR DEBIT 1",
        type: "debit",
        amount: 1000.0,
        balance: 9000.0,
      },
      {
        id: "tx-2",
        date: "2026-04-02",
        narration: "FABRICATED CLIENT CREDIT",
        type: "credit",
        amount: 5000.0,
        balance: 14000.0,
      },
      {
        id: "tx-3",
        date: "2026-04-03",
        narration: "FABRICATED VENDOR DEBIT 2",
        type: "debit",
        amount: 2000.0,
        balance: 12000.0,
      },
    ];

    it("returns isReconciled = true when opening/closing balances, counts, and totals match", () => {
      const result = reconcileStatement(validTxs, summary);

      expect(result).not.toBeNull();
      expect(result?.isReconciled).toBe(true);
      expect(result?.mismatches).toHaveLength(0);
      expect(result?.actual.openingBalance).toBe(10000.0);
      expect(result?.actual.closingBalance).toBe(12000.0);
      expect(result?.actual.drCount).toBe(2);
      expect(result?.actual.crCount).toBe(1);
      expect(result?.actual.totalDebits).toBe(3000.0);
      expect(result?.actual.totalCredits).toBe(5000.0);
    });

    it("allows 0.01 tolerance for floating point calculations", () => {
      const summaryWithCent: StatementSummary = {
        openingBalance: 10000.0,
        drCount: 2,
        crCount: 1,
        totalDebits: 3000.005, // 0.005 difference from 3000.0
        totalCredits: 4999.995, // 0.005 difference from 5000.0
        closingBalance: 12000.004,
      };

      const result = reconcileStatement(validTxs, summaryWithCent);
      expect(result?.isReconciled).toBe(true);
    });

    it("detects opening balance mismatch", () => {
      const mismatchedSummary: StatementSummary = {
        ...summary,
        openingBalance: 15000.0, // Expected 15000, but first row implies 10000
      };

      const result = reconcileStatement(validTxs, mismatchedSummary);
      expect(result?.isReconciled).toBe(false);
      expect(result?.mismatches.some((m) => m.field === "openingBalance")).toBe(true);
    });

    it("detects closing balance mismatch", () => {
      const mismatchedSummary: StatementSummary = {
        ...summary,
        closingBalance: 11000.0, // Expected 11000, but last row is 12000
      };

      const result = reconcileStatement(validTxs, mismatchedSummary);
      expect(result?.isReconciled).toBe(false);
      expect(result?.mismatches.some((m) => m.field === "closingBalance")).toBe(true);
    });

    it("detects debit and credit count mismatches", () => {
      const mismatchedSummary: StatementSummary = {
        ...summary,
        drCount: 5, // Expected 5, actual is 2
        crCount: 3, // Expected 3, actual is 1
      };

      const result = reconcileStatement(validTxs, mismatchedSummary);
      expect(result?.isReconciled).toBe(false);
      expect(result?.mismatches.some((m) => m.field === "drCount")).toBe(true);
      expect(result?.mismatches.some((m) => m.field === "crCount")).toBe(true);
    });

    it("detects total debits and total credits mismatches", () => {
      const mismatchedSummary: StatementSummary = {
        ...summary,
        totalDebits: 4500.0, // Expected 4500, actual is 3000
        totalCredits: 8000.0, // Expected 8000, actual is 5000
      };

      const result = reconcileStatement(validTxs, mismatchedSummary);
      expect(result?.isReconciled).toBe(false);
      expect(result?.mismatches.some((m) => m.field === "totalDebits")).toBe(true);
      expect(result?.mismatches.some((m) => m.field === "totalCredits")).toBe(true);
    });
  });

  describe("4. Rejection of Incomplete LLM Rows (validateStatementTransactions)", () => {
    it("rejects rows without valid date, narration, or numeric balance and flags them as needs_review", () => {
      const badTxs: ParsedTransaction[] = [
        {
          id: "bad-1",
          date: "", // Missing date
          narration: "VALID NARRATION",
          type: "debit",
          amount: 50.0,
          balance: 1000.0,
        },
        {
          id: "bad-2",
          date: "2026-05-01",
          narration: "   ", // Blank narration
          type: "debit",
          amount: 100.0,
          balance: 900.0,
        },
        {
          id: "bad-3",
          date: "2026-05-02",
          narration: "VALID NARRATION 3",
          type: "debit",
          amount: 150.0,
          balance: NaN, // Invalid balance
        },
      ];

      const summary = validateStatementTransactions(badTxs);

      expect(summary.needsReviewRows).toBe(3);
      expect(summary.validRows).toBe(0);

      // Verify specific issues
      expect(summary.transactions[0].issues.some((i) => i.type === "INVALID_DATE")).toBe(true);
      expect(summary.transactions[1].issues.some((i) => i.type === "INVALID_NARRATION")).toBe(true);
      expect(summary.transactions[2].issues.some((i) => i.type === "INVALID_BALANCE")).toBe(true);
    });

    it("integrates reconciliation seamlessly when summary is passed via metadata", () => {
      const mockMeta: StatementMetadata = {
        summary: {
          openingBalance: 5000.0,
          drCount: 1,
          crCount: 0,
          totalDebits: 500.0,
          totalCredits: 0.0,
          closingBalance: 4500.0,
        },
      };

      const txs: ParsedTransaction[] = [
        {
          id: "tx-1",
          date: "2026-06-01",
          narration: "OFFICE EXPENSE",
          type: "debit",
          amount: 500.0,
          balance: 4500.0,
        },
      ];

      const validation = validateStatementTransactions(txs, mockMeta);
      expect(validation.validRows).toBe(1);
      expect(validation.needsReviewRows).toBe(0);
      expect(validation.reconciliation).toBeDefined();
      expect(validation.reconciliation?.isReconciled).toBe(true);
    });
  });

  describe("4. Source Fix: Summary Headers & Values Dropped Before LLM (Requirement 6)", () => {
    it("truncates extracted text so summary header and values appearing after the last transaction are NEVER sent to the LLM", () => {
      // Fabricated multi-page document text where summary table and values appear after the last transaction on page 2
      const page1Text = [
        "ACME REGIONAL BANK - ACCOUNT STATEMENT",
        "Date | Description | Chq No | Debit | Credit | Balance",
        "01/01/2026 | SALARY CREDIT | 1001 | 0.00 | 50,000.00 | 75,000.00",
        "12/01/2026 | SUPERMARKET GROCERIES | 1002 | 3,500.00 | 0.00 | 71,500.00",
        "28/01/2026 | BROADBAND INTERNET BILL | 1003 | 1,500.00 | 0.00 | 70,000.00",
      ].join("\n");

      const page2Text = [
        "Statement Summary",
        "Brought Forward | Dr Count | Cr Count | Total Debits | Total Credits | Closing Balance",
        "25,000.00 | 2 | 1 | 7,890.00 | 50,000.00 | 70,000.00",
        "IMPORTANT NOTICE: Keep your credentials safe. Never share OTP or passwords.",
        "Page 2 of 2",
      ].join("\n");

      const extractedPages = [
        { pageNumber: 1, rawText: page1Text, redacted: { redactedText: page1Text } },
        { pageNumber: 2, rawText: page2Text, redacted: { redactedText: page2Text } },
      ];

      // 1. Truncate pages before any LLM call
      const { truncatedPages, markerFound, pageNumber, charsKept, cleanedText } =
        truncatePagesAtSummaryMarker(extractedPages);

      // Verify marker was located on page 2 and logged properly
      expect(markerFound).toBe(true);
      expect(pageNumber).toBe(2);
      expect(charsKept).toBeGreaterThan(0);

      // Verify page 2 was completely dropped
      expect(truncatedPages.length).toBe(1);
      expect(truncatedPages[0].pageNumber).toBe(1);

      // Verify that summary headers and values MUST NOT be in the text sent to the LLM
      expect(cleanedText).not.toContain("Statement Summary");
      expect(cleanedText).not.toContain("Brought Forward");
      expect(cleanedText).not.toContain("Dr Count");
      expect(cleanedText).not.toContain("Cr Count");
      expect(cleanedText).not.toContain("Total Debits");
      expect(cleanedText).not.toContain("Total Credits");
      expect(cleanedText).not.toContain("25,000.00"); // Summary opening balance
      expect(cleanedText).not.toContain("7,890.00");  // Summary total debits
      expect(cleanedText).not.toContain("IMPORTANT NOTICE");

      // Verify transactions on page 1 are preserved
      expect(cleanedText).toContain("SALARY CREDIT");
      expect(cleanedText).toContain("BROADBAND INTERNET BILL");

      // 2. Simulated parsed rows from LLM (LLM only received page 1)
      const parsedRows: ParsedTransaction[] = [
        {
          id: "row-1",
          date: "2026-01-01",
          narration: "SALARY CREDIT",
          type: "credit",
          amount: 50000,
          balance: 75000,
        },
        {
          id: "row-2",
          date: "2026-01-12",
          narration: "SUPERMARKET GROCERIES",
          type: "debit",
          amount: 3500,
          balance: 71500,
        },
        {
          id: "row-3",
          date: "2026-01-28",
          narration: "BROADBAND INTERNET BILL",
          type: "debit",
          amount: 1500,
          balance: 70000,
        },
      ];

      // 3. Compute openingBalance and closingBalance from parsed rows (Requirement 1)
      const balances = computeStatementBalances(parsedRows);
      // Row 1 balance 75000 - credit 50000 = 25000
      expect(balances.openingBalance).toBe(25000);
      // Last row balance = 70000
      expect(balances.closingBalance).toBe(70000);

      // 4. Derive period from min and max row dates (Requirement 4)
      const period = deriveStatementPeriod(parsedRows);
      expect(period.startDate).toBe("2026-01-01");
      expect(period.endDate).toBe("2026-01-28");

      // 5. Derive metadata and validate with per-row running balance (Requirement 1 & 2)
      const derivedMeta = deriveStatementMetadataFromTransactions(parsedRows);
      expect(derivedMeta.openingBalance).toBe(25000);
      expect(derivedMeta.closingBalance).toBe(70000);
      expect(derivedMeta.startDate).toBe("2026-01-01");
      expect(derivedMeta.endDate).toBe("2026-01-28");

      const validation = validateStatementTransactions(parsedRows, derivedMeta);
      expect(validation.validRows).toBe(3);
      expect(validation.hasErrors).toBe(false);
    });
  });
});
