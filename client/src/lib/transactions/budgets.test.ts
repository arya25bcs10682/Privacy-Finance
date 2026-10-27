import { describe, it, expect } from "vitest";
import {
  calculateCategoryBudgets,
  getBudgetAlerts,
  parseLocalDate,
  getWeekStart,
} from "./budgets";

describe("Budget Calculation Engine", () => {
  const mockLimits: Record<string, number> = {
    "Food & Dining": 10000,
    "Housing & Rent": 25000,
    "Shopping & Groceries": 5000,
    "Entertainment": 3000,
  };

  it("parses YYYY-MM-DD as local date without UTC shifts", () => {
    const d = parseLocalDate("2026-09-15");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8); // 0-indexed September
    expect(d.getDate()).toBe(15);
  });

  it("determines Monday of the week (Mon-Sun) accurately", () => {
    // 2026-10-26 is Monday
    expect(getWeekStart("2026-10-26")).toBe("2026-10-26");
    // 2026-10-27 is Tuesday -> Monday is 2026-10-26
    expect(getWeekStart("2026-10-27")).toBe("2026-10-26");
    // 2026-11-01 is Sunday -> Monday is 2026-10-26
    expect(getWeekStart("2026-11-01")).toBe("2026-10-26");
    // 2026-11-02 is Monday -> Monday is 2026-11-02
    expect(getWeekStart("2026-11-02")).toBe("2026-11-02");
  });

  it("assigns green (#22C55E) when category spending is under 80%", () => {
    const transactions = [
      { category: "Food & Dining", amount: 6500, type: "debit", month: "2026-03", date: "2026-03-10" },
    ];

    const metrics = calculateCategoryBudgets(transactions, mockLimits, "2026-03");
    const foodMetric = metrics.find((m) => m.category === "Food & Dining")!;

    expect(foodMetric.spent).toBe(6500);
    expect(foodMetric.limit).toBe(10000);
    expect(foodMetric.pct).toBe(65);
    expect(foodMetric.status).toBe("under");
    expect(foodMetric.progressColor).toBe("#22C55E");
    expect(foodMetric.remaining).toBe(3500);
  });

  it("assigns amber (#F59E0B) when category spending is over 80% and within limit (80% to 100%)", () => {
    const transactions = [
      { category: "Food & Dining", amount: 8500, type: "debit", month: "2026-03", date: "2026-03-05" },
      { category: "Entertainment", amount: 2400, type: "debit", month: "2026-03", date: "2026-03-12" },
    ];

    const metrics = calculateCategoryBudgets(transactions, mockLimits, "2026-03");

    const foodMetric = metrics.find((m) => m.category === "Food & Dining")!;
    expect(foodMetric.pct).toBe(85);
    expect(foodMetric.status).toBe("near");
    expect(foodMetric.progressColor).toBe("#F59E0B");
    expect(foodMetric.remaining).toBe(1500);

    const entMetric = metrics.find((m) => m.category === "Entertainment")!;
    expect(entMetric.pct).toBe(80);
    expect(entMetric.status).toBe("near");
    expect(entMetric.progressColor).toBe("#F59E0B");
  });

  it("assigns red (#EF4444) when category spending is over limit (> 100%)", () => {
    const transactions = [
      { category: "Shopping & Groceries", amount: 6200, type: "debit", month: "2026-03", date: "2026-03-20" },
    ];

    const metrics = calculateCategoryBudgets(transactions, mockLimits, "2026-03");
    const shopMetric = metrics.find((m) => m.category === "Shopping & Groceries")!;

    expect(shopMetric.spent).toBe(6200);
    expect(shopMetric.limit).toBe(5000);
    expect(shopMetric.pct).toBe(124);
    expect(shopMetric.status).toBe("over");
    expect(shopMetric.progressColor).toBe("#EF4444");
    expect(shopMetric.remaining).toBe(-1200);
  });

  it("shows '-' for daily allowance when the selected month is in the past", () => {
    const transactions = [
      { category: "Food & Dining", amount: 7000, type: "debit", month: "2026-03", date: "2026-03-15" },
    ];

    const metrics = calculateCategoryBudgets(transactions, mockLimits, "2026-03");
    const foodMetric = metrics.find((m) => m.category === "Food & Dining")!;

    expect(foodMetric.remaining).toBe(3000);
    // 2026-03 is not current month -> daily allowance must display "-"
    expect(foodMetric.dailyAllowanceDisplay).toBe("-");
  });

  it("calculates daily allowance when the selected period is the current month", () => {
    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const todayStr = `${currentMonthStr}-${String(now.getDate()).padStart(2, "0")}`;

    const transactions = [
      { category: "Food & Dining", amount: 2000, type: "debit", month: currentMonthStr, date: todayStr },
    ];

    const metrics = calculateCategoryBudgets(transactions, mockLimits, currentMonthStr);
    const foodMetric = metrics.find((m) => m.category === "Food & Dining")!;

    expect(foodMetric.remaining).toBe(8000);
    expect(foodMetric.dailyAllowanceDisplay).toContain("/ day");
    expect(foodMetric.dailyAllowance).toBeGreaterThan(0);
  });

  describe("Fabricated transactions across several dates (Requirement 7)", () => {
    it("spreads 10000 of food over 20 days so it is NOT counted as one day and counts days over limit correctly", () => {
      // Create 20 debit transactions on 20 distinct dates in March 2026 (each ₹500, sum = ₹10,000)
      const transactions = Array.from({ length: 20 }, (_, i) => {
        const day = String(i + 1).padStart(2, "0");
        return {
          category: "Food & Dining",
          amount: 500,
          type: "debit",
          date: `2026-03-${day}`,
          month: "2026-03",
        };
      });

      // Case A: Daily limit of ₹400 -> every one of the 20 days (₹500) exceeded limit
      const limitsA = { "Food & Dining": 400 };
      const periodsA = { "Food & Dining": "daily" as const };
      const metricsA = calculateCategoryBudgets(transactions, limitsA, periodsA, "2026-03");
      const foodA = metricsA.find((m) => m.category === "Food & Dining")!;

      expect(foodA.period).toBe("daily");
      expect(foodA.daysOverLimit).toBe(20);
      expect(foodA.highestSpendDay).toEqual({ date: "2026-03-01", amount: 500 });
      // Peak day must be 500, NOT 10,000!
      expect(foodA.highestSpendDay?.amount).toBe(500);
      // Equivalent monthly budget for 31 days in March: 400 * 31 = 12400
      expect(foodA.equivalentMonthlyBudget).toBe(12400);

      // Case B: Daily limit of ₹600 -> none of the 20 days exceeded limit
      const limitsB = { "Food & Dining": 600 };
      const periodsB = { "Food & Dining": "daily" as const };
      const metricsB = calculateCategoryBudgets(transactions, limitsB, periodsB, "2026-03");
      const foodB = metricsB.find((m) => m.category === "Food & Dining")!;

      expect(foodB.daysOverLimit).toBe(0);
      expect(foodB.highestSpendDay?.amount).toBe(500);
      expect(foodB.equivalentMonthlyBudget).toBe(18600); // 600 * 31

      // Case C: Mixed daily spend with 10 days at ₹300 and 10 days at ₹700 (daily limit = ₹500)
      const mixedTransactions = [
        ...Array.from({ length: 10 }, (_, i) => ({
          category: "Food & Dining",
          amount: 300,
          type: "debit",
          date: `2026-03-${String(i + 1).padStart(2, "0")}`,
          month: "2026-03",
        })),
        ...Array.from({ length: 10 }, (_, i) => ({
          category: "Food & Dining",
          amount: 700,
          type: "debit",
          date: `2026-03-${String(i + 11).padStart(2, "0")}`,
          month: "2026-03",
        })),
      ];
      const limitsC = { "Food & Dining": 500 };
      const metricsC = calculateCategoryBudgets(mixedTransactions, limitsC, periodsA, "2026-03");
      const foodC = metricsC.find((m) => m.category === "Food & Dining")!;

      // Exactly the 10 days with ₹700 exceeded ₹500 limit
      expect(foodC.daysOverLimit).toBe(10);
      expect(foodC.highestSpendDay?.amount).toBe(700);
    });

    it("handles weekly budget grouping, weeks over limit, and latest week spend", () => {
      // 2026-03-02 (Mon) to 2026-03-08 (Sun): Week 1 -> ₹3,000
      // 2026-03-09 (Mon) to 2026-03-15 (Sun): Week 2 -> ₹1,500
      // 2026-03-16 (Mon) to 2026-03-22 (Sun): Week 3 -> ₹2,500
      const weeklyTx = [
        { category: "Food & Dining", amount: 1500, type: "debit", date: "2026-03-03", month: "2026-03" },
        { category: "Food & Dining", amount: 1500, type: "debit", date: "2026-03-06", month: "2026-03" },
        { category: "Food & Dining", amount: 1500, type: "debit", date: "2026-03-10", month: "2026-03" },
        { category: "Food & Dining", amount: 2500, type: "debit", date: "2026-03-18", month: "2026-03" },
      ];

      const limits = { "Food & Dining": 2000 };
      const periods = { "Food & Dining": "weekly" as const };
      const metrics = calculateCategoryBudgets(weeklyTx, limits, periods, "2026-03");
      const foodMetric = metrics.find((m) => m.category === "Food & Dining")!;

      expect(foodMetric.period).toBe("weekly");
      // Week 1 (3000) and Week 3 (2500) exceeded 2000 limit -> 2 weeks over limit
      expect(foodMetric.weeksOverLimit).toBe(2);
      // Latest week is Week 3 with 2500
      expect(foodMetric.latestWeekSpend).toBe(2500);
      expect(foodMetric.spent).toBe(2500);
      // Equivalent monthly budget for 31 days: 2000 * (31/7) ≈ 8857
      expect(foodMetric.equivalentMonthlyBudget).toBe(Math.round(2000 * (31 / 7)));
      // Past month -> allowance display "-"
      expect(foodMetric.dailyAllowanceDisplay).toBe("-");
    });
  });

  describe("Alerts generation with period labels", () => {
    it("generates warning and critical alerts with period labels", () => {
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const todayStr = `${currentMonth}-${String(now.getDate()).padStart(2, "0")}`;

      const transactions = [
        { category: "Food & Dining", amount: 880, type: "debit", month: currentMonth, date: todayStr },
        { category: "Shopping & Groceries", amount: 5500, type: "debit", month: currentMonth, date: todayStr },
      ];

      const limits = {
        "Food & Dining": 1000,
        "Shopping & Groceries": 5000,
      };

      const periods = {
        "Food & Dining": "daily" as const,
        "Shopping & Groceries": "monthly" as const,
      };

      const metrics = calculateCategoryBudgets(transactions, limits, periods, currentMonth);
      const alerts = getBudgetAlerts(metrics);

      expect(alerts).toHaveLength(2);

      const foodAlert = alerts.find((a) => a.category === "Food & Dining")!;
      expect(foodAlert.severity).toBe("warning");
      expect(foodAlert.message).toContain("near daily limit");

      const shopAlert = alerts.find((a) => a.category === "Shopping & Groceries")!;
      expect(shopAlert.severity).toBe("critical");
      expect(shopAlert.message).toContain("exceeded its monthly limit");
    });
  });
});
