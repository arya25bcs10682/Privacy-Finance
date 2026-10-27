import { describe, it, expect } from "vitest";
import { computePortfolio } from "./marketData";
import type { HoldingItem, QuoteData } from "./types";

describe("Holdings Market Data & Portfolio Calculations", () => {
  it("computes portfolio current value, P&L, day change, and allocation accurately", () => {
    const holdings: HoldingItem[] = [
      {
        id: "hold-1",
        symbol: "RELIANCE.NS",
        name: "Reliance Industries",
        units: 10,
        avgPrice: 2400, // Invested = 24,000
        assetType: "stock",
      },
      {
        id: "hold-2",
        symbol: "120503",
        name: "Axis ELSS Tax Saver",
        units: 100,
        avgPrice: 80, // Invested = 8,000
        assetType: "mf",
      },
    ];

    const quotes: Record<string, QuoteData> = {
      "RELIANCE.NS": {
        symbol: "RELIANCE.NS",
        price: 2500, // Current = 25,000 (P&L: +1000, +4.17%)
        dayChange: 50, // Day Change = 10 * 50 = +500
        dayChangePercent: 2.04,
        prevClose: 2450,
        currency: "INR",
        source: "yahoo",
        lastUpdated: new Date().toISOString(),
      },
      "120503": {
        symbol: "120503",
        price: 90, // Current = 9,000 (P&L: +1000, +12.5%)
        dayChange: -2, // Day Change = 100 * -2 = -200
        dayChangePercent: -2.17,
        prevClose: 92,
        currency: "INR",
        source: "mfapi",
        lastUpdated: new Date().toISOString(),
      },
    };

    const { enriched, summary, allocation } = computePortfolio(holdings, quotes);

    // 1. Check enriched holdings
    expect(enriched).toHaveLength(2);

    const rel = enriched.find((h) => h.symbol === "RELIANCE.NS");
    expect(rel).toBeDefined();
    expect(rel?.investedValue).toBe(24000);
    expect(rel?.currentValue).toBe(25000);
    expect(rel?.totalPnlAmount).toBe(1000);
    expect(rel?.totalPnlPercent).toBeCloseTo(4.166, 1);
    expect(rel?.dayChangeAmount).toBe(500);

    const mf = enriched.find((h) => h.symbol === "120503");
    expect(mf).toBeDefined();
    expect(mf?.investedValue).toBe(8000);
    expect(mf?.currentValue).toBe(9000);
    expect(mf?.totalPnlAmount).toBe(1000);
    expect(mf?.totalPnlPercent).toBe(12.5);
    expect(mf?.dayChangeAmount).toBe(-200);

    // 2. Check summary metrics
    // Total Invested = 24,000 + 8,000 = 32,000
    // Total Value = 25,000 + 9,000 = 34,000
    // Total P&L = +2,000 (+6.25%)
    // Day Change = 500 - 200 = +300
    expect(summary.totalInvested).toBe(32000);
    expect(summary.totalValue).toBe(34000);
    expect(summary.totalPnlAmount).toBe(2000);
    expect(summary.totalPnlPercent).toBe(6.25);
    expect(summary.dayChangeAmount).toBe(300);
    expect(summary.stocksCount).toBe(1);
    expect(summary.mfCount).toBe(1);

    // 3. Check allocation breakdown
    expect(allocation).toHaveLength(2);
    const stockAlloc = allocation.find((a) => a.name === "Direct Equity / Stocks");
    const mfAlloc = allocation.find((a) => a.name === "Mutual Funds (SIP)");
    expect(stockAlloc?.value).toBe(25000);
    expect(mfAlloc?.value).toBe(9000);
    expect((stockAlloc?.percent || 0) + (mfAlloc?.percent || 0)).toBeCloseTo(100, 1);
  });

  it("gracefully falls back to purchase price / cost basis when quote is unavailable", () => {
    const holdings: HoldingItem[] = [
      {
        id: "hold-unquoted",
        symbol: "UNKNOWN.TICKER",
        name: "Unquoted Asset",
        units: 5,
        avgPrice: 100,
        assetType: "stock",
      },
    ];

    const { enriched, summary } = computePortfolio(holdings, {});

    expect(enriched[0].currentPrice).toBe(100);
    expect(enriched[0].currentValue).toBe(500);
    expect(enriched[0].totalPnlAmount).toBe(0);
    expect(enriched[0].dayChangeAmount).toBe(0);
    expect(enriched[0].hasLiveQuote).toBe(false);

    expect(summary.totalValue).toBe(500);
    expect(summary.totalInvested).toBe(500);
    expect(summary.totalPnlAmount).toBe(0);
  });

  it("converts multi-currency holdings into selected portfolio target currency", () => {
    const holdings: HoldingItem[] = [
      {
        id: "hold-aapl",
        symbol: "AAPL",
        name: "Apple Inc.",
        units: 10,
        avgPrice: 150, // Bought in USD: $150 -> $1,500 invested
        currency: "USD",
        assetType: "stock",
      },
      {
        id: "hold-rel",
        symbol: "RELIANCE.NS",
        name: "Reliance Industries",
        units: 10,
        avgPrice: 2000, // Bought in INR: ₹2,000 -> ₹20,000 invested
        currency: "INR",
        assetType: "stock",
      },
    ];

    const quotes: Record<string, QuoteData> = {
      AAPL: {
        symbol: "AAPL",
        price: 200, // $200 -> $2,000 current (+33.33%)
        dayChange: 2,
        dayChangePercent: 1.0,
        prevClose: 198,
        currency: "USD",
        source: "yahoo",
        lastUpdated: new Date().toISOString(),
      },
      "RELIANCE.NS": {
        symbol: "RELIANCE.NS",
        price: 2500, // ₹2500 -> ₹25,000 current (+25%)
        dayChange: 25,
        dayChangePercent: 1.0,
        prevClose: 2475,
        currency: "INR",
        source: "yahoo",
        lastUpdated: new Date().toISOString(),
      },
      "USDINR=X": {
        symbol: "USDINR=X",
        price: 85, // 1 USD = 85 INR
        dayChange: 0,
        dayChangePercent: 0,
        prevClose: 85,
        currency: "INR",
        source: "yahoo",
        lastUpdated: new Date().toISOString(),
      },
    };

    // 1. Compute portfolio in INR (Target = INR)
    const inrPortfolio = computePortfolio(holdings, quotes, "INR");
    const aaplInInr = inrPortfolio.enriched.find((h) => h.symbol === "AAPL");
    const relInInr = inrPortfolio.enriched.find((h) => h.symbol === "RELIANCE.NS");

    expect(aaplInInr).toBeDefined();
    expect(aaplInInr?.originalCurrency).toBe("USD");
    expect(aaplInInr?.originalAvgPrice).toBe(150);
    expect(aaplInInr?.originalInvestedValue).toBe(1500);
    expect(aaplInInr?.originalCurrentPrice).toBe(200);
    expect(aaplInInr?.originalCurrentValue).toBe(2000);
    // Converted to INR at rate 85:
    // Avg price = 150 * 85 = 12,750
    // Invested = 1500 * 85 = 127,500
    // Current price = 200 * 85 = 17,000
    // Current value = 2000 * 85 = 170,000
    // P&L amount = 170,000 - 127,500 = 42,500
    expect(aaplInInr?.avgPrice).toBe(12750);
    expect(aaplInInr?.investedValue).toBe(127500);
    expect(aaplInInr?.currentPrice).toBe(17000);
    expect(aaplInInr?.currentValue).toBe(170000);
    expect(aaplInInr?.totalPnlAmount).toBe(42500);

    // Reliance remains INR
    expect(relInInr?.investedValue).toBe(20000);
    expect(relInInr?.currentValue).toBe(25000);

    // Portfolio summary in INR
    expect(inrPortfolio.summary.totalInvested).toBe(127500 + 20000);
    expect(inrPortfolio.summary.totalValue).toBe(170000 + 25000);
    expect(inrPortfolio.summary.currency).toBe("INR");

    // 2. Compute portfolio in USD (Target = USD)
    const usdPortfolio = computePortfolio(holdings, quotes, "USD");
    const aaplInUsd = usdPortfolio.enriched.find((h) => h.symbol === "AAPL");
    const relInUsd = usdPortfolio.enriched.find((h) => h.symbol === "RELIANCE.NS");

    // AAPL in USD should match original USD values
    expect(aaplInUsd?.avgPrice).toBe(150);
    expect(aaplInUsd?.investedValue).toBe(1500);
    expect(aaplInUsd?.currentPrice).toBe(200);
    expect(aaplInUsd?.currentValue).toBe(2000);

    // Reliance in USD should convert ₹20,000 / 85 and ₹25,000 / 85
    expect(relInUsd?.originalCurrency).toBe("INR");
    expect(relInUsd?.investedValue).toBeCloseTo(20000 / 85, 2);
    expect(relInUsd?.currentValue).toBeCloseTo(25000 / 85, 2);

    expect(usdPortfolio.summary.totalInvested).toBeCloseTo(1500 + 20000 / 85, 2);
    expect(usdPortfolio.summary.totalValue).toBeCloseTo(2000 + 25000 / 85, 2);
    expect(usdPortfolio.summary.currency).toBe("USD");
  });
});
