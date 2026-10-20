/**
* PaymentPanel — المكوّن الموحّد الوحيد لمنطق الدفع (طريقة الدفع + المدفوع + المتبقي).
*
* ════════════════════════════════════════════════════════════════════════════
* WHY THIS FILE EXISTS (P1-4 في تقرير التسليم)
* ════════════════════════════════════════════════════════════════════════════
* Before this component, each screen rebuilt the same payment rules in its own
* words:
*
*   POS            `_app.pos.tsx`          smart cash<->credit switching, split,
*                                          change, overpaid guard
*   Sales invoice  `_app.sales-invoice.tsx` `paid` clamped by `total`, credit
*                                          zeroes it, remaining recomputed
*   Milling intake `_app.milling.intake.tsx` `isCredit`, `remainingDue`,
*                                          overpaid warning
*
* Three implementations of one rule is how the same sale comes out different on
* two screens — and that is precisely the kind of drift the delivery audit
* flagged. The rules now live here, ONCE, and every screen renders this panel
* and reads the state it returns.
*
* WHAT IS AND IS NOT IN HERE
* --------------------------
* In:  the method picker (the shared `PaymentMethodPicker` + catalogue), the
*      paid field, the remaining line, the cash-change line, the overpaid
*      error, the "pay in full" / "full credit" helpers, the rule that a debt
*      needs a real (non-system) customer, and the credit-limit hint.
* Out: the submit button, the receipt, the RPC. Those differ per screen on
*      purpose and belong to the screen.
*
* THE RULES THE PANEL ENFORCES (one place, all screens)
* -----------------------------------------------------
*  1. A credit-term method collects nothing now: `paid` is forced to 0.
*  2. `paid` is never negative and never above the total, except cash, where a
*     larger tender is CHANGE — displayed, and clamped to the total on release.
*  3. Any remaining amount is debt, and debt needs a customer that can carry
*     it. The system cash customer cannot, so the panel blocks it by name.
*  4. The credit limit is shown when the customer's balance would exceed it.
*  5. A customer change cannot leave the panel on a method the customer is
*     not allowed to use (see `usePaymentPanel`).
*
* The panel is CONTROLLED: state lives in the screen so its submit path keeps
* working exactly as before. `usePaymentPanel` is the single implementation of
* the arithmetic, usable by a screen that renders its own layout.
*/

import { useEffect, useMemo, useRef } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { money } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { getPaymentMethodDefinition, type PaymentContext } from "@/lib/payments/payment-methods";
import {
  resolvePayment,
  roundMoney,
  type PaymentCustomer,
  type PaymentResolution,
} from "@/lib/payments/payment-rules";
import { PaymentMethodPicker } from "@/components/ui/payment-method";

export { roundMoney };
export type { PaymentCustomer };

export interface PaymentPanelState {
  method: string;
  /** What the operator typed. Empty means "not decided yet". */
  paidRaw: string;
  customerId: string | null | undefined;
}

export interface PaymentPanelInput {
  total: number;
  state: PaymentPanelState;
  customers?: PaymentCustomer[];
}

export interface PaymentPanelResult extends Omit<PaymentResolution, "blockingReason"> {
  /** Kept under the panel's old name so existing screens read unchanged. */
  isPayable: boolean;
  /** The sentence to show, translated, for the blocking reason. */
  blockingReason: string | null;
}

/**
 * The payment arithmetic — the ONE implementation.
 *
 * The rules themselves live in `@/lib/payments/payment-rules` (no React, no
 * DOM, unit-tested). This wrapper only adds the translated sentence a screen
 * shows when the payment cannot be posted.
 */
