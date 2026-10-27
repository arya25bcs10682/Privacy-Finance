import { useLocation } from "react-router-dom";
import { useKeyContext } from "@/context/KeyContext";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "./NotificationBell";
import {
  Menu,
  Lock,
  LogOut,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";

interface HeaderProps {
  onOpenMobileSidebar: () => void;
  onOpenLogin: () => void;
  onOpenSignup: () => void;
}

const ROUTE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/transactions": "Transactions",
  "/budgets": "Budgets",
  "/bills": "Bills & Subscriptions",
  "/investments": "Investments & Holdings",
  "/settings": "Settings & Security",
  "/upload": "Statement Upload",
};

export function Header({
  onOpenMobileSidebar,
  onOpenLogin,
  onOpenSignup,
}: HeaderProps) {
  const location = useLocation();
  const { user, dataKey, lock, logout } = useKeyContext();

  const pageTitle = ROUTE_TITLES[location.pathname] || "PrivacyFinance";

  return (
    <header className="h-14 border-b border-[#1F242D] bg-[#0C0E10] px-4 sm:px-6 flex items-center justify-between shrink-0 fixed top-0 right-0 left-0 md:left-64 z-20">
      {/* Left: Mobile Toggle & Page Title */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobileSidebar}
          className="md:hidden p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-[#161B22] transition"
          aria-label="Open Navigation"
        >
          <Menu className="h-5 w-5" />
        </button>

        <h1 className="text-sm sm:text-base font-semibold tracking-tight text-foreground">
          {pageTitle}
        </h1>
      </div>

      {/* Right: User Menu & Actions */}
      <div className="flex items-center gap-3">
        {user ? (
          <div className="flex items-center gap-2 sm:gap-3">
            {/* In-App Bill Reminder Bell */}
            <NotificationBell />

            {/* User identification */}
            <div className="flex items-center gap-2 pl-1 sm:pl-2">
              <div className="h-7 w-7 rounded-full bg-[#161B22] border border-[#1F242D] flex items-center justify-center text-foreground font-mono text-xs">
                {user.email.charAt(0).toUpperCase()}
              </div>
              <span className="text-xs text-muted-foreground hidden sm:inline max-w-[150px] truncate">
                {user.email}
              </span>
            </div>

            {/* Lock Vault Button */}
            {dataKey && (
              <Button
                size="sm"
                variant="outline"
                onClick={lock}
                className="gap-1.5 text-xs h-8 border-[#1F242D] bg-transparent hover:bg-[#161B22]"
                title="Lock Vault & Wipe In-Memory Keys"
              >
                <Lock className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Lock Vault</span>
              </Button>
            )}

            {/* Sign Out Button */}
            <Button
              size="sm"
              variant="ghost"
              onClick={logout}
              className="gap-1.5 text-xs h-8 text-muted-foreground hover:text-trend-red hover:bg-[#161B22]"
              title="Sign Out"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={onOpenLogin}
              className="text-xs h-8 text-muted-foreground hover:text-foreground hover:bg-[#161B22]"
            >
              <UserIcon className="h-3.5 w-3.5 sm:mr-1" />
              <span>Log In</span>
            </Button>
            <Button
              size="sm"
              onClick={onOpenSignup}
              className="text-xs h-8 bg-foreground text-background hover:bg-foreground/90 font-medium"
            >
              <ShieldCheck className="h-3.5 w-3.5 mr-1" />
              <span>Create Account</span>
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
