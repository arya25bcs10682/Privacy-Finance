import { Router, type Response } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { parseStatementText } from "../services/parser.js";

export const parseRouter = Router();

// Dedicated rate limiter for LLM parsing (e.g. 60 pages per 15 minutes per IP)
const parseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Parse rate limit exceeded. Please wait a few moments before parsing more pages.",
  },
});

parseRouter.use(requireAuth);
parseRouter.use(parseLimiter);

/**
 * POST /api/parse
 * Accepts redacted bank statement page text and returns structured transactions via LLM.
 * PRIVACY GUARANTEE: Neither request text nor parsed transaction contents are logged or persisted.
 */
parseRouter.post("/", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { text, pageNumber } = req.body;

    if (typeof text !== "string") {
      res.status(400).json({ error: "Page text is required and must be a string." });
      return;
    }

    if (!text.trim()) {
      res.status(200).json({
        transactions: [],
        count: 0,
        pageNumber,
      });
      return;
    }

    // Call LLM parser with automatic Zod validation and retry
    // ZERO-KNOWLEDGE: Raw text and responses are strictly not logged
    const transactions = await parseStatementText(text);

    res.status(200).json({
      transactions,
      count: transactions.length,
      pageNumber,
    });
  } catch (err: unknown) {
    const errorObj = err && typeof err === "object" ? (err as Record<string, unknown>) : null;
    const rawStatus = typeof errorObj?.status === "number" ? errorObj.status : 500;
    const isModelBusy =
      rawStatus === 503 ||
      rawStatus === 429 ||
      rawStatus === 500 ||
      (err instanceof Error && err.message.toLowerCase().includes("busy"));
    const status = isModelBusy ? 503 : (rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500);
    const message = isModelBusy
      ? "The AI model is busy. Please try again in a minute."
      : (err instanceof Error ? err.message : "Failed to parse bank statement page via LLM.");
    const model =
      typeof errorObj?.model === "string"
        ? errorObj.model
        : process.env.GEMINI_MODEL || process.env.LLM_MODEL || "gemini-3.5-flash";

    // Strict zero-knowledge: log err.status, err.message and the model name (never the request text or response body)
    console.error(`[LLM Parse Error] Model: ${model} | Status: ${status} | Message: ${message}`);

    res.status(status).json({
      stage: "llm",
      status,
      message,
    });
  }
});
