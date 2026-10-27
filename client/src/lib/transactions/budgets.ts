import type { BudgetPeriod } from "../storage/budgetStorage";

/**
 * Budget Calculation Engine
 *
 * Rules:
 * - Progress bar colors:
 *   - Green (#22C55E) when under 80%
 *   - Amber (#F59E0B) when 80% to 100%
 *   - Red (#EF4444) when over limit (> 100%)
 * - Remaining amount: limit - spent for the period
 * - Daily allowance: remaining / days left in period, only when selected period is current; otherwise "-"
 * - Spending calculation:
 *   - Parse "YYYY-MM-DD" as local date (avoid UTC shifts)
 *   - Count only debits in the category
 *   - Monthly: sum of debits in selected month. Progress = spent / limit
 *   - Weekly: sum of debits in selected week (Mon-Sun). Shows weekly average, weeks over limit, latest week spend
 *   - Daily: for selected month shows average spend/day, highest-spend day, days over limit.
 *     Progress = latest day spend vs limit if current month, otherwise average day vs limit.
 *   - Equivalent monthly budget: daily limit * daysInMonth, weekly limit * (daysInMonth / 7)
 */

export interface CategoryBudgetMetric {
  category: string;
  limit: number;
  period: BudgetPeriod;
  spent: number;
  pct: number;
  remaining: number;
  dailyAllowance: number;
  dailyAllowanceDisplay: string;
  remainingDays: number;
  status: "under" | "near" | "over";
  progressColor: string; // #22C55E | #F59E0B | #EF4444
  equivalentMonthlyBudget: number;
  // Daily specific metrics
  averageDailySpend?: number;
  highestSpendDay?: { date: string; amount: number };
  daysOverLimit?: number;
  // Weekly specific metrics
  averageWeeklySpend?: number;
  weeksOverLimit?: number;
  latestWeekSpend?: number;
}

export interface BudgetAlert {
  id: string;
  category: string;
  spent: number;
  limit: number;
  pct: number;
  remaining: number;
  status: "near" | "over";
  message: string;
  severity: "critical" | "warning";
}

/**
 * Parses a "YYYY-MM-DD" string into a local Date without UTC shifts.
 */
export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map((v) => parseInt(v, 10));
  return new Date(y, m - 1, d, 12, 0, 0);
}

/**
 * Returns the Monday date ("YYYY-MM-DD") of the week containing the given date string.
 * Week is defined as Monday through Sunday.
 */
export function getWeekStart(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map((v) => parseInt(v, 10));
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  const day = dt.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const diff = day === 0 ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diff);
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, "0");
  const date = String(dt.getDate()).padStart(2, "0");
  return `${year}-${month}-${date}`;
}

/**
 * Calculates budget metrics for each category in the specified month.
 */
