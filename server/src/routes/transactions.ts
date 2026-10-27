import { Router, type Response } from "express";
import rateLimit from "express-rate-limit";
import { Transaction } from "../models/Transaction.js";
import { isDbConnected, memoryStore } from "../models/memoryFallback.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";

export const transactionsRouter = Router();

// Apply authentication middleware to all transaction routes
transactionsRouter.use(requireAuth);

const bulkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Bulk operation rate limit exceeded. Please wait a few moments." },
});

/**
 * GET /api/transactions
 * List transactions for the authenticated user only.
 * Optional query params: month (YYYY-MM), accountId
 */
transactionsRouter.get("/", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { month, accountId } = req.query;

    if (!isDbConnected()) {
      const transactions = memoryStore.transactions.find(req.userId!, {
        month: typeof month === "string" ? month : undefined,
        accountId: typeof accountId === "string" ? accountId : undefined,
      });
      res.status(200).json({ transactions });
      return;
    }

    const filter: Record<string, unknown> = {
      // Strictly scoped by authenticated user's ID
      userId: req.userId,
    };

    if (month && typeof month === "string") {
      filter.month = month;
    }

    if (accountId && typeof accountId === "string") {
      filter.accountId = accountId;
    }

    const transactions = await Transaction.find(filter).sort({ createdAt: -1 });
    res.status(200).json({ transactions });
  } catch (err) {
    console.error("Fetch transactions error:", err);
    res.status(500).json({ error: "Failed to retrieve transactions." });
  }
});

/**
 * GET /api/transactions/:id
 * Retrieve a single transaction by ID scoped strictly by userId.
 */
transactionsRouter.get("/:id", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const transaction = await Transaction.findOne({
      _id: req.params.id,
      userId: req.userId,
    });

    if (!transaction) {
      res.status(404).json({ error: "Transaction not found." });
      return;
    }

    res.status(200).json({ transaction });
  } catch (err) {
    console.error("Fetch single transaction error:", err);
    res.status(500).json({ error: "Failed to retrieve transaction." });
  }
});

/**
 * POST /api/transactions
 * Create a single transaction.
 */
transactionsRouter.post("/", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { txHash, encryptedPayload, month, accountId } = req.body;

    if (!txHash || !encryptedPayload || !month) {
      res.status(400).json({ error: "txHash, encryptedPayload, and month are required." });
      return;
    }

    const transaction = new Transaction({
      userId: req.userId,
      txHash,
      encryptedPayload,
      month,
      accountId,
    });

    await transaction.save();
    res.status(201).json({ transaction });
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: number }).code === 11000
    ) {
      res
        .status(409)
        .json({ error: "A transaction with this txHash already exists for this user." });
      return;
    }
    console.error("Create transaction error:", err);
    res.status(500).json({ error: "Failed to save transaction." });
  }
});

/**
 * POST /api/transactions/bulk
 * Bulk insert that skips duplicates on (userId, txHash) and returns counts.
 */
transactionsRouter.post(
  "/bulk",
  bulkLimiter,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { transactions } = req.body;

      if (!Array.isArray(transactions) || transactions.length === 0) {
        res.status(400).json({ error: "transactions array is required and cannot be empty." });
        return;
      }

      const userId = req.userId!;

      if (!isDbConnected()) {
        const result = memoryStore.transactions.bulkUpsert(userId, transactions);
        res.status(200).json({
          ...result,
          success: true,
        });
        return;
      }

      // Build upsert bulk write operations with $setOnInsert
      const operations = transactions.map((tx) => ({
        updateOne: {
          filter: {
            userId,
            txHash: tx.txHash,
          },
          update: {
            $setOnInsert: {
              userId,
              txHash: tx.txHash,
              encryptedPayload: tx.encryptedPayload,
              month: tx.month,
              accountId: tx.accountId,
            },
          },
          upsert: true,
        },
      }));

      const result = await Transaction.bulkWrite(operations, { ordered: false });

      const insertedCount = result.upsertedCount || 0;
      const skippedCount = result.matchedCount || 0;
      const total = transactions.length;

      res.status(200).json({
        insertedCount,
        skippedCount,
        total,
        success: true,
      });
    } catch (err) {
      console.error("Bulk insert transactions error:", err);
      res.status(500).json({ error: "Failed to perform bulk insert." });
    }
  }
);

/**
 * POST /api/transactions/check-hashes
 * Query existing hashes for the authenticated user and return existing ones with counts.
 */
transactionsRouter.post(
  "/check-hashes",
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { txHashes } = req.body;

      if (!Array.isArray(txHashes)) {
        res.status(400).json({ error: "txHashes array is required." });
        return;
      }

      if (txHashes.length === 0) {
        res.status(200).json({ existingHashes: [], duplicateCount: 0, newCount: 0 });
        return;
      }

      if (!isDbConnected()) {
        const result = memoryStore.transactions.checkHashes(req.userId!, txHashes);
        res.status(200).json(result);
        return;
      }

      // Query only the hashes belonging to this user
      const existingDocs = await Transaction.find(
        {
          userId: req.userId,
          txHash: { $in: txHashes },
        },
        { txHash: 1, _id: 0 }
      ).sort({ createdAt: -1 });

      const existingHashes: string[] = existingDocs.map((doc) => doc.txHash);
      const duplicateCount = existingHashes.length;
      const newCount = txHashes.length - duplicateCount;

      res.status(200).json({
        existingHashes,
        duplicateCount,
        newCount,
      });
    } catch (err) {
      console.error("Check hashes error:", err);
      res.status(500).json({ error: "Failed to check transaction hashes." });
    }
  }
);

/**
 * PUT /api/transactions/:id
 * Update an existing transaction scoped strictly by userId.
 */
transactionsRouter.put("/:id", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { encryptedPayload, month, accountId } = req.body;

    const updateFields: Record<string, unknown> = {};
    if (encryptedPayload) updateFields.encryptedPayload = encryptedPayload;
    if (month) updateFields.month = month;
    if (accountId !== undefined) updateFields.accountId = accountId;

    const transaction = await Transaction.findOneAndUpdate(
      {
        _id: req.params.id,
        userId: req.userId,
      },
      { $set: updateFields },
      { new: true }
    );

    if (!transaction) {
      res.status(404).json({ error: "Transaction not found." });
      return;
    }

    res.status(200).json({ transaction });
  } catch (err) {
    console.error("Update transaction error:", err);
    res.status(500).json({ error: "Failed to update transaction." });
  }
});

/**
 * DELETE /api/transactions/:id
 * Delete a transaction scoped strictly by userId.
 */
transactionsRouter.delete(
  "/:id",
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const transaction = await Transaction.findOneAndDelete({
        _id: req.params.id,
        userId: req.userId,
      });

      if (!transaction) {
        res.status(404).json({ error: "Transaction not found." });
        return;
      }

      res.status(200).json({ message: "Transaction deleted successfully.", id: transaction._id });
    } catch (err) {
      console.error("Delete transaction error:", err);
      res.status(500).json({ error: "Failed to delete transaction." });
    }
  }
);
