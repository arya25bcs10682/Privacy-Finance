import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatCard } from "./stat-card";
import { ChartCard } from "./chart-card";
import { Wallet } from "lucide-react";

describe("Reusable Card Components", () => {
  describe("StatCard", () => {
    it("renders title, value, subtitle, and badge correctly", () => {
      render(
        <StatCard
          title="Total Net Worth"
          value="₹12,45,280"
          subtitle="Encrypted assets"
          badge="Rule 1 & 2"
          icon={Wallet}
        />
      );

      expect(screen.getByText("Total Net Worth")).toBeInTheDocument();
      expect(screen.getByText("₹12,45,280")).toBeInTheDocument();
      expect(screen.getByText("Encrypted assets")).toBeInTheDocument();
      expect(screen.getByText("Rule 1 & 2")).toBeInTheDocument();
    });

    it("renders positive trend delta with trend green styling", () => {
      render(
        <StatCard
          title="Monthly Inflow"
          value="₹1,45,000"
          delta={{ value: "+12.4%", isPositive: true, period: "vs last month" }}
        />
      );

      const deltaElem = screen.getByText("+12.4%");
      expect(deltaElem).toBeInTheDocument();
      expect(deltaElem.parentElement?.className).toContain("text-trend-green");
      expect(screen.getByText("vs last month")).toBeInTheDocument();
    });

    it("renders negative trend delta with trend red styling", () => {
      render(
        <StatCard
          title="Monthly Outflow"
          value="₹42,350"
          delta={{ value: "-8.2%", isPositive: false, period: "vs target" }}
        />
      );

      const deltaElem = screen.getByText("-8.2%");
      expect(deltaElem).toBeInTheDocument();
      expect(deltaElem.parentElement?.className).toContain("text-trend-red");
    });
  });

  describe("ChartCard", () => {
    it("renders title, description, actions, children, and footer cleanly", () => {
      render(
        <ChartCard
          title="Cashflow Overview"
          description="Inflow vs Outflow analysis"
          action={<button>Filter 1M</button>}
          footer={<span>Footer metrics</span>}
        >
          <div data-testid="chart-content">Chart Canvas</div>
        </ChartCard>
      );

      expect(screen.getByText("Cashflow Overview")).toBeInTheDocument();
      expect(screen.getByText("Inflow vs Outflow analysis")).toBeInTheDocument();
      expect(screen.getByText("Filter 1M")).toBeInTheDocument();
      expect(screen.getByTestId("chart-content")).toBeInTheDocument();
      expect(screen.getByText("Footer metrics")).toBeInTheDocument();
    });
  });
});
