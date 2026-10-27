import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  splitTextIntoTransactionChunks,
  parsePagesWithLLM,
  parseChunkWithRetry,
  StatementParsingError,
  type ExtractedPage,
} from "./extractor";
import * as api from "../api";

describe("Statement Chunking & Retries (splitTextIntoTransactionChunks & parsePagesWithLLM)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("splits text with 65 transaction lines into 3 chunks (~30 per chunk)", () => {
    const lines: string[] = ["HDFC Bank Statement Header"];
    for (let i = 1; i <= 65; i++) {
      lines.push(`15/01/2026 UPI/SWIGGY/ORDER${i} 100.00 DR 5000.00`);
    }
    const sampleText = lines.join("\n");
    const chunks = splitTextIntoTransactionChunks(sampleText, 30);

    expect(chunks.length).toBe(3);
    expect(chunks[0]).toContain("UPI/SWIGGY/ORDER1");
    expect(chunks[0]).toContain("UPI/SWIGGY/ORDER30");
    expect(chunks[1]).toContain("UPI/SWIGGY/ORDER31");
    expect(chunks[1]).toContain("UPI/SWIGGY/ORDER60");
    expect(chunks[2]).toContain("UPI/SWIGGY/ORDER61");
    expect(chunks[2]).toContain("UPI/SWIGGY/ORDER65");
  });

  it("returns single chunk when transactions are <= 30", () => {
    const lines: string[] = ["HDFC Bank Statement Header"];
    for (let i = 1; i <= 10; i++) {
      lines.push(`15/01/2026 UPI/SWIGGY/ORDER${i} 100.00 DR 5000.00`);
    }
    const sampleText = lines.join("\n");
    const chunks = splitTextIntoTransactionChunks(sampleText, 30);

    expect(chunks.length).toBe(1);
    expect(chunks[0]).toContain("UPI/SWIGGY/ORDER1");
  });

  it("retries each chunk up to 4 times on 429/503 and reports 'Model busy, retrying (2/4)'", async () => {
    const mockPage: ExtractedPage = {
      pageNumber: 1,
      rawText: "Sample",
      redacted: {
        redactedText: "15/01/2026 UPI/SWIGGY/ORDER 100.00 DR 5000.00",
        redactedCount: 1,
      },
    };

    let callCount = 0;
    const progressCalls: any[] = [];

    vi.spyOn(api, "apiFetch").mockImplementation(async (endpoint) => {
      if (endpoint === "/parse") {
        callCount++;
        // Simulate 503 on first two calls, then succeed on 3rd call
        if (callCount < 3) {
          throw new api.ApiError(503, "The AI model is busy. Please try again in a minute.");
        }
        return {
          transactions: [
            {
              date: "2026-01-15",
              narration: "UPI/SWIGGY/ORDER",
              type: "debit",
              amount: 100,
              balance: 5000,
            },
          ],
          count: 1,
        };
      }
      return {};
    });

    const results = await parsePagesWithLLM(
      [mockPage],
      (prog) => {
        progressCalls.push(prog);
      },
      undefined,
      { chunkDelayMs: 0, retryDelays: [1, 2, 3, 4] }
    );

    expect(callCount).toBe(3);
    expect(results).toHaveLength(1);
    expect(results[0].narration).toBe("UPI/SWIGGY/ORDER");

    const retryMessages = progressCalls.map((p) => p.message).filter(Boolean);
    expect(retryMessages).toContain("Parsing chunk 1 of 1");
    expect(retryMessages).toContain("Model busy, retrying (1/4)");
    expect(retryMessages).toContain("Model busy, retrying (2/4)");
  });

  it("does not retry on 400/401/403/404 errors", async () => {
    let callCount = 0;
    vi.spyOn(api, "apiFetch").mockImplementation(async () => {
      callCount++;
      throw new api.ApiError(400, "Bad Request");
    });

    await expect(
      parseChunkWithRetry("Sample text", 0, undefined, [1, 2, 3, 4])
    ).rejects.toThrow();

    expect(callCount).toBe(1); // Exactly 1 attempt, zero retries
  });

  it("throws StatementParsingError when all attempts fail, capturing progress and parsed chunks", async () => {
    // 2 chunks of text
    const lines: string[] = [];
    for (let i = 1; i <= 60; i++) {
      lines.push(`15/01/2026 UPI/ORDER/${i} 10.00 DR 1000.00`);
    }
    const mockPage: ExtractedPage = {
      pageNumber: 1,
      rawText: "Sample",
      redacted: {
        redactedText: lines.join("\n"),
        redactedCount: 60,
      },
    };

    let callCount = 0;
    vi.spyOn(api, "apiFetch").mockImplementation(async (_endpoint, options) => {
      callCount++;
      const body = JSON.parse(String(options?.body || "{}"));
      // Chunk 1 succeeds
      if (body.pageNumber === 1) {
        return {
          transactions: [
            { date: "2026-01-15", narration: "UPI/ORDER/1", type: "debit", amount: 10, balance: 1000 },
          ],
          count: 1,
        };
      }
      // Chunk 2 always fails 503
      throw new api.ApiError(503, "The AI model is busy. Please try again in a minute.");
    });

    try {
      await parsePagesWithLLM([mockPage], undefined, undefined, {
        chunkDelayMs: 0,
        retryDelays: [1, 2, 3, 4],
      });
      expect.fail("Should have thrown StatementParsingError");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(StatementParsingError);
      const parseErr = err as StatementParsingError;
      expect(parseErr.status).toBe(503);
      expect(parseErr.message).toBe("The AI model is busy. Please try again in a minute.");
      expect(parseErr.failedChunkIndex).toBe(1); // Failed on 2nd chunk
      expect(parseErr.parsedTransactions).toHaveLength(1); // Preserved chunk 1 tx
      expect(parseErr.chunks.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("resumes from a failed chunk without starting over", async () => {
    let callCount = 0;
    vi.spyOn(api, "apiFetch").mockImplementation(async (_endpoint, options) => {
      callCount++;
      const body = JSON.parse(String(options?.body || "{}"));
      return {
        transactions: [
          { date: "2026-01-16", narration: `TX-FROM-CHUNK-${body.pageNumber}`, type: "credit", amount: 50, balance: 2000 },
        ],
        count: 1,
      };
    });

    const existingTxs = [
      { date: "2026-01-15", narration: "TX-FROM-CHUNK-1", type: "debit" as const, amount: 10, balance: 1000 },
    ];

    const resumeState = {
      chunks: ["Chunk 1 text", "Chunk 2 text", "Chunk 3 text"],
      startChunkIndex: 1, // Resume from chunk 2 (index 1)
      accumulatedTransactions: existingTxs,
      totalPages: 3,
    };

    const progressMessages: string[] = [];
    const results = await parsePagesWithLLM(
      [],
      (prog) => {
        if (prog.message) progressMessages.push(prog.message);
      },
      resumeState,
      { chunkDelayMs: 0, retryDelays: [1, 2, 3, 4] }
    );

    // Should only have called chunk 2 and chunk 3 (2 calls)
    expect(callCount).toBe(2);
    // Total results should include the existing chunk 1 plus chunk 2 and 3
    expect(results).toHaveLength(3);
    expect(results[0].narration).toBe("TX-FROM-CHUNK-1");
    expect(results[1].narration).toBe("TX-FROM-CHUNK-2");
    expect(results[2].narration).toBe("TX-FROM-CHUNK-3");
    expect(progressMessages).toContain("Parsing chunk 2 of 3");
    expect(progressMessages).toContain("Parsing chunk 3 of 3");
  });

  it("strips statement summary section before chunking so it is never sent to /api/parse", async () => {
    const sentChunks: string[] = [];
    vi.spyOn(api, "apiFetch").mockImplementation(async (_endpoint, options) => {
      const body = JSON.parse(String(options?.body || "{}"));
      sentChunks.push(body.text);
      return {
        transactions: [
          { date: "2026-07-01", narration: "LEGIT TRANSACTION", type: "debit", amount: 100, balance: 5000 },
        ],
        count: 1,
      };
    });

    const mockPage: ExtractedPage = {
      pageNumber: 1,
      rawText: "Sample",
      redacted: {
        redactedText: `01/07/2026 LEGIT TRANSACTION 100.00 DR 5000.00
Statement Summary
Brought Forward Dr Count Cr Count Total Debits Total Credits Closing Balance
5100.00 1 0 100.00 0.00 5000.00`,
        redactedCount: 1,
      },
    };

    let extractedSummary: any = null;
    const results = await parsePagesWithLLM(
      [mockPage],
      undefined,
      undefined,
      {
        chunkDelayMs: 0,
        retryDelays: [1, 2, 3, 4],
        onSummaryExtracted: (s) => {
          extractedSummary = s;
        },
      }
    );

    expect(results).toHaveLength(1);
    expect(sentChunks).toHaveLength(1);
    expect(sentChunks[0]).toContain("LEGIT TRANSACTION");
    expect(sentChunks[0]).not.toContain("Statement Summary");
    expect(sentChunks[0]).not.toContain("Brought Forward");
    expect(extractedSummary).toBeNull();
  });
});

