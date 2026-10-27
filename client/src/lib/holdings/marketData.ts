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
/**
 * Supported display currencies and exchange rate conversion logic
 */
export const DEFAULT_RATES_TO_INR: Record<string, number> = {
  INR: 1,
  USD: 86.5,
  EUR: 93.0,
  GBP: 110.0,
};

/**
 * Extracts live or fallback exchange rates from quote data
 */
export function getExchangeRates(quotes?: Record<string, QuoteData>): Record<string, number> {
  const rates: Record<string, number> = { ...DEFAULT_RATES_TO_INR };
  if (!quotes) return rates;

  if (quotes["USDINR=X"]?.price && quotes["USDINR=X"].price > 0) {
    rates.USD = quotes["USDINR=X"].price;
  }
  if (quotes["EURINR=X"]?.price && quotes["EURINR=X"].price > 0) {
    rates.EUR = quotes["EURINR=X"].price;
  } else if (quotes["EURUSD=X"]?.price && quotes["EURUSD=X"].price > 0 && rates.USD) {
    rates.EUR = quotes["EURUSD=X"].price * rates.USD;
  }
  if (quotes["GBPINR=X"]?.price && quotes["GBPINR=X"].price > 0) {
    rates.GBP = quotes["GBPINR=X"].price;
  }
  return rates;
}

/**
 * Converts a numeric value between any two supported currencies
 */
export function convertCurrency(
  amount: number,
  from: string = "INR",
  to: string = "INR",
  rates: Record<string, number> = DEFAULT_RATES_TO_INR
): number {
  if (amount === 0 || isNaN(amount)) return 0;
  const fromUpper = (from || "INR").toUpperCase();
  const toUpper = (to || "INR").toUpperCase();
  if (fromUpper === toUpper) return amount;

  const fromRate = rates[fromUpper] ?? 1;
  const toRate = rates[toUpper] ?? 1;

  // Convert from origin currency to base INR, then from INR to target currency
  const inINR = amount * fromRate;
  return inINR / toRate;
}

/**
 * Returns the currency symbol for display
 */
export function getCurrencySymbol(currency: string = "INR"): string {
  switch (currency.toUpperCase()) {
    case "USD":
      return "$";
    case "EUR":
      return "€";
    case "GBP":
      return "£";
    case "INR":
    default:
      return "₹";
  }
}

/**
 * Formats a currency amount with symbol and appropriate locale
 */
export function formatCurrency(
  amount: number,
  currency: string = "INR",
  options?: {
    showSign?: boolean;
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
  }
): string {
  const symbol = getCurrencySymbol(currency);
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);
  const minDigits = options?.minimumFractionDigits ?? 0;
  const maxDigits = options?.maximumFractionDigits ?? 2;

  let locale = "en-IN";
  if (currency.toUpperCase() === "USD") locale = "en-US";
  else if (currency.toUpperCase() === "EUR") locale = "de-DE";
  else if (currency.toUpperCase() === "GBP") locale = "en-GB";

  const formatted = absAmount.toLocaleString(locale, {
    minimumFractionDigits: minDigits,
    maximumFractionDigits: maxDigits,
  });

  const sign = options?.showSign ? (isNegative ? "-" : "+") : isNegative ? "-" : "";
  return `${sign}${symbol}${formatted}`;
}

/**
 * Batch fetches all market data for holdings (both stocks via proxy and MFs via direct API)
 * Automatically includes major forex currency pairs for real-time exchange rates.
 */
