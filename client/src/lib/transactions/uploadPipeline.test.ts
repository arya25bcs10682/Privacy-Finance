import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeHashesAndCheckDuplicates,
  uploadOnlyNewTransactions,
  type ReviewableTransaction,
} from "./uploadPipeline";
import { generateDataKey, decryptJSON } from "../crypto";
import type { ValidatedTransaction } from "../pdf/validation";
import * as apiModule from "../api";

describe("Upload Pipeline & Deduplication", () => {
  let dataKey: CryptoKey;

  beforeEach(async () => {
    dataKey = await generateDataKey();
    vi.restoreAllMocks();
  });

  const sampleValidatedTransactions: ValidatedTransaction[] = [
    {
      id: "tx-1",
      date: "2026-01-02",
      narration: "SALARY CREDIT CORP",
      type: "credit",
      amount: 30000,
      balance: 55000,
      issues: [],
      status: "valid",
      isExcluded: false,
    },
    {
      id: "tx-2",
      date: "2026-01-05",
      narration: "SWIGGY BANGALORE",
      type: "debit",
      amount: 500,
      balance: 54500,
      issues: [],
      status: "valid",
      isExcluded: false,
    },
    {
      id: "tx-3",
      date: "2026-01-12",
      narration: "MSEB ELECTRICITY BILL",
      type: "debit",
      amount: 2000,
      balance: 52500,
      issues: [],
      status: "valid",
      isExcluded: false,
    },
  ];

  it("computes txHash for each transaction and identifies new vs duplicate hashes", async () => {
    // Mock apiFetch for /transactions/check-hashes to return tx-2's hash as existing
    const apiFetchSpy = vi.spyOn(apiModule, "apiFetch").mockImplementation(async (endpoint, options) => {
      if (endpoint === "/transactions/check-hashes" && options?.body) {
        const body = JSON.parse(options.body as string);
        const hashes: string[] = body.txHashes;
        // Pretend the second hash already exists in MongoDB
        return {
          existingHashes: [hashes[1]],
          duplicateCount: 1,
          newCount: hashes.length - 1,
        } as unknown as ReturnType<typeof apiModule.apiFetch>;
      }
      return {} as ReturnType<typeof apiModule.apiFetch>;
    });

    const result = await computeHashesAndCheckDuplicates(
      sampleValidatedTransactions,
      dataKey
    );

    expect(apiFetchSpy).toHaveBeenCalledTimes(1);
    expect(result.annotated.length).toBe(3);

    // Each transaction has a valid 64-character SHA-256 hex txHash
    for (const tx of result.annotated) {
      expect(tx.txHash).toMatch(/^[a-f0-9]{64}$/);
    }

    // Counts
    expect(result.newCount).toBe(2);
    expect(result.duplicateCount).toBe(1);

    // Row 1 is new
    expect(result.annotated[0].isDuplicate).toBe(false);

    // Row 2 is duplicate
    expect(result.annotated[1].isDuplicate).toBe(true);

    // Row 3 is new
    expect(result.annotated[2].isDuplicate).toBe(false);
  });

  it("encrypts and bulk-uploads ONLY the new transactions (never duplicates or plaintext)", async () => {
    let bulkRequestBody: {
      transactions: Array<{
        txHash: string;
        month: string;
        encryptedPayload: { iv: string; ct: string };
      }>;
    } | null = null;

    vi.spyOn(apiModule, "apiFetch").mockImplementation(async (endpoint, options) => {
      if (endpoint === "/transactions/bulk" && options?.body) {
        bulkRequestBody = JSON.parse(options.body as string);
        return {
          insertedCount: bulkRequestBody?.transactions.length || 0,
          skippedCount: 0,
          total: bulkRequestBody?.transactions.length || 0,
        } as unknown as ReturnType<typeof apiModule.apiFetch>;
      }
      return {} as ReturnType<typeof apiModule.apiFetch>;
    });

    const reviewableTxs: ReviewableTransaction[] = [
      {
        ...sampleValidatedTransactions[0],
        txHash: "hash-new-1",
        isDuplicate: false, // NEW
      },
      {
        ...sampleValidatedTransactions[1],
        txHash: "hash-duplicate-2",
        isDuplicate: true, // DUPLICATE (must be skipped)
      },
      {
        ...sampleValidatedTransactions[2],
        txHash: "hash-new-3",
        isDuplicate: false, // NEW
      },
    ];

    const uploadRes = await uploadOnlyNewTransactions(reviewableTxs, dataKey);

    expect(uploadRes.insertedCount).toBe(2);
    expect(bulkRequestBody).not.toBeNull();

    // Verify exactly 2 transactions were sent (only the new ones)
    expect(bulkRequestBody!.transactions.length).toBe(2);
    expect(bulkRequestBody!.transactions[0].txHash).toBe("hash-new-1");
    expect(bulkRequestBody!.transactions[1].txHash).toBe("hash-new-3");

    // STRICT ZERO-KNOWLEDGE: Check that payload is encrypted and has iv & ct
    for (const sentTx of bulkRequestBody!.transactions) {
      expect(sentTx.encryptedPayload.iv).toBeDefined();
      expect(sentTx.encryptedPayload.ct).toBeDefined();

      // Ensure no raw narration or amount is leaked in plaintext
      const asString = JSON.stringify(sentTx);
      expect(asString).not.toContain("SALARY CREDIT CORP");
      expect(asString).not.toContain("MSEB ELECTRICITY BILL");

      // Verify decryptability with the dataKey
      const decrypted = await decryptJSON<{ narration: string; amount: number }>(
        {
          iv: sentTx.encryptedPayload.iv,
          ciphertext: sentTx.encryptedPayload.ct,
        },
        dataKey
      );
      expect(decrypted.narration).toBeDefined();
      expect(decrypted.amount).toBeGreaterThan(0);
    }
  });

  it("skips excluded or needs_review transactions from upload", async () => {
    let sentCount = 0;
    vi.spyOn(apiModule, "apiFetch").mockImplementation(async (_endpoint, options) => {
      const body = JSON.parse((options?.body as string) || "{}");
      sentCount = body.transactions?.length || 0;
      return { insertedCount: sentCount, skippedCount: 0, total: sentCount } as unknown as ReturnType<
        typeof apiModule.apiFetch
      >;
    });

    const mixedTxs: ReviewableTransaction[] = [
      {
        ...sampleValidatedTransactions[0],
        txHash: "hash-valid-new",
        isDuplicate: false,
        status: "valid",
        isExcluded: false,
      },
      {
        ...sampleValidatedTransactions[1],
        txHash: "hash-excluded",
        isDuplicate: false,
        status: "valid",
        isExcluded: true, // User excluded this
      },
      {
        ...sampleValidatedTransactions[2],
        txHash: "hash-failing",
        isDuplicate: false,
        status: "needs_review", // Still has math issues
        isExcluded: false,
      },
    ];

    const res = await uploadOnlyNewTransactions(mixedTxs, dataKey);
    // Only the single valid, non-excluded, non-duplicate transaction should be uploaded
    expect(res.insertedCount).toBe(1);
    expect(sentCount).toBe(1);
  });
});
