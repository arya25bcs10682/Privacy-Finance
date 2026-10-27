import React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface ChartCardProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

export function ChartCard({
  title,
  description,
  action,
  footer,
  children,
  className,
  contentClassName,
}: ChartCardProps) {
  return (
    <Card className={cn("border-border bg-card", className)}>
      <CardHeader className="flex flex-row items-start justify-between pb-4 gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-sm font-medium text-foreground">{title}</CardTitle>
          {description && (
            <CardDescription className="text-xs text-muted-foreground">
              {description}
            </CardDescription>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </CardHeader>

      <CardContent className={cn("pt-0", contentClassName)}>
        {children}
      </CardContent>

      {footer && (
        <CardFooter className="pt-3 border-t border-gridline text-xs text-muted-foreground flex items-center justify-between">
          {footer}
        </CardFooter>
      )}
    </Card>
  );
}
