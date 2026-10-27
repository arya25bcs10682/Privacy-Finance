import { Router, type Response } from "express";
import { Budget } from "../models/Budget.js";
import { isDbConnected, memoryStore } from "../models/memoryFallback.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";

export const budgetsRouter = Router();
budgetsRouter.use(requireAuth);

budgetsRouter.get("/", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { month } = req.query;

    if (!isDbConnected()) {
      const budgets = memoryStore.budgets.find(
        req.userId!,
        typeof month === "string" ? month : undefined
      );
      res.status(200).json({ budgets });
      return;
    }

    const filter: Record<string, unknown> = { userId: req.userId };
    if (month && typeof month === "string") filter.month = month;

    const budgets = await Budget.find(filter).sort({ month: -1 });
    res.status(200).json({ budgets });
  } catch (err) {
    console.error("Fetch budgets error:", err instanceof Error ? err.stack || err.message : err);
    res.status(500).json({ error: "Failed to fetch budgets." });
  }
});

budgetsRouter.get("/:id", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!isDbConnected()) {
      const budget = memoryStore.budgets.findById(req.params.id, req.userId!);
      if (!budget) {
        res.status(404).json({ error: "Budget not found." });
        return;
      }
      res.status(200).json({ budget });
      return;
    }

    const budget = await Budget.findOne({ _id: req.params.id, userId: req.userId });
    if (!budget) {
      res.status(404).json({ error: "Budget not found." });
      return;
    }
    res.status(200).json({ budget });
  } catch (err) {
    console.error("Fetch budget error:", err instanceof Error ? err.stack || err.message : err);
    res.status(500).json({ error: "Failed to fetch budget." });
  }
});

budgetsRouter.post("/", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { month, encryptedPayload } = req.body;
    if (!month || !encryptedPayload) {
      res.status(400).json({ error: "month and encryptedPayload are required." });
      return;
    }

    if (!isDbConnected()) {
      const budget = memoryStore.budgets.create({
        userId: req.userId!,
        month,
        encryptedPayload,
      });
      res.status(201).json({ budget });
      return;
    }

    const budget = new Budget({
      userId: req.userId,
      month,
      encryptedPayload,
    });

    await budget.save();
    res.status(201).json({ budget });
  } catch (err) {
    console.error("Create budget error:", err instanceof Error ? err.stack || err.message : err);
    res.status(500).json({ error: "Failed to create budget." });
  }
});

budgetsRouter.put("/:id", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { month, encryptedPayload } = req.body;

    if (!isDbConnected()) {
      const budget = memoryStore.budgets.update(
        req.params.id,
        req.userId!,
        encryptedPayload,
        typeof month === "string" ? month : undefined
      );
      if (!budget) {
        res.status(404).json({ error: "Budget not found." });
        return;
      }
      res.status(200).json({ budget });
      return;
    }

    const updateFields: Record<string, unknown> = {};
    if (month) updateFields.month = month;
    if (encryptedPayload) updateFields.encryptedPayload = encryptedPayload;

    const budget = await Budget.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { $set: updateFields },
      { new: true }
    );

    if (!budget) {
      res.status(404).json({ error: "Budget not found." });
      return;
    }

    res.status(200).json({ budget });
  } catch (err) {
    console.error("Update budget error:", err instanceof Error ? err.stack || err.message : err);
    res.status(500).json({ error: "Failed to update budget." });
  }
});

budgetsRouter.delete("/:id", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!isDbConnected()) {
      const deleted = memoryStore.budgets.delete(req.params.id, req.userId!);
      if (!deleted) {
        res.status(404).json({ error: "Budget not found." });
        return;
      }
      res.status(200).json({ message: "Budget deleted successfully.", id: req.params.id });
      return;
    }

    const budget = await Budget.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!budget) {
      res.status(404).json({ error: "Budget not found." });
      return;
    }
    res.status(200).json({ message: "Budget deleted successfully.", id: budget._id });
  } catch (err) {
    console.error("Delete budget error:", err instanceof Error ? err.stack || err.message : err);
    res.status(500).json({ error: "Failed to delete budget." });
  }
});
