import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { useKeyContext } from "@/context/KeyContext";
import { useTransactionContext } from "@/context/TransactionContext";
import { CATEGORY_COLORS } from "@/lib/transactions/categories";
import { Receipt, UploadCloud, Lock, Search, Filter, ShieldCheck, Tag } from "lucide-react";

const CATEGORY_OPTIONS = [
  "Food & Dining",
  "Housing & Rent",
  "Shopping & Groceries",
  "Utilities & Bills",
  "Entertainment",
  "Travel & Commute",
  "Health & Wellness",
  "Income & Salary",
  "Investments",
  "General & Others",
];

export function TransactionsPage() {
  const { dataKey } = useKeyContext();
  const { transactions, overrides, setOverride } = useTransactionContext();
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("ALL");

  const filtered = useMemo(() => {
    return transactions.filter((tx) => {
      const matchSearch =
        !searchTerm ||
        tx.narration.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tx.merchant.toLowerCase().includes(searchTerm.toLowerCase());
      const matchCat = filterCategory === "ALL" || tx.category === filterCategory;
      return matchSearch && matchCat;
    });
  }, [transactions, searchTerm, filterCategory]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1F242D] pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            Encrypted Transactions
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Client-side decrypted in memory with rule-based merchant categorizer and manual overrides (stored encrypted).
          </p>
        </div>

        <Link to="/upload">
          <Button size="sm" className="gap-1.5 text-xs h-8 bg-foreground text-background hover:bg-foreground/90 font-medium">
            <UploadCloud className="h-3.5 w-3.5" />
            <span>Import Statement</span>
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Decrypted Records"
          value={dataKey ? String(transactions.length) : "Locked"}
          subtitle="Scoped to your user ID"
          icon={Receipt}
        />
        <StatCard
          title="Manual Overrides"
          value={dataKey ? String(Object.keys(overrides).length) : "Locked"}
          subtitle="Stored AES-GCM encrypted"
          badge="Encrypted"
        />
        <StatCard
          title="Categorization Hierarchy"
          value="3-Tier Active"
          subtitle="Override -> Rule -> Pattern"
          icon={Tag}
        />
      </div>

      <Card className="border-border bg-card">
        <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-medium">Transaction History</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Click any category pill to manually override (changes persist encrypted)
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#161B22] border border-[#1F242D] text-xs text-muted-foreground">
              <Search className="h-3.5 w-3.5" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search merchant/narration..."
                className="bg-transparent border-none text-foreground text-xs focus:outline-none w-28 sm:w-44"
              />
            </div>
            <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-[#161B22] border border-[#1F242D] text-xs text-muted-foreground">
              <Filter className="h-3 w-3" />
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="bg-transparent text-foreground text-xs focus:outline-none cursor-pointer"
              >
                <option value="ALL" className="bg-[#0C0E10]">All Categories</option>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c} className="bg-[#0C0E10]">{c}</option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!dataKey ? (
            <div className="py-12 text-center text-xs text-muted-foreground space-y-2">
              <Lock className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="font-medium text-foreground">Vault is Locked</p>
              <p>Transactions are encrypted on the server. Unlock your vault to decrypt records in memory.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground space-y-2">
              <p>No transactions found matching your criteria.</p>
              <Link to="/upload">
                <Button size="sm" variant="outline" className="h-8 text-xs border-[#1F242D]">
                  Upload PDF or CSV Statement
                </Button>
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#121418] border-b border-border text-muted-foreground text-[11px] uppercase font-mono">
                  <tr>
                    <th className="p-3 font-medium">Date</th>
                    <th className="p-3 font-medium">Merchant / Narration</th>
                    <th className="p-3 font-medium">Category (Click to Override)</th>
                    <th className="p-3 font-medium text-right">Amount</th>
                    <th className="p-3 font-medium text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gridline">
                  {filtered.map((tx) => {
                    const isOverridden = Boolean(overrides[tx.txHash]);
                    const badgeColor = CATEGORY_COLORS[tx.category] || "#2A2D32";

                    return (
                      <tr key={tx.id || tx.txHash} className="hover:bg-[#161B22]/50 transition">
                        <td className="p-3 font-mono text-muted-foreground whitespace-nowrap">
                          {tx.date}
                        </td>
                        <td className="p-3 max-w-xs sm:max-w-md">
                          <div className="font-medium text-foreground truncate">{tx.merchant}</div>
                          <div className="text-[11px] text-muted-foreground font-mono truncate">
                            {tx.narration}
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="inline-flex items-center gap-1.5">
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: badgeColor }}
                            />
                            <select
                              value={tx.category}
                              onChange={(e) => setOverride(tx.txHash, e.target.value)}
                              className="bg-[#161B22] border border-[#1F242D] text-foreground text-xs rounded px-1.5 py-0.5 focus:outline-none cursor-pointer hover:border-muted-foreground"
                              title="Manual Category Override (Encrypted)"
                            >
                              {CATEGORY_OPTIONS.map((c) => (
                                <option key={c} value={c} className="bg-[#0C0E10] text-foreground">
                                  {c}
                                </option>
                              ))}
                            </select>
                            {isOverridden && (
                              <span
                                className="text-[10px] font-mono text-trend-green bg-trend-green/10 px-1 py-0.5 rounded border border-trend-green/30 inline-flex items-center gap-0.5"
                                title="Manually overridden and stored encrypted"
                              >
                                <ShieldCheck className="h-2.5 w-2.5" /> Override
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3 text-right font-mono font-medium whitespace-nowrap">
                          <span className={tx.type === "credit" ? "text-trend-green" : "text-foreground"}>
                            {tx.type === "credit" ? "+" : "-"}₹{tx.amount.toLocaleString("en-IN")}
                          </span>
                        </td>
                        <td className="p-3 text-right font-mono text-muted-foreground whitespace-nowrap">
                          ₹{tx.balance.toLocaleString("en-IN")}
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
  );
}
