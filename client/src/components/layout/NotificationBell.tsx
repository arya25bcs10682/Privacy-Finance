import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTransactionContext } from "@/context/TransactionContext";
import { Button } from "@/components/ui/button";
import {
  Bell,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  ShieldCheck,
  Check,
} from "lucide-react";

export function NotificationBell() {
  const {
    billReminders,
    markBillAsPaid,
    pushPermission,
    requestPushPermission,
  } = useTransactionContext();

  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const urgentCount = billReminders.length;

  return (
    <div className="relative" ref={containerRef}>
      {/* Bell Button with Active Badge */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-[#161B22] transition focus:outline-none"
        aria-label="Bill Reminders"
        title="Bill & Subscription Reminders"
      >
        <Bell className="h-4 w-4" />
        {urgentCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-trend-red text-[10px] font-mono font-bold text-white shadow-sm">
            {urgentCount}
          </span>
        )}
      </button>

      {/* Popover Dropdown */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl bg-[#0C0E10] border border-[#1F242D] shadow-2xl p-4 z-50 text-xs space-y-3 antialiased">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#1F242D] pb-2.5">
            <div className="flex items-center gap-1.5 font-semibold text-foreground">
              <Clock className="h-4 w-4 text-trend-green" />
              <span>Bill Reminders</span>
              <span className="px-1.5 py-0.2 rounded-full bg-[#161B22] text-[10px] font-mono text-muted-foreground border border-[#1F242D]">
                {urgentCount}
              </span>
            </div>
            <Link
              to="/bills"
              onClick={() => setIsOpen(false)}
              className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <span>View All</span>
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>

          {/* Web Push Opt-in Banner */}
          {pushPermission !== "granted" && (
            <div className="p-2.5 rounded-lg bg-[#161B22]/70 border border-[#1F242D] space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-foreground flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-trend-green" /> Web Push Reminders
                </span>
                <Button
                  size="sm"
                  onClick={requestPushPermission}
                  className="h-6 text-[10px] px-2 bg-foreground text-background hover:bg-foreground/90 font-medium"
                >
                  Enable Push
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Get zero-knowledge desktop alerts before due dates. No plaintext leaves your device.
              </p>
            </div>
          )}

          {/* Reminders List */}
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {urgentCount === 0 ? (
              <div className="py-6 text-center text-muted-foreground space-y-1">
                <CheckCircle2 className="h-6 w-6 text-trend-green mx-auto mb-1" />
                <p className="font-medium text-foreground text-xs">All Bills Cleared!</p>
                <p className="text-[11px]">No upcoming or overdue payments for this cycle.</p>
              </div>
            ) : (
              billReminders.map((rem) => {
                const isOverdue = rem.status === "overdue";
                const isToday = rem.status === "due_today";

                return (
                  <div
                    key={rem.billId}
                    className={`p-2.5 rounded-lg border flex flex-col gap-1.5 transition ${
                      isOverdue
                        ? "bg-trend-red/10 border-trend-red/30"
                        : isToday
                        ? "bg-amber-500/10 border-amber-500/30"
                        : "bg-[#161B22]/40 border-[#1F242D]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 truncate">
                        {isOverdue ? (
                          <AlertCircle className="h-3.5 w-3.5 text-trend-red shrink-0" />
                        ) : (
                          <Clock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                        )}
                        <span className="font-medium text-foreground truncate">{rem.name}</span>
                      </div>
                      <span className="font-mono font-semibold text-foreground text-xs shrink-0 pl-2">
                        ₹{rem.amount.toLocaleString("en-IN")}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px]">
                      <span
                        className={
                          isOverdue
                            ? "text-trend-red font-mono"
                            : isToday
                            ? "text-amber-500 font-mono"
                            : "text-muted-foreground font-mono"
                        }
                      >
                        {rem.message}
                      </span>
                      <Button
                        size="sm"
                        onClick={() => markBillAsPaid(rem.billId, true)}
                        className="h-6 px-2 text-[10px] bg-[#161B22] hover:bg-trend-green/20 hover:text-trend-green border border-[#1F242D] text-foreground gap-1"
                        title="Mark bill as paid"
                      >
                        <Check className="h-3 w-3" /> Paid
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
