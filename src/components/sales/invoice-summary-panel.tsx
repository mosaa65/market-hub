import * as React from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Loader2,
  ShoppingBag,
  User,
  Warehouse as WarehouseIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { money } from "@/lib/format";
import { toSystemDigits } from "@/lib/format-preferences";
import { AmountInput } from "@/components/ui/amount-input";
import { DynamicPaymentSelector } from "@/components/ui/payment-method/dynamic-payment-selector";
import type { PaymentSettlementSelection } from "@/lib/payments/treasury-types";

/**
 * InvoiceSummaryPanel — لوحة القرار في المستند، مضغوطة لتسع الشاشة كاملةً.
 *
 * ════════════════════════════════════════════
 * ما تغيّر ولماذا
 * ════════════════════════════════════════════
 * النسخة السابقة كانت ثلاث بطاقات كبيرة (الجهة / السداد / الإجماليات) تحت
 * بعضها، فكانت تتجاوز ارتفاع الشاشة ويضيع زر الإصدار أسفل التمرير. الآن:
 *
 *   • **دفتر واحد** بأقسام مفصولة بخط، لا بطاقات متعددة بإطارات ثقيلة —
 *     نفس التسلسل البصري، نصف الارتفاع.
 *   • **التاريخ والمستودع** صارا سطرًا واحدًا في الترويسة (كانا في مكانين).
 *   • **المبلغ المدفوع** صار هو البطل: صف كبير يتبعه شريحتا المتبقي والباقي.
 *   • **الإجمالي** سطر بارز ملاصق للإصدار، والاثنان مثبّتان أسفل العمود فلا
 *     يغادران الشاشة أبدًا.
 *
 * الكيبورد: كل عنصر تفاعلي `data-form-nav` بترتيب DOM (الجهة ← طريقة السداد
 * ← المدفوع ← الخصم ← الملاحظة ← الإصدار). اختصارات مباشرة: Alt+1 كامل،
 * Alt+2 آجل.
 */

export interface SummaryCustomer {
  id: string;
  name: string;
  phone?: string | null;
  balance?: number | null;
  credit_limit?: number | null;
  is_system?: boolean | null;
}

export interface InvoiceSummaryPanelProps {
  isRtl: boolean;
  customers: SummaryCustomer[];
  cashCustomerId: string;
  customerId: string;
  onCustomerChange: (id: string) => void;
  paymentMethod: string;
  onPaymentMethodChange: (methodId: string) => void;
  settlement: PaymentSettlementSelection;
  onSettlementChange: (selection: PaymentSettlementSelection) => void;
  paid: string;
  onPaidChange: (value: string) => void;
  subtotal: number;
  discount: string;
  onDiscountChange: (value: string) => void;
  total: number;
  effectivePaid: number;
  remaining: number;
  change: number;
  currencySymbol: string;
  remainingError: string | null;
  lineCount: number;
  submitting: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  note: string;
  onNoteChange: (value: string) => void;
  /** تاريخ المستند (YYYY-MM-DD) — في ترويسة اللوحة مع المستودع. */
  date: string;
  onDateChange: (value: string) => void;
  /** اسم المستودع المكتوب في ترويسة المستند. */
  warehouseLabel: string;
}

const stepLabel =
  "flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground";

function Divider() {
  return <div className="h-px bg-border/60" aria-hidden />;
}

