/**
 * Expense filter sheet.
 *
 * Built on the existing `VortexFilterSheet`, so the register's filters behave
 * exactly like the ones on Products, Sales and Debtors — same drawer on mobile,
 * same dialog on desktop, same Apply/Reset footer.
 *
 * Two design decisions worth stating:
 *
 *  1. **Filters are applied on Apply, not on every keystroke.** Each change
 *     would otherwise be a server round-trip against a paginated RPC; the sheet
 *     keeps a local draft and commits once.
 *
 *  2. **Search is NOT in here.** It lives in the toolbar and filters as you
 *     type (debounced), because hiding the search box behind a filter button is
 *     the single most common complaint about filtered registers.
 */

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { VortexFilterSheet, VortexFilterSection } from "@/components/vortex-ui";
import { FieldInput } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  EMPTY_EXPENSE_FILTERS,
  EXPENSE_STATUS_ORDER,
  EXPENSE_STATUS_META,
  activeExpenseFilterCount,
  addDays,
  startOfMonth,
  today,
  type ExpenseListFilters,
} from "@/lib/expenses/query-keys";
import type { ExpenseLookups, ExpensePaymentState, ExpenseStatus } from "@/lib/expenses/types";
import { CalendarRange, CircleDollarSign, Layers, Tag } from "lucide-react";

export function ExpenseFilterSheet({
  open,
  onOpenChange,
  filters,
  onApply,
  lookups,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: ExpenseListFilters;
  onApply: (next: ExpenseListFilters) => void;
  lookups: ExpenseLookups | undefined;
}) {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const [draft, setDraft] = useState<ExpenseListFilters>(filters);

  // Re-seed whenever the sheet opens so it always reflects what is currently
  // applied, not what was left over from a previous visit.
  useEffect(() => {
    if (open) setDraft(filters);
  }, [open, filters]);

  const set = <K extends keyof ExpenseListFilters>(key: K, value: ExpenseListFilters[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const toggleStatus = (status: ExpenseStatus) =>
    setDraft((prev) => ({
      ...prev,
      status: prev.status.includes(status)
        ? prev.status.filter((s) => s !== status)
        : [...prev.status, status],
    }));

  const setPayment = (value: ExpensePaymentState) =>
    // Clicking the active chip clears it, so a filter can be removed without
    // hunting for the reset button.
    setDraft((prev) => ({ ...prev, paymentState: prev.paymentState === value ? null : value }));

  const applyPreset = (preset: "today" | "month" | "quarter" | "year" | "all") => {
    const end = today();
    if (preset === "all") return setDraft((prev) => ({ ...prev, dateFrom: null, dateTo: null }));
    setDraft((prev) => ({
      ...prev,
      dateTo: end,
      dateFrom:
        preset === "today"
          ? end
          : preset === "month"
            ? startOfMonth()
            : preset === "quarter"
              ? addDays(end, -90)
              : `${new Date().getFullYear()}-01-01`,
    }));
  };

  return (
    <VortexFilterSheet
      open={open}
      onOpenChange={onOpenChange}
      activeCount={activeExpenseFilterCount(draft)}
      title={ar ? "تصفية المصروفات" : "Filter expenses"}
      subtitle={ar ? "حاصر النتائج بدقة" : "Narrow the register precisely"}
      applyLabel={ar ? "تطبيق" : "Apply"}
      resetLabel={ar ? "إعادة ضبط" : "Reset"}
      onApply={() => onApply(draft)}
      onReset={() => {
        // Search is preserved: a reset of the advanced filters should not also
        // wipe what the operator typed in the search box.
        setDraft({ ...EMPTY_EXPENSE_FILTERS, search: filters.search });
        onApply({ ...EMPTY_EXPENSE_FILTERS, search: filters.search });
      }}
    >
      <VortexFilterSection
        title={t("expenses.filter.status")}
        icon={<Layers className="size-3.5" />}
        description={ar ? "يمكن اختيار أكثر من حالة" : "Multiple allowed"}
      >
        <div className="flex flex-wrap gap-1.5">
          {EXPENSE_STATUS_ORDER.map((status) => {
            const active = draft.status.includes(status);
            return (
              <button
                key={status}
                type="button"
                onClick={() => toggleStatus(status)}
                className={cn(
                  "rounded-full border px-3 py-1 text-[11px] font-medium transition",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : cn("bg-surface text-muted-foreground hover:bg-surface-2", "border-border/70"),
                )}
              >
                {t(EXPENSE_STATUS_META[status].labelKey)}
              </button>
            );
          })}
        </div>
      </VortexFilterSection>

      <VortexFilterSection
        title={t("expenses.filter.payment")}
        icon={<CircleDollarSign className="size-3.5" />}
      >
        <div className="grid grid-cols-3 gap-2">
          {(["unpaid", "partial", "paid"] as ExpensePaymentState[]).map((state) => (
            <button
              key={state}
              type="button"
              onClick={() => setPayment(state)}
              className={cn(
                "rounded-lg border px-2 py-2 text-[11px] font-medium transition",
                draft.paymentState === state
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border bg-surface text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`expenses.payment.${state}`)}
            </button>
          ))}
        </div>
      </VortexFilterSection>

      <VortexFilterSection title={t("common.date")} icon={<CalendarRange className="size-3.5" />}>
        {" "}
        <div className="mb-2 flex flex-wrap gap-1.5">
          {(["today", "month", "quarter", "year", "all_time"] as const).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => applyPreset(preset === "all_time" ? "all" : preset)}
              className="rounded-full border border-border/70 bg-surface px-2.5 py-1 text-[11px] text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
            >
              {t(`expenses.filter.${preset}`)}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <FieldInput
            type="date"
            size="sm"
            value={draft.dateFrom ?? ""}
            onValueChange={(value) => set("dateFrom", value || null)}
            aria-label={t("common.from")}
          />
          <FieldInput
            type="date"
            size="sm"
            value={draft.dateTo ?? ""}
            onValueChange={(value) => set("dateTo", value || null)}
            aria-label={t("common.to")}
          />
        </div>
      </VortexFilterSection>

      <VortexFilterSection title={t("expenses.field.category")} icon={<Tag className="size-3.5" />}>
        <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
          <button
            type="button"
            onClick={() => set("categoryId", null)}
            className={cn(
              "rounded-full border px-3 py-1 text-[11px] transition",
              !draft.categoryId
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border/70 bg-surface text-muted-foreground hover:text-foreground",
            )}
          >
            {t("common.all")}
          </button>
          {(lookups?.categories ?? []).map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => set("categoryId", category.id)}
              className={cn(
                "rounded-full border px-3 py-1 text-[11px] transition",
                draft.categoryId === category.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border/70 bg-surface text-muted-foreground hover:text-foreground",
              )}
            >
              {ar ? category.name_ar || category.name : category.name}
            </button>
          ))}
        </div>
      </VortexFilterSection>
    </VortexFilterSheet>
  );
}

/* الحالة والسداد والتاريخ والتصنيف فقط — الأبعاد (مركز تكلفة/مشروع/مورد/موظف)
 * أُزيلت من الفلترة عمداً: تسجيلها من الفورم يكفي، وتعقيدها في السجل
 * كان يجعل إيجاد مصروف عادي مهمة محاسبية. */
