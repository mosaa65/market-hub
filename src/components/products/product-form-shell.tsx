import * as React from "react";
import { AlertTriangle, Barcode, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { SegmentedTabs, type SegmentedTabItem } from "@/components/ui/segmented-tabs";

/**
 * ProductFormShell — the ONE presentation layer for the product form.
 *
 * Before this, two competing paths rendered the same form with different
 * chrome: the main drawer (luxury preview card + hand-rolled tab strip) and
 * the guided item dialog (plain wizard with bare inputs). Both are the same
 * entity, so they now share:
 *
 *  - `ProductPreviewCard` — the live identity/financials preview.
 *  - `ProductFormTabs` — the segmented tab strip (shared `SegmentedTabs`),
 *    with an optional *issues count* per tab so an operator sees where the
 *    validation problems live before pressing Save.
 *  - `FormIssuesBar` — the live validation strip above the tabs; tapping an
 *    issue jumps to its tab.
 *
 * The shell owns presentation only. Field values, policy rules and the write
 * stay with the screen.
 */

export type ProductFormTab = "general" | "pricing" | "specs" | "policy";

/* ------------------------------------------------------------------ */
/*  Live preview card                                                  */
/* ------------------------------------------------------------------ */

export interface ProductPreviewCardProps {
  nameAr: string;
  nameEn: string;
  categoryLabel?: string | null;
  barcode?: string;
  isActive: boolean;
  /** Render the financial (margin/ROI) block — hidden when cost is not visible. */
  canViewCost: boolean;
  /** Numeric values already computed by the screen. */
  profit?: number;
  marginPercent?: number;
  currencySymbol?: string;
  /** Arabic-Indic digit formatter already wired in the screen (toSystemDigits). */
  formatDigits?: (value: string) => string;
  activeLabel?: string;
  inactiveLabel?: string;
  newTitlePlaceholder?: string;
  /** Nature/policy chips shown instead of stock financials (services). */
  chips?: { label: string; tone?: "primary" | "success" | "muted" | "warning" }[];
  className?: string;
}

const chipTones: Record<string, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  muted: "bg-muted text-muted-foreground",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

export function ProductPreviewCard({
  nameAr,
  nameEn,
  categoryLabel,
  barcode,
  isActive,
  canViewCost,
  profit = 0,
  marginPercent = 0,
  currencySymbol = "",
  formatDigits = (v) => v,
  activeLabel = "نشط",
  inactiveLabel = "معطل",
  newTitlePlaceholder = "اسم المنتج الجديد...",
  chips,
  className,
}: ProductPreviewCardProps) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-card via-card/95 to-primary/[0.035] p-4 shadow-sm transition-shadow duration-200 hover:shadow-md sm:p-5",
        className,
      )}
    >
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {categoryLabel ? (
              <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                {categoryLabel}
              </span>
            ) : null}
            {chips?.map((chip) => (
              <span
                key={chip.label}
                className={cn(
                  "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium",
                  chipTones[chip.tone ?? "muted"],
                )}
              >
                {chip.label}
              </span>
            ))}
            {barcode ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted/80 px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
                <Barcode className="size-3" />
                {formatDigits(barcode)}
              </span>
            ) : null}
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium",
                isActive
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  isActive ? "bg-emerald-500" : "bg-muted-foreground",
                )}
              />
              {isActive ? activeLabel : inactiveLabel}
            </span>
          </div>
          <h3 className="truncate text-base font-bold text-foreground sm:text-lg">
            {nameAr.trim() || nameEn.trim() || newTitlePlaceholder}
          </h3>
          {nameAr.trim() && nameEn.trim() && (
            <p className="truncate text-xs text-muted-foreground">{nameEn}</p>
          )}
        </div>

        {canViewCost && !chips ? (
          <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-background/80 p-3 backdrop-blur-xs">
            <div className="text-center sm:text-end">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                هامش الربح المتوقع
              </div>
              <div className="flex items-center justify-center gap-1 font-mono text-sm font-bold text-foreground sm:justify-end">
                <span
                  className={cn(
                    profit >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400",
                  )}
                >
                  {profit > 0 ? "+" : ""}
                  {formatDigits(profit.toFixed(2))} {currencySymbol}
                </span>
              </div>
            </div>
            <div
              className={cn(
                "flex flex-col items-center justify-center rounded-lg px-2.5 py-1 text-center font-mono text-xs font-bold",
                profit >= 0
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "bg-rose-500/10 text-rose-700 dark:text-rose-300",
              )}
            >
              <span className="text-[10px] font-normal opacity-80">العائد</span>
              <span>{marginPercent}%</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab strip with issue counts                                        */
/* ------------------------------------------------------------------ */

export interface ProductFormTabsProps {
  value: ProductFormTab;
  onChange: (tab: ProductFormTab) => void;
  /** Per-tab missing-field counts; a tab with issues shows an amber badge. */
  issues?: Partial<Record<ProductFormTab, number>>;
  labels: Record<ProductFormTab, { label: string; icon: React.ReactNode }>;
  className?: string;
}

export function ProductFormTabs({
  value,
  onChange,
  issues,
  labels,
  className,
}: ProductFormTabsProps) {
  const items: SegmentedTabItem<ProductFormTab>[] = (
    ["general", "pricing", "specs", "policy"] as ProductFormTab[]
  ).map((tab) => {
    const count = issues?.[tab] ?? 0;
    return {
      value: tab,
      label: labels[tab].label,
      icon: labels[tab].icon,
      disabled: false,
      badge:
        count > 0 ? (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-2.5" aria-hidden />
            {count}
          </span>
        ) : undefined,
    };
  });

  return (
    <SegmentedTabs
      value={value}
      onChange={onChange}
      items={items}
      ariaLabel="أقسام نموذج المنتج"
      className={className}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Live issues strip                                                  */
/* ------------------------------------------------------------------ */

export interface FormIssue {
  tab: ProductFormTab;
  message: string;
}

/**
 * A compact list of the *currently* missing/invalid fields. Rendered above
 * the tabs so the operator fixes things before pressing Save rather than
 * discovering them in a toast. Clicking jumps to the owning tab.
 */
export function FormIssuesBar({
  issues,
  onJump,
  className,
}: {
  issues: FormIssue[];
  onJump: (tab: ProductFormTab) => void;
  className?: string;
}) {
  if (issues.length === 0) return null;

  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] font-medium text-amber-700 dark:text-amber-400",
        className,
      )}
    >
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
      <span className="font-bold">{issues.length} ملاحظة:</span>
      {issues.map((issue, index) => (
        <button
          key={`${issue.tab}-${index}`}
          type="button"
          onClick={() => onJump(issue.tab)}
          className="inline-flex items-center gap-0.5 rounded-full bg-background/60 px-2 py-0.5 transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {issue.message}
          <ChevronDown className="size-2.5" aria-hidden />
        </button>
      ))}
    </div>
  );
}