export function InvoiceSummaryPanel({
  isRtl,
  customers,
  cashCustomerId,
  customerId,
  onCustomerChange,
  paymentMethod,
  onPaymentMethodChange,
  settlement,
  onSettlementChange,
  paid,
  onPaidChange,
  subtotal,
  total,
  discount,
  onDiscountChange,
  effectivePaid,
  remaining,
  change,
  remainingError,
  lineCount,
  submitting,
  canSubmit,
  onSubmit,
  note,
  onNoteChange,
  date,
  onDateChange,
  warehouseLabel,
}: InvoiceSummaryPanelProps) {
  const selected = customers.find((c) => c.id === customerId);
  const isCash = Boolean(selected?.is_system);
  const others = React.useMemo(
    () => customers.filter((c) => c.id !== cashCustomerId),
    [customers, cashCustomerId],
  );
  const isBalanced = remaining === 0;

  // Alt+1 = سداد كامل، Alt+2 = آجل بالكامل — اليد على الأرقام لا على الفأرة.
  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "1") {
        event.preventDefault();
        onPaidChange(String(total));
      } else if (event.key === "2") {
        event.preventDefault();
        onPaidChange("0");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onPaidChange, total]);

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
      {/* ═══ ترويسة: التاريخ • المستودع • عدد البنود ═══ */}
      <div className="flex items-center gap-2 border-b border-border/70 bg-gradient-to-b from-muted/45 to-transparent px-3 py-2">
        <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          type="date"
          value={date}
          data-form-nav
          onChange={(e) => onDateChange(e.target.value)}
          aria-label={isRtl ? "تاريخ الفاتورة" : "Invoice date"}
          className="w-[7.3rem] shrink-0 rounded-md border border-transparent bg-transparent px-1 py-0.5 font-mono text-[11px] font-semibold text-foreground outline-none transition hover:border-border/70 focus:border-primary/60 focus:bg-surface focus:ring-2 focus:ring-primary/15"
        />
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 border-s border-border/60 ps-2">
          <WarehouseIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-[11px] font-semibold text-foreground">
            {warehouseLabel}
          </span>
        </div>
        <span className="shrink-0 rounded-full border border-border/70 bg-surface px-1.5 py-0.5 font-mono text-[10px] font-bold text-muted-foreground">
          {toSystemDigits(lineCount)}
        </span>
      </div>

      {/* ═══ ① الجهة ═══ */}
      <div className="space-y-1.5 px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className={stepLabel}>
            <span className="grid size-4 place-items-center rounded-full bg-primary/10 font-mono text-[9px] text-primary">
              ١
            </span>
            {isRtl ? "الجهة" : "Party"}
          </span>
          {isCash && (
            <span className="rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">
              {isRtl ? "بيع نقدي" : "Cash"}
            </span>
          )}
        </div>

        <div className="relative">
          <span
            className={cn(
              "pointer-events-none absolute start-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-lg",
              isCash ? "bg-primary/15 text-primary" : "bg-surface-2 text-muted-foreground",
            )}
          >
            {isCash ? <ShoppingBag className="size-3.5" /> : <User className="size-3.5" />}
          </span>
          <select
            value={customerId}
            data-form-nav
            onChange={(e) => onCustomerChange(e.target.value)}
            aria-label={isRtl ? "اختيار العميل" : "Select customer"}
            className="h-9 w-full appearance-none rounded-lg border border-border/80 bg-surface ps-9 pe-7 text-xs font-semibold text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
          >
            {cashCustomerId && (
              <option value={cashCustomerId}>
                {(customers.find((c) => c.id === cashCustomerId)?.name ??
                  (isRtl ? "عميل نقدي" : "Walk-in")) + (isRtl ? " — افتراضي" : " — default")}
              </option>
            )}
            {others.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.phone ? ` — ${c.phone}` : ""}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute end-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        </div>

        {selected && !isCash && Number(selected.balance ?? 0) !== 0 && (
          <p className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{isRtl ? "الرصيد الحالي" : "Current balance"}</span>
            <span className="font-mono font-bold text-amber-700 dark:text-amber-300">
              {toSystemDigits(money(Number(selected.balance ?? 0)))}
            </span>
          </p>
        )}
      </div>

      <Divider />

      {/* ═══ ② طريقة السداد ═══ */}
      <div className="space-y-1.5 px-3 py-2.5">
        <span className={stepLabel}>
          <span className="grid size-4 place-items-center rounded-full bg-primary/10 font-mono text-[9px] text-primary">
            ٢
          </span>
          {isRtl ? "طريقة السداد" : "Payment method"}
        </span>
        {paymentMethod !== "split" && (
          <DynamicPaymentSelector
            context="sales"
            value={paymentMethod}
            onChange={onPaymentMethodChange}
            settlement={settlement}
            onSettlementChange={onSettlementChange}
            includeCredit
          />
        )}
      </div>

      <Divider />

      {/* ═══ ③ المدفوع — بطل اللوحة ═══ */}
      <div className="space-y-1.5 px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className={stepLabel}>
            <span className="grid size-4 place-items-center rounded-full bg-primary/10 font-mono text-[9px] text-primary">
              ٣
            </span>
            {isRtl ? "المدفوع" : "Paid"}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              tabIndex={-1}
              onClick={() => onPaidChange(String(total))}
              title={isRtl ? "سداد كامل — Alt+1" : "Pay in full — Alt+1"}
              className="rounded-md border border-border/70 bg-surface px-1.5 py-0.5 text-[9px] font-bold text-foreground transition hover:border-primary/40 hover:text-primary"
            >
              {isRtl ? "كامل" : "Full"}
            </button>
            <button
              type="button"
              tabIndex={-1}
              onClick={() => onPaidChange("0")}
              title={isRtl ? "آجل بالكامل — Alt+2" : "Full credit — Alt+2"}
              className="rounded-md border border-border/70 bg-surface px-1.5 py-0.5 text-[9px] font-bold text-foreground transition hover:border-amber-500/40 hover:text-amber-600"
            >
              {isRtl ? "آجل" : "Credit"}
            </button>
          </div>
        </div>

        <AmountInput
          value={paid === "" ? null : Number(paid)}
          onValueChange={(v) => onPaidChange(v == null ? "" : String(v))}
          min={0}
          showInWords={false}
          data-form-nav
          className="h-10 rounded-lg border-border/80 bg-surface text-base font-black text-foreground"
          containerClassName="[&_input]:h-10 [&_input]:text-base [&_input]:font-black"
          placeholder={isRtl ? "كامل المبلغ" : "full amount"}
        />

        <div className="grid grid-cols-2 gap-1.5">
          <div
            className={cn(
              "rounded-lg border px-2 py-1",
              remaining > 0
                ? "border-amber-500/30 bg-amber-500/[0.08]"
                : "border-border/60 bg-surface/60",
            )}
          >
            <span className="block text-[9px] font-semibold text-muted-foreground">
              {isRtl ? "المتبقي (آجل)" : "Remaining"}
            </span>
            <span
              className={cn(
                "block font-mono text-xs font-black tabular-nums",
                remaining > 0 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
              )}
            >
              {toSystemDigits(money(remaining))}
            </span>
          </div>
          <div className="rounded-lg border border-border/60 bg-surface/60 px-2 py-1">
            <span className="block text-[9px] font-semibold text-muted-foreground">
              {isRtl ? "الباقي للعميل" : "Change"}
            </span>
            <span
              className={cn(
                "block font-mono text-xs font-black tabular-nums",
                change > 0 ? "text-sky-600 dark:text-sky-400" : "text-muted-foreground",
              )}
            >
              {toSystemDigits(money(change))}
            </span>
          </div>
        </div>

        <label className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-surface/60 px-2 py-1">
          <span className="text-[10px] font-semibold text-muted-foreground">
            {isRtl ? "الخصم" : "Discount"}
          </span>
          <AmountInput
            value={discount === "" ? null : Number(discount)}
            onValueChange={(v) => onDiscountChange(v == null ? "" : String(v))}
            min={0}
            showInWords={false}
            data-form-nav
            className="h-7 w-24 rounded-md border-border/70 bg-surface text-end text-xs"
            containerClassName="[&_input]:h-7"
          />
        </label>

        {remainingError && (
          <p className="flex items-start gap-1.5 rounded-lg border border-rose-500/25 bg-rose-500/[0.08] px-2 py-1 text-[10px] font-medium leading-relaxed text-rose-700 dark:text-rose-300">
            <AlertCircle className="mt-0.5 size-3 shrink-0" />
            {remainingError}
          </p>
        )}
      </div>

      {/* ═══ ملاحظة (مطوية — لا تزاحم القرار) ═══ */}
      <details className="group border-t border-border/60 px-3 py-2">
        <summary className="flex cursor-pointer list-none items-center justify-between text-[10px] font-semibold text-muted-foreground transition hover:text-foreground">
          <span>{isRtl ? "ملاحظة على الفاتورة" : "Invoice note"}</span>
          <ChevronDown className="size-3 transition group-open:rotate-180" />
        </summary>
        <textarea
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          data-form-nav
          rows={2}
          placeholder={
            isRtl ? "اختياري — تُطبع أسفل المستند" : "Optional — printed on the document"
          }
          className="mt-1.5 w-full resize-none rounded-lg border border-border/70 bg-surface px-2 py-1 text-[11px] text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
        />
      </details>

      {/*
       * ═══ بطاقة الإجمالي + الإصدار — مثبّتة أسفل العمود ═══
       *
       * بطاقة واحدة متماسكة بدل ثلاثة أسطر رقمية منفصلة:
       *   • الرقم الكبير = الصافي المستحق (مركز الثقل البصري).
       *   • تحته شريط كامل/آجل/باقٍ بنسبة مئوية — يفهم الوضع بنظرة واحدة.
       *   • ثم زر الإصدار ملاصقًا — الرقم ثم القرار، بلا بحث.
       */}
      <div className="border-t border-border/70 bg-gradient-to-b from-muted/30 to-transparent px-3 pb-2.5 pt-2">
        <div className="relative overflow-hidden rounded-xl border border-primary/25 bg-gradient-to-br from-primary/[0.07] via-card to-card px-3 py-2.5 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span className="block text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                {isRtl ? "صافي الإجمالي" : "Net total"}
              </span>
              <span className="block font-mono text-2xl font-black leading-tight tabular-nums text-foreground">
                {toSystemDigits(money(total))}
              </span>
              <span className="block text-[9px] text-muted-foreground">
                {isRtl
                  ? `${toSystemDigits(lineCount)} بند · المجموع ${toSystemDigits(money(subtotal))}`
                  : `${lineCount} lines · ${money(subtotal)}`}
              </span>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold",
                remaining > 0
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : change > 0
                    ? "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              )}
            >
              {remaining > 0
                ? isRtl
                  ? "آجل"
                  : "Credit"
                : change > 0
                  ? isRtl
                    ? "باقٍ"
                    : "Change"
                  : isRtl
                    ? "مدفوع"
                    : "Paid"}
            </span>
          </div>

          {/* شريط التوزيع: كم من الإجمالي سُدّد وكم بقي آجلًا (نسب مقروءة). */}
          {total > 0 && (
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2"
              role="presentation"
            >
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                style={{ width: `${Math.min(100, Math.max(0, (effectivePaid / total) * 100))}%` }}
              />
            </div>
          )}

          <div className="mt-1.5 flex items-center justify-between text-[10px] font-semibold">
            <span className="text-emerald-600 dark:text-emerald-400">
              {isRtl ? "مدفوع" : "Paid"} {toSystemDigits(money(effectivePaid))}
            </span>
            <span
              className={
                remaining > 0 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"
              }
            >
              {isRtl ? "متبقٍ" : "Due"} {toSystemDigits(money(remaining))}
            </span>
          </div>
        </div>
        <button
          type="button"
          data-form-nav
          onClick={onSubmit}
          disabled={!canSubmit || submitting}
          className={cn(
            "inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none",
            isBalanced
              ? "bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:opacity-95"
              : "bg-foreground text-background shadow-md hover:opacity-95",
          )}
        >
          {submitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          {isRtl ? "إصدار الفاتورة" : "Post invoice"}
          <kbd className="ms-1 hidden rounded border border-current/25 px-1 text-[9px] font-medium opacity-80 sm:inline">
            Ctrl+↵
          </kbd>
        </button>
        <p className="mt-1.5 flex items-center justify-center gap-2 text-[9px] text-muted-foreground">
          <span className="inline-flex items-center gap-0.5">
            <kbd className="rounded border border-border/70 bg-surface px-1">F2</kbd>
            {isRtl ? "بحث" : "find"}
          </span>
          <span className="inline-flex items-center gap-0.5">
            <kbd className="rounded border border-border/70 bg-surface px-1">Alt+1</kbd>
            {isRtl ? "كامل" : "full"}
          </span>
          <span className="inline-flex items-center gap-0.5">
            <kbd className="rounded border border-border/70 bg-surface px-1">Alt+2</kbd>
            {isRtl ? "آجل" : "credit"}
          </span>
        </p>
      </div>
    </div>
  );
}
