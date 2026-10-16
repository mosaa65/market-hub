import React from "react";
import type { ReportMetricDefinition } from "@/lib/reports/types";
import { Card, CardContent } from "@/components/ui/card";
import { Ltr } from "@/components/ltr-value";

interface ReportSummaryDeckProps {
  metricsDefinitions: ReportMetricDefinition[];
  metricsValues: Record<string, number>;
  currencySymbol?: string;
}

export function ReportSummaryDeck({
  metricsDefinitions,
  metricsValues,
  currencySymbol = "ر.ي",
}: ReportSummaryDeckProps) {
  if (!metricsDefinitions || metricsDefinitions.length === 0) return null;

  function formatValue(value: number | undefined, format: ReportMetricDefinition["format"]) {
    if (value === undefined || value === null || isNaN(value)) return "—";

    switch (format) {
      case "money":
        return `${Number(value).toLocaleString("en-US", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        })} ${currencySymbol}`;
      case "quantity":
        return Number(value).toLocaleString("en-US", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 3,
        });
      case "percentage":
        return `${Number(value).toFixed(2)}%`;
      case "integer":
        return Number(value).toLocaleString("en-US");
      default:
        return String(value);
    }
  }

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-5 p-1">
      {metricsDefinitions.slice(0, 5).map((metric) => {
        const val = metricsValues[metric.key];
        const isPositiveProfit = metric.key.toLowerCase().includes("margin") && (val ?? 0) > 0;
        const isNegativeProfit = metric.key.toLowerCase().includes("margin") && (val ?? 0) < 0;

        return (
          <Card
            key={metric.key}
            className="rounded-xl border border-border bg-card text-card-foreground shadow-xs hover:border-primary/40 transition-colors"
          >
            <CardContent className="p-3 text-center flex flex-col justify-center items-center">
              <div className="text-xs font-semibold text-muted-foreground truncate w-full">
                {metric.labelAr || "المؤشر"}
              </div>
              <div
                className={`mt-1.5 text-base sm:text-lg font-bold font-mono tracking-tight truncate w-full ${
                  isPositiveProfit
                    ? "text-emerald-600 dark:text-emerald-400"
                    : isNegativeProfit
                      ? "text-destructive"
                      : "text-foreground"
                }`}
              >
                <Ltr>{formatValue(val, metric.format)}</Ltr>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
