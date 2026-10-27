import { Router, type Response } from "express";
import { StatementFile } from "../models/StatementFile.js";
import { isDbConnected, memoryStore } from "../models/memoryFallback.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";

export const statementFilesRouter = Router();
statementFilesRouter.use(requireAuth);

statementFilesRouter.get("/", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { month, bank } = req.query;

    if (!isDbConnected()) {
      const files = memoryStore.statementFiles.find(req.userId!, {
        month: typeof month === "string" ? month : undefined,
        bank: typeof bank === "string" ? bank : undefined,
      });
      res.status(200).json({ files });
      return;
    }

    const filter: Record<string, unknown> = { userId: req.userId };
    if (month && typeof month === "string") filter.month = month;
    if (bank && typeof bank === "string") filter.bank = bank;

    const files = await StatementFile.find(filter).sort({ createdAt: -1 });
    res.status(200).json({ files });
  } catch (err) {
    console.error("Fetch statement files error:", err instanceof Error ? err.stack || err.message : err);
    res.status(500).json({ error: "Failed to fetch statement files." });
  }
});

statementFilesRouter.get(
  "/:id",
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (!isDbConnected()) {
        const file = memoryStore.statementFiles.findById(req.params.id, req.userId!);
        if (!file) {
          res.status(404).json({ error: "Statement file not found." });
          return;
        }
        res.status(200).json({ file });
        return;
      }

      const file = await StatementFile.findOne({ _id: req.params.id, userId: req.userId });
      if (!file) {
        res.status(404).json({ error: "Statement file not found." });
        return;
      }
      res.status(200).json({ file });
    } catch (err) {
      console.error("Fetch statement file error:", err instanceof Error ? err.stack || err.message : err);
      res.status(500).json({ error: "Failed to fetch statement file." });
    }
  }
);

statementFilesRouter.post("/", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { encryptedPayload, bank, month, gridFsFileId, fileSize } = req.body;
    if (!encryptedPayload) {
      res.status(400).json({ error: "encryptedPayload is required." });
      return;
    }

    if (!isDbConnected()) {
      const file = memoryStore.statementFiles.create({
        userId: req.userId!,
        encryptedPayload,
        bank,
        month,
        gridFsFileId,
        fileSize,
      });
      res.status(201).json({ file });
      return;
    }

    const file = new StatementFile({
      userId: req.userId,
      encryptedPayload,
      bank,
      month,
      gridFsFileId,
      fileSize,
    });

    await file.save();
    res.status(201).json({ file });
  } catch (err) {
    console.error("Create statement file error:", err instanceof Error ? err.stack || err.message : err);
    res.status(500).json({ error: "Failed to create statement file." });
  }
});

statementFilesRouter.delete(
  "/:id",
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (!isDbConnected()) {
        const deleted = memoryStore.statementFiles.delete(req.params.id, req.userId!);
        if (!deleted) {
          res.status(404).json({ error: "Statement file not found." });
          return;
        }
        res.status(200).json({ message: "Statement file deleted successfully.", id: req.params.id });
        return;
      }

      const file = await StatementFile.findOneAndDelete({ _id: req.params.id, userId: req.userId });
      if (!file) {
        res.status(404).json({ error: "Statement file not found." });
        return;
      }
      res.status(200).json({ message: "Statement file deleted successfully.", id: file._id });
    } catch (err) {
      console.error("Delete statement file error:", err instanceof Error ? err.stack || err.message : err);
      res.status(500).json({ error: "Failed to delete statement file." });
    }
  }
);
