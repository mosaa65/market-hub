"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Info,
  HelpCircle,
  Sparkles,
  BookOpen,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  Layers,
  Database,
  CheckCircle2,
  Table as TableIcon,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface ImpactMatrixColumn {
  key: string;
  label: string;
  className?: string;
}

export interface ImpactMatrixRow {
  badge?: {
    label: string;
    variant: "emerald" | "amber" | "rose" | "blue" | "purple" | "slate";
  };
  fields: Record<string, React.ReactNode>;
}

export interface GuideStep {
  number: number | string;
  title: string;
  description: string;
}

export interface GuideRule {
  type: "info" | "warning" | "success" | "danger";
  title: string;
  description: string;
}

export interface PageGuideConfig {
  title: string;
  subtitle?: string;
  badge?: string;
  icon?: React.ReactNode;
  summaryText?: string;
  overviewCards?: Array<{
    title: string;
    description: string;
    icon?: React.ReactNode;
    color?: "blue" | "emerald" | "purple" | "amber";
  }>;
  matrixTitle?: string;
  matrixDescription?: string;
  impactMatrix?: {
    columns: ImpactMatrixColumn[];
    rows: ImpactMatrixRow[];
  };
  stepsTitle?: string;
  steps?: GuideStep[];
  rulesTitle?: string;
  rules?: GuideRule[];
  footerTip?: string;
}

