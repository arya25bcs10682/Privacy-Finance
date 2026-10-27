import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadBudgetForMonth,
  saveBudgetForMonth,
  DEFAULT_CATEGORY_LIMITS,
} from "./budgetStorage";
import { generateDataKey } from "../crypto";
import * as api from "../api";

describe("Encrypted Budget Storage (budgetStorage)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("saves and loads category budgets encrypted with AES-GCM 256 without exposing plaintext", async () => {
    const dataKey = await generateDataKey();
    const month = "2026-03";

    const customLimits = {
      "Food & Dining": 15000,
      "Housing & Rent": 30000,
      "Shopping & Groceries": 10000,
    };

    const postSpy = vi.spyOn(api, "apiFetch").mockResolvedValue({
      budget: { _id: "budget-doc-123" },
    });

    const savedId = await saveBudgetForMonth(month, customLimits, dataKey);
    expect(savedId).toBe("budget-doc-123");

    // 1. Check localStorage for encrypted payload
    const rawStored = localStorage.getItem(`pf_encrypted_budget_${month}`);
    expect(rawStored).not.toBeNull();
    const parsed = JSON.parse(rawStored!);
    expect(parsed).toHaveProperty("iv");
    expect(parsed).toHaveProperty("ciphertext");

    // Zero-knowledge rule: plaintext limits & numbers must NOT exist in raw storage
    expect(rawStored).not.toContain("Food & Dining");
    expect(rawStored).not.toContain("15000");

    // 2. Check server payload
    expect(postSpy).toHaveBeenCalledWith("/budgets", expect.objectContaining({ method: "POST" }));

    // 3. Decrypt and load back in memory
    const loaded = await loadBudgetForMonth(month, dataKey);
    expect(loaded.limits["Food & Dining"]).toBe(15000);
    expect(loaded.limits["Housing & Rent"]).toBe(30000);
    expect(loaded.limits["Shopping & Groceries"]).toBe(10000);
  });

  it("returns default category limits when no budget has been saved yet", async () => {
    const dataKey = await generateDataKey();
    vi.spyOn(api, "apiFetch").mockResolvedValue({ budgets: [] });

    const loaded = await loadBudgetForMonth("2026-04", dataKey);
    expect(loaded.limits["Food & Dining"]).toBe(DEFAULT_CATEGORY_LIMITS["Food & Dining"]);
    expect(loaded.limits["Housing & Rent"]).toBe(DEFAULT_CATEGORY_LIMITS["Housing & Rent"]);
  });

  it("updates existing budget document via PUT when budgetId is provided", async () => {
    const dataKey = await generateDataKey();
    const putSpy = vi.spyOn(api, "apiFetch").mockResolvedValue({
      budget: { _id: "existing-budget-1" },
    });

    await saveBudgetForMonth("2026-03", { "Food & Dining": 20000 }, dataKey, "existing-budget-1");

    expect(putSpy).toHaveBeenCalledWith(
      "/budgets/existing-budget-1",
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("persists and restores period configuration, defaulting missing periods to 'monthly'", async () => {
    const dataKey = await generateDataKey();
    const month = "2026-05";

    const customLimits = {
      "Food & Dining": 500,
      "Travel & Commute": 1500,
      "Housing & Rent": 25000,
    };

    const customPeriods = {
      "Food & Dining": "daily" as const,
      "Travel & Commute": "weekly" as const,
    };

    vi.spyOn(api, "apiFetch").mockResolvedValue({
      budget: { _id: "budget-period-1" },
    });

    await saveBudgetForMonth(month, customLimits, customPeriods, dataKey);

    const loaded = await loadBudgetForMonth(month, dataKey);
    expect(loaded.periods["Food & Dining"]).toBe("daily");
    expect(loaded.periods["Travel & Commute"]).toBe("weekly");
    // Housing & Rent had no period explicitly provided -> defaults to "monthly"
    expect(loaded.periods["Housing & Rent"]).toBe("monthly");
  });
});