export async function fetchAllHoldingsQuotes(
  holdings: HoldingItem[]
): Promise<Record<string, QuoteData>> {
  // Always include major forex pairs for live portfolio currency conversion
  const stockSymbols: string[] = ["USDINR=X", "EURINR=X", "GBPINR=X", "EURUSD=X"];
  const mfCodes: string[] = [];

  for (const h of holdings) {
    if (h.assetType === "mf" || /^\d{5,7}$/.test(h.symbol.trim())) {
      mfCodes.push(h.symbol.trim());
    } else {
      stockSymbols.push(h.symbol.trim().toUpperCase());
    }
  }

  // 1. Fetch stock quotes and forex pairs via proxy in one batch
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
 * - Current Value = units * CMP (converted to target currency)
 * - Total P&L = Current Value - Invested Value (converted to target currency)
 * - Day Change = units * (CMP - prevClose) (converted to target currency)
 * - Allocation Breakdown
 */
export function computePortfolio(
  holdings: HoldingItem[],
  quotes: Record<string, QuoteData>,
  targetCurrency: string = "INR"
): {
  enriched: EnrichedHolding[];
  summary: PortfolioSummary;
  allocation: AssetAllocationItem[];
  targetCurrency: string;
} {
  const rates = getExchangeRates(quotes);
  const target = (targetCurrency || "INR").toUpperCase();

  let totalValue = 0;
  let totalInvested = 0;
  let dayChangeAmount = 0;
  let stocksCount = 0;
  let mfCount = 0;

  const enriched: EnrichedHolding[] = holdings.map((h) => {
    const lookupKey = h.symbol.trim().toUpperCase();
    const quote = quotes[lookupKey] || quotes[h.symbol.trim()];

    const hasLiveQuote = Boolean(quote && quote.price > 0);
    const nativeCurrency = (h.currency || quote?.currency || "INR").toUpperCase();
    const quoteCurrency = (quote?.currency || nativeCurrency).toUpperCase();

    // Native price and cost basis in asset's original currency
    const rawCMP = hasLiveQuote ? quote!.price : h.avgPrice;
    const currentPriceNative =
      quote && quoteCurrency !== nativeCurrency
        ? convertCurrency(rawCMP, quoteCurrency, nativeCurrency, rates)
        : rawCMP;

    const investedValueNative = h.units * h.avgPrice;
    const currentValueNative = h.units * currentPriceNative;
    const totalPnlAmountNative = currentValueNative - investedValueNative;
    const totalPnlPercent =
      investedValueNative > 0 ? (totalPnlAmountNative / investedValueNative) * 100 : 0;

    const unitDayChange = hasLiveQuote ? quote!.dayChange : 0;
    const itemDayChangeAmountNative = h.units * unitDayChange;
    const itemDayChangePercent = hasLiveQuote ? quote!.dayChangePercent : 0;

    // Convert all metrics to target currency
    const avgPriceConverted = convertCurrency(h.avgPrice, nativeCurrency, target, rates);
    const currentPriceConverted = convertCurrency(currentPriceNative, nativeCurrency, target, rates);
    const investedValueConverted = convertCurrency(investedValueNative, nativeCurrency, target, rates);
    const currentValueConverted = convertCurrency(currentValueNative, nativeCurrency, target, rates);
    const totalPnlAmountConverted = currentValueConverted - investedValueConverted;
    const itemDayChangeAmountConverted = convertCurrency(
      itemDayChangeAmountNative,
      nativeCurrency,
      target,
      rates
    );

    totalValue += currentValueConverted;
    totalInvested += investedValueConverted;
    dayChangeAmount += itemDayChangeAmountConverted;

    if (h.assetType === "mf") mfCount++;
    else stocksCount++;

    return {
      ...h,
      avgPrice: avgPriceConverted,
      currentPrice: currentPriceConverted,
      currentValue: currentValueConverted,
      investedValue: investedValueConverted,
      totalPnlAmount: totalPnlAmountConverted,
      totalPnlPercent,
      dayChangeAmount: itemDayChangeAmountConverted,
      dayChangePercent: itemDayChangePercent,
      currency: target,
      hasLiveQuote,
      quoteUnavailable: !hasLiveQuote,
      originalCurrency: nativeCurrency,
      originalAvgPrice: h.avgPrice,
      originalInvestedValue: investedValueNative,
      originalCurrentPrice: currentPriceNative,
      originalCurrentValue: currentValueNative,
    };
  });

  const totalPnlAmount = totalValue - totalInvested;
  const totalPnlPercent = totalInvested > 0 ? (totalPnlAmount / totalInvested) * 100 : 0;
  const prevPortfolioValue = totalValue - dayChangeAmount;
  const dayChangePercent =
    prevPortfolioValue > 0 ? (dayChangeAmount / prevPortfolioValue) * 100 : 0;

  // Build allocation breakdown by asset class / type in target currency
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
      currency: target,
    },
    allocation,
    targetCurrency: target,
  };
}
