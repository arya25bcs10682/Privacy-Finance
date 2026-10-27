import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  delta?: {
    value: string | number;
    isPositive?: boolean;
    period?: string;
  };
  icon?: React.ComponentType<{ className?: string }>;
  badge?: string;
  className?: string;
}

export function StatCard({
  title,
  value,
  subtitle,
  delta,
  icon: Icon,
  badge,
  className,
}: StatCardProps) {
  const isPositive = delta?.isPositive ?? (typeof delta?.value === "string" && delta.value.startsWith("+"));
  const isNegative = delta ? !isPositive : false;

  return (
    <Card className={cn("border-border bg-card transition hover:border-border/80", className)}>
      <CardContent className="p-5 space-y-3">
        {/* Top Header: Title, Icon, Badge */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground truncate">
            {title}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {badge && (
              <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-nav-active text-muted-foreground border border-border">
                {badge}
              </span>
            )}
            {Icon && (
              <div className="h-7 w-7 rounded-md bg-nav-active/60 border border-border flex items-center justify-center text-foreground">
                <Icon className="h-3.5 w-3.5" />
              </div>
            )}
          </div>
        </div>

        {/* Primary Metric Value */}
        <div className="space-y-1">
          <div className="text-2xl font-bold font-mono tracking-tight text-foreground">
            {value}
          </div>
          {subtitle && (
            <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
          )}
        </div>

        {/* Trend Indicator (strictly using Trend Green #22C55E or Trend Red #EF4444) */}
        {delta && (
          <div className="flex items-center gap-1.5 text-xs pt-1 border-t border-gridline">
            <span
              className={cn(
                "inline-flex items-center gap-1 font-mono font-medium",
                isPositive && "text-trend-green",
                isNegative && "text-trend-red",
                delta.isPositive === undefined && !isPositive && !isNegative && "text-muted-foreground"
              )}
            >
              {isPositive ? (
                <TrendingUp className="h-3 w-3 text-trend-green" />
              ) : isNegative ? (
                <TrendingDown className="h-3 w-3 text-trend-red" />
              ) : (
                <Minus className="h-3 w-3 text-muted-foreground" />
              )}
              <span>{delta.value}</span>
            </span>
            {delta.period && (
              <span className="text-muted-foreground text-[11px] truncate">
                {delta.period}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
