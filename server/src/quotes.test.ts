import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { generateTokens } from "./utils/jwt.js";
import { quotesCache, CACHE_TTL_MS } from "./routes/quotes.js";

describe("Quotes Proxy API (GET /api/quotes)", () => {
  const app = createApp();
  const testUserId = "user-investor-test";
  const { accessToken } = generateTokens(testUserId);

  beforeEach(() => {
    // Clear cache between test runs
    quotesCache.clear();
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app).get("/api/quotes?symbols=AAPL");
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 if symbols parameter is missing or empty", async () => {
    const resNoParam = await request(app)
      .get("/api/quotes")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(resNoParam.status).toBe(400);

    const resEmpty = await request(app)
      .get("/api/quotes?symbols=   ,,  ")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(resEmpty.status).toBe(400);
  });

  it("serves quotes from 5-minute in-memory cache when present", async () => {
    // Pre-populate cache
    const mockQuote = {
      symbol: "TESTSYM",
      name: "Test Symbol Inc.",
      regularMarketPrice: 250.75,
      regularMarketChange: 5.25,
      regularMarketChangePercent: 2.14,
      regularMarketPreviousClose: 245.5,
      currency: "INR",
      updatedAt: new Date().toISOString(),
    };

    quotesCache.set("TESTSYM", {
      quote: mockQuote,
      timestamp: Date.now(),
    });

    const res = await request(app)
      .get("/api/quotes?symbols=TESTSYM")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.cachedCount).toBe(1);
    expect(res.body.fetchedCount).toBe(0);
    expect(res.body.quotes).toHaveLength(1);
    expect(res.body.quotes[0].symbol).toBe("TESTSYM");
    expect(res.body.quotes[0].regularMarketPrice).toBe(250.75);
    expect(res.body.map["TESTSYM"].name).toBe("Test Symbol Inc.");
  });

  it("expires cached quotes after 5 minutes (TTL)", async () => {
    const expiredTimestamp = Date.now() - (CACHE_TTL_MS + 1000);
    quotesCache.set("EXPIRED_SYM", {
      quote: {
        symbol: "EXPIRED_SYM",
        regularMarketPrice: 100,
        regularMarketChange: 0,
        regularMarketChangePercent: 0,
        updatedAt: new Date(expiredTimestamp).toISOString(),
      },
      timestamp: expiredTimestamp,
    });

    // Requesting expired symbol should treat it as missing from valid cache
    const res = await request(app)
      .get("/api/quotes?symbols=EXPIRED_SYM")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.cachedCount).toBe(0);
    expect(res.body.fetchedCount).toBe(1);
  });

  it("handles invalid or non-existent symbols gracefully without 500 crash", async () => {
    const res = await request(app)
      .get("/api/quotes?symbols=NONEXISTENT_XYZ_999")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("quotes");
    expect(Array.isArray(res.body.quotes)).toBe(true);
  });
});
