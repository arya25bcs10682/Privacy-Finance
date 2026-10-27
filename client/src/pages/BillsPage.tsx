import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { useKeyContext } from "@/context/KeyContext";
import { useTransactionContext } from "@/context/TransactionContext";
import {
  CreditCard,
  Calendar,
  Plus,
  CheckCircle2,
  Clock,
  AlertCircle,
  Bell,
  Trash2,
  Lock,
  Check,
  X,
  ShieldCheck,
} from "lucide-react";

export function BillsPage() {
  const { dataKey } = useKeyContext();
  const {
    bills,
    billReminders,
    saveBill,
    deleteBill,
    markBillAsPaid,
    pushPermission,
    requestPushPermission,
  } = useTransactionContext();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Utilities & Bills");
  const [nextDueDate, setNextDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split("T")[0];
  });
  const [cadence, setCadence] = useState<"monthly" | "yearly" | "quarterly" | "weekly">("monthly");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Stats calculation
  const totalMonthlyRecurring = bills.reduce((sum, b) => sum + b.amount, 0);
  const paidCount = bills.filter((b) => b.isPaid).length;
  const unpaidCount = bills.filter((b) => !b.isPaid).length;

  const upcomingDueAmount = bills
    .filter((b) => !b.isPaid)
    .reduce((sum, b) => sum + b.amount, 0);

  const handleCreateBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !amount || !dataKey) return;

    setIsSubmitting(true);
    try {
      await saveBill({
        name: name.trim(),
        amount: parseFloat(amount),
        category,
        nextDueDate,
        cadence,
        source: "manual",
        isPaid: false,
      });

      setName("");
      setAmount("");
      setIsAddModalOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner: Title & Add Bill Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1F242D] pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            Bills & Recurring Subscriptions
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Auto-detected cadence (30±3 days) plus manually added bills with client-side reminders and encrypted persistence.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {pushPermission !== "granted" && (
            <Button
              size="sm"
              variant="outline"
              onClick={requestPushPermission}
              className="gap-1.5 text-xs h-8 border-[#1F242D] hover:bg-[#161B22]"
            >
              <Bell className="h-3.5 w-3.5 text-trend-green" />
              <span>Enable Web Push</span>
            </Button>
          )}

          <Button
            size="sm"
            onClick={() => setIsAddModalOpen(true)}
            className="gap-1.5 text-xs h-8 bg-foreground text-background hover:bg-foreground/90 font-medium"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Bill</span>
          </Button>
        </div>
      </div>

      {/* Summary StatCards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Upcoming Due"
          value={`₹${upcomingDueAmount.toLocaleString("en-IN")}`}
          subtitle={`${unpaidCount} pending payments`}
          icon={Calendar}
          badge={unpaidCount === 0 ? "All Cleared" : "Action Required"}
        />
        <StatCard
          title="Monthly Recurring"
          value={`₹${totalMonthlyRecurring.toLocaleString("en-IN")}`}
          subtitle={`${bills.length} active bills & subscriptions`}
          icon={CreditCard}
        />
        <StatCard
          title="Paid This Cycle"
          value={`${paidCount} of ${bills.length}`}
          subtitle="Marked cleared"
          delta={{
            value: bills.length > 0 ? `${Math.round((paidCount / bills.length) * 100)}%` : "100%",
            isPositive: true,
            period: "cleared",
          }}
          icon={CheckCircle2}
        />
        <StatCard
          title="Reminder Engine"
          value={pushPermission === "granted" ? "Push Active" : "In-App Bell"}
          subtitle="Client-side Zero-Knowledge"
          badge="AES-GCM"
          icon={ShieldCheck}
        />
      </div>

      {/* Active Urgency Alert Bar */}
      {billReminders.filter((r) => r.status === "due_today" || r.status === "overdue").length > 0 && (
        <div className="space-y-2">
          {billReminders
            .filter((r) => r.status === "due_today" || r.status === "overdue")
            .map((rem) => {
              const isOverdue = rem.status === "overdue";
              return (
                <div
                  key={`bill-alert-${rem.billId}`}
                  className={`flex items-center justify-between p-3 rounded-lg border text-xs text-foreground transition ${
                    isOverdue
                      ? "bg-trend-red/10 border-trend-red/30"
                      : "bg-amber-500/10 border-amber-500/30"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {isOverdue ? (
                      <AlertCircle className="h-4 w-4 text-trend-red shrink-0" />
                    ) : (
                      <Clock className="h-4 w-4 text-amber-500 shrink-0" />
                    )}
                    <span>
                      <strong className={isOverdue ? "text-trend-red" : "text-amber-500"}>
                        {isOverdue ? "Overdue Bill:" : "Due Today:"}
                      </strong>{" "}
                      {rem.message}
                    </span>
                  </div>

                  <Button
                    size="sm"
                    onClick={() => markBillAsPaid(rem.billId, true)}
                    className="h-6 px-2 text-[10px] bg-foreground text-background hover:bg-foreground/90 gap-1 font-medium"
                  >
                    <Check className="h-3 w-3" /> Mark as Paid
                  </Button>
                </div>
              );
            })}
        </div>
      )}

      {/* Bills & Subscriptions Table */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Recurring Bills & Subscriptions</CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Detected from statement cadence (30±3 days) and manually configured bills (stored AES-GCM encrypted)
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {!dataKey ? (
            <div className="py-12 text-center text-xs text-muted-foreground space-y-2">
              <Lock className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="font-medium text-foreground">Vault is Locked</p>
              <p>Bills are encrypted on the server. Unlock your vault to view and manage bills in memory.</p>
            </div>
          ) : bills.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground space-y-2">
              <p>No bills detected or added yet.</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsAddModalOpen(true)}
                className="h-8 text-xs border-[#1F242D]"
              >
                Add Your First Bill
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#121418] border-b border-border text-muted-foreground text-[11px] uppercase font-mono">
                  <tr>
                    <th className="p-3 font-medium">Bill / Service</th>
                    <th className="p-3 font-medium">Category</th>
                    <th className="p-3 font-medium">Next Due Date</th>
                    <th className="p-3 font-medium text-right">Amount</th>
                    <th className="p-3 font-medium text-center">Status</th>
                    <th className="p-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gridline font-mono">
                  {bills.map((bill) => {
                    const reminder = billReminders.find((r) => r.billId === bill.id);
                    const isOverdue = reminder?.status === "overdue";
                    const isDueToday = reminder?.status === "due_today";

                    return (
                      <tr key={bill.id} className="hover:bg-[#161B22]/50 transition">
                        <td className="p-3 font-sans">
                          <div className="font-medium text-foreground flex items-center gap-1.5">
                            <span>{bill.name}</span>
                            <span
                              className={`text-[9px] px-1.5 py-0.2 rounded font-mono uppercase border ${
                                bill.source === "detected"
                                  ? "bg-[#161B22] text-muted-foreground border-[#1F242D]"
                                  : "bg-trend-green/10 text-trend-green border-trend-green/30"
                              }`}
                            >
                              {bill.source}
                            </span>
                          </div>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            Cadence: {bill.cadence}
                          </span>
                        </td>

                        <td className="p-3 text-muted-foreground font-sans">{bill.category}</td>

                        <td className="p-3 text-foreground whitespace-nowrap">
                          {bill.nextDueDate}
                        </td>

                        <td className="p-3 text-right font-medium text-foreground whitespace-nowrap">
                          ₹{bill.amount.toLocaleString("en-IN")}
                        </td>

                        <td className="p-3 text-center whitespace-nowrap">
                          {bill.isPaid ? (
                            <span className="text-trend-green text-[11px] inline-flex items-center gap-1 bg-trend-green/10 px-2 py-0.5 rounded border border-trend-green/30 font-sans">
                              <CheckCircle2 className="h-3 w-3" /> Paid
                            </span>
                          ) : isOverdue ? (
                            <span className="text-trend-red text-[11px] inline-flex items-center gap-1 bg-trend-red/10 px-2 py-0.5 rounded border border-trend-red/30 font-sans">
                              <AlertCircle className="h-3 w-3" /> Overdue
                            </span>
                          ) : isDueToday ? (
                            <span className="text-amber-500 text-[11px] inline-flex items-center gap-1 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30 font-sans">
                              <Clock className="h-3 w-3" /> Due Today
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-[11px] inline-flex items-center gap-1 font-sans">
                              <Clock className="h-3 w-3 text-muted-foreground" /> Upcoming
                            </span>
                          )}
                        </td>

                        <td className="p-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <Button
                              size="sm"
                              variant={bill.isPaid ? "outline" : "default"}
                              onClick={() => markBillAsPaid(bill.id, !bill.isPaid)}
                              className={`h-7 px-2.5 text-[11px] font-sans font-medium ${
                                bill.isPaid
                                  ? "border-[#1F242D] text-muted-foreground hover:text-foreground hover:bg-[#161B22]"
                                  : "bg-foreground text-background hover:bg-foreground/90"
                              }`}
                            >
                              {bill.isPaid ? "Mark Unpaid" : "Mark as Paid"}
                            </Button>

                            {bill.source === "manual" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => deleteBill(bill.id)}
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-trend-red hover:bg-[#161B22]"
                                title="Delete Bill"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
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

      {/* Add Bill Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#0C0E10] border border-[#1F242D] rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#1F242D] pb-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Add Custom Bill</h3>
                <p className="text-[11px] text-muted-foreground">
                  Stored encrypted with AES-GCM 256. Plaintext is never sent to the server.
                </p>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateBill} className="space-y-3 text-xs">
              <div>
                <label className="text-[11px] text-muted-foreground block mb-1">
                  Bill / Service Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Airtel Broadband, Netflix, Rent"
                  required
                  className="w-full bg-[#161B22] border border-[#1F242D] rounded px-3 py-1.5 text-foreground focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-muted-foreground block mb-1">
                    Amount (₹ INR)
                  </label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="1179"
                    required
                    min="1"
                    className="w-full bg-[#161B22] border border-[#1F242D] rounded px-3 py-1.5 text-foreground font-mono focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-muted-foreground block mb-1">
                    Next Due Date
                  </label>
                  <input
                    type="date"
                    value={nextDueDate}
                    onChange={(e) => setNextDueDate(e.target.value)}
                    required
                    className="w-full bg-[#161B22] border border-[#1F242D] rounded px-3 py-1.5 text-foreground font-mono focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-muted-foreground block mb-1">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full bg-[#161B22] border border-[#1F242D] rounded px-3 py-1.5 text-foreground focus:outline-none"
                  >
                    {[
                      "Utilities & Bills",
                      "Entertainment",
                      "Housing & Rent",
                      "Health & Wellness",
                      "Travel & Commute",
                      "Shopping & Groceries",
                      "Investments",
                      "General & Others",
                    ].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] text-muted-foreground block mb-1">Cadence</label>
                  <select
                    value={cadence}
                    onChange={(e) =>
                      setCadence(e.target.value as "monthly" | "yearly" | "quarterly" | "weekly")
                    }
                    className="w-full bg-[#161B22] border border-[#1F242D] rounded px-3 py-1.5 text-foreground focus:outline-none"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#1F242D]">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsAddModalOpen(false)}
                  className="h-8 text-xs border-[#1F242D]"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting || !name.trim() || !amount}
                  className="h-8 text-xs bg-foreground text-background hover:bg-foreground/90 font-medium"
                >
                  {isSubmitting ? "Encrypting..." : "Save Bill"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
