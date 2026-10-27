import { Router, type Response } from "express";
import { Holding } from "../models/Holding.js";
import { isDbConnected, memoryStore } from "../models/memoryFallback.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";

export const holdingsRouter = Router();
holdingsRouter.use(requireAuth);

holdingsRouter.get("/", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { assetClass } = req.query;

    if (!isDbConnected()) {
      const holdings = memoryStore.holdings.find(
        req.userId!,
        typeof assetClass === "string" ? assetClass : undefined
      );
      res.status(200).json({ holdings });
      return;
    }

    const filter: Record<string, unknown> = { userId: req.userId };
    if (assetClass && typeof assetClass === "string") filter.assetClass = assetClass;

    const holdings = await Holding.find(filter).sort({ createdAt: -1 });
    res.status(200).json({ holdings });
  } catch (err) {
    console.error("Fetch holdings error:", err instanceof Error ? err.stack || err.message : err);
    res.status(500).json({ error: "Failed to fetch holdings." });
  }
});

holdingsRouter.get("/:id", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!isDbConnected()) {
      const holding = memoryStore.holdings.findById(req.params.id, req.userId!);
      if (!holding) {
        res.status(404).json({ error: "Holding not found." });
        return;
      }
      res.status(200).json({ holding });
      return;
    }

    const holding = await Holding.findOne({ _id: req.params.id, userId: req.userId });
    if (!holding) {
      res.status(404).json({ error: "Holding not found." });
      return;
    }
    res.status(200).json({ holding });
  } catch (err) {
    console.error("Fetch holding error:", err instanceof Error ? err.stack || err.message : err);
    res.status(500).json({ error: "Failed to fetch holding." });
  }
});

holdingsRouter.post("/", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { encryptedPayload, assetClass } = req.body;
    if (!encryptedPayload) {
      res.status(400).json({ error: "encryptedPayload is required." });
      return;
    }

    if (!isDbConnected()) {
      const holding = memoryStore.holdings.create({
        userId: req.userId!,
        encryptedPayload,
        assetClass,
      });
      res.status(201).json({ holding });
      return;
    }

    const holding = new Holding({
      userId: req.userId,
      encryptedPayload,
      assetClass,
    });

    await holding.save();
    res.status(201).json({ holding });
  } catch (err) {
    console.error("Create holding error:", err instanceof Error ? err.stack || err.message : err);
    res.status(500).json({ error: "Failed to create holding." });
  }
});

holdingsRouter.put("/:id", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { encryptedPayload, assetClass } = req.body;

    if (!isDbConnected()) {
      const holding = memoryStore.holdings.update(
        req.params.id,
        req.userId!,
        encryptedPayload,
        typeof assetClass === "string" ? assetClass : undefined
      );
      if (!holding) {
        res.status(404).json({ error: "Holding not found." });
        return;
      }
      res.status(200).json({ holding });
      return;
    }

    const updateFields: Record<string, unknown> = {};
    if (encryptedPayload) updateFields.encryptedPayload = encryptedPayload;
    if (assetClass !== undefined) updateFields.assetClass = assetClass;

    const holding = await Holding.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { $set: updateFields },
      { new: true }
    );

    if (!holding) {
      res.status(404).json({ error: "Holding not found." });
      return;
    }

    res.status(200).json({ holding });
  } catch (err) {
    console.error("Update holding error:", err instanceof Error ? err.stack || err.message : err);
    res.status(500).json({ error: "Failed to update holding." });
  }
});

holdingsRouter.delete("/:id", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!isDbConnected()) {
      const deleted = memoryStore.holdings.delete(req.params.id, req.userId!);
      if (!deleted) {
        res.status(404).json({ error: "Holding not found." });
        return;
      }
      res.status(200).json({ message: "Holding deleted successfully.", id: req.params.id });
      return;
    }

    const holding = await Holding.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!holding) {
      res.status(404).json({ error: "Holding not found." });
      return;
    }
    res.status(200).json({ message: "Holding deleted successfully.", id: holding._id });
  } catch (err) {
    console.error("Delete holding error:", err instanceof Error ? err.stack || err.message : err);
    res.status(500).json({ error: "Failed to delete holding." });
  }
});