export function usePaymentPanel({ total, state, customers }: PaymentPanelInput): PaymentPanelResult {
  const { t, lang } = useI18n();
  const isRtl = lang === "ar";

  return useMemo(() => {
    const rules = resolvePayment({
      total,
      method: state.method,
      paidRaw: state.paidRaw,
      customerId: state.customerId,
      customers,
    });

    let blockingReason: string | null = null;
    switch (rules.blockingReason) {
      case "overpaid":
        blockingReason = t("common.overpaid");
        break;
      case "customer_required_for_credit":
        blockingReason = t("common.customer_required_for_credit");
        break;
      case "credit_customer_locked":
        blockingReason = t("common.credit_customer_locked");
        break;
      case "credit_limit":
        blockingReason = isRtl
          ? `تجاوز حد الائتمان: الرصيد الحالي ${money(Number(rules.customer?.balance ?? 0))}، حد العميل ${money(Number(rules.creditLimit ?? 0))}`
          : `Credit limit exceeded: balance ${money(Number(rules.customer?.balance ?? 0))}, limit ${money(Number(rules.creditLimit ?? 0))}`;
        break;
      default:
        blockingReason = null;
    }

    return { ...rules, isPayable: rules.payable, blockingReason };
  }, [total, state, customers, t, isRtl]);
}

/**
 * Keep the method honest when the amount or the customer changes.
 *
 * Two situations where leaving the operator's choice alone would write a
 * document that contradicts itself:
 *
 *   • `paid` covers the total while the method is still آجل — an invoice
 *     recorded as credit that collected every fils is not credit.
 *   • nothing was collected and the method is not آجل — an invoice recorded as
 *     cash that collected nothing is a debt nobody owns.
 *
 * It never touches the total-0 case (an empty cart has no payment decision to
 * make), and it never overrides a method the panel itself just set.
 */
export function usePaymentMethodReconcile({
  result,
  method,
  onMethodChange,
  enabled = true,
}: {
  result: PaymentPanelResult;
  method: string;
  onMethodChange: (method: string) => void;
  /** `false` leaves the operator's choice completely alone. */
  enabled?: boolean;
}) {
  const lastTarget = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (result.total <= 0) return;
    let target: string | null = null;

    if (result.isCredit && result.paid >= result.total) target = "cash";
    else if (!result.isCredit && result.paid <= 0 && result.definition) target = "credit";

    if (!target || target === method) {
      lastTarget.current = null;
      return;
    }
    // Guards a loop if the tenant disabled the target method: only switch when
    // the catalogue actually offers it for this context.
    if (lastTarget.current === target) return;
    lastTarget.current = target;
    onMethodChange(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the target is a pure
    // function of paid/total/method; `onMethodChange` is a screen callback that
    // is recreated every render and must not retrigger the reconciliation.
  }, [enabled, result.isCredit, result.paid, result.total, method]);
}

export interface PaymentPanelProps {
  /** Which section is asking — decides what the business allows here. */
  context: PaymentContext;
  /** Invoice amount to be settled. */
  total: number;
  method: string;
  onMethodChange: (methodId: string) => void;
  paid: string;
  onPaidChange: (value: string) => void;
  /** The customer the remaining amount would be booked to. */
  customerId: string | null | undefined;
  /** The resolved customer list, for the debt/limit checks. */
  customers?: PaymentCustomer[];
  /** Currency label printed next to amounts. */
  currency?: string;
  /** Show the "pay in full" / "full credit" helper buttons. */
  showShortcuts?: boolean;
  /**
   * Switch to آجل when nothing has been paid. On for POS and milling (a
   * counter sale), off for the invoice form which lets the operator decide.
   */
  autoMethod?: boolean;
  disabled?: boolean;
  className?: string;
  /** Called with the reference text when the method needs one. */
  reference?: string;
  onReferenceChange?: (value: string) => void;
}

/**
 * The shared payment block. Screens place it where their layout expects it and
 * read the same numbers from `usePaymentPanel` for their summary/receipt.
 */
