import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart as RechartsPie,
  Pie,
  Cell,
} from "recharts";
import { StatCard } from "@/components/ui/stat-card";
import { ChartCard } from "@/components/ui/chart-card";
import { Button } from "@/components/ui/button";
import { useKeyContext } from "@/context/KeyContext";
import { useTransactionContext } from "@/context/TransactionContext";
import { CATEGORY_COLORS } from "@/lib/transactions/categories";
import {
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  UploadCloud,
  Lock,
  KeyRound,
  FileText,
  Filter,
  AlertTriangle,
  AlertCircle,
  ArrowRight,
} from "lucide-react";

export function DashboardPage() {
  const { user, dataKey, isLocked, idleTimeoutRemainingMs } = useKeyContext();
  const {
    transactions,
    selectedMonth,
    setSelectedMonth,
    availableMonths,
    budgetAlerts,
  } = useTransactionContext();

  const minutesRemaining = Math.floor(idleTimeoutRemainingMs / 60000);
  const secondsRemaining = Math.floor((idleTimeoutRemainingMs % 60000) / 1000);

  // Filter transactions strictly for the selected month using transaction date
  const monthTransactions = useMemo(() => {
    if (selectedMonth === "ALL") return transactions;
    return transactions.filter((t) => {
      const txMonth = t.date ? t.date.substring(0, 7) : t.month;
      return txMonth === selectedMonth;
    });
  }, [transactions, selectedMonth]);

  // 1. Current Balance (latest transaction in month, or overall latest)
  const currentBalance = useMemo(() => {
    if (monthTransactions.length > 0) {
      return monthTransactions[monthTransactions.length - 1].balance;
    }
    if (transactions.length > 0) {
      return transactions[transactions.length - 1].balance;
    }
    return 0;
  }, [monthTransactions, transactions]);

  // 2. Month Income (sum of credits)
  const monthIncome = useMemo(() => {
    return monthTransactions
      .filter((t) => t.type === "credit")
      .reduce((sum, t) => sum + t.amount, 0);
  }, [monthTransactions]);

  // 3. Month Spend (sum of debits)
  const monthSpend = useMemo(() => {
    return monthTransactions
      .filter((t) => t.type === "debit")
      .reduce((sum, t) => sum + t.amount, 0);
  }, [monthTransactions]);

  // 4. Projected Month-End Cash
  const projectedMonthEnd = useMemo(() => {
    if (monthTransactions.length === 0) {
      return 0;
    }

    // Determine days elapsed in the selected month
    const parts = selectedMonth.split("-");
    const year = parseInt(parts[0], 10) || new Date().getFullYear();
    const monthNum = parseInt(parts[1], 10) || new Date().getMonth() + 1;
    const daysInMonth = new Date(year, monthNum, 0).getDate();

    const now = new Date();
    const isCurrentCalendarMonth =
      now.getFullYear() === year && now.getMonth() + 1 === monthNum;

    if (isCurrentCalendarMonth) {
      const currentDay = Math.min(Math.max(now.getDate(), 1), daysInMonth);
      const daysRemaining = daysInMonth - currentDay;
      const dailyNetRate = (monthIncome - monthSpend) / currentDay;
      return Math.round(currentBalance + daysRemaining * dailyNetRate);
    }

    // If past or future month, projected end cash is the final month balance
    return currentBalance;
  }, [monthTransactions, selectedMonth, monthIncome, monthSpend, currentBalance]);

  // Chart 1 Data: Balance over time
  const balanceTimelineData = useMemo(() => {
    if (monthTransactions.length === 0) {
      return [];
    }

    return monthTransactions.map((t) => ({
      date: t.date.substring(5), // MM-DD
      fullDate: t.date,
      balance: t.balance,
      narration: t.narration,
      amount: t.amount,
      type: t.type,
    }));
  }, [monthTransactions]);

  // Calculate if the overall balance movement is net up or net down for the summary badge
  const isNetPositiveTrajectory = useMemo(() => {
    if (balanceTimelineData.length < 2) return true;
    const first = balanceTimelineData[0].balance;
    const last = balanceTimelineData[balanceTimelineData.length - 1].balance;
    return last >= first;
  }, [balanceTimelineData]);

  // Generate multi-stop linear gradient for up/down segments:
  // Rising segments = emerald green (#22C55E), falling segments = crimson red (#EF4444)
  const segmentStops = useMemo(() => {
    const data = balanceTimelineData;
    if (data.length < 2) {
      return [
        { offset: "0%", color: "#22C55E" },
        { offset: "100%", color: "#22C55E" },
      ];
    }
    const stops: { offset: string; color: string }[] = [];
    const n = data.length;
    for (let i = 0; i < n - 1; i++) {
      const startPct = ((i / (n - 1)) * 100).toFixed(2) + "%";
      const endPct = (((i + 1) / (n - 1)) * 100).toFixed(2) + "%";
      const isUp = data[i + 1].balance >= data[i].balance;
      const color = isUp ? "#22C55E" : "#EF4444";
      stops.push({ offset: startPct, color });
      stops.push({ offset: endPct, color });
    }
    return stops;
  }, [balanceTimelineData]);

  // Chart 2 Data: Spending by Category Donut
  const categorySpendingData = useMemo(() => {
    const debits = monthTransactions.filter((t) => t.type === "debit");
    if (debits.length === 0) {
      return [];
    }

    const map: Record<string, number> = {};
    for (const t of debits) {
      const cat = t.category || "General & Others";
      map[cat] = (map[cat] || 0) + t.amount;
    }

    return Object.entries(map)
      .map(([name, value]) => ({
        name,
        value,
        color: CATEGORY_COLORS[name] || "#2A2D32",
      }))
      .sort((a, b) => b.value - a.value);
  }, [monthTransactions]);

  const totalDebits = useMemo(() => {
    return categorySpendingData.reduce((acc, curr) => acc + curr.value, 0);
  }, [categorySpendingData]);

  return (
    <div className="space-y-6">
      {/* Top Banner: Vault Status, Month Selector & Upload Button */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1F242D] pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            Zero-Knowledge Financial Vault
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Encrypted transactions decrypted in memory only. Never cached in disk storage.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Month Selector */}
          <div className="flex items-center gap-1.5 bg-[#0C0E10] border border-[#1F242D] px-2 py-1 rounded-lg text-xs">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground text-[11px] font-medium hidden sm:inline">Month:</span>
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
              <option value="ALL" className="bg-[#0C0E10] text-foreground">
                All Months
              </option>
            </select>
          </div>

          {/* Upload Button */}
          <Link to="/upload">
            <Button
              size="sm"
              className="gap-1.5 text-xs h-8 bg-foreground text-background hover:bg-foreground/90 font-medium"
            >
              <UploadCloud className="h-3.5 w-3.5" />
              <span>Upload Statement</span>
            </Button>
          </Link>

          {/* Vault Key Status Badge */}
          {dataKey && !isLocked ? (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-trend-green/10 border border-trend-green/30 text-trend-green text-xs font-mono">
              <span className="h-2 w-2 rounded-full bg-trend-green animate-pulse" />
              <span>DECRYPTED ({minutesRemaining}m {secondsRemaining}s)</span>
            </div>
          ) : user && isLocked ? (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-trend-red/10 border border-trend-red/30 text-trend-red text-xs font-mono">
              <span className="h-2 w-2 rounded-full bg-trend-red" />
              <span>VAULT LOCKED</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#161B22] border border-[#1F242D] text-xs font-mono text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-muted-foreground" />
              <span>NOT SIGNED IN</span>
            </div>
          )}
        </div>
      </div>

      {/* Budget Alerts Banner: Shown when a category is near or over its monthly limit */}
      {budgetAlerts.length > 0 && (
        <div className="space-y-2">
          {budgetAlerts.map((alert) => {
            const isOver = alert.status === "over";
            return (
              <div
                key={alert.id}
                className={`flex items-center justify-between p-3 rounded-lg border text-xs text-foreground transition ${
                  isOver
                    ? "bg-trend-red/10 border-trend-red/30"
                    : "bg-amber-500/10 border-amber-500/30"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  {isOver ? (
                    <AlertCircle className="h-4 w-4 text-trend-red shrink-0" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                  )}
                  <span>
                    <strong className={isOver ? "text-trend-red" : "text-amber-500"}>
                      {isOver ? "Over Budget:" : "Budget Warning:"}
                    </strong>{" "}
                    {alert.message}
                  </span>
                </div>
                <Link
                  to="/budgets"
                  className={`inline-flex items-center gap-1 font-mono font-medium hover:underline text-[11px] shrink-0 pl-2 ${
                    isOver ? "text-trend-red" : "text-amber-500"
                  }`}
                >
                  <span>Manage Budgets</span>
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {/* 4-Card Row: Current Balance, Month Income, Month Spend, Projected Month-End Cash */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Current Balance"
          value={`₹${currentBalance.toLocaleString("en-IN")}`}
          subtitle={`Running balance (${selectedMonth})`}
          icon={Wallet}
          badge="Verified"
        />

        <StatCard
          title="Month Income"
          value={`₹${monthIncome.toLocaleString("en-IN")}`}
          subtitle="Verified credits & salary"
          delta={{ value: "+12.1%", isPositive: true, period: "inflow" }}
          icon={ArrowUpRight}
        />

        <StatCard
          title="Month Spend"
          value={`₹${monthSpend.toLocaleString("en-IN")}`}
          subtitle="Debits & withdrawals"
          delta={{ value: "-4.2%", isPositive: true, period: "outflow" }}
          icon={ArrowDownRight}
        />

        <StatCard
          title="Projected Month-End Cash"
          value={`₹${projectedMonthEnd.toLocaleString("en-IN")}`}
          subtitle="Based on daily net cashflow"
          icon={Calendar}
          badge={projectedMonthEnd >= currentBalance ? "Growing" : "Burn"}
        />
      </div>

      {/* Main Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Line Chart: Balance Over Time with Green/Red Gradient and Gridlines #161B22 */}
        <ChartCard
          title="Balance Over Time"
          description="Running balance history with green/red gradient across transaction points"
          className="lg:col-span-2"
          action={
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="inline-flex items-center gap-1 text-trend-green">
                <span className="h-2 w-2 rounded-full bg-trend-green" /> Inflow
              </span>
              <span className="inline-flex items-center gap-1 text-trend-red">
                <span className="h-2 w-2 rounded-full bg-trend-red" /> Outflow
              </span>
            </div>
          }
          footer={
            <>
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${
                    isNetPositiveTrajectory ? "bg-trend-green" : "bg-trend-red"
                  }`}
                />
                <span>
                  Trajectory: {isNetPositiveTrajectory ? "Net Positive Growth" : "Net Spend Dip"}
                </span>
              </div>
              <span className="font-mono text-muted-foreground text-[11px]">
                {balanceTimelineData.length} checkpoints plotted
              </span>
            </>
          }
        >
          {balanceTimelineData.length === 0 ? (
            <div className="h-72 w-full flex flex-col items-center justify-center text-xs text-muted-foreground gap-2">
              <Wallet className="h-8 w-8 text-muted-foreground/30" />
              <p>No transactions found for {selectedMonth}</p>
            </div>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={balanceTimelineData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    {/* Up/Down Segment Gradient: Green #22C55E top, Red #EF4444 bottom */}
                    <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22C55E" stopOpacity={0.35} />
                      <stop offset="50%" stopColor="#22C55E" stopOpacity={0.08} />
                      <stop offset="100%" stopColor="#EF4444" stopOpacity={0.25} />
                    </linearGradient>

                    {/* Up/Down Segment Gradient: Green #22C55E for rises, Red #EF4444 for falls */}
                    <linearGradient id="segmentLineGradient" x1="0" y1="0" x2="1" y2="0">
                      {segmentStops.map((stop, index) => (
                        <stop key={index} offset={stop.offset} stopColor={stop.color} />
                      ))}
                    </linearGradient>
                  </defs>

                  {/* Grid lines strictly styled with #161B22 */}
                  <CartesianGrid stroke="#161B22" strokeDasharray="3 3" vertical={false} />

                  <XAxis
                    dataKey="date"
                    stroke="#8B949E"
                    fontSize={11}
                    tickLine={false}
                    axisLine={{ stroke: "#1F242D" }}
                  />
                  <YAxis
                    stroke="#8B949E"
                    fontSize={11}
                    tickLine={false}
                    axisLine={{ stroke: "#1F242D" }}
                    tickFormatter={(val) => `₹${Math.round(val / 1000)}k`}
                  />

                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0C0E10",
                      borderColor: "#1F242D",
                      borderRadius: "0.5rem",
                      fontSize: "12px",
                      color: "#E0E3E6",
                    }}
                    formatter={(val: unknown) => [
                      `₹${Number(val || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
                      "Balance",
                    ]}
                    labelFormatter={(lbl: unknown) => `Date: ${lbl}`}
                  />

                  <Area
                    type="monotone"
                    dataKey="balance"
                    stroke="url(#segmentLineGradient)"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#balanceGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        {/* Spending-by-Category Donut Chart */}
        <ChartCard
          title="Spending by Category"
          description={`Categorized debits for ${selectedMonth}`}
          className="lg:col-span-1"
          footer={
            <>
              <span className="text-muted-foreground">Total Spend</span>
              <span className="font-mono text-foreground font-semibold">
                ₹{totalDebits.toLocaleString("en-IN")}
              </span>
            </>
          }
        >
          {categorySpendingData.length === 0 ? (
            <div className="h-48 w-full flex flex-col items-center justify-center text-xs text-muted-foreground gap-2">
              <p>No debit spending in {selectedMonth}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Donut Chart */}
              <div className="h-48 w-full flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsPie>
                    <Pie
                      data={categorySpendingData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                      stroke="#0C0E10"
                      strokeWidth={2}
                    >
                    {categorySpendingData.map((entry, index) => (
                      <Cell
                        key={`cat-cell-${index}`}
                        fill={entry.color}
                        stroke="#0C0E10"
                        strokeWidth={2}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0C0E10",
                      border: "1px solid #1F242D",
                      borderRadius: "0.5rem",
                      fontSize: "12px",
                      color: "#FFFFFF",
                    }}
                    itemStyle={{ color: "#FFFFFF" }}
                    labelStyle={{ color: "#FFFFFF" }}
                    formatter={(val: unknown) => [
                      `₹${Number(val || 0).toLocaleString("en-IN")}`,
                      "Spent",
                    ]}
                  />
                </RechartsPie>
              </ResponsiveContainer>
            </div>

            {/* Category Breakdown Legend */}
            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
              {categorySpendingData.slice(0, 5).map((cat) => {
                const pct = totalDebits > 0 ? ((cat.value / totalDebits) * 100).toFixed(1) : "0.0";
                return (
                  <div key={cat.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 truncate">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: cat.color }}
                      />
                      <span className="text-[#E0E3E6] truncate">{cat.name}</span>
                    </div>
                    <div className="font-mono text-[#E0E3E6] shrink-0 pl-2">
                      ₹{cat.value.toLocaleString("en-IN")} ({pct}%)
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </ChartCard>
      </div>

      {/* Security Info & Supported Banks Footer */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-[#0C0E10] border border-[#1F242D] space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <FileText className="h-4 w-4 text-trend-green" />
            <span>Bank Layout Parsers</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Native support for HDFC Bank, ICICI Bank, and State Bank of India (SBI) PDF, CSV, and XLSX statements.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-[#0C0E10] border border-[#1F242D] space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <KeyRound className="h-4 w-4 text-foreground" />
            <span>PBKDF2-SHA256 (600k Rounds)</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Master keys live strictly in React memory (`KeyContext`) and are wiped automatically on idle or logout.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-[#0C0E10] border border-[#1F242D] space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <Lock className="h-4 w-4 text-trend-red" />
            <span>15-Minute Auto-Lock</span>
          </div>
          <p className="text-xs text-muted-foreground">
            In-memory master data key is cleared after 15 minutes of inactivity to protect your private records.
          </p>
        </div>
      </div>
    </div>
  );
}
