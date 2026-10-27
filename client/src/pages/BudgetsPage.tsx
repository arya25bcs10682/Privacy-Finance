import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { useKeyContext } from "@/context/KeyContext";
import { useTransactionContext } from "@/context/TransactionContext";
import type { BudgetPeriod } from "@/lib/storage/budgetStorage";
import {
  PieChart,
  Calendar,
  Wallet,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Lock,
  Filter,
  Edit2,
  Check,
  X,
} from "lucide-react";

export function BudgetsPage() {
  const { dataKey } = useKeyContext();
  const {
    selectedMonth,
    setSelectedMonth,
    availableMonths,
    categoryBudgetMetrics,
    setBudgetLimit,
  } = useTransactionContext();

  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editLimitVal, setEditLimitVal] = useState<string>("");
  const [editPeriodVal, setEditPeriodVal] = useState<BudgetPeriod>("monthly");

  const totalBudget = categoryBudgetMetrics.reduce((sum, m) => sum + m.equivalentMonthlyBudget, 0);
  const totalSpent = categoryBudgetMetrics.reduce((sum, m) => sum + m.spent, 0);
  const totalRemaining = totalBudget - totalSpent;
  const overallPct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 1000) / 10 : 0;

  const overLimitCount = categoryBudgetMetrics.filter((m) => m.status === "over").length;
  const nearLimitCount = categoryBudgetMetrics.filter((m) => m.status === "near").length;

  const handleStartEdit = (category: string, currentLimit: number, currentPeriod: BudgetPeriod) => {
    setEditingCategory(category);
    setEditLimitVal(String(currentLimit));
    setEditPeriodVal(currentPeriod || "monthly");
  };

  const handleSaveEdit = async (category: string) => {
    const num = parseFloat(editLimitVal);
    if (!isNaN(num) && num >= 0) {
      await setBudgetLimit(category, Math.round(num), editPeriodVal);
    }
    setEditingCategory(null);
  };

  const handleCancelEdit = () => {
    setEditingCategory(null);
    setEditLimitVal("");
  };

  return (
    <div className="space-y-6">
      {/* Top Banner: Title & Month Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1F242D] pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            Category Budgets & Expense Limits
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Encrypted target limits (daily, weekly, monthly) with live progress bars, remaining amounts, and daily allowance tracking.
          </p>
        </div>

        {/* Month Selector: default to latest month that has transactions */}
        <div className="flex items-center gap-1.5 bg-[#0C0E10] border border-[#1F242D] px-2.5 py-1 rounded-lg text-xs self-start sm:self-auto">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground text-[11px] font-medium">Month:</span>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="bg-transparent text-foreground text-xs font-mono focus:outline-none cursor-pointer"
          >
            {availableMonths.map((m) => (
              <option key={m} value={m} className="bg-[#0C0E10] text-foreground">
                {m}
              </option>
            ))}
            {availableMonths.length === 0 && (
              <option value={selectedMonth} className="bg-[#0C0E10] text-foreground">
                {selectedMonth}
              </option>
            )}
            <option value="ALL" className="bg-[#0C0E10] text-foreground">
              All Months
            </option>
          </select>
        </div>
      </div>

      {/* Summary StatCards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Monthly Budget"
          value={`₹${totalBudget.toLocaleString("en-IN")}`}
          subtitle={`Equivalent monthly target (${selectedMonth})`}
          icon={PieChart}
          badge="AES-GCM"
        />
        <StatCard
          title="Total Spent"
          value={`₹${totalSpent.toLocaleString("en-IN")}`}
          subtitle={`${overallPct}% of total budget`}
          delta={{
            value: `${overallPct}%`,
            isPositive: overallPct <= 80,
            period: "budget utilized",
          }}
          icon={Wallet}
        />
        <StatCard
          title="Remaining Budget"
          value={`₹${Math.max(0, totalRemaining).toLocaleString("en-IN")}`}
          subtitle={totalRemaining >= 0 ? "Safe margin" : "Deficit"}
          badge={totalRemaining >= 0 ? "Under Cap" : "Over Budget"}
          icon={Calendar}
        />
        <StatCard
          title="Budget Health"
          value={
            overLimitCount > 0
              ? `${overLimitCount} Over Limit`
              : nearLimitCount > 0
              ? `${nearLimitCount} Near Limit`
              : "Healthy"
          }
          subtitle="Real-time alert status"
          icon={overLimitCount > 0 ? AlertCircle : CheckCircle2}
        />
      </div>

      {/* Active Alerts Banner if near or over budget */}
      {(overLimitCount > 0 || nearLimitCount > 0) && (
        <div className="space-y-2">
          {categoryBudgetMetrics
            .filter((m) => m.status === "over")
            .map((m) => {
              const periodLabel = m.period === "daily" ? "daily" : m.period === "weekly" ? "weekly" : "monthly";
              return (
                <div
                  key={`banner-over-${m.category}`}
                  className="flex items-center justify-between p-3 rounded-lg bg-trend-red/10 border border-trend-red/30 text-xs text-foreground"
                >
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-trend-red shrink-0" />
                    <span>
                      <strong className="text-trend-red">{m.category}</strong> exceeded its {periodLabel}{" "}
                      budget by <strong>₹{Math.abs(Math.round(m.remaining)).toLocaleString("en-IN")}</strong> (
                      {m.pct}% utilized).
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-trend-red font-medium shrink-0">
                    OVER LIMIT
                  </span>
                </div>
              );
            })}

          {categoryBudgetMetrics
            .filter((m) => m.status === "near")
            .map((m) => {
              const periodLabel = m.period === "daily" ? "daily" : m.period === "weekly" ? "weekly" : "monthly";
              const allowancePart = m.dailyAllowanceDisplay !== "-" ? `, ${m.dailyAllowanceDisplay} allowance` : "";
              return (
                <div
                  key={`banner-near-${m.category}`}
                  className="flex items-center justify-between p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-foreground"
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                    <span>
                      <strong className="text-amber-500">{m.category}</strong> is near its {periodLabel}{" "}
                      limit at <strong>{m.pct}%</strong> (₹{Math.max(0, Math.round(m.remaining)).toLocaleString("en-IN")}{" "}
                      remaining{allowancePart}).
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-amber-500 font-medium shrink-0">
                    NEAR LIMIT (&ge;80%)
                  </span>
                </div>
              );
            })}
        </div>
      )}

      {/* Category Budgets Grid */}
      {!dataKey ? (
        <Card className="border-border bg-card">
          <CardContent className="py-12 text-center text-xs text-muted-foreground space-y-2">
            <Lock className="h-8 w-8 text-muted-foreground mx-auto" />
            <p className="font-medium text-foreground">Vault is Locked</p>
            <p>Unlock your vault with your Secret Key to view and manage encrypted category budgets.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {categoryBudgetMetrics.map((m) => {
            const isEditing = editingCategory === m.category;
            const isOver = m.status === "over";
            const isNear = m.status === "near";

            // Status label badge
            const statusLabel = isOver
              ? "Over Limit"
              : isNear
              ? "Near Limit (≥80%)"
              : "On Track (<80%)";

            const periodName =
              m.period === "daily" ? "Daily" : m.period === "weekly" ? "Weekly" : "Monthly";

            return (
              <Card key={m.category} className="border-border bg-card space-y-2">
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <span>{m.category}</span>
                      <span
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded border"
                        style={{
                          backgroundColor: `${m.progressColor}15`,
                          borderColor: `${m.progressColor}40`,
                          color: m.progressColor,
                        }}
                      >
                        {statusLabel}
                      </span>
                    </CardTitle>
                    <CardDescription className="text-xs font-mono text-muted-foreground mt-0.5">
                      {periodName} Target: ₹{m.limit.toLocaleString("en-IN")} &bull; Spent: ₹
                      {m.spent.toLocaleString("en-IN")}
                    </CardDescription>
                  </div>

                  {/* Percentage Metric */}
                  <div className="text-right">
                    <span
                      className="text-sm font-mono font-bold"
                      style={{ color: m.progressColor }}
                    >
                      {m.pct}%
                    </span>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3">
                  {/* Progress Bar: Capped at 100% with colors green under 80%, amber 80-100%, red over limit */}
                  <div className="h-2 w-full bg-[#161B22] rounded-full overflow-hidden">
                    <div
                      className="h-full transition-all duration-300 rounded-full"
                      style={{
                        width: `${Math.min(m.pct, 100)}%`,
                        backgroundColor: m.progressColor,
                      }}
                    />
                  </div>

                  {/* Remaining Amount & Daily Allowance Row */}
                  <div className="flex items-center justify-between text-xs font-mono pt-1">
                    <div>
                      <span className="text-muted-foreground text-[11px] block">Remaining ({periodName})</span>
                      <span
                        className={
                          m.remaining < 0
                            ? "text-trend-red font-semibold"
                            : "text-foreground font-semibold"
                        }
                      >
                        {m.remaining < 0
                          ? `-₹${Math.abs(m.remaining).toLocaleString("en-IN")}`
                          : `₹${m.remaining.toLocaleString("en-IN")}`}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="text-muted-foreground text-[11px] block">Daily Allowance</span>
                      <span className="text-foreground font-semibold">
                        {m.dailyAllowanceDisplay}
                      </span>
                      {m.remainingDays > 0 && m.dailyAllowanceDisplay !== "-" && (
                        <span className="text-[10px] text-muted-foreground block">
                          ({m.remainingDays} days left)
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Daily Period Specific Metrics */}
                  {m.period === "daily" && (
                    <div className="grid grid-cols-3 gap-2 p-2 rounded-lg bg-[#0C0E10] border border-[#1F242D] text-[11px] font-mono">
                      <div>
                        <span className="text-muted-foreground block text-[10px]">Avg Spend/Day</span>
                        <span className="text-foreground font-medium">
                          ₹{(m.averageDailySpend ?? 0).toLocaleString("en-IN")}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[10px]">Peak Day</span>
                        <span className="text-foreground font-medium truncate block" title={m.highestSpendDay?.date !== "-" ? m.highestSpendDay?.date : undefined}>
                          ₹{(m.highestSpendDay?.amount ?? 0).toLocaleString("en-IN")}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[10px]">Days Over Limit</span>
                        <span
                          className={
                            (m.daysOverLimit ?? 0) > 0
                              ? "text-trend-red font-semibold"
                              : "text-foreground font-medium"
                          }
                        >
                          {m.daysOverLimit ?? 0}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Weekly Period Specific Metrics */}
                  {m.period === "weekly" && (
                    <div className="grid grid-cols-3 gap-2 p-2 rounded-lg bg-[#0C0E10] border border-[#1F242D] text-[11px] font-mono">
                      <div>
                        <span className="text-muted-foreground block text-[10px]">Avg Spend/Wk</span>
                        <span className="text-foreground font-medium">
                          ₹{(m.averageWeeklySpend ?? 0).toLocaleString("en-IN")}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[10px]">Latest Week</span>
                        <span className="text-foreground font-medium">
                          ₹{(m.latestWeekSpend ?? 0).toLocaleString("en-IN")}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[10px]">Weeks Over Limit</span>
                        <span
                          className={
                            (m.weeksOverLimit ?? 0) > 0
                              ? "text-trend-red font-semibold"
                              : "text-foreground font-medium"
                          }
                        >
                          {m.weeksOverLimit ?? 0}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Equivalent Monthly Budget & Inline Limit/Period Editor */}
                  <div className="pt-2 border-t border-gridline flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-2">
                    {isEditing ? (
                      <div className="flex flex-wrap items-center gap-2 w-full py-0.5">
                        <div className="flex items-center gap-1">
                          <span className="text-muted-foreground text-[11px]">Target period:</span>
                          <select
                            value={editPeriodVal}
                            onChange={(e) => setEditPeriodVal(e.target.value as BudgetPeriod)}
                            className="bg-[#161B22] border border-[#1F242D] rounded px-1.5 py-0.5 text-xs text-foreground focus:outline-none cursor-pointer"
                          >
                            <option value="daily" className="bg-[#0C0E10] text-foreground">
                              Daily
                            </option>
                            <option value="weekly" className="bg-[#0C0E10] text-foreground">
                              Weekly
                            </option>
                            <option value="monthly" className="bg-[#0C0E10] text-foreground">
                              Monthly
                            </option>
                          </select>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-muted-foreground text-[11px]">Limit: ₹</span>
                          <input
                            type="number"
                            value={editLimitVal}
                            onChange={(e) => setEditLimitVal(e.target.value)}
                            className="w-24 bg-[#161B22] border border-[#1F242D] rounded px-1.5 py-0.5 text-xs text-foreground font-mono focus:outline-none"
                            autoFocus
                          />
                        </div>
                        <div className="flex items-center gap-1 ml-auto">
                          <Button
                            size="sm"
                            onClick={() => handleSaveEdit(m.category)}
                            className="h-6 px-2 text-[11px] bg-foreground text-background hover:bg-foreground/90 gap-0.5"
                          >
                            <Check className="h-3 w-3" /> Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={handleCancelEdit}
                            className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-muted-foreground text-[11px] font-mono">
                            {periodName} Target: ₹{m.limit.toLocaleString("en-IN")}
                          </span>
                          {m.period !== "monthly" && (
                            <span className="text-muted-foreground text-[10px] font-mono px-1 py-0.2 bg-[#0C0E10] border border-[#1F242D] rounded">
                              Equiv. Monthly: ₹{m.equivalentMonthlyBudget.toLocaleString("en-IN")}
                            </span>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleStartEdit(m.category, m.limit, m.period)}
                          className="h-6 text-[11px] text-muted-foreground hover:text-foreground gap-1 px-1.5 self-start sm:self-auto"
                        >
                          <Edit2 className="h-3 w-3" /> Edit Limit
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
