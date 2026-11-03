import type { ReactNode } from "react";

export interface PosTotalsRow {
  label: string;
  value: ReactNode;
  className?: string;
}

interface PosTotalsCardProps {
  countLabel: string;
  count: number;
  rows: PosTotalsRow[];
  totalLabel: string;
  total: ReactNode;
}

export function PosTotalsCard({ countLabel, count, rows, totalLabel, total }: PosTotalsCardProps) {
  return (
    <section className="rounded-2xl border border-primary/20 bg-primary/[0.055] px-3 py-2 text-card-foreground shadow-sm dark:border-primary/30 dark:bg-primary/[0.12] sm:px-4 sm:py-3">
      <div className="flex items-center justify-between border-b border-primary/15 py-1.5 text-xs dark:border-primary/25">
        <span className="text-muted-foreground">{countLabel}</span>
        <span className="font-mono font-semibold [unicode-bidi:isolate]">{count}</span>
      </div>
      {rows.map((row, index) => (
        <div
          key={`${row.label}-${index}`}
          className={`flex items-center justify-between gap-3 border-b border-primary/15 py-1.5 text-xs last:border-0 dark:border-primary/25 ${row.className ?? ""}`}
        >
          <span className="min-w-0 text-muted-foreground">{row.label}</span>
          <span className="shrink-0 font-mono font-medium [unicode-bidi:isolate]">{row.value}</span>
        </div>
      ))}
      <div className="flex items-center justify-between gap-3 pt-2 text-base font-bold">
        <span>{totalLabel}</span>
        <span className="shrink-0 font-mono text-primary [unicode-bidi:isolate]">{total}</span>
      </div>
    </section>
  );
}
