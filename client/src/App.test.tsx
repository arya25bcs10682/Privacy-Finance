import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import App from "./App";
import * as api from "@/lib/api";

describe("Client App Integration & Layout", () => {
  it("renders the zero-knowledge vault header, navigation links, and cards", async () => {
    vi.spyOn(api, "apiFetch").mockRejectedValue(new Error("Unauthorized"));

    await act(async () => {
      render(<App />);
    });

    // 1. Top Header & Brand
    expect(screen.getByText("PrivacyFinance")).toBeInTheDocument();
    expect(screen.getByText("Zero-Knowledge Financial Vault")).toBeInTheDocument();
    expect(screen.getByText("NOT SIGNED IN")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log In" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Account" })).toBeInTheDocument();

    // 2. Fixed Left Sidebar Navigation items (Dashboard, Transactions, Budgets, Bills, Investments, Settings)
    const dashboardLinks = screen.getAllByRole("link", { name: /Dashboard/i });
    expect(dashboardLinks.length).toBeGreaterThanOrEqual(1);

    expect(screen.getByRole("link", { name: /Transactions/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Budgets/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Bills/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Investments/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Settings/i })).toBeInTheDocument();

    // 3. Active pill #2A2D32 styling on active route
    const activeDashboardLink = dashboardLinks[0];
    expect(activeDashboardLink.className).toContain("bg-[#2A2D32]");

    // 4. Reusable StatCard components rendered (4-card row)
    expect(screen.getByText("Current Balance")).toBeInTheDocument();
    expect(screen.getByText("Month Income")).toBeInTheDocument();
    expect(screen.getByText("Month Spend")).toBeInTheDocument();
    expect(screen.getByText("Projected Month-End Cash")).toBeInTheDocument();

    // 5. Reusable ChartCard components rendered
    expect(screen.getByText("Balance Over Time")).toBeInTheDocument();
    expect(screen.getByText("Spending by Category")).toBeInTheDocument();
  });
});
