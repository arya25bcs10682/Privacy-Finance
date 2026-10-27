import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { ChartCard } from "@/components/ui/chart-card";
import { Button } from "@/components/ui/button";
import { useKeyContext } from "@/context/KeyContext";
import { useTransactionContext } from "@/context/TransactionContext";
import { searchMutualFunds, formatCurrency, getCurrencySymbol } from "@/lib/holdings/marketData";
import type { AssetType, HoldingItem } from "@/lib/holdings/types";
import {
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  Plus,
  RefreshCw,
  Trash2,
  Pencil,
  Lock,
  PieChart as PieIcon,
  Search,
  Building,
  BarChart3,
  X,
  AlertCircle,
  Globe,
} from "lucide-react";
import { ResponsiveContainer, PieChart as RechartsPie, Pie, Cell, Tooltip } from "recharts";

export function InvestmentsPage() {
  const { dataKey } = useKeyContext();
  const {
    holdings,
    enrichedHoldings,
    portfolioSummary,
    portfolioAllocation,
    portfolioCurrency,
    setPortfolioCurrency,
    isQuotesLoading,
    isLoading,
    refreshQuotes,
    saveHolding,
    deleteHolding,
  } = useTransactionContext();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingHolding, setEditingHolding] = useState<HoldingItem | null>(null);
  const [assetType, setAssetType] = useState<AssetType>("stock");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [units, setUnits] = useState("");
  const [avgPrice, setAvgPrice] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [notes, setNotes] = useState("");

  // Mutual Fund search states
  const [mfSearchQuery, setMfSearchQuery] = useState("");
  const [mfSearchResults, setMfSearchResults] = useState<
    Array<{ schemeCode: number; schemeName: string }>
  >([]);
  const [isSearchingMf, setIsSearchingMf] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleOpenAddModal = () => {
    setEditingHolding(null);
    setAssetType("stock");
    setSymbol("");
    setName("");
    setUnits("");
    setAvgPrice("");
    setPurchaseDate("");
    setCurrency("INR");
    setNotes("");
    setMfSearchQuery("");
    setMfSearchResults([]);
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (h: HoldingItem) => {
    setEditingHolding(h);
    setAssetType(h.assetType || "stock");
    setSymbol(h.symbol);
    setName(h.name || h.symbol);
    setUnits(String(h.units));
    setAvgPrice(String(h.avgPrice));
    setPurchaseDate(h.purchaseDate || "");
    setCurrency(h.currency || "INR");
    setNotes(h.notes || "");
    setMfSearchQuery(h.assetType === "mf" ? h.name || h.symbol : "");
    setMfSearchResults([]);
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleMfSearch = async (query: string) => {
    setMfSearchQuery(query);
    if (query.trim().length < 2) {
      setMfSearchResults([]);
      return;
    }

    setIsSearchingMf(true);
    try {
      const results = await searchMutualFunds(query);
      setMfSearchResults(results);
    } catch {
      setMfSearchResults([]);
    } finally {
      setIsSearchingMf(false);
    }
  };

  const handleSelectMf = (schemeCode: number, schemeName: string) => {
    setSymbol(String(schemeCode));
    setName(schemeName);
    setMfSearchQuery(schemeName);
    setMfSearchResults([]);
  };

  const handleSaveHolding = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanSymbol = symbol.trim().toUpperCase();
    const parsedUnits = parseFloat(units);
    const parsedAvgPrice = parseFloat(avgPrice);

    // Validate symbol
    if (!cleanSymbol) {
      setFormError("Please enter a valid ticker symbol or mutual fund scheme code.");
      return;
    }

    // Alphanumeric with standard market ticker delimiters (.NS, ^NSEI, BTC-USD, etc.)
    if (!/^[A-Za-z0-9^._-]+$/.test(cleanSymbol)) {
      setFormError("Invalid symbol. Please enter a valid ticker symbol (e.g. RELIANCE.NS, TCS.NS, AAPL).");
      return;
    }

    // Validate inputs: units > 0, price >= 0
    if (isNaN(parsedUnits) || parsedUnits <= 0) {
      setFormError("Units must be greater than 0.");
      return;
    }
    if (isNaN(parsedAvgPrice) || parsedAvgPrice < 0) {
      setFormError("Average buy price must be greater than or equal to 0.");
      return;
    }

    setIsSaving(true);
    try {
      await saveHolding({
        ...(editingHolding ? { id: editingHolding.id } : {}),
        symbol: cleanSymbol,
        name: name.trim() || cleanSymbol,
        units: parsedUnits,
        avgPrice: parsedAvgPrice,
        purchaseDate: purchaseDate.trim() || undefined,
        assetType,
        currency,
        notes: notes.trim() || undefined,
      });

      // Reset and close
      setIsModalOpen(false);
      setEditingHolding(null);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to save holding.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1F242D] pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            Investments & Holdings
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Encrypted portfolio with real-time stock quotes via proxy & mutual fund NAVs from mfapi.in.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Currency Filter Selector */}
          <div className="flex items-center bg-[#121418] border border-[#1F242D] rounded-lg p-0.5" title="Filter portfolio currency">
            <div className="px-2 text-[11px] text-muted-foreground flex items-center gap-1 font-medium">
              <Globe className="h-3 w-3 text-accent" />
              <span className="hidden sm:inline">Currency:</span>
            </div>
            {(["INR", "USD", "EUR", "GBP"] as const).map((curr) => {
              const isActive = portfolioCurrency === curr;
              return (
                <button
                  key={curr}
                  type="button"
                  onClick={() => setPortfolioCurrency(curr)}
                  className={`px-2 py-1 text-xs font-mono font-medium rounded transition ${
                    isActive
                      ? "bg-foreground text-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-[#161B22]"
                  }`}
                >
                  {curr === "INR" ? "₹ INR" : curr === "USD" ? "$ USD" : curr === "EUR" ? "€ EUR" : "£ GBP"}
                </button>
              );
            })}
          </div>

          <div className="hidden sm:flex items-center gap-1.5 font-mono text-xs text-trend-green bg-trend-green/10 border border-trend-green/30 px-2.5 py-1 rounded">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>PORTFOLIO ENCRYPTED (AES-GCM)</span>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={() => refreshQuotes()}
            disabled={isQuotesLoading || holdings.length === 0}
            className="h-8 text-xs border-[#1F242D] hover:bg-[#161B22] gap-1.5"
            title="Refresh Quotes"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isQuotesLoading ? "animate-spin text-accent" : ""}`} />
            <span>{isQuotesLoading ? "Updating..." : "Refresh"}</span>
          </Button>

          <Button
            size="sm"
            onClick={handleOpenAddModal}
            className="h-8 text-xs bg-foreground text-background hover:bg-foreground/90 gap-1.5 font-medium"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Holding</span>
          </Button>
        </div>
      </div>

      {/* Summary StatCards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Invested"
          value={formatCurrency(portfolioSummary.totalInvested, portfolioCurrency, { maximumFractionDigits: 0 })}
          subtitle={`Total acquisition cost (${portfolioCurrency})`}
          icon={Building}
        />
        <StatCard
          title="Current Value"
          value={formatCurrency(portfolioSummary.totalValue, portfolioCurrency, { maximumFractionDigits: 0 })}
          subtitle={`Real-time market valuation (${portfolioCurrency})`}
          delta={{
            value: `${portfolioSummary.dayChangeAmount >= 0 ? "+" : "-"}${formatCurrency(Math.abs(portfolioSummary.dayChangeAmount), portfolioCurrency, { maximumFractionDigits: 0 })} (${portfolioSummary.dayChangePercent >= 0 ? "+" : ""}${portfolioSummary.dayChangePercent.toFixed(2)}%)`,
            isPositive: portfolioSummary.dayChangeAmount >= 0,
            period: "today",
          }}
          icon={TrendingUp}
        />
        <StatCard
          title="Total Profit / Loss"
          value={`${portfolioSummary.totalPnlAmount >= 0 ? "+" : "-"}${formatCurrency(Math.abs(portfolioSummary.totalPnlAmount), portfolioCurrency, { maximumFractionDigits: 0 })}`}
          subtitle={`Unrealized returns (${portfolioCurrency})`}
          delta={{
            value: `${portfolioSummary.totalPnlPercent >= 0 ? "+" : ""}${portfolioSummary.totalPnlPercent.toFixed(2)}%`,
            isPositive: portfolioSummary.totalPnlAmount >= 0,
            period: "all-time",
          }}
          icon={portfolioSummary.totalPnlAmount >= 0 ? TrendingUp : TrendingDown}
        />
        <StatCard
          title="Tracked Holdings"
          value={String(portfolioSummary.holdingsCount)}
          subtitle={`${portfolioSummary.stocksCount} Stocks • ${portfolioSummary.mfCount} Mutual Funds`}
          badge={`Currency: ${portfolioCurrency}`}
          icon={BarChart3}
        />
      </div>

      {/* Portfolio Table & Allocation Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Allocation Donut Chart */}
        <ChartCard
          title="Asset Allocation"
          description="Portfolio distribution by asset class"
          className="lg:col-span-1"
        >
          {portfolioAllocation.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-xs text-muted-foreground gap-2">
              <PieIcon className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-white">No holdings added yet</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="h-56 w-full flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsPie>
                    <Pie
                      data={portfolioAllocation}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                      stroke="#0C0E10"
                      strokeWidth={2}
                    >
                      {portfolioAllocation.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
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
                        formatCurrency(Number(val || 0), portfolioCurrency, { maximumFractionDigits: 0 }),
                        "Current Value",
                      ]}
                    />
                  </RechartsPie>
                </ResponsiveContainer>
              </div>

              {/* Legend with percentages */}
              <div className="space-y-2 pt-2 border-t border-gridline">
                {portfolioAllocation.map((item) => (
                  <div key={item.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="text-[#E0E3E6]">{item.name}</span>
                    </div>
                    <div className="font-mono text-[#E0E3E6]">
                      {formatCurrency(item.value, portfolioCurrency, { maximumFractionDigits: 0 })} (
                      {item.percent.toFixed(1)}%)
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </ChartCard>

        {/* Portfolio Table */}
        <Card className="border-border bg-card lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-medium">Holdings Portfolio</CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Individual equities and mutual fund schemes converted to {portfolioCurrency} ({getCurrencySymbol(portfolioCurrency)}) in client RAM
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {!dataKey ? (
              <div className="py-12 text-center text-xs text-muted-foreground space-y-2">
                <Lock className="h-8 w-8 text-muted-foreground mx-auto" />
                <p className="font-medium text-foreground">Vault is Locked</p>
                <p>Unlock your vault to decrypt and view portfolio holdings.</p>
              </div>
            ) : isLoading ? (
              <div className="py-12 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                <p>Loading investment holdings...</p>
              </div>
            ) : enrichedHoldings.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-foreground space-y-3">
                <p className="text-sm font-medium text-foreground">Add your first holding</p>
                <p className="text-muted-foreground">Track direct stocks, ETFs, and mutual funds with encrypted zero-knowledge security.</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleOpenAddModal}
                  className="h-8 text-xs border-[#1F242D] hover:bg-[#161B22]"
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add your first holding
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-[#121418] border-b border-border text-muted-foreground text-[11px] uppercase font-mono">
                    <tr>
                      <th className="p-3 font-medium">Asset / Ticker</th>
                      <th className="p-3 font-medium">Type</th>
                      <th className="p-3 font-medium text-right">Units</th>
                      <th className="p-3 font-medium text-right">Avg Buy Price ({getCurrencySymbol(portfolioCurrency)})</th>
                      <th className="p-3 font-medium text-right">Invested ({getCurrencySymbol(portfolioCurrency)})</th>
                      <th className="p-3 font-medium text-right">Current Price ({getCurrencySymbol(portfolioCurrency)})</th>
                      <th className="p-3 font-medium text-right">Current Value ({getCurrencySymbol(portfolioCurrency)})</th>
                      <th className="p-3 font-medium text-right whitespace-nowrap">Total P&L ({getCurrencySymbol(portfolioCurrency)})</th>
                      <th className="p-3 font-medium text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gridline font-mono">
                    {enrichedHoldings.map((h) => {
                      const isPnlPositive = h.totalPnlAmount >= 0;
                      const hasDiffCurrency = Boolean(h.originalCurrency && h.originalCurrency !== portfolioCurrency);

                      return (
                        <tr key={h.id} className="hover:bg-[#161B22]/50 transition">
                          <td className="p-3 font-sans">
                            <div className="font-medium text-foreground">{h.name}</div>
                            <div className="text-[10px] text-muted-foreground font-mono flex items-center gap-1.5">
                              <span>{h.symbol}</span>
                              {h.purchaseDate && (
                                <span className="text-[10px] text-muted-foreground/80">
                                  • Bought {h.purchaseDate}
                                </span>
                              )}
                              {h.originalCurrency && (
                                <span className="text-[9px] text-accent/80 bg-accent/10 px-1 rounded font-mono">
                                  Traded: {h.originalCurrency}
                                </span>
                              )}
                              {!h.hasLiveQuote && (
                                <span className="text-[9px] text-amber-500/80 bg-amber-500/10 px-1 rounded">
                                  price unavailable
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3">
                            <span
                              className={`text-[9px] px-1.5 py-0.5 rounded font-mono uppercase border ${
                                h.assetType === "mf"
                                  ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                                  : "bg-trend-green/10 text-trend-green border-trend-green/30"
                              }`}
                            >
                              {h.assetType === "mf" ? "MF" : "Stock"}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            {h.units.toLocaleString("en-IN", { maximumFractionDigits: 3 })}
                          </td>
                          <td className="p-3 text-right text-muted-foreground">
                            <div>
                              {formatCurrency(h.avgPrice, portfolioCurrency, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                            {hasDiffCurrency && (
                              <div className="text-[10px] text-muted-foreground/70 font-sans" title="Original bought price">
                                Orig: {formatCurrency(h.originalAvgPrice ?? h.avgPrice, h.originalCurrency!, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </div>
                            )}
                          </td>
                          <td className="p-3 text-right text-foreground font-medium">
                            <div>
                              {formatCurrency(h.investedValue, portfolioCurrency, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                            {hasDiffCurrency && (
                              <div className="text-[10px] text-muted-foreground/70 font-sans" title="Original invested cost">
                                Orig: {formatCurrency(h.originalInvestedValue ?? h.investedValue, h.originalCurrency!, { maximumFractionDigits: 2 })}
                              </div>
                            )}
                          </td>
                          <td className="p-3 text-right font-medium">
                            {h.hasLiveQuote ? (
                              <div>
                                <span className="text-foreground">
                                  {formatCurrency(h.currentPrice, portfolioCurrency, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                                {hasDiffCurrency && h.originalCurrentPrice && (
                                  <div className="text-[10px] text-muted-foreground/70 font-sans" title="Traded quote price">
                                    Orig: {formatCurrency(h.originalCurrentPrice, h.originalCurrency!, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-amber-400/90 text-[11px] italic">price unavailable</span>
                            )}
                          </td>
                          <td className="p-3 text-right font-medium">
                            {h.hasLiveQuote ? (
                              <span className="text-foreground">
                                {formatCurrency(h.currentValue, portfolioCurrency, { maximumFractionDigits: 0 })}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-[11px]">
                                {formatCurrency(h.investedValue, portfolioCurrency, { maximumFractionDigits: 0 })}{" "}
                                <span className="text-[9px] text-muted-foreground/70">(cost basis)</span>
                              </span>
                            )}
                          </td>
                          <td
                            className={`p-3 text-right font-medium whitespace-nowrap ${
                              !h.hasLiveQuote
                                ? "text-muted-foreground"
                                : isPnlPositive
                                  ? "text-trend-green"
                                  : "text-trend-red"
                            }`}
                            style={{ whiteSpace: "nowrap" }}
                          >
                            {h.hasLiveQuote ? (
                              <>
                                <div className="whitespace-nowrap" style={{ whiteSpace: "nowrap" }}>
                                  {`${isPnlPositive ? "+" : "-"}${formatCurrency(Math.abs(h.totalPnlAmount), portfolioCurrency, {
                                    maximumFractionDigits: 0,
                                  })}`}
                                </div>
                                <div className="text-[10px] whitespace-nowrap" style={{ whiteSpace: "nowrap" }}>
                                  {`${isPnlPositive ? "+" : ""}${h.totalPnlPercent.toFixed(2)}%`}
                                </div>
                              </>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="p-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleOpenEditModal(h)}
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-[#161B22]"
                                title="Edit Holding"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => deleteHolding(h.id)}
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-trend-red hover:bg-trend-red/10"
                                title="Delete Holding"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add / Edit Holding Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#0C0E10] border border-[#1F242D] rounded-xl max-w-lg w-full p-5 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-[#1F242D]">
              <div className="flex items-center gap-2">
                <Building className="h-4 w-4 text-trend-green" />
                <h3 className="text-sm font-semibold text-foreground">
                  {editingHolding ? "Edit Investment Holding" : "Add Investment Holding"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsModalOpen(false);
                  setEditingHolding(null);
                }}
                className="text-muted-foreground hover:text-foreground p-1 rounded"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveHolding} className="space-y-4 pt-4 text-xs">
              {formError && (
                <div className="flex items-center gap-2 p-2.5 rounded bg-trend-red/10 border border-trend-red/30 text-trend-red text-xs">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Asset Type Toggle */}
              <div>
                <label className="block text-muted-foreground mb-1 font-medium">Asset Class</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAssetType("stock");
                      if (!editingHolding) {
                        setSymbol("");
                        setName("");
                      }
                    }}
                    className={`p-2 rounded-lg border text-center transition font-medium ${
                      assetType === "stock"
                        ? "bg-[#161B22] border-foreground text-foreground"
                        : "border-[#1F242D] text-muted-foreground hover:bg-[#121418]"
                    }`}
                  >
                    Direct Stock / ETF
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAssetType("mf");
                      if (!editingHolding) {
                        setSymbol("");
                        setName("");
                      }
                    }}
                    className={`p-2 rounded-lg border text-center transition font-medium ${
                      assetType === "mf"
                        ? "bg-[#161B22] border-foreground text-foreground"
                        : "border-[#1F242D] text-muted-foreground hover:bg-[#121418]"
                    }`}
                  >
                    Mutual Fund (MF)
                  </button>
                </div>
              </div>

              {/* Mutual Fund Search */}
              {assetType === "mf" ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-muted-foreground mb-1 font-medium">
                      Search Mutual Fund Scheme
                    </label>
                    <div className="relative">
                      <Search className="h-3.5 w-3.5 absolute left-3 top-2.5 text-muted-foreground" />
                      <input
                        type="text"
                        value={mfSearchQuery}
                        onChange={(e) => handleMfSearch(e.target.value)}
                        placeholder="Search e.g. Axis ELSS, Parag Parikh Flexi, HDFC Top 100..."
                        className="w-full bg-[#121418] border border-[#1F242D] rounded-lg pl-8 pr-3 py-2 text-foreground focus:outline-none focus:border-foreground"
                      />
                      {isSearchingMf && (
                        <div className="absolute right-3 top-2.5">
                          <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        </div>
                      )}
                    </div>

                    {/* Search Results Dropdown */}
                    {mfSearchResults.length > 0 && (
                      <div className="mt-1.5 max-h-48 overflow-y-auto bg-[#121418] border border-[#1F242D] rounded-lg divide-y divide-[#1F242D] shadow-lg">
                        {mfSearchResults.map((item) => (
                          <div
                            key={item.schemeCode}
                            onClick={() => handleSelectMf(item.schemeCode, item.schemeName)}
                            className="p-2 hover:bg-[#161B22] cursor-pointer transition text-left"
                          >
                            <div className="text-foreground font-medium text-[11px]">
                              {item.schemeName}
                            </div>
                            <div className="text-[10px] text-muted-foreground font-mono">
                              Scheme Code: {item.schemeCode}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-muted-foreground mb-1">Scheme Code</label>
                      <input
                        type="text"
                        value={symbol}
                        onChange={(e) => setSymbol(e.target.value)}
                        placeholder="e.g. 120503"
                        required
                        className="w-full bg-[#121418] border border-[#1F242D] rounded-lg px-3 py-2 text-foreground font-mono focus:outline-none focus:border-foreground"
                      />
                    </div>
                    <div>
                      <label className="block text-muted-foreground mb-1">Fund Name</label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Fund scheme name"
                        required
                        className="w-full bg-[#121418] border border-[#1F242D] rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-foreground"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                /* Stock Form Fields */
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-muted-foreground mb-1">Ticker Symbol</label>
                    <input
                      type="text"
                      value={symbol}
                      onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                      placeholder="e.g. RELIANCE.NS, TCS.NS, AAPL"
                      required
                      className="w-full bg-[#121418] border border-[#1F242D] rounded-lg px-3 py-2 text-foreground font-mono uppercase focus:outline-none focus:border-foreground"
                    />
                  </div>
                  <div>
                    <label className="block text-muted-foreground mb-1">Company / Asset Name</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Reliance Industries"
                      className="w-full bg-[#121418] border border-[#1F242D] rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-foreground"
                    />
                  </div>
                </div>
              )}

              {/* Units and Buy Price */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-muted-foreground mb-1">
                    {assetType === "mf" ? "Allotted Units" : "Quantity / Shares"}
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={units}
                    onChange={(e) => setUnits(e.target.value)}
                    placeholder="e.g. 50"
                    required
                    className="w-full bg-[#121418] border border-[#1F242D] rounded-lg px-3 py-2 text-foreground font-mono focus:outline-none focus:border-foreground"
                  />
                </div>
                <div>
                  <label className="block text-muted-foreground mb-1">
                    {assetType === "mf"
                      ? `Average NAV (${getCurrencySymbol(currency)})`
                      : `Average Buy Price (${getCurrencySymbol(currency)})`}
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={avgPrice}
                    onChange={(e) => setAvgPrice(e.target.value)}
                    placeholder="e.g. 2450.00"
                    required
                    className="w-full bg-[#121418] border border-[#1F242D] rounded-lg px-3 py-2 text-foreground font-mono focus:outline-none focus:border-foreground"
                  />
                </div>
              </div>

              {/* Purchase Date & Currency */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-muted-foreground mb-1">Purchase Date (Optional)</label>
                  <input
                    type="date"
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    className="w-full bg-[#121418] border border-[#1F242D] rounded-lg px-3 py-2 text-foreground font-mono focus:outline-none focus:border-foreground"
                  />
                </div>
                <div>
                  <label className="block text-muted-foreground mb-1">Asset Currency</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full bg-[#121418] border border-[#1F242D] rounded-lg px-2.5 py-2 text-foreground focus:outline-none focus:border-foreground"
                  >
                    <option value="INR">INR (₹)</option>
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="GBP">GBP (£)</option>
                  </select>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-muted-foreground mb-1">Notes (Optional)</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Bought long ago, long term SIP"
                  className="w-full bg-[#121418] border border-[#1F242D] rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-foreground"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1F242D]">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsModalOpen(false);
                    setEditingHolding(null);
                  }}
                  className="h-8 border-[#1F242D]"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSaving}
                  className="h-8 bg-foreground text-background hover:bg-foreground/90 font-medium"
                >
                  {isSaving ? "Encrypting & Saving..." : editingHolding ? "Update Holding" : "Save Holding"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
