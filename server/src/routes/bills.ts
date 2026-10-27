import { Router, type Response } from "express";
import { Bill } from "../models/Bill.js";
import { isDbConnected, memoryStore } from "../models/memoryFallback.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";

export const billsRouter = Router();
billsRouter.use(requireAuth);

billsRouter.get("/", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { dueDateMonth } = req.query;

    if (!isDbConnected()) {
      const bills = memoryStore.bills.find(
        req.userId!,
        typeof dueDateMonth === "string" ? dueDateMonth : undefined
      );
      res.status(200).json({ bills });
      return;
    }

    const filter: Record<string, unknown> = { userId: req.userId };
    if (dueDateMonth && typeof dueDateMonth === "string") filter.dueDateMonth = dueDateMonth;

    const bills = await Bill.find(filter).sort({ createdAt: -1 });
    res.status(200).json({ bills });
  } catch (err) {
    console.error("Fetch bills error:", err instanceof Error ? err.stack || err.message : err);
    res.status(500).json({ error: "Failed to fetch bills." });
  }
});

billsRouter.get("/:id", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!isDbConnected()) {
      const bill = memoryStore.bills.findById(req.params.id, req.userId!);
      if (!bill) {
        res.status(404).json({ error: "Bill not found." });
        return;
      }
      res.status(200).json({ bill });
      return;
    }

    const bill = await Bill.findOne({ _id: req.params.id, userId: req.userId });
    if (!bill) {
      res.status(404).json({ error: "Bill not found." });
      return;
    }
    res.status(200).json({ bill });
  } catch (err) {
    console.error("Fetch bill error:", err instanceof Error ? err.stack || err.message : err);
    res.status(500).json({ error: "Failed to fetch bill." });
  }
});

billsRouter.post("/", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { encryptedPayload, dueDateMonth } = req.body;
    if (!encryptedPayload) {
      res.status(400).json({ error: "encryptedPayload is required." });
      return;
    }

    if (!isDbConnected()) {
      const bill = memoryStore.bills.create({
        userId: req.userId!,
        encryptedPayload,
        dueDateMonth,
      });
      res.status(201).json({ bill });
      return;
    }

    const bill = new Bill({
      userId: req.userId,
      encryptedPayload,
      dueDateMonth,
    });

    await bill.save();
    res.status(201).json({ bill });
  } catch (err) {
    console.error("Create bill error:", err instanceof Error ? err.stack || err.message : err);
    res.status(500).json({ error: "Failed to create bill." });
  }
});

billsRouter.put("/:id", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { encryptedPayload, dueDateMonth } = req.body;

    if (!isDbConnected()) {
      const bill = memoryStore.bills.update(
        req.params.id,
        req.userId!,
        encryptedPayload,
        typeof dueDateMonth === "string" ? dueDateMonth : undefined
      );
      if (!bill) {
        res.status(404).json({ error: "Bill not found." });
        return;
      }
      res.status(200).json({ bill });
      return;
    }

    const updateFields: Record<string, unknown> = {};
    if (encryptedPayload) updateFields.encryptedPayload = encryptedPayload;
    if (dueDateMonth !== undefined) updateFields.dueDateMonth = dueDateMonth;

    const bill = await Bill.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { $set: updateFields },
      { new: true }
    );

    if (!bill) {
      res.status(404).json({ error: "Bill not found." });
      return;
    }

    res.status(200).json({ bill });
  } catch (err) {
    console.error("Update bill error:", err instanceof Error ? err.stack || err.message : err);
    res.status(500).json({ error: "Failed to update bill." });
  }
});

billsRouter.delete("/:id", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!isDbConnected()) {
      const deleted = memoryStore.bills.delete(req.params.id, req.userId!);
      if (!deleted) {
        res.status(404).json({ error: "Bill not found." });
        return;
      }
      res.status(200).json({ message: "Bill deleted successfully.", id: req.params.id });
      return;
    }

    const bill = await Bill.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!bill) {
      res.status(404).json({ error: "Bill not found." });
      return;
    }
    res.status(200).json({ message: "Bill deleted successfully.", id: bill._id });
  } catch (err) {
    console.error("Delete bill error:", err instanceof Error ? err.stack || err.message : err);
    res.status(500).json({ error: "Failed to delete bill." });
  }
});
