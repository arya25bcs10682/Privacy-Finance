import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { generateTokens } from "./utils/jwt.js";

describe("Security Audit & Hardening Suite", () => {
  const app = createApp();
  const testUserId = "security-audit-user";
  const { accessToken } = generateTokens(testUserId);

  describe("Security Headers & CSP Verification", () => {
    it("emits strict security headers and Content Security Policy on API responses", async () => {
      const res = await request(app).get("/api/health");

      expect(res.status).toBe(200);

      // Verify Helmet security headers
      expect(res.headers).toHaveProperty("x-content-type-options", "nosniff");
      expect(res.headers).toHaveProperty(
        "referrer-policy",
        "strict-origin-when-cross-origin"
      );
      expect(res.headers).toHaveProperty(
        "cross-origin-resource-policy",
        "cross-origin"
      );

      // Verify Content Security Policy
      const csp = res.headers["content-security-policy"];
      expect(csp).toBeDefined();
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("https://api.mfapi.in");
    });
  });

  describe("Zero-Knowledge & Secret Transmission Protection", () => {
    it("actively rejects signup attempts that include raw secretKey in request payload", async () => {
      const res = await request(app)
        .post("/api/auth/signup")
        .send({
          email: "attacker@test.com",
          password: "SuperPassword123!",
          secretKey: "ILLEGAL_PLAINTEXT_SECRET_KEY",
          keySalt: "some-salt",
          wrappedDataKey: { ciphertext: "abc" },
          wrappedDataKeyByRecovery: "def",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Security violation");
    });

    it("actively rejects signup attempts that include raw secret property", async () => {
      const res = await request(app)
        .post("/api/auth/signup")
        .send({
          email: "attacker2@test.com",
          password: "SuperPassword123!",
          secret: "ILLEGAL_PLAINTEXT_SECRET",
          keySalt: "some-salt",
          wrappedDataKey: { ciphertext: "abc" },
          wrappedDataKeyByRecovery: "def",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Security violation");
    });
  });

  describe("Rate Limiting on Sensitive Endpoints", () => {
    it("applies rate limiting headers to /api/quotes endpoint", async () => {
      const res = await request(app)
        .get("/api/quotes?symbols=AAPL")
        .set("Authorization", `Bearer ${accessToken}`);

      // Rate limit headers (Standard RFC draft or Express Rate Limit)
      const hasRateLimitHeader =
        "ratelimit-limit" in res.headers ||
        "x-ratelimit-limit" in res.headers ||
        "retry-after" in res.headers;
      expect(hasRateLimitHeader).toBe(true);
    });

    it("applies rate limiting to /api/transactions/bulk endpoint", async () => {
      const res = await request(app)
        .post("/api/transactions/bulk")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ transactions: [] });

      const hasRateLimitHeader =
        "ratelimit-limit" in res.headers ||
        "x-ratelimit-limit" in res.headers ||
        "retry-after" in res.headers;
      expect(hasRateLimitHeader).toBe(true);
    });
  });
});
