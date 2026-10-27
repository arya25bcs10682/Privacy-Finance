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
});