export function calculateCategoryBudgets(
  transactions: Array<{
    category: string;
    amount: number;
    type: string;
    month?: string;
    date?: string;
  }>,
  limits: Record<string, number>,
  periodsOrMonth?: Record<string, BudgetPeriod> | string,
  maybeMonth?: string
): CategoryBudgetMetric[] {
  let periods: Record<string, BudgetPeriod> = {};
  let selectedMonth: string = "ALL";

  if (typeof periodsOrMonth === "string") {
    selectedMonth = periodsOrMonth;
    periods = {};
  } else {
    periods = periodsOrMonth || {};
    selectedMonth = maybeMonth || "ALL";
  }

  // 1. Calculate days in month and whether it is the current calendar month
  const parts = selectedMonth.split("-");
  const year = parseInt(parts[0], 10) || new Date().getFullYear();
  const monthNum = parseInt(parts[1], 10) || new Date().getMonth() + 1;
  const daysInMonth = new Date(year, monthNum, 0).getDate();

  const now = new Date();
  const isCurrentMonth =
    selectedMonth !== "ALL" &&
    now.getFullYear() === year &&
    now.getMonth() + 1 === monthNum;

  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
  const currentWeekStart = getWeekStart(todayStr);

  // 2. Filter debits strictly belonging to the selected month using transaction date
  const monthDebits = transactions.filter((t) => {
    if (t.type !== "debit") return false;
    const txDate = t.date || (t.month ? `${t.month}-01` : "");
    const txMonth = txDate ? txDate.substring(0, 7) : t.month;
    return selectedMonth === "ALL" || txMonth === selectedMonth;
  });

  // Group debits by category
  const debitsByCategory: Record<string, typeof monthDebits> = {};
  for (const t of monthDebits) {
    const cat = t.category || "General & Others";
    if (!debitsByCategory[cat]) debitsByCategory[cat] = [];
    debitsByCategory[cat].push(t);
  }

  // 3. Compute metrics for each budgeted category
  const categories = Object.keys(limits);
  const metrics: CategoryBudgetMetric[] = categories.map((category) => {
    const limit = limits[category] || 0;
    const period: BudgetPeriod = periods[category] || "monthly";
    const catDebits = debitsByCategory[category] || [];
    const totalMonthSpend = catDebits.reduce((sum, t) => sum + t.amount, 0);

    let spent = 0;
    let pct = 0;
    let remaining = 0;
    let dailyAllowance = 0;
    let dailyAllowanceDisplay = "-";
    let remainingDays = 0;
    let equivalentMonthlyBudget = limit;

    let averageDailySpend: number | undefined;
    let highestSpendDay: { date: string; amount: number } | undefined;
    let daysOverLimit: number | undefined;

    let averageWeeklySpend: number | undefined;
    let weeksOverLimit: number | undefined;
    let latestWeekSpend: number | undefined;

    if (period === "daily") {
      // Group debits by individual calendar day
      const dailySpendMap: Record<string, number> = {};
      for (const t of catDebits) {
        const txDate = t.date || (t.month ? `${t.month}-01` : "");
        if (txDate) {
          dailySpendMap[txDate] = (dailySpendMap[txDate] || 0) + t.amount;
        }
      }

      const dateKeys = Object.keys(dailySpendMap).sort();
      daysOverLimit = dateKeys.filter((d) => dailySpendMap[d] > limit).length;

      if (dateKeys.length > 0) {
        let maxDate = dateKeys[0];
        let maxAmount = dailySpendMap[maxDate];
        for (const d of dateKeys) {
          if (dailySpendMap[d] > maxAmount) {
            maxDate = d;
            maxAmount = dailySpendMap[d];
          }
        }
        highestSpendDay = { date: maxDate, amount: maxAmount };
      } else {
        highestSpendDay = { date: "-", amount: 0 };
      }

      // Days elapsed for average computation
      const daysCount = isCurrentMonth
        ? Math.max(1, Math.min(now.getDate(), daysInMonth))
        : daysInMonth;
      averageDailySpend = Math.round((totalMonthSpend / daysCount) * 10) / 10;
      equivalentMonthlyBudget = limit * daysInMonth;

      const latestDaySpend =
        dateKeys.length > 0 ? dailySpendMap[dateKeys[dateKeys.length - 1]] : 0;

      // Progress: latest day's spend vs limit if current month, otherwise average day vs limit
      spent = isCurrentMonth ? latestDaySpend : averageDailySpend;
      pct = limit > 0 ? (spent / limit) * 100 : 0;
      remaining = limit - spent;

      // Daily allowance: only when current period (1 day left)
      if (isCurrentMonth) {
        remainingDays = 1;
        if (remaining > 0) {
          dailyAllowance = Math.floor(remaining);
        }
        dailyAllowanceDisplay = `₹${dailyAllowance.toLocaleString("en-IN")} / day`;
      } else {
        dailyAllowanceDisplay = "-";
      }
    } else if (period === "weekly") {
      // Group debits by Mon-Sun week
      const weeklySpendMap: Record<string, number> = {};
      for (const t of catDebits) {
        const txDate = t.date || (t.month ? `${t.month}-01` : "");
        if (txDate) {
          const wKey = getWeekStart(txDate);
          weeklySpendMap[wKey] = (weeklySpendMap[wKey] || 0) + t.amount;
        }
      }

      const weekKeys = Object.keys(weeklySpendMap).sort();
      weeksOverLimit = weekKeys.filter((k) => weeklySpendMap[k] > limit).length;
      latestWeekSpend =
        weekKeys.length > 0 ? weeklySpendMap[weekKeys[weekKeys.length - 1]] : 0;
      averageWeeklySpend =
        weekKeys.length > 0 ? Math.round(totalMonthSpend / weekKeys.length) : 0;

      const weeksInMonth = daysInMonth / 7;
      equivalentMonthlyBudget = Math.round(limit * weeksInMonth);

      spent = latestWeekSpend;
      pct = limit > 0 ? (spent / limit) * 100 : 0;
      remaining = limit - spent;

      // Check if current week is selected
      const isCurrentWeek =
        isCurrentMonth &&
        weekKeys.length > 0 &&
        weekKeys[weekKeys.length - 1] === currentWeekStart;

      if (isCurrentWeek) {
        const dayOfWeek = now.getDay(); // 0 is Sun, 1 is Mon
        remainingDays = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
        if (remaining > 0) {
          dailyAllowance = Math.floor(remaining / remainingDays);
        }
        dailyAllowanceDisplay = `₹${dailyAllowance.toLocaleString("en-IN")} / day`;
      } else {
        dailyAllowanceDisplay = "-";
      }
    } else {
      // Monthly period
      spent = totalMonthSpend;
      pct = limit > 0 ? (spent / limit) * 100 : 0;
      remaining = limit - spent;
      equivalentMonthlyBudget = limit;

      if (isCurrentMonth) {
        const currentDay = Math.min(Math.max(now.getDate(), 1), daysInMonth);
        remainingDays = Math.max(1, daysInMonth - currentDay + 1);
        if (remaining > 0) {
          dailyAllowance = Math.floor(remaining / remainingDays);
        }
        dailyAllowanceDisplay = `₹${dailyAllowance.toLocaleString("en-IN")} / day`;
      } else {
        dailyAllowanceDisplay = "-";
      }
    }

    // Determine status & progress color
    // Green under 80%, Amber 80% to 100%, Red over limit (> 100%)
    let status: "under" | "near" | "over" = "under";
    let progressColor = "#22C55E"; // Green under 80%

    if (pct > 100) {
      status = "over";
      progressColor = "#EF4444"; // Red over limit
    } else if (pct >= 80) {
      status = "near";
      progressColor = "#F59E0B"; // Amber 80% to 100%
    }

    return {
      category,
      limit,
      period,
      spent: Math.round(spent * 10) / 10,
      pct: Math.round(pct * 10) / 10,
      remaining: Math.round(remaining * 10) / 10,
      dailyAllowance,
      dailyAllowanceDisplay,
      remainingDays,
      status,
      progressColor,
      equivalentMonthlyBudget,
      averageDailySpend,
      highestSpendDay,
      daysOverLimit,
      averageWeeklySpend,
      weeksOverLimit,
      latestWeekSpend,
    };
  });

  // Sort: over limit first, then near limit, then highest percentage
  metrics.sort((a, b) => b.pct - a.pct);

  return metrics;
}

