/**
 * Expense status badge.
 *
 * One component owns the status → colour mapping so a status can never be shown
 * as "green" on one screen and "amber" on another. The tone comes from
 * `EXPENSE_STATUS_META` (the same table that drives the filter chips), and the
 * label comes from the translation dictionary under a fixed key pattern.
 */

import { cn } from "@/lib/utils";
import { toneClasses } from "@/design/styles";
import { useI18n } from "@/lib/i18n";
import { EXPENSE_STATUS_META } from "@/lib/expenses/query-keys";
import type { ExpenseStatus } from "@/lib/expenses/types";
import { Lock } from "lucide-react";

export function ExpenseStatusBadge({
  status,
  className,
  showLock = false,
}: {
  status: ExpenseStatus;
  className?: string;
  /** Render a padlock for financial states — mirrors the database immutability. */
  showLock?: boolean;
}) {
  const { t } = useI18n();
  const meta = EXPENSE_STATUS_META[status] ?? EXPENSE_STATUS_META.DRAFT;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        toneClasses[meta.tone].badge,
        className,
      )}
      // The tone is colour; the label is the meaning. Announced explicitly so
      // the status is not conveyed by colour alone.
      title={t(meta.labelKey)}
    >
      {showLock && meta.immutable ? <Lock className="size-2.5" aria-hidden /> : null}
      {t(meta.labelKey)}
    </span>
  );
}

/**
 * Settlement badge — deliberately separate from the status badge.
 *
 * "Posted, unpaid" and "Posted, partially paid" are the same status from the
 * workflow's point of view but completely different from the cashier's, so the
 * register shows both rather than collapsing them into one ambiguous chip.
 */
export function ExpensePaymentBadge({
  paid,
  total,
  status,
  className,
}: {
  paid: number;
  total: number;
  status: ExpenseStatus;
  className?: string;
}) {
  const { t } = useI18n();

  if (status === "DRAFT" || status === "SUBMITTED" || status === "REJECTED") return null;
  if (status === "CANCELLED" || status === "REVERSED") return null;

  const isSettled = total > 0 && paid >= total - 0.005;
  const hasPart = paid > 0 && !isSettled;

  const tone = isSettled ? "success" : hasPart ? "warning" : "danger";
  const label = isSettled
    ? t("expenses.payment.paid")
    : hasPart
      ? t("expenses.payment.partial")
      : t("expenses.payment.unpaid");

  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
        toneClasses[tone].badge,
        className,
      )}
    >
      {label}
    </span>
  );
}
