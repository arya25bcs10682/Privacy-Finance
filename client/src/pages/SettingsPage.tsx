import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useKeyContext } from "@/context/KeyContext";
import { useTransactionContext } from "@/context/TransactionContext";
import { ShieldCheck, KeyRound, Lock, Clock, LogOut, Tag, Plus, Trash2 } from "lucide-react";

export function SettingsPage() {
  const { user, dataKey, lock, logout } = useKeyContext();

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="border-b border-[#1F242D] pb-4">
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          Settings & Cryptographic Security
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Zero-knowledge parameters, in-memory master key lifecycle, and session management.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* User Session */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-trend-green" />
              Account Credentials
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Authenticated user session
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div>
              <span className="text-muted-foreground block text-[11px]">Email Address</span>
              <span className="font-mono text-foreground font-medium">
                {user ? user.email : "Guest (Not signed in)"}
              </span>
            </div>

            <div>
              <span className="text-muted-foreground block text-[11px]">Server Storage Rules</span>
              <p className="text-muted-foreground mt-0.5">
                Only passwordHash, keySalt, and wrapped keys are stored. The server never sees your Secret Key.
              </p>
            </div>

            {user && (
              <div className="pt-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={logout}
                  className="h-8 text-xs border-[#1F242D] text-muted-foreground hover:text-trend-red gap-1.5"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign Out of Session
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cryptographic Key Parameters */}
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-foreground" />
              Web Crypto Architecture
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              OWASP 2023+ compliance
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="flex items-center justify-between font-mono">
              <span className="text-muted-foreground">PBKDF2 Rounds</span>
              <span className="text-foreground font-medium">600,000 iterations</span>
            </div>

            <div className="flex items-center justify-between font-mono">
              <span className="text-muted-foreground">Master Key Encryption</span>
              <span className="text-foreground font-medium">AES-GCM 256-bit</span>
            </div>

            <div className="flex items-center justify-between font-mono">
              <span className="text-muted-foreground">Key Wrapping</span>
              <span className="text-foreground font-medium">AES-KW / AES-GCM</span>
            </div>

            <div className="flex items-center justify-between font-mono">
              <span className="text-muted-foreground">Deduplication Hash</span>
              <span className="text-foreground font-medium">HKDF SHA-256 HMAC</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Auto-Lock Configuration */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Inactivity Auto-Lock Timer (Rule 2)
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Wipes all CryptoKey instances from browser memory to prevent forensic extraction
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-xs">
          <p className="text-muted-foreground">
            When you stop interacting with the application for <strong>15 minutes</strong>, the in-memory
            master data key is zeroed out and garbage-collected. The application locks automatically.
          </p>

          <div className="flex items-center justify-between pt-2 border-t border-gridline">
            <div>
              <span className="text-muted-foreground block text-[11px]">Manual Lock</span>
              <span className="text-foreground font-medium">Instantly wipe memory keys</span>
            </div>
            {dataKey && (
              <Button
                size="sm"
                variant="outline"
                onClick={lock}
                className="h-8 text-xs border-[#1F242D] gap-1.5"
              >
                <Lock className="h-3.5 w-3.5" />
                Lock Vault Now
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* User-Editable Categorization Rules */}
      <CategorizationRulesCard />
    </div>
  );
}

function CategorizationRulesCard() {
  const { dataKey } = useKeyContext();
  const { rules, addRule, removeRule } = useTransactionContext();
  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState("Food & Dining");
  const [matchType, setMatchType] = useState<"contains" | "exact" | "regex">("contains");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pattern.trim() || !dataKey) return;
    setIsSubmitting(true);
    try {
      await addRule({ pattern: pattern.trim(), category, matchType });
      setPattern("");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Tag className="h-4 w-4 text-trend-green" />
          User-Editable Categorization Rules
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Custom merchant pattern rules for UPI/NEFT/ACH/IMPS narrations (stored AES-GCM 256 encrypted)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-xs">
        {dataKey ? (
          <>
            <form onSubmit={handleAddRule} className="flex flex-wrap items-center gap-2 p-3 bg-[#161B22]/60 rounded-lg border border-[#1F242D]">
              <div className="flex-1 min-w-[140px]">
                <input
                  type="text"
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  placeholder="Merchant pattern (e.g. SWIGGY, NETFLIX, RENT)..."
                  className="w-full bg-[#0C0E10] border border-[#1F242D] rounded px-2.5 py-1.5 text-xs text-foreground focus:outline-none"
                  required
                />
              </div>

              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="bg-[#0C0E10] border border-[#1F242D] rounded px-2 py-1.5 text-xs text-foreground focus:outline-none"
              >
                {[
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
                ].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <select
                value={matchType}
                onChange={(e) => setMatchType(e.target.value as "contains" | "exact" | "regex")}
                className="bg-[#0C0E10] border border-[#1F242D] rounded px-2 py-1.5 text-xs text-foreground focus:outline-none"
              >
                <option value="contains">Contains</option>
                <option value="exact">Exact Match</option>
                <option value="regex">Regex</option>
              </select>

              <Button
                type="submit"
                size="sm"
                disabled={isSubmitting || !pattern.trim()}
                className="h-8 text-xs bg-foreground text-background hover:bg-foreground/90 gap-1"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Save Rule</span>
              </Button>
            </form>

            <div className="space-y-2">
              <span className="text-[11px] font-mono uppercase text-muted-foreground">
                Active Custom Rules ({rules.length})
              </span>
              {rules.length === 0 ? (
                <p className="text-muted-foreground text-xs py-2">
                  No custom rules defined yet. Built-in pattern recognition is currently active.
                </p>
              ) : (
                <div className="divide-y divide-gridline border border-[#1F242D] rounded-lg overflow-hidden">
                  {rules.map((rule) => (
                    <div
                      key={rule.id}
                      className="flex items-center justify-between p-2.5 bg-[#0C0E10] hover:bg-[#161B22]/40 transition text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-foreground font-medium">{rule.pattern}</span>
                        <span className="text-[10px] font-mono text-muted-foreground uppercase px-1.5 py-0.5 rounded bg-[#161B22]">
                          {rule.matchType || "contains"}
                        </span>
                        <span className="text-muted-foreground">&rarr;</span>
                        <span className="text-trend-green">{rule.category}</span>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeRule(rule.id)}
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-trend-red"
                        title="Delete rule"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="text-muted-foreground">Unlock vault to view and edit encrypted categorization rules.</p>
        )}
      </CardContent>
    </Card>
  );
}
