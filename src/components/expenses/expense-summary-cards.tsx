/**
 * Expense summary strip.
 *
 * Four figures, all computed by `public.expense_summary` in Postgres. Nothing
 * here sums an array: the previous finance screen did, which is why it degraded
 * with the size of the register rather than staying constant.
 *
 * The cards are also the fastest filter in the UI — clicking "Awaiting
 * approval" applies that status filter — so they earn their space rather than
 * being decoration.
 *
 * They are ALWAYS rendered, including before any data exists. An earlier
 * version showed five skeleton placeholders until the summary arrived, which
 * on an empty database never resolved: the screen looked broken and gave no
 * clue what the cards were for. Now the layout is stable and each card states
 * its own meaning, with a zero and its unit visible from the first paint.
 */

import { cn } from "@/lib/utils";
import { money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { Skeleton } from "@/components/ui/skeleton";
import type { ExpenseSummary } from "@/lib/expenses/types";
import { AlertTriangle, CheckCircle2, Clock, Receipt, Wallet } from "lucide-react";

/** A locally-built zero summary, so the cards have real content immediately. */
const EMPTY_SUMMARY: ExpenseSummary = {
  period_total: 0,
  posted_total: 0,
  paid_total: 0,
  outstanding_total: 0,
  pending_total: 0,
  draft_total: 0,
  total_count: 0,
  pending_count: 0,
  unpaid_count: 0,
  partial_count: 0,
  paid_count: 0,
  draft_count: 0,
  overdue_count: 0,
  overdue_total: 0,
};

interface CardSpec {
  key: keyof Pick<
    ExpenseSummary,
    "period_total" | "posted_total" | "paid_total" | "outstanding_total" | "pending_total"
  >;
  countKey?: keyof ExpenseSummary;
  labelKey: string;
  /** One line of plain language under the figure — replaces the old shimmer. */
  hintKey: string;
  icon: typeof Receipt;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
}

const CARDS: CardSpec[] = [
  {
    key: "period_total",
    countKey: "total_count",
    labelKey: "expenses.summary.period",
    hintKey: "expenses.summary.period_hint",
    icon: Receipt,
    tone: "neutral",
  },
  {
    key: "posted_total",
    labelKey: "expenses.summary.posted",
    hintKey: "expenses.summary.posted_hint",
    icon: Wallet,
    tone: "info",
  },
  {
    key: "pending_total",
    countKey: "pending_count",
    labelKey: "expenses.summary.pending",
    hintKey: "expenses.summary.pending_hint",
    icon: Clock,
    tone: "warning",
  },
  {
    key: "outstanding_total",
    countKey: "unpaid_count",
    labelKey: "expenses.summary.outstanding",
    hintKey: "expenses.summary.outstanding_hint",
    icon: AlertTriangle,
    tone: "danger",
  },
  {
    key: "paid_total",
    countKey: "paid_count",
    labelKey: "expenses.summary.paid",
    hintKey: "expenses.summary.paid_hint",
    icon: CheckCircle2,
    tone: "success",
  },
];

const TONE_CLASS: Record<CardSpec["tone"], { icon: string; value: string }> = {
  neutral: {
    icon: "bg-surface-2 text-muted-foreground border-border/60",
    value: "text-foreground",
  },
  info: {
    icon: "bg-tone-info text-tone-info-fg border-tone-info-fg/20",
    value: "text-tone-info-fg",
  },
  success: {
    icon: "bg-tone-success text-tone-success-fg border-tone-success-fg/20",
    value: "text-tone-success-fg",
  },
  warning: {
    icon: "bg-tone-warning text-tone-warning-fg border-tone-warning-fg/20",
    value: "text-tone-warning-fg",
  },
  danger: {
    icon: "bg-tone-danger text-tone-danger-fg border-tone-danger-fg/20",
    value: "text-tone-danger-fg",
  },
};

export function ExpenseSummaryCards({
  summary,
  loading,
  onSelect,
  activeKey,
}: {
  summary: ExpenseSummary | undefined;
  loading?: boolean;
  /** Clicking a card applies the matching filter. */
  onSelect?: (card: CardSpec["key"]) => void;
  activeKey?: CardSpec["key"] | null;
}) {
  const { t, lang } = useI18n();
  const ar = lang === "ar";

  // `summary ?? EMPTY_SUMMARY` rather than an early return: the cards render
  // their real labels, icons and a zero from the first frame. Only the numerals
  // get a skeleton while the first fetch is in flight, so the layout never
  // jumps and an empty database still explains what each card measures.
  const data = summary ?? EMPTY_SUMMARY;
  const firstLoad = Boolean(loading) && !summary;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {CARDS.map((card) => {
        const value = Number(data[card.key] ?? 0);
        const count = card.countKey ? Number(data[card.countKey] ?? 0) : null;
        const tone = TONE_CLASS[card.tone];
        const isActive = activeKey === card.key;

        return (
          <button
            key={card.key}
            type="button"
            onClick={onSelect ? () => onSelect(card.key) : undefined}
            disabled={!onSelect}
            // `aria-label` carries the hint so a screen reader announces what
            // the figure means, not just its number.
            aria-label={`${t(card.labelKey)} — ${t(card.hintKey)}`}
            className={cn(
              "group relative overflow-hidden rounded-[14px] border border-border/70 bg-surface/80 p-4 text-start transition",
              onSelect && "hover:border-primary/40 hover:bg-surface active:scale-[0.99]",
              isActive && "border-primary/60 bg-primary/[0.04] ring-1 ring-primary/20",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-medium text-muted-foreground">
                  {t(card.labelKey)}
                </span>

                {firstLoad ? (
                  // Only the number is pending. The label and the icon are
                  // already correct, so the card reads as a card, not a gap.
                  <Skeleton className="mt-1.5 h-6 w-24" />
                ) : (
                  <span
                    className={cn(
                      "mt-1 block truncate font-mono text-lg font-bold tracking-tight tabular-nums",
                      tone.value,
                    )}
                  >
                    {money(value)}
                  </span>
                )}

                {/* The caption turns a bare zero into an explanation. */}
                <span className="mt-0.5 block truncate text-[10px] text-muted-foreground/80">
                  {t(card.hintKey)}
                </span>
              </span>

              <span
                aria-hidden
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-xl border [&_svg]:size-4",
                  tone.icon,
                )}
              >
                <card.icon />
              </span>
            </div>

            {count !== null && count > 0 ? (
              <span className="mt-2 block text-[11px] tabular-nums text-muted-foreground">
                {count} {ar ? "مستند" : count === 1 ? "document" : "documents"}
              </span>
            ) : null}

            {/* Overdue is surfaced only when it is non-zero: a permanent
                "0 overdue" chip trains people to ignore the space it occupies. */}
            {card.key === "outstanding_total" && data.overdue_count > 0 ? (
              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-tone-danger px-2 py-0.5 text-[10px] font-medium text-tone-danger-fg">
                <AlertTriangle className="size-2.5" aria-hidden />
                {data.overdue_count} {ar ? "متأخر" : "overdue"}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export type { CardSpec as ExpenseSummaryCardSpec };
