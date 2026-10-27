import { hmacTxHash, encryptJSON } from "../crypto";
import { apiFetch } from "../api";
import type { ValidatedTransaction } from "../pdf/validation";

export interface ReviewableTransaction extends ValidatedTransaction {
  txHash: string;
  isDuplicate: boolean;
}

export interface HashCheckResult {
  annotated: ReviewableTransaction[];
  newCount: number;
  duplicateCount: number;
  existingHashes: Set<string>;
}

/**
 * Computes deterministic HMAC-SHA256 txHash for all parsed rows,
 * queries the server for existing hashes belonging to this user,
 * and classifies each row as "new" or "duplicate".
 */
export async function computeHashesAndCheckDuplicates(
  transactions: ValidatedTransaction[],
  dataKey: CryptoKey
): Promise<HashCheckResult> {
  // 1. Compute HMAC txHash for each transaction client-side
  const withHashes = await Promise.all(
    transactions.map(async (tx) => {
      const txHash = await hmacTxHash(
        {
          date: tx.date,
          amount: tx.amount,
          type: tx.type,
          cleanedDescription: tx.narration,
          runningBalance: tx.balance,
        },
        dataKey
      );
      return { tx, txHash };
    })
  );

  const hashesToCheck = withHashes
    .filter((w) => !w.tx.isExcluded)
    .map((w) => w.txHash);

  // 2. Query existing hashes from /api/transactions/check-hashes
  let existingHashSet = new Set<string>();
  if (hashesToCheck.length > 0) {
    try {
      const res = await apiFetch<{ existingHashes: string[] }>(
        "/transactions/check-hashes",
        {
          method: "POST",
          body: JSON.stringify({ txHashes: hashesToCheck }),
        }
      );
      existingHashSet = new Set(res.existingHashes || []);
    } catch (err) {
      console.warn("Could not query existing hashes from server:", err);
    }
  }

  // 3. Annotate transactions and calculate counters
  let newCount = 0;
  let duplicateCount = 0;

  const annotated: ReviewableTransaction[] = withHashes.map(({ tx, txHash }) => {
    const isDuplicate = existingHashSet.has(txHash);

    if (!tx.isExcluded && tx.status !== "needs_review") {
      if (isDuplicate) {
        duplicateCount++;
      } else {
        newCount++;
      }
    }

    return {
      ...tx,
      txHash,
      isDuplicate,
    };
  });

  return {
    annotated,
    newCount,
    duplicateCount,
    existingHashes: existingHashSet,
  };
}

/**
 * Encrypts and bulk-uploads ONLY the new (non-duplicate, non-excluded, valid) transactions.
 * STRICT ZERO-KNOWLEDGE: Plaintext is never sent to the server.
 */
export async function uploadOnlyNewTransactions(
  transactions: ReviewableTransaction[],
  dataKey: CryptoKey,
  accountId?: string
): Promise<{ insertedCount: number; skippedCount: number; total: number }> {
  // Filter down strictly to rows that are NOT duplicates, NOT excluded, and valid
  const toUpload = transactions.filter(
    (tx) => !tx.isExcluded && tx.status !== "needs_review" && !tx.isDuplicate
  );

  if (toUpload.length === 0) {
    return { insertedCount: 0, skippedCount: 0, total: 0 };
  }

  // Encrypt each transaction client-side with master AES-GCM 256 data key
  const encryptedBatch = await Promise.all(
    toUpload.map(async (tx) => {
      const month = tx.date.substring(0, 7); // YYYY-MM
      const encrypted = await encryptJSON(
        {
          date: tx.date,
          narration: tx.narration,
          type: tx.type,
          amount: tx.amount,
          balance: tx.balance,
        },
        dataKey
      );

      return {
        txHash: tx.txHash,
        month,
        accountId,
        encryptedPayload: {
          iv: encrypted.iv,
          ct: encrypted.ciphertext,
        },
      };
    })
  );

  return apiFetch<{ insertedCount: number; skippedCount: number; total: number }>(
    "/transactions/bulk",
    {
      method: "POST",
      body: JSON.stringify({ transactions: encryptedBatch }),
    }
  );
}
