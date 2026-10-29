import * as React from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Landmark,
  Loader2,
  ShoppingBag,
  User,
  Wallet,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { money } from "@/lib/format";
import { toSystemDigits } from "@/lib/format-preferences";
import { AmountInput } from "@/components/ui/amount-input";
import { DynamicPaymentSelector } from "@/components/ui/payment-method/dynamic-payment-selector";
import type { PaymentSettlementSelection } from "@/lib/payments/treasury-types";

/**
 * InvoiceSummaryPanel — عمود المستند: الجهة، ثم السداد، ثم الإجماليات والإصدار.
 *
 * ترتيب القراءة هو ترتيب القرار في المستند الرسمي:
 *   إلى من؟ (الجهة) → كيف سُدّد؟ → كم الإجمالي والمتبقي؟ → إصدار.
 * وكل خطوة مرقّمة بعلامة صغيرة، فيعرف المستخدم أين هو فورًا.
 *
 * اختصار السرعة: بعد كل تغيير في المبلغ يُعاد حساب المتبقي، وكل المبالغ
 * المكرّرة (المدفوع، المتبقي، الصافي) تأتي من نفس محرك الدفع المشترك —
 * لا حساب ثانٍ هنا.
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
}

const sectionNumber =
  "grid size-5 shrink-0 place-items-center rounded-full border border-primary/25 bg-primary/10 font-mono text-[10px] font-bold text-primary";

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
  discount,
  onDiscountChange,
  total,
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
}: InvoiceSummaryPanelProps) {
  const selected = customers.find((c) => c.id === customerId);
  const isCash = Boolean(selected?.is_system);
  const others = React.useMemo(
    () => customers.filter((c) => c.id !== cashCustomerId),
    [customers, cashCustomerId],
  );
  const [showAll, setShowAll] = React.useState(false);

  return (
    <div className="flex h-full flex-col gap-4">
      {/* ① الجهة */}
      <section className="rounded-2xl border border-border/80 bg-card p-4">
        <header className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <span className={sectionNumber}>١</span>
            {isRtl ? "الجهة" : "Party"}
          </h3>
          {isCash && (
            <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
              {isRtl ? "بيع نقدي" : "Cash sale"}
            </span>
          )}
        </header>

        <div
          className={cn(
            "flex items-center gap-2.5 rounded-xl border px-3 py-2.5",
            isCash ? "border-primary/30 bg-primary/[0.06]" : "border-border/70 bg-surface",
          )}
        >
          <span
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-xl",
              isCash ? "bg-primary/15 text-primary" : "bg-surface-2 text-muted-foreground",
            )}
          >
            {isCash ? <ShoppingBag className="size-4" /> : <User className="size-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-foreground">
              {selected?.name ?? (isRtl ? "لم يُختر عميل" : "No party selected")}
            </p>
            <p className="truncate text-[10px] text-muted-foreground">
              {isCash
                ? isRtl
                  ? "الجهة الافتراضية للبيع الفوري — لا تحمل أرصدة آجلة"
                  : "Default walk-in party — cannot carry a balance"
                : selected?.phone
                  ? toSystemDigits(selected.phone)
                  : isRtl
                    ? "عميل مسجّل"
                    : "Registered customer"}
            </p>
          </div>
          {!isCash && selected && Number(selected.balance ?? 0) !== 0 && (
            <span className="shrink-0 rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-700 dark:text-amber-300">
              {toSystemDigits(money(Number(selected.balance ?? 0)))}
            </span>
          )}
        </div>

        <div className="mt-2 space-y-1.5">
          <label className="block text-[10px] font-semibold text-muted-foreground">
            {isRtl ? "تغيير الجهة" : "Change party"}
          </label>
          <div className="relative">
            <select
              value={customerId}
              data-form-nav
              onChange={(e) => onCustomerChange(e.target.value)}
              aria-label={isRtl ? "اختيار العميل" : "Select customer"}
              className="h-10 w-full appearance-none rounded-xl border border-border/80 bg-surface px-3 pe-8 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
            >
              {cashCustomerId && (
                <option value={cashCustomerId}>
                  {(customers.find((c) => c.id === cashCustomerId)?.name ??
                    (isRtl ? "عميل نقدي" : "Walk-in")) + (isRtl ? " — افتراضي" : " — default")}
                </option>
              )}
              {!showAll && others.length > 0 && (
                <option value="" disabled>
                  {isRtl ? `— ${others.length} عميل مسجّل —` : `— ${others.length} customers —`}
                </option>
              )}
              {others.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.phone ? ` — ${c.phone}` : ""}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
      </section>

      {/* ② السداد */}
      <section className="rounded-2xl border border-border/80 bg-card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          <span className={sectionNumber}>٢</span>
          {isRtl ? "السداد" : "Payment"}
        </h3>

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

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="block text-[10px] font-semibold text-muted-foreground">
              {isRtl ? "المبلغ المدفوع" : "Amount paid"}
            </span>
            <AmountInput
              value={paid === "" ? null : Number(paid)}
              onValueChange={(v) => onPaidChange(v == null ? "" : String(v))}
              min={0}
              showInWords={false}
              data-form-nav
              className="h-9 rounded-lg border-border/70 bg-surface text-sm font-bold"
              containerClassName="[&_input]:h-9"
              placeholder={isRtl ? "كامل" : "full"}
            />
          </label>
          <label className="space-y-1">
            <span className="block text-[10px] font-semibold text-muted-foreground">
              {isRtl ? "الخصم" : "Discount"}
            </span>
            <AmountInput
              value={discount === "" ? null : Number(discount)}
              onValueChange={(v) => onDiscountChange(v == null ? "" : String(v))}
              min={0}
              showInWords={false}
              data-form-nav
              className="h-9 rounded-lg border-border/70 bg-surface text-sm"
              containerClassName="[&_input]:h-9"
            />
          </label>
        </div>

        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onPaidChange(String(total))}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border/70 bg-surface px-2 text-[10px] font-semibold text-foreground transition hover:border-primary/40 hover:text-primary"
          >
            <Wallet className="size-3" />
            {isRtl ? "سداد كامل" : "Pay in full"}
          </button>
          <button
            type="button"
            onClick={() => onPaidChange("0")}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border/70 bg-surface px-2 text-[10px] font-semibold text-foreground transition hover:border-amber-500/40 hover:text-amber-600"
          >
            <Landmark className="size-3" />
            {isRtl ? "آجل بالكامل" : "Full credit"}
          </button>
        </div>

        {Number(change) > 0 && (
          <p className="mt-2 rounded-lg border border-sky-500/25 bg-sky-500/10 px-2 py-1 text-[11px] font-semibold text-sky-700 dark:text-sky-300">
            {isRtl ? "الباقي للعميل" : "Change due"}: {toSystemDigits(money(Number(change)))}
          </p>
        )}
        {remainingError && (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-rose-500/25 bg-rose-500/10 px-2 py-1 text-[11px] font-medium text-rose-700 dark:text-rose-300">
            <AlertCircle className="mt-0.5 size-3 shrink-0" />
            {remainingError}
          </p>
        )}
      </section>

      {/* ③ الإجماليات */}
      <section className="rounded-2xl border border-border/80 bg-card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          <span className={sectionNumber}>٣</span>
          {isRtl ? "الإجماليات" : "Totals"}
        </h3>

        <dl className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">
              {isRtl
                ? `المجموع الفرعي (${toSystemDigits(lineCount)} بند)`
                : `Subtotal (${lineCount})`}
            </dt>
            <dd className="font-mono tabular-nums text-foreground">
              {toSystemDigits(money(subtotal))}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">{isRtl ? "الخصم" : "Discount"}</dt>
            <dd className="font-mono tabular-nums text-foreground">
              {Number(discount) > 0 ? `− ${toSystemDigits(money(Number(discount)))}` : "—"}
            </dd>
          </div>
          <div className="mt-1 flex items-baseline justify-between border-t border-border/70 pt-2">
            <dt className="text-sm font-bold text-foreground">{isRtl ? "الإجمالي" : "Total"}</dt>
            <dd className="font-mono text-lg font-black tabular-nums text-foreground">
              {toSystemDigits(money(total))}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">{isRtl ? "المدفوع" : "Paid"}</dt>
            <dd className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {toSystemDigits(money(effectivePaid))}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">{isRtl ? "المتبقي (آجل)" : "Remaining"}</dt>
            <dd
              className={cn(
                "font-mono font-bold tabular-nums",
                remaining > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
              )}
            >
              {toSystemDigits(money(remaining))}
            </dd>
          </div>
        </dl>

        <label className="mt-3 block space-y-1">
          <span className="block text-[10px] font-semibold text-muted-foreground">
            {isRtl ? "ملاحظة على الفاتورة" : "Invoice note"}
          </span>
          <textarea
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            data-form-nav
            rows={2}
            placeholder={
              isRtl ? "اختياري — تُطبع أسفل المستند" : "Optional — printed on the document"
            }
            className="w-full resize-none rounded-lg border border-border/70 bg-surface px-2.5 py-1.5 text-xs text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
          />
        </label>
      </section>

      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit || submitting}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-95 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
      >
        {submitting ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <CheckCircle2 className="size-4" />
        )}
        {isRtl ? "إصدار الفاتورة" : "Post invoice"}
        <kbd className="ml-1 hidden rounded border border-primary-foreground/30 bg-primary-foreground/10 px-1.5 text-[10px] font-medium sm:inline">
          Ctrl+Enter
        </kbd>
      </button>
      <p className="-mt-2 text-center text-[10px] leading-relaxed text-muted-foreground">
        {isRtl
          ? "F2 بحث الأصناف · Enter إضافة · Alt+↑↓ ترتيب البنود · Ctrl+Enter إصدار"
          : "F2 items · Enter add · Alt+↑↓ reorder · Ctrl+Enter post"}
      </p>
    </div>
  );
}
