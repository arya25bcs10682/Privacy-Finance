import { apiFetch } from "../api";
import type {
  HoldingItem,
  QuoteData,
  EnrichedHolding,
  PortfolioSummary,
  AssetAllocationItem,
} from "./types";

// In-memory cache for mutual fund NAVs to prevent redundant network calls
interface MFCacheItem {
  quote: QuoteData;
  timestamp: number;
}
const mfCache = new Map<string, MFCacheItem>();
const MF_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches stock/ETF quotes through our authenticated server proxy (/api/quotes)
 */
export async function fetchStockQuotes(symbols: string[]): Promise<Record<string, QuoteData>> {
  if (symbols.length === 0) return {};

  const cleanSymbols = Array.from(
    new Set(symbols.map((s) => s.trim().toUpperCase()).filter((s) => s.length > 0))
  );

  if (cleanSymbols.length === 0) return {};

  try {
    const res = await apiFetch<{
      quotes: Array<{
        symbol: string;
        name?: string;
        regularMarketPrice: number;
        regularMarketChange: number;
        regularMarketChangePercent: number;
        regularMarketPreviousClose?: number;
        currency?: string;
      }>;
      map?: Record<string, unknown>;
    }>(`/quotes?symbols=${encodeURIComponent(cleanSymbols.join(","))}`);

    const result: Record<string, QuoteData> = {};
    for (const q of res.quotes || []) {
      result[q.symbol.toUpperCase()] = {
        symbol: q.symbol.toUpperCase(),
        name: q.name,
        price: q.regularMarketPrice,
        dayChange: q.regularMarketChange,
        dayChangePercent: q.regularMarketChangePercent,
        prevClose: q.regularMarketPreviousClose,
        currency: q.currency || "INR",
        source: "yahoo",
        lastUpdated: new Date().toISOString(),
      };
    }
    return result;
  } catch (err) {
    console.warn("Failed to fetch quotes via proxy:", err);
    return {};
  }
}

interface MFResponseData {
  meta?: {
    scheme_code?: number;
    scheme_name?: string;
    fund_house?: string;
    scheme_category?: string;
  };
  data?: Array<{
    date: string;
    nav: string;
  }>;
  status?: string;
}

/**
 * Fetches latest Mutual Fund NAV directly from api.mfapi.in/mf/{scheme_code}
 */
export async function fetchMutualFundNAV(schemeCode: string | number): Promise<QuoteData | null> {
  const code = String(schemeCode).trim();
  if (!code || !/^\d+$/.test(code)) return null;

  const now = Date.now();
  const cached = mfCache.get(code);
  if (cached && now - cached.timestamp < MF_CACHE_TTL_MS) {
    return cached.quote;
  }

  try {
    const res = await fetch(`https://api.mfapi.in/mf/${encodeURIComponent(code)}`);
    if (!res.ok) {
      throw new Error(`MF API returned status ${res.status}`);
    }

    const json: MFResponseData = await res.json();
    if (!json.data || json.data.length === 0) {
      return null;
    }

    const latestNav = parseFloat(json.data[0].nav);
    const prevNav = json.data[1] ? parseFloat(json.data[1].nav) : latestNav;
    const dayChange = latestNav - prevNav;
    const dayChangePercent = prevNav > 0 ? (dayChange / prevNav) * 100 : 0;

    const quote: QuoteData = {
      symbol: code,
      name: json.meta?.scheme_name || `MF Scheme ${code}`,
      price: latestNav,
      dayChange,
      dayChangePercent,
      prevClose: prevNav,
      currency: "INR",
      source: "mfapi",
      lastUpdated: new Date().toISOString(),
    };

    mfCache.set(code, { quote, timestamp: now });
    return quote;
  } catch (err) {
    console.warn(`Failed to fetch NAV for scheme ${code}:`, err);
    return null;
  }
}

/**
 * Searches mutual fund schemes by name directly from api.mfapi.in
 */
