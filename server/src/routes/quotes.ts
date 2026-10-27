import { Router, type Response } from "express";
import rateLimit from "express-rate-limit";
import YahooFinance from "yahoo-finance2";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";

export const quotesRouter = Router();

// Rate limiter for market quotes proxy (100 requests per 15 mins per IP)
const quotesLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Quotes rate limit exceeded. Please wait a few moments before requesting more quotes." },
});

// Require authentication and rate limiting for all quote proxy endpoints
quotesRouter.use(requireAuth);
quotesRouter.use(quotesLimiter);

export interface NormalizedQuote {
  symbol: string;
  name?: string;
  regularMarketPrice: number;
  regularMarketChange: number;
  regularMarketChangePercent: number;
  regularMarketPreviousClose?: number;
  currency?: string;
  exchange?: string;
  updatedAt: string;
}

interface CacheEntry {
  quote: NormalizedQuote;
  timestamp: number;
}

// 5-minute in-memory cache
export const CACHE_TTL_MS = 5 * 60 * 1000;
export const quotesCache = new Map<string, CacheEntry>();

// Initialize yahoo-finance2 instance with notices suppressed
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

/**
 * Normalizes raw Yahoo Finance quote object into a clean payload
 */
function normalizeYahooQuote(raw: Record<string, unknown>): NormalizedQuote {
  const symbol = String(raw.symbol || "").toUpperCase();
  const name =
    (typeof raw.shortName === "string" && raw.shortName) ||
    (typeof raw.longName === "string" && raw.longName) ||
    (typeof raw.displayName === "string" && raw.displayName) ||
    symbol;

  const price =
    typeof raw.regularMarketPrice === "number"
      ? raw.regularMarketPrice
      : typeof raw.postMarketPrice === "number"
        ? raw.postMarketPrice
        : 0;

  const change = typeof raw.regularMarketChange === "number" ? raw.regularMarketChange : 0;
  const changePercent =
    typeof raw.regularMarketChangePercent === "number" ? raw.regularMarketChangePercent : 0;

  const prevClose =
    typeof raw.regularMarketPreviousClose === "number"
      ? raw.regularMarketPreviousClose
      : price - change;

  const currency = typeof raw.currency === "string" ? raw.currency : "USD";
  const exchange = typeof raw.exchange === "string" ? raw.exchange : undefined;

  return {
    symbol,
    name,
    regularMarketPrice: price,
    regularMarketChange: change,
    regularMarketChangePercent: changePercent,
    regularMarketPreviousClose: prevClose,
    currency,
    exchange,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * GET /api/quotes?symbols=AAPL,RELIANCE.NS,TCS.NS
 * Fetches market quotes with 5-minute in-memory caching.
 */
quotesRouter.get("/", async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const rawSymbols = req.query.symbols;
    if (!rawSymbols || typeof rawSymbols !== "string") {
      res.status(400).json({ error: "Query parameter 'symbols' is required (comma-separated)." });
      return;
    }

    const requestedSymbols = rawSymbols
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);

    if (requestedSymbols.length === 0) {
      res.status(400).json({ error: "At least one valid symbol must be specified." });
      return;
    }

    // Limit to 50 symbols per call to prevent abuse
    if (requestedSymbols.length > 50) {
      res.status(400).json({ error: "Maximum 50 symbols allowed per request." });
      return;
    }

    const now = Date.now();
    const resultQuotes: NormalizedQuote[] = [];
    const missingSymbols: string[] = [];

    // 1. Check in-memory cache
    for (const sym of requestedSymbols) {
      const cached = quotesCache.get(sym);
      if (cached && now - cached.timestamp < CACHE_TTL_MS) {
        resultQuotes.push(cached.quote);
      } else {
        missingSymbols.push(sym);
      }
    }

    // 2. Fetch missing symbols from Yahoo Finance
    if (missingSymbols.length > 0) {
      try {
        // yf.quote supports batch array of symbols
        const rawResults = await yf.quote(missingSymbols);
        const quotesArray = Array.isArray(rawResults) ? rawResults : rawResults ? [rawResults] : [];

        for (const raw of quotesArray) {
          if (raw && typeof raw === "object") {
            const normalized = normalizeYahooQuote(raw as Record<string, unknown>);
            quotesCache.set(normalized.symbol, {
              quote: normalized,
              timestamp: now,
            });
            resultQuotes.push(normalized);
          }
        }
      } catch (fetchErr) {
        console.error("Batch quote fetch error from Yahoo Finance:", fetchErr);
        // Fallback: try fetching individually so one bad symbol doesn't fail the rest
        for (const sym of missingSymbols) {
          try {
            const single = await yf.quote(sym);
            if (single && typeof single === "object") {
              const normalized = normalizeYahooQuote(single as Record<string, unknown>);
              quotesCache.set(normalized.symbol, {
                quote: normalized,
                timestamp: now,
              });
              resultQuotes.push(normalized);
            }
          } catch (singleErr) {
            console.warn(`Could not resolve quote for symbol '${sym}':`, singleErr);
          }
        }
      }
    }

    // Build map for convenient O(1) symbol lookup
    const map: Record<string, NormalizedQuote> = {};
    for (const q of resultQuotes) {
      map[q.symbol] = q;
    }

    res.status(200).json({
      quotes: resultQuotes,
      map,
      cachedCount: requestedSymbols.length - missingSymbols.length,
      fetchedCount: missingSymbols.length,
    });
  } catch (err) {
    console.error("Quotes proxy handler error:", err);
    res.status(500).json({ error: "Failed to fetch quotes from market data provider." });
  }
});