export function PageGuideButton({
  config,
  className,
}: {
  config: PageGuideConfig;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "matrix" | "steps" | "security">("overview");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="دليل وتعليمات الصفحة"
        title="دليل وتعليمات الصفحة"
        className={cn(
          "group relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-sky-500/30 bg-gradient-to-tr from-sky-500/10 via-indigo-500/10 to-emerald-500/10 text-sky-600 transition-all duration-300 hover:scale-105 hover:border-sky-500/60 hover:bg-sky-500/20 hover:shadow-md hover:shadow-sky-500/20 active:scale-95 dark:border-sky-400/30 dark:from-sky-400/15 dark:text-sky-300 dark:hover:border-sky-400/70",
          className,
        )}
      >
        <span className="text-sm font-black tracking-tighter transition-transform duration-300 group-hover:scale-110">
          !
        </span>
        <span className="absolute -inset-0.5 -z-10 rounded-full bg-gradient-to-r from-sky-500/20 to-indigo-500/20 opacity-0 blur-xs transition-opacity duration-300 group-hover:opacity-100" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden border-border/80 bg-background/95 p-0 shadow-2xl backdrop-blur-xl sm:rounded-3xl">
          {/* Top Brand Banner */}
          <div className="relative border-b border-border/70 bg-gradient-to-r from-sky-500/10 via-indigo-500/10 to-purple-500/10 px-6 py-5 sm:px-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-sky-500/30 bg-sky-500/15 text-sky-600 shadow-inner dark:text-sky-400">
                  {config.icon ?? <BookOpen className="h-5 w-5" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-sky-600 dark:text-sky-400">
                      <Sparkles className="h-2.5 w-2.5" />
                      {config.badge ?? "دليل النظام"}
                    </span>
                  </div>
                  <DialogTitle className="mt-1 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                    {config.title}
                  </DialogTitle>
                </div>
              </div>

              {/* Navigation Tabs */}
              <div className="flex items-center gap-1 rounded-2xl border border-border/80 bg-surface/80 p-1 text-xs shadow-2xs backdrop-blur-md">
                <button
                  type="button"
                  onClick={() => setActiveTab("overview")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-medium transition-colors",
                    activeTab === "overview"
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span>نظرة عامة</span>
                </button>
                {config.impactMatrix && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("matrix")}
                    className={cn(
                      "flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-medium transition-colors",
                      activeTab === "matrix"
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <TableIcon className="h-3.5 w-3.5" />
                    <span>الأثر والعمليات</span>
                  </button>
                )}
                {config.steps && config.steps.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("steps")}
                    className={cn(
                      "flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-medium transition-colors",
                      activeTab === "steps"
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Zap className="h-3.5 w-3.5" />
                    <span>خطوات العمل</span>
                  </button>
                )}
                {config.rules && config.rules.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("security")}
                    className={cn(
                      "flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-medium transition-colors",
                      activeTab === "security"
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>الضوابط والتحقق</span>
                  </button>
                )}
              </div>
            </div>

            {config.subtitle && (
              <DialogDescription className="mt-2.5 text-xs text-muted-foreground sm:text-sm">
                {config.subtitle}
              </DialogDescription>
            )}
          </div>

          {/* Scrollable Content Area */}
          <div className="max-h-[60vh] overflow-y-auto px-6 py-6 sm:px-8">
            {/* TAB 1: OVERVIEW */}
            {activeTab === "overview" && (
              <div className="space-y-6">
                {config.summaryText && (
                  <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4 text-sm leading-relaxed text-foreground">
                    <p>{config.summaryText}</p>
                  </div>
                )}

                {config.overviewCards && config.overviewCards.length > 0 && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {config.overviewCards.map((card, idx) => (
                      <div
                        key={idx}
                        className="group rounded-2xl border border-border/80 bg-surface/50 p-4.5 transition-all duration-200 hover:border-border hover:bg-surface hover:shadow-xs"
                      >
                        <div className="flex items-start gap-3">
                          {card.icon ? (
                            <div className="mt-0.5 rounded-xl bg-primary/10 p-2 text-primary">
                              {card.icon}
                            </div>
                          ) : (
                            <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-xl bg-primary/10 text-xs font-bold text-primary">
                              {idx + 1}
                            </div>
                          )}
                          <div>
                            <h4 className="text-sm font-semibold text-foreground">
                              {card.title}
                            </h4>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              {card.description}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: SUPABASE-STYLE IMPACT MATRIX */}
            {activeTab === "matrix" && config.impactMatrix && (
              <div className="space-y-4">
                {(config.matrixTitle || config.matrixDescription) && (
                  <div>
                    {config.matrixTitle && (
                      <h4 className="text-sm font-semibold text-foreground">
                        {config.matrixTitle}
                      </h4>
                    )}
                    {config.matrixDescription && (
                      <p className="text-xs text-muted-foreground">
                        {config.matrixDescription}
                      </p>
                    )}
                  </div>
                )}

                <div className="overflow-hidden rounded-2xl border border-border/80 bg-surface/90 shadow-2xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-start text-xs">
                      <thead>
                        <tr className="border-b border-border/80 bg-muted/40 font-mono text-[11px] text-muted-foreground">
                          {config.impactMatrix.columns.map((col) => (
                            <th
                              key={col.key}
                              className={cn("px-4 py-3 font-semibold", col.className)}
                            >
                              {col.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {config.impactMatrix.rows.map((row, rIdx) => (
                          <tr
                            key={rIdx}
                            className="transition-colors hover:bg-accent/40"
                          >
                            {config.impactMatrix.columns.map((col, cIdx) => (
                              <td
                                key={col.key}
                                className={cn(
                                  "px-4 py-3 align-top leading-relaxed",
                                  cIdx === 0 && "font-medium text-foreground",
                                )}
                              >
                                {cIdx === 0 && row.badge && (
                                  <div className="mb-1">
                                    <span
                                      className={cn(
                                        "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                                        row.badge.variant === "emerald" &&
                                          "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                                        row.badge.variant === "rose" &&
                                          "border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-400",
                                        row.badge.variant === "amber" &&
                                          "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400",
                                        row.badge.variant === "blue" &&
                                          "border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-400",
                                        row.badge.variant === "purple" &&
                                          "border-purple-500/25 bg-purple-500/10 text-purple-600 dark:text-purple-400",
                                        row.badge.variant === "slate" &&
                                          "border-slate-500/25 bg-slate-500/10 text-slate-600 dark:text-slate-400",
                                      )}
                                    >
                                      {row.badge.label}
                                    </span>
                                  </div>
                                )}
                                {row.fields[col.key]}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: STEP-BY-STEP WORKFLOW */}
            {activeTab === "steps" && config.steps && (
              <div className="space-y-4">
                {config.stepsTitle && (
                  <h4 className="text-sm font-semibold text-foreground">
                    {config.stepsTitle}
                  </h4>
                )}
                <div className="space-y-3">
                  {config.steps.map((st, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-3.5 rounded-2xl border border-border/70 bg-surface/40 p-4 transition-colors hover:border-border hover:bg-surface/80"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-sky-500/30 bg-sky-500/10 text-xs font-bold text-sky-600 dark:text-sky-400">
                        {st.number}
                      </div>
                      <div className="space-y-1">
                        <h5 className="text-sm font-semibold text-foreground">
                          {st.title}
                        </h5>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {st.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB 4: RULES, GUARDS & SECURITY */}
            {activeTab === "security" && config.rules && (
              <div className="space-y-4">
                {config.rulesTitle && (
                  <h4 className="text-sm font-semibold text-foreground">
                    {config.rulesTitle}
                  </h4>
                )}
                <div className="space-y-3">
                  {config.rules.map((rule, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        "rounded-2xl border p-4 text-xs leading-relaxed",
                        rule.type === "danger" &&
                          "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300",
                        rule.type === "warning" &&
                          "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300",
                        rule.type === "success" &&
                          "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
                        rule.type === "info" &&
                          "border-sky-500/30 bg-sky-500/5 text-sky-700 dark:text-sky-300",
                      )}
                    >
                      <div className="flex items-start gap-2.5">
                        {rule.type === "danger" || rule.type === "warning" ? (
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        ) : (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                        )}
                        <div>
                          <h5 className="font-semibold">{rule.title}</h5>
                          <p className="mt-1 opacity-90">{rule.description}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Bottom Footer Note */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/80 bg-muted/20 px-6 py-3.5 sm:px-8">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Database className="h-3.5 w-3.5 text-sky-500" />
              <span>
                {config.footerTip ??
                  "نظام التدقيق الداخلي — جميع التعديلات والحركات تسجل آلياً وتخضع لرقابة الأثر المالي والمخزني"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-xl border border-border bg-surface px-4 py-1.5 text-xs font-semibold text-foreground shadow-2xs hover:bg-accent"
            >
              فهمت، إغلاق الدليل
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