/**
 * Extracts alerts for categories that are near (>= 80%) or over (> 100%) their target limit.
 */
export function getBudgetAlerts(metrics: CategoryBudgetMetric[]): BudgetAlert[] {
  return metrics
    .filter(
      (m): m is CategoryBudgetMetric & { status: "near" | "over" } =>
        m.status === "near" || m.status === "over"
    )
    .map((m) => {
      const isOver = m.status === "over";
      const excess = Math.abs(Math.round(m.remaining));
      const periodLabel =
        m.period === "daily" ? "daily" : m.period === "weekly" ? "weekly" : "monthly";

      const allowanceText =
        m.dailyAllowanceDisplay !== "-" ? `, ${m.dailyAllowanceDisplay} allowance` : "";

      return {
        id: `alert_${m.category}_${m.status}`,
        category: m.category,
        spent: m.spent,
        limit: m.limit,
        pct: m.pct,
        remaining: m.remaining,
        status: m.status,
        severity: isOver ? "critical" : "warning",
        message: isOver
          ? `${m.category} has exceeded its ${periodLabel} limit by ₹${excess.toLocaleString(
              "en-IN"
            )} (${m.pct}% utilized)`
          : `${m.category} is near ${periodLabel} limit at ${m.pct}% (₹${Math.max(
              0,
              Math.round(m.remaining)
            ).toLocaleString("en-IN")} remaining${allowanceText})`,
      };
    });
}