export async function searchMutualFunds(
  query: string
): Promise<Array<{ schemeCode: number; schemeName: string }>> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  try {
    const res = await fetch(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(trimmed)}`);
    if (!res.ok) return [];
    const list: Array<{ schemeCode: number; schemeName: string }> = await res.json();
    return Array.isArray(list) ? list.slice(0, 15) : [];
  } catch {
    return [];
  }
}

/**
 * Batch fetches all market data for holdings (both stocks via proxy and MFs via direct API)
 */
export async function fetchAllHoldingsQuotes(
  holdings: HoldingItem[]
): Promise<Record<string, QuoteData>> {
  const stockSymbols: string[] = [];
  const mfCodes: string[] = [];

  for (const h of holdings) {
    if (h.assetType === "mf" || /^\d{5,7}$/.test(h.symbol.trim())) {
      mfCodes.push(h.symbol.trim());
    } else {
      stockSymbols.push(h.symbol.trim().toUpperCase());
    }
  }

  // 1. Fetch stock quotes via proxy in one batch
  const stockQuotes = await fetchStockQuotes(stockSymbols);

  // 2. Fetch mutual fund NAVs directly in parallel
  const mfQuotesList = await Promise.all(
    mfCodes.map((code) => fetchMutualFundNAV(code))
  );

  const combinedQuotes: Record<string, QuoteData> = { ...stockQuotes };
  for (const q of mfQuotesList) {
    if (q) {
      combinedQuotes[q.symbol] = q;
    }
  }

  return combinedQuotes;
}

/**
 * Computes live portfolio metrics:
 * - Current Value = units * CMP
 * - Total P&L = Current Value - Invested Value
 * - Day Change = units * (CMP - prevClose)
 * - Allocation Breakdown
 */
export function computePortfolio(
  holdings: HoldingItem[],
  quotes: Record<string, QuoteData>
): {
  enriched: EnrichedHolding[];
  summary: PortfolioSummary;
  allocation: AssetAllocationItem[];
} {
  let totalValue = 0;
  let totalInvested = 0;
  let dayChangeAmount = 0;
  let stocksCount = 0;
  let mfCount = 0;

  const enriched: EnrichedHolding[] = holdings.map((h) => {
    const lookupKey = h.symbol.trim().toUpperCase();
    const quote = quotes[lookupKey] || quotes[h.symbol.trim()];

    const hasLiveQuote = Boolean(quote && quote.price > 0);
    const currentPrice = hasLiveQuote ? quote!.price : h.avgPrice;
    const investedValue = h.units * h.avgPrice;
    const currentValue = h.units * currentPrice;
    const totalPnlAmount = currentValue - investedValue;
    const totalPnlPercent = investedValue > 0 ? (totalPnlAmount / investedValue) * 100 : 0;

    const unitDayChange = hasLiveQuote ? quote!.dayChange : 0;
    const itemDayChangeAmount = h.units * unitDayChange;
    const itemDayChangePercent = hasLiveQuote ? quote!.dayChangePercent : 0;

    totalValue += currentValue;
    totalInvested += investedValue;
    dayChangeAmount += itemDayChangeAmount;

    if (h.assetType === "mf") mfCount++;
    else stocksCount++;

    return {
      ...h,
      currentPrice,
      currentValue,
      investedValue,
      totalPnlAmount,
      totalPnlPercent,
      dayChangeAmount: itemDayChangeAmount,
      dayChangePercent: itemDayChangePercent,
      currency: quote?.currency || h.currency || "INR",
      hasLiveQuote,
      quoteUnavailable: !hasLiveQuote,
    };
  });

  const totalPnlAmount = totalValue - totalInvested;
  const totalPnlPercent = totalInvested > 0 ? (totalPnlAmount / totalInvested) * 100 : 0;
  const prevPortfolioValue = totalValue - dayChangeAmount;
  const dayChangePercent =
    prevPortfolioValue > 0 ? (dayChangeAmount / prevPortfolioValue) * 100 : 0;

  // Build allocation breakdown by asset class / type
  const classTotals: Record<string, number> = {};
  for (const item of enriched) {
    const typeLabel =
      item.assetType === "stock"
        ? "Direct Equity / Stocks"
        : item.assetType === "mf"
          ? "Mutual Funds (SIP)"
          : item.assetType === "etf"
            ? "Exchange Traded Funds"
            : item.assetType === "crypto"
              ? "Crypto"
              : "Other Assets";

    classTotals[typeLabel] = (classTotals[typeLabel] || 0) + item.currentValue;
  }

  // Pre-defined color palette: blue, green, amber, light grey, purple
  const palette = ["#3B82F6", "#22C55E", "#F59E0B", "#E0E3E6", "#8B5CF6", "#EC4899", "#14B8A6"];
  const allocation: AssetAllocationItem[] = Object.entries(classTotals).map(
    ([name, value], idx) => ({
      name,
      value,
      color: palette[idx % palette.length],
      percent: totalValue > 0 ? (value / totalValue) * 100 : 0,
    })
  );

  return {
    enriched,
    summary: {
      totalValue,
      totalInvested,
      totalPnlAmount,
      totalPnlPercent,
      dayChangeAmount,
      dayChangePercent,
      holdingsCount: holdings.length,
      stocksCount,
      mfCount,
    },
    allocation,
  };
}