export function PaymentPanel(props: PaymentPanelProps) {
  const {
    context,
    total,
    method,
    onMethodChange,
    paid,
    onPaidChange,
    customerId,
    customers,
    currency,
    showShortcuts = true,
    autoMethod = false,
    disabled = false,
    className,
    reference,
    onReferenceChange,
  } = props;

  const { t, lang } = useI18n();
  const isRtl = lang === "ar";

  const result = usePaymentPanel({
    total,
    state: { method, paidRaw: paid, customerId },
    customers,
  });

  // The screen may opt into the automatic cash<->credit reconciliation.
  usePaymentMethodReconcile({ result, method, onMethodChange, enabled: autoMethod });

  const fmt = (n: number) =>
    currency ? `${money(n)} ${currency}` : money(n);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-semibold text-muted-foreground">
            {t("common.payment_method")}
          </label>
          {showShortcuts && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPaidChange(String(result.total))}
                className="rounded-lg bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-300"
              >
                {t("common.pay_full")}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  onMethodChange("credit");
                  onPaidChange("0");
                }}
                className="rounded-lg bg-violet-500/10 px-2 py-0.5 text-[11px] font-bold text-violet-700 hover:bg-violet-500/20 disabled:opacity-50 dark:text-violet-300"
              >
                {t("common.pay_credit")}
              </button>
            </div>
          )}
        </div>

        <PaymentMethodPicker
          context={context}
          value={method}
          onChange={(next) => {
            onMethodChange(next);
            // Choosing a credit term means collecting nothing now — stated
            // once here instead of three screens each remembering to do it.
            if (getPaymentMethodDefinition(next)?.isCreditTerm) onPaidChange("0");
          }}
          ensureIds={[method]}
          disabled={disabled}
          ariaLabel={t("common.payment_method")}
          data-form-nav
        />

        {result.needsReference && onReferenceChange && (
          <input
            value={reference ?? ""}
            onChange={(e) => onReferenceChange(e.target.value)}
            disabled={disabled}
            data-form-nav
            placeholder={t("common.payment_reference")}
            className="h-10 w-full rounded-xl border border-border/80 bg-surface px-3 text-xs font-semibold text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-muted-foreground">
            {t("common.paid")}
          </label>
          <div className="relative">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              dir="ltr"
              disabled={disabled || result.isCredit}
              value={result.isCredit ? "" : paid}
              onChange={(e) => onPaidChange(e.target.value)}
              data-form-nav
              placeholder={result.isCredit ? "0.00" : fmt(result.total)}
              className={cn(
                "h-10 w-full rounded-xl border bg-surface px-3 pe-12 font-mono text-sm font-bold outline-none transition",
                "focus:border-primary focus:ring-2 focus:ring-primary/20",
                "disabled:cursor-not-allowed disabled:opacity-60",
                result.isOverpaid ? "border-destructive text-destructive" : "border-border/80",
              )}
            />
            <span className="pointer-events-none absolute end-2.5 top-3 text-[11px] text-muted-foreground">
              {currency}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {result.isCredit
              ? isRtl
                ? "معطّل لأن الطريقة آجلة"
                : "Disabled because the method is credit"
              : isRtl
                ? "المبلغ المستلم فعلياً من العميل"
                : "Amount actually collected"}
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-muted-foreground">
            {t("common.remaining")}
          </label>
          <div className="flex h-10 w-full items-center justify-between rounded-xl border border-border/80 bg-surface-2/70 px-3">
            <span className="text-xs text-muted-foreground">
              {result.remaining > 0 ? (isRtl ? "ذمة:" : "Debt:") : isRtl ? "مسدد" : "Settled"}
            </span>
            <span
              className={cn(
                "font-mono text-sm font-black tabular-nums",
                result.remaining > 0
                  ? "text-rose-600 dark:text-rose-400"
                  : "text-emerald-600 dark:text-emerald-400",
              )}
            >
              {fmt(result.remaining)}
            </span>
          </div>
          {result.change > 0 && (
            <p className="text-[11px] font-semibold text-sky-600 dark:text-sky-400">
              {t("common.change")}: {fmt(result.change)}
            </p>
          )}
          {result.booksAsDebt && (
            <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
              {isRtl ? "ستُرحَّل كذمة على: " : "Will be booked as debt to: "}
              <strong>{result.customer?.name}</strong>
            </p>
          )}
        </div>
      </div>

      {result.exceedsCreditLimit && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{result.blockingReason}</span>
        </div>
      )}

      {result.isOverpaid && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-[11px] font-bold text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t("common.overpaid")} ({fmt(result.total)})
          </span>
        </div>
      )}

      {(result.debtWithoutCustomer || result.debtOnSystemCustomer) && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{result.blockingReason}</span>
        </div>
      )}

      {result.isPayable && result.remaining === 0 && result.total > 0 && (
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {isRtl ? "الفاتورة مسددة بالكامل" : "Invoice fully settled"}
        </div>
      )}
    </div>
  );
}
