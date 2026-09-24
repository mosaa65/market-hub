/**
 * StatementSummaryCards — ملخص الكشف (افتتاحي · مدين · دائن · ختامي)
 *
 * ⚠️ عرض فقط. يقرأ من StatementResult بلا أي حساب.
 * يطبّق قرار المستخدم: دلالة الرصيد تختلف بحسب نوع الجهة
 * (عميل = مدين لنا · مورد = دائن علينا · صندوق = رصيد متاح).
 */

import { ArrowDownLeft, ArrowUpRight, Scale, Wallet, TrendingUp } from "lucide-react";
import { fmtMoney } from "@/lib/statements/format";
import { directionLabel } from "@/lib/statements/format";
import type { StatementResult } from "@/lib/statements/types";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface StatementSummaryCardsProps {
  result: StatementResult;
  currencySymbol: string;
  className?: string;
}

export function StatementSummaryCards({
  result,
  currencySymbol,
  className,
}: StatementSummaryCardsProps) {
  const { lang } = useI18n();
  const ar = lang === "ar";

  const closingPositive =
    result.entityType === "supplier" ? result.closingBalance <= 0 : result.closingBalance >= 0;

  const cards = [
    {
      key: "opening",
      label: ar ? "الرصيد الافتتاحي" : "Opening balance",
      value: fmtMoney(result.openingBalance, currencySymbol),
      icon: Wallet,
      tone: "neutral" as const,
      hint: result.period.from
        ? ar
          ? `حتى ${result.period.from}`
          : `Before ${result.period.from}`
        : ar
          ? "قبل الفترة"
          : "Before period",
    },
    {
      key: "debit",
      label: ar ? "إجمالي المدين" : "Total debit",
      value: fmtMoney(result.totalDebit, currencySymbol),
      icon: ArrowUpRight,
      tone: "negative" as const,
      hint: ar ? `${result.countedRows} حركة` : `${result.countedRows} entries`,
    },
    {
      key: "credit",
      label: ar ? "إجمالي الدائن" : "Total credit",
      value: fmtMoney(result.totalCredit, currencySymbol),
      icon: ArrowDownLeft,
      tone: "positive" as const,
      hint: ar ? "السدادات والمرتجعات" : "Payments & returns",
    },
    {
      key: "closing",
      label: ar ? "الرصيد الختامي" : "Closing balance",
      value: fmtMoney(result.closingBalance, currencySymbol),
      icon: TrendingUp,
      tone: closingPositive ? ("positive" as const) : ("negative" as const),
      hint: directionLabel(result.direction, result.entityType, lang),
    },
  ];

  const toneClass = {
    neutral: "border-border/80 bg-surface/60 text-foreground",
    positive: "border-emerald-500/30 bg-emerald-500/5 text-emerald-600",
    negative: "border-rose-500/30 bg-rose-500/5 text-rose-600",
  } as const;

  return (
    <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.key}
            className={cn(
              "rounded-2xl border p-3.5 transition-colors",
              toneClass[card.tone],
              card.key === "closing" && "ring-1 ring-inset ring-current/10",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wider opacity-80">
                {card.label}
              </span>
              <Icon className="h-3.5 w-3.5 shrink-0 opacity-60" />
            </div>
            <div className="mt-1.5 font-mono text-lg font-bold leading-tight">{card.value}</div>
            <div className="mt-0.5 truncate text-[10px] opacity-70">{card.hint}</div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * شريط دلالة الرصيد — سطر واحد مكثّف يُستخدم أعلى الجدول.
 */
export function StatementBalanceBanner({
  result,
  currencySymbol,
  className,
}: StatementSummaryCardsProps) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const isDebit = result.direction === "debit";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-2.5",
        result.direction === "zero"
          ? "border-border/80 bg-surface/60"
          : isDebit
            ? "border-rose-500/25 bg-rose-500/5"
            : "border-emerald-500/25 bg-emerald-500/5",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-xs">
        <Scale className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">{ar ? "الرصيد الختامي" : "Closing balance"}:</span>
        <span
          className={cn(
            "font-mono text-sm font-bold",
            result.direction === "zero"
              ? "text-foreground"
              : isDebit
                ? "text-rose-600"
                : "text-emerald-600",
          )}
        >
          {fmtMoney(result.closingBalance, currencySymbol)}
        </span>
      </div>
      <span className="text-[11px] text-muted-foreground">
        {directionLabel(result.direction, result.entityType, lang)}
      </span>
    </div>
  );
}
