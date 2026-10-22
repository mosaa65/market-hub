import React from "react";
import type { ReportMetricDefinition } from "@/lib/reports/types";
import { Card, CardContent } from "@/components/ui/card";
import { Ltr } from "@/components/ltr-value";

interface ReportSummaryDeckProps {
  metricsDefinitions: ReportMetricDefinition[];
  metricsValues: Record<string, number>;
  currencySymbol?: string;
}

export function ReportSummaryDeck(_props?: any) {
  return null;
}
