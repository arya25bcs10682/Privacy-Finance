import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  parseTabularData,
  extractTransactionsFromTabular,
  type BankColumnMapping,
} from "./parser";
import { saveBankMapping, getBankMapping } from "../storage/bankMappingStorage";
import { generateDataKey, hmacTxHash } from "../crypto";
import { validateStatementTransactions } from "../pdf/validation";

describe("Tabular Parser (CSV & XLSX)", () => {
  it("auto-detects HDFC CSV columns and metadata accurately", () => {
    const csvContent = [
      "HDFC BANK LIMITED",
      "Statement Period: 01/01/2026 to 31/01/2026",
      '"Opening Balance: INR 25,000.00"',
      '"Closing Balance: INR 42,500.00"',
      "",
      "Date,Narration,Chq/Ref No,Value Dt,Withdrawal Amt,Deposit Amt,Closing Balance",
      "02/01/2026,SALARY CREDIT FROM ACME CORP,REF01,02/01/2026,0.00,30000.00,55000.00",
      "05/01/2026,UPI-SWIGGY FOOD ORDER,REF02,05/01/2026,500.00,0.00,54500.00",
      "12/01/2026,MSEB ELECTRICITY BILL,REF03,12/01/2026,2000.00,0.00,52500.00",
      "25/01/2026,RENT PAYMENT JAN 2026,REF04,25/01/2026,10000.00,0.00,42500.00",
    ].join("\n");

    const buffer = new TextEncoder().encode(csvContent);
    const result = parseTabularData(buffer);

    expect(result.detectedBank).toBe("HDFC");
    expect(result.metadata.openingBalance).toBe(25000);
    expect(result.metadata.closingBalance).toBe(42500);
    expect(result.metadata.startDate).toBe("2026-01-01");
    expect(result.metadata.endDate).toBe("2026-01-31");

    // Check detected column mappings
    expect(result.detectedMapping.dateColumn).toBe("Date");
    expect(result.detectedMapping.narrationColumn).toBe("Narration");
    expect(result.detectedMapping.debitColumn).toBe("Withdrawal Amt");
    expect(result.detectedMapping.creditColumn).toBe("Deposit Amt");
    expect(result.detectedMapping.balanceColumn).toBe("Closing Balance");

    // Extract transactions using the mapping
    const txs = extractTransactionsFromTabular(
      result.rawRows,
      result.headerRowIndex,
      result.detectedMapping
    );

    expect(txs.length).toBe(4);
    expect(txs[0].date).toBe("2026-01-02");
    expect(txs[0].amount).toBe(30000);
    expect(txs[0].type).toBe("credit");
    expect(txs[0].balance).toBe(55000);

    expect(txs[1].date).toBe("2026-01-05");
    expect(txs[1].amount).toBe(500);
    expect(txs[1].type).toBe("debit");
    expect(txs[1].balance).toBe(54500);

    // Reuse validation flow
    const summary = validateStatementTransactions(txs, result.metadata);
    expect(summary.hasErrors).toBe(false);
    expect(summary.validRows).toBe(4);
    expect(summary.needsReviewRows).toBe(0);
  });

  it("auto-detects ICICI Excel (XLSX) columns and parses transactions cleanly", () => {
    // Construct in-memory XLSX workbook
    const wsData = [
      ["ICICI BANK LIMITED"],
      ["Statement From: 01-Feb-2026 to 28-Feb-2026"],
      ["Opn Bal: 10,000.00"],
      ["Cls Bal: 18,200.00"],
      [],
      ["Transaction Date", "Description", "Cheque No", "Debit (INR)", "Credit (INR)", "Balance (INR)"],
      ["02-Feb-2026", "NEFT-INWARD-FREELANCE-PAY", "REF101", 0, 15000, 25000],
      ["10-Feb-2026", "AMAZON INDIA RETAIL BENGALURU", "REF102", 4500, 0, 20500],
      ["20-Feb-2026", "ATM CASH WDL KORAMANGALA", "REF103", 2300, 0, 18200],
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const xlsxBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;

    const result = parseTabularData(xlsxBuffer);
    expect(result.detectedBank).toBe("ICICI");
    expect(result.metadata.openingBalance).toBe(10000);
    expect(result.metadata.closingBalance).toBe(18200);

    expect(result.detectedMapping.dateColumn).toBe("Transaction Date");
    expect(result.detectedMapping.narrationColumn).toBe("Description");
    expect(result.detectedMapping.debitColumn).toBe("Debit (INR)");
    expect(result.detectedMapping.creditColumn).toBe("Credit (INR)");
    expect(result.detectedMapping.balanceColumn).toBe("Balance (INR)");

    const txs = extractTransactionsFromTabular(
      result.rawRows,
      result.headerRowIndex,
      result.detectedMapping
    );

    expect(txs.length).toBe(3);
    expect(txs[0].date).toBe("2026-02-02");
    expect(txs[0].amount).toBe(15000);
    expect(txs[0].type).toBe("credit");

    // Reuse validation flow
    const summary = validateStatementTransactions(txs, result.metadata);
    expect(summary.hasErrors).toBe(false);
    expect(summary.validRows).toBe(3);
  });

  it("auto-detects SBI CSV layout and detects math discrepancies in needs-review list", () => {
    const sbiCsv = [
      "STATE BANK OF INDIA",
      "Period: 01/03/2026 to 31/03/2026",
      "Balance B/F : 5,000.00",
      "Balance C/F : 12,350.00",
      "",
      "Txn Date,Value Date,Description,Ref No/Cheque,Debit,Credit,Balance",
      "01/03/2026,01/03/2026,QUARTERLY INTEREST CREDIT,REF991,0.00,350.00,5350.00",
      "15/03/2026,15/03/2026,TRANSFER FROM RELATIVE,REF992,0.00,10000.00,15000.00", // Glitch: 5350+10000 = 15350 != 15000
      "28/03/2026,28/03/2026,SIP MUTUAL FUND NIPPON,REF993,3000.00,0.00,12350.00",
    ].join("\n");

    const result = parseTabularData(new TextEncoder().encode(sbiCsv));
    expect(result.detectedBank).toBe("SBI");

    const txs = extractTransactionsFromTabular(
      result.rawRows,
      result.headerRowIndex,
      result.detectedMapping
    );

    // Validate using the shared validation flow
    const summary = validateStatementTransactions(txs, result.metadata);
    expect(summary.hasErrors).toBe(true);
    expect(summary.needsReviewRows).toBeGreaterThanOrEqual(1);

    const flaggedRow = summary.transactions.find((t) => t.id === txs[1].id);
    expect(flaggedRow?.status).toBe("needs_review");
    expect(flaggedRow?.issues.some((i) => i.type === "MATH_MISMATCH")).toBe(true);
  });

  it("saves and retrieves encrypted bank column mappings using AES-GCM 256", async () => {
    const dataKey = await generateDataKey();

    const hdfcMapping: BankColumnMapping = {
      bank: "HDFC",
      dateColumn: "Date",
      narrationColumn: "Narration",
      debitColumn: "Withdrawal Amt",
      creditColumn: "Deposit Amt",
      balanceColumn: "Closing Balance",
    };

    // Save encrypted mapping
    await saveBankMapping("HDFC", hdfcMapping, dataKey);

    // Retrieve and decrypt
    const retrieved = await getBankMapping("HDFC", dataKey);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.bank).toBe("HDFC");
    expect(retrieved?.dateColumn).toBe("Date");
    expect(retrieved?.narrationColumn).toBe("Narration");
    expect(retrieved?.debitColumn).toBe("Withdrawal Amt");
    expect(retrieved?.creditColumn).toBe("Deposit Amt");
    expect(retrieved?.balanceColumn).toBe("Closing Balance");

    // Case-insensitive lookup
    const retrievedLower = await getBankMapping("hdfc", dataKey);
    expect(retrievedLower?.bank).toBe("HDFC");

    // Non-existent bank returns null
    const nonExistent = await getBankMapping("AXIS", dataKey);
    expect(nonExistent).toBeNull();
  });

  it("produces deterministic deduplication hash for CSV parsed transactions", async () => {
    const dataKey = await generateDataKey();

    const parsedTx = {
      date: "2026-01-02",
      narration: "SALARY CREDIT CORP",
      type: "credit" as const,
      amount: 30000,
      balance: 55000,
    };

    const hash1 = await hmacTxHash(
      {
        date: parsedTx.date,
        amount: parsedTx.amount,
        type: parsedTx.type,
        cleanedDescription: parsedTx.narration,
        runningBalance: parsedTx.balance,
      },
      dataKey
    );

    const hash2 = await hmacTxHash(
      {
        date: parsedTx.date,
        amount: parsedTx.amount,
        type: parsedTx.type,
        cleanedDescription: parsedTx.narration,
        runningBalance: parsedTx.balance,
      },
      dataKey
    );

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });
});
