import React from "react";
import { NavLink } from "react-router-dom";
import { useKeyContext } from "@/context/KeyContext";
import {
  LayoutDashboard,
  Receipt,
  PieChart,
  CreditCard,
  TrendingUp,
  Settings,
  UploadCloud,
  Lock,
  Unlock,
  ShieldCheck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", path: "/", icon: LayoutDashboard },
  { label: "Transactions", path: "/transactions", icon: Receipt },
  { label: "Budgets", path: "/budgets", icon: PieChart },
  { label: "Bills", path: "/bills", icon: CreditCard },
  { label: "Investments", path: "/investments", icon: TrendingUp },
  { label: "Settings", path: "/settings", icon: Settings },
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  className?: string;
}

export function Sidebar({ isOpen, onClose, className }: SidebarProps) {
  const { dataKey, isLocked, idleTimeoutRemainingMs } = useKeyContext();

  const minutesRemaining = Math.floor(idleTimeoutRemainingMs / 60000);
  const secondsRemaining = Math.floor((idleTimeoutRemainingMs % 60000) / 1000);

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#0C0E10] text-foreground border-r border-[#1F242D] select-none">
      {/* Brand Header */}
      <div className="h-14 px-5 border-b border-[#1F242D] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="h-3.5 w-3.5 rounded-sm bg-foreground" />
          <span className="font-semibold text-sm tracking-tight text-foreground">
            PrivacyFinance
          </span>
          <span className="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded bg-[#161B22] text-muted-foreground border border-[#1F242D]">
            ZK-VAULT
          </span>
        </div>

        {/* Mobile close button */}
        {onClose && (
          <button
            onClick={onClose}
            className="md:hidden text-muted-foreground hover:text-foreground p-1 rounded hover:bg-[#161B22]"
            aria-label="Close Sidebar"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Main Navigation */}
      <div className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <div className="px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Menu
        </div>

        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/"}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition",
                  isActive
                    ? "bg-[#2A2D32] text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-[#161B22]"
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}

        {/* Upload Statement Action */}
        <div className="pt-3">
          <div className="px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Import
          </div>
          <NavLink
            to="/upload"
            onClick={onClose}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition",
                isActive
                  ? "bg-[#2A2D32] text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-[#161B22]"
              )
            }
          >
            <UploadCloud className="h-4 w-4 shrink-0" />
            <span>Upload Statement</span>
          </NavLink>
        </div>
      </div>

      {/* Footer: Zero-Knowledge Key State */}
      <div className="p-3 border-t border-[#1F242D] shrink-0">
        <div className="p-2.5 rounded-lg bg-[#161B22]/60 border border-[#1F242D] space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground flex items-center gap-1">
              <ShieldCheck className="h-3 w-3 text-trend-green" />
              Vault Memory
            </span>
            {dataKey && !isLocked ? (
              <span className="h-1.5 w-1.5 rounded-full bg-trend-green animate-pulse" />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-trend-red" />
            )}
          </div>

          <div className="font-mono text-[11px] text-foreground flex items-center gap-1.5">
            {dataKey && !isLocked ? (
              <>
                <Unlock className="h-3 w-3 text-trend-green shrink-0" />
                <span className="truncate">Active ({minutesRemaining}m {secondsRemaining}s)</span>
              </>
            ) : (
              <>
                <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                <span>Memory Wiped</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Fixed Left Sidebar */}
      <aside
        className={cn(
          "hidden md:block fixed top-0 left-0 bottom-0 w-64 z-30",
          className
        )}
      >
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Slide-Over */}
      {isOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
            onClick={onClose}
          />

          {/* Drawer Pane */}
          <div className="relative w-64 max-w-[80vw] h-full z-10 shadow-2xl">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}
