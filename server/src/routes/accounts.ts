import { Router, type Response } from "express";
import { Account } from "../models/Account.js";
import { isDbConnected, memoryStore } from "../models/memoryFallback.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";

export const accountsRouter = Router();
accountsRouter.use(requireAuth);

accountsRouter.get("/", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!isDbConnected()) {
      const accounts = memoryStore.accounts.find(req.userId!);
      res.status(200).json({ accounts });
      return;
    }

    const accounts = await Account.find({ userId: req.userId }).sort({ createdAt: -1 });
    res.status(200).json({ accounts });
  } catch (err) {
    console.error("Fetch accounts error:", err instanceof Error ? err.stack || err.message : err);
    res.status(500).json({ error: "Failed to fetch accounts." });
  }
});

accountsRouter.get("/:id", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!isDbConnected()) {
      const account = memoryStore.accounts.findById(req.params.id, req.userId!);
      if (!account) {
        res.status(404).json({ error: "Account not found." });
        return;
      }
      res.status(200).json({ account });
      return;
    }

    const account = await Account.findOne({ _id: req.params.id, userId: req.userId });
    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    res.status(200).json({ account });
  } catch (err) {
    console.error("Fetch account error:", err instanceof Error ? err.stack || err.message : err);
    res.status(500).json({ error: "Failed to fetch account." });
  }
});

accountsRouter.post("/", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { encryptedPayload, accountType } = req.body;
    if (!encryptedPayload) {
      res.status(400).json({ error: "encryptedPayload is required." });
      return;
    }

    if (!isDbConnected()) {
      const account = memoryStore.accounts.create({
        userId: req.userId!,
        encryptedPayload,
        accountType,
      });
      res.status(201).json({ account });
      return;
    }

    const account = new Account({
      userId: req.userId,
      encryptedPayload,
      accountType,
    });

    await account.save();
    res.status(201).json({ account });
  } catch (err) {
    console.error("Create account error:", err instanceof Error ? err.stack || err.message : err);
    res.status(500).json({ error: "Failed to create account." });
  }
});

accountsRouter.put("/:id", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { encryptedPayload, accountType } = req.body;

    if (!isDbConnected()) {
      const account = memoryStore.accounts.update(
        req.params.id,
        req.userId!,
        encryptedPayload,
        accountType
      );
      if (!account) {
        res.status(404).json({ error: "Account not found." });
        return;
      }
      res.status(200).json({ account });
      return;
    }

    const updateFields: Record<string, unknown> = {};
    if (encryptedPayload) updateFields.encryptedPayload = encryptedPayload;
    if (accountType !== undefined) updateFields.accountType = accountType;

    const account = await Account.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { $set: updateFields },
      { new: true }
    );

    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    res.status(200).json({ account });
  } catch (err) {
    console.error("Update account error:", err instanceof Error ? err.stack || err.message : err);
    res.status(500).json({ error: "Failed to update account." });
  }
});

accountsRouter.delete("/:id", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!isDbConnected()) {
      const deleted = memoryStore.accounts.delete(req.params.id, req.userId!);
      if (!deleted) {
        res.status(404).json({ error: "Account not found." });
        return;
      }
      res.status(200).json({ message: "Account deleted successfully.", id: req.params.id });
      return;
    }

    const account = await Account.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!account) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    res.status(200).json({ message: "Account deleted successfully.", id: account._id });
  } catch (err) {
    console.error("Delete account error:", err instanceof Error ? err.stack || err.message : err);
    res.status(500).json({ error: "Failed to delete account." });
  }
});
