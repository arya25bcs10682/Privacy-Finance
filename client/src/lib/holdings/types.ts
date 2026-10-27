export type AssetType = "stock" | "mf" | "etf" | "crypto" | "other";

export interface HoldingItem {
  id: string;
  symbol: string; // Stock symbol (e.g. RELIANCE.NS, AAPL) or MF Scheme Code (e.g. 120503)
  name: string; // Descriptive name (e.g. "Reliance Industries Ltd", "Axis ELSS Tax Saver")
  units: number; // Quantity / shares / mutual fund units
  avgPrice: number; // Average purchase price / NAV per unit
  assetType: AssetType;
  purchaseDate?: string; // Optional purchase date (YYYY-MM-DD)
  currency?: string; // INR, USD, etc. (defaults to INR)
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface QuoteData {
  symbol: string;
  name?: string;
  price: number;
  dayChange: number;
  dayChangePercent: number;
  prevClose?: number;
  currency?: string;
  source: "yahoo" | "mfapi";
  lastUpdated: string;
}

export interface EnrichedHolding extends HoldingItem {
  currentPrice: number;
  currentValue: number;
  investedValue: number;
  totalPnlAmount: number;
  totalPnlPercent: number;
  dayChangeAmount: number;
  dayChangePercent: number;
  currency: string;
  hasLiveQuote: boolean;
  quoteUnavailable?: boolean;
  originalCurrency?: string;
  originalAvgPrice?: number;
  originalInvestedValue?: number;
  originalCurrentPrice?: number;
  originalCurrentValue?: number;
}

export interface PortfolioSummary {
  totalValue: number;
  totalInvested: number;
  totalPnlAmount: number;
  totalPnlPercent: number;
  dayChangeAmount: number;
  dayChangePercent: number;
  holdingsCount: number;
  stocksCount: number;
  mfCount: number;
  currency?: string;
}

export interface AssetAllocationItem {
  name: string;
  value: number;
  color: string;
  percent: number;
}
