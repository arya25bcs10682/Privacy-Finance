import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { generateTokens } from "./utils/jwt.js";
import { parseStatementText } from "./services/parser.js";
import { MockLLMProvider } from "./services/llm/mock.js";
import { setGlobalLLMProvider, getLLMProvider } from "./services/llm/factory.js";
import type { ILLMProvider } from "./services/llm/types.js";
import { GeminiProvider, GeminiError } from "./services/llm/gemini.js";

describe("LLM-Based Statement Parser & /api/parse", () => {
  const app = createApp();
  let userToken: string;

  beforeEach(() => {
    vi.clearAllMocks();
    userToken = generateTokens("test-user-id-parse").accessToken;
  });

  describe("1. Parser Service & Zod Validation", () => {
    it("successfully parses valid LLM JSON output into typed transactions", async () => {
      const mockTransactions = [
        {
          date: "2026-02-15",
          narration: "HDFC SALARY CREDIT",
          type: "credit",
          amount: 85000,
          balance: 145000.5,
        },
        {
          date: "2026-02-16",
          narration: "AMZN MKTP BLR",
          type: "debit",
          amount: 1299,
          balance: 143701.5,
        },
      ];

      const mockProvider = new MockLLMProvider(JSON.stringify(mockTransactions));
      const result = await parseStatementText("Statement page text", {
        provider: mockProvider,
      });

      expect(result).toHaveLength(2);
      expect(result[0].date).toBe("2026-02-15");
      expect(result[0].type).toBe("credit");
      expect(result[0].amount).toBe(85000);
      expect(result[1].type).toBe("debit");
    });

    it("strips markdown code blocks if the LLM wraps the response in ```json ... ```", async () => {
      const wrappedMarkdown = `\`\`\`json
[
  {
    "date": "2026-01-20",
    "narration": "NETFLIX RECURRING",
    "type": "debit",
    "amount": 649,
    "balance": 25000
  }
]
\`\`\``;

      const mockProvider = new MockLLMProvider(wrappedMarkdown);
      const result = await parseStatementText("Text", { provider: mockProvider });

      expect(result).toHaveLength(1);
      expect(result[0].narration).toBe("NETFLIX RECURRING");
      expect(result[0].amount).toBe(649);
    });

    it("retries once on invalid JSON and succeeds when retry returns valid output", async () => {
      let callCount = 0;
      const retryProvider: ILLMProvider = {
        name: "flaky-llm",
        generateText: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            // First attempt: Invalid malformed JSON
            return "Here are the transactions: [{ date: 2026-01-01, amount: invalid }]";
          }
          // Second attempt: Valid JSON conforming to schema
          return JSON.stringify([
            {
              date: "2026-01-01",
              narration: "GROCERY STORE",
              type: "debit",
              amount: 540,
              balance: 12000,
            },
          ]);
        }),
      };

      const result = await parseStatementText("Raw statement text", {
        provider: retryProvider,
      });

      expect(callCount).toBe(2);
      expect(result).toHaveLength(1);
      expect(result[0].date).toBe("2026-01-01");
    });

    it("throws an error if retry also fails Zod schema validation", async () => {
      const alwaysFailsProvider: ILLMProvider = {
        name: "failing-llm",
        generateText: vi.fn().mockResolvedValue(
          // Fails Zod because date format is invalid and amount is negative
          JSON.stringify([{ date: "not-a-date", narration: "test", type: "other", amount: -50 }])
        ),
      };

      await expect(
        parseStatementText("Statement text", { provider: alwaysFailsProvider })
      ).rejects.toThrow("Failed to parse statement transactions after retry");
    });

    it("returns empty array for pages with no transactions", async () => {
      const mockProvider = new MockLLMProvider("[]");
      const result = await parseStatementText("Page text with terms and conditions", {
        provider: mockProvider,
      });

      expect(result).toEqual([]);
    });
  });

  describe("2. Pluggable Provider Interface", () => {
    it("allows swapping provider without hardcoding", async () => {
      const customProvider: ILLMProvider = {
        name: "custom-ollama",
        generateText: vi.fn().mockResolvedValue(
          JSON.stringify([
            {
              date: "2026-03-01",
              narration: "OLLAMA LOCAL PARSE",
              type: "credit",
              amount: 1000,
              balance: 5000,
            },
          ])
        ),
      };

      setGlobalLLMProvider(customProvider);
      expect(getLLMProvider().name).toBe("custom-ollama");

      const result = await parseStatementText("Some text");
      expect(result[0].narration).toBe("OLLAMA LOCAL PARSE");
    });
  });

  describe("3. POST /api/parse Route & Security", () => {
    beforeEach(() => {
      setGlobalLLMProvider(
        new MockLLMProvider(
          JSON.stringify([
            {
              date: "2026-02-10",
              narration: "UPI/50123/Swiggy Bangalore",
              type: "debit",
              amount: 450.5,
              balance: 98549.5,
            },
          ])
        )
      );
    });

    it("rejects unauthorized requests with 401", async () => {
      const res = await request(app).post("/api/parse").send({ text: "statement page text" });

      expect(res.status).toBe(401);
    });

    it("parses redacted page text successfully when authenticated", async () => {
      const res = await request(app)
        .post("/api/parse")
        .set("Cookie", [`accessToken=${userToken}`])
        .send({
          text: "10-Feb-2026 UPI/50123/Swiggy Bangalore 450.50 DR 98549.50",
          pageNumber: 1,
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("transactions");
      expect(res.body.transactions).toHaveLength(1);
      expect(res.body.transactions[0].date).toBe("2026-02-10");
      expect(res.body.count).toBe(1);
      expect(res.body.pageNumber).toBe(1);
    });

    it("returns empty array for empty or blank text", async () => {
      const res = await request(app)
        .post("/api/parse")
        .set("Cookie", [`accessToken=${userToken}`])
        .send({ text: "   " });

      expect(res.status).toBe(200);
      expect(res.body.transactions).toEqual([]);
      expect(res.body.count).toBe(0);
    });

    it("returns {stage: 'llm', status, message} when the LLM provider fails", async () => {
      const failingProvider: ILLMProvider = {
        name: "failing-gemini",
        generateText: vi.fn().mockImplementation(() => {
          const err = new Error("This model is currently experiencing high demand.");
          (err as any).status = 503;
          (err as any).model = "gemini-3.5-flash";
          throw err;
        }),
      };

      setGlobalLLMProvider(failingProvider);

      const res = await request(app)
        .post("/api/parse")
        .set("Cookie", [`accessToken=${userToken}`])
        .send({ text: "Sample statement page text", pageNumber: 1 });

      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        stage: "llm",
        status: 503,
        message: "The AI model is busy. Please try again in a minute.",
      });
    });
  });

  describe("4. Gemini Provider Resilience & Fallback", () => {
    it("retries on 503 up to 4 times and succeeds if a retry succeeds", async () => {
      let callCount = 0;
      const fakeFetch = vi.fn().mockImplementation(async (url: string) => {
        callCount++;
        if (callCount < 3) {
          return {
            ok: false,
            status: 503,
            text: async () => JSON.stringify({ error: { message: "Model overloaded" } }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify([{ date: "2026-01-01", narration: "TEST", type: "debit", amount: 10, balance: 100 }]) }],
                },
              },
            ],
          }),
        };
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = fakeFetch as any;

      try {
        const provider = new GeminiProvider({
          apiKey: "test-key",
          model: "gemini-3.5-flash",
          retryDelays: [1, 2, 3, 4],
        });

        const res = await provider.generateText({
          systemPrompt: "sys",
          userPrompt: "user",
        });

        expect(callCount).toBe(3);
        expect(res).toContain("TEST");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("does not retry on 400/401/403/404 errors", async () => {
      let callCount = 0;
      const fakeFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ error: { message: "Bad Request" } }),
        };
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = fakeFetch as any;

      try {
        const provider = new GeminiProvider({
          apiKey: "test-key",
          model: "gemini-3.5-flash",
          retryDelays: [1, 2, 3, 4],
        });

        await expect(
          provider.generateText({
            systemPrompt: "sys",
            userPrompt: "user",
          })
        ).rejects.toThrow();

        expect(callCount).toBe(1); // No retries performed
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("switches to fallback model if primary model still returns 503 after all retries", async () => {
      const modelsCalled: string[] = [];
      const fakeFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("gemini-3.5-flash-lite")) {
          modelsCalled.push("fallback");
          return {
            ok: true,
            status: 200,
            json: async () => ({
              candidates: [
                {
                  content: {
                    parts: [{ text: "[]" }],
                  },
                },
              ],
            }),
          };
        }
        modelsCalled.push("primary");
        return {
          ok: false,
          status: 503,
          text: async () => JSON.stringify({ error: { message: "Model overloaded" } }),
        };
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = fakeFetch as any;

      try {
        const provider = new GeminiProvider({
          apiKey: "test-key",
          model: "gemini-3.5-flash",
          fallbackModel: "gemini-3.5-flash-lite",
          retryDelays: [1, 2, 3, 4],
        });

        const res = await provider.generateText({
          systemPrompt: "sys",
          userPrompt: "user",
        });

        expect(res).toBe("[]");
        // Primary was called 5 times (initial + 4 retries), then fallback was called
        expect(modelsCalled.filter((m) => m === "primary").length).toBe(5);
        expect(modelsCalled.filter((m) => m === "fallback").length).toBe(1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("throws 503 busy message if both primary and fallback models fail", async () => {
      const fakeFetch = vi.fn().mockImplementation(async () => {
        return {
          ok: false,
          status: 503,
          text: async () => JSON.stringify({ error: { message: "Overloaded" } }),
        };
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = fakeFetch as any;

      try {
        const provider = new GeminiProvider({
          apiKey: "test-key",
          model: "gemini-3.5-flash",
          fallbackModel: "gemini-3.5-flash-lite",
          retryDelays: [1, 2, 3, 4],
        });

        await expect(
          provider.generateText({
            systemPrompt: "sys",
            userPrompt: "user",
          })
        ).rejects.toMatchObject({
          status: 503,
          message: "The AI model is busy. Please try again in a minute.",
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});

