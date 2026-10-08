/**
 * PaymentMethodPicker — المكوّن الموحّد الوحيد لاختيار طريقة الدفع.
 *
 * WHY ONE COMPONENT
 * -----------------
 * Eight screens each invented their own way to ask "how is this being paid?":
 * a <select> in POS and purchase-POS, four buttons in purchases, a Radix Select
 * in the returns dialogs, another <select> in the collection sheet and the
 * expense form. They offered different options, used different labels for the
 * same method, and none of them respected anything the business had configured
 * because nothing was configurable.
 *
 * This is now the only way to choose a payment method.
 *
 * DESIGN PROVENANCE
 * -----------------
 * The visual language is the POS switcher's, not a new one: the same rounded
 * card, the same selected border-and-tint treatment, the same compact type.
 * POS is the screen cashiers use hundreds of times a day, so the change there
 * must be "the same control, now driven by settings", not a new experience.
 *
 * SIZE
 * ----
 * Chips are deliberately small (36px tall) and wrap. A business with eleven
 * enabled methods gets two tidy rows, not a page-height list. In `select` mode
 * a native control is used instead, for narrow columns where a wrapping grid
 * would push the total off-screen.
 */

import { useMemo } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { paymentMethodLabel, type PaymentContext } from "@/lib/payments/payment-methods";
import { usePaymentMethodsForContext } from "@/hooks/use-payment-methods";
import { PaymentMethodIcon } from "./payment-method-icon";

export type PaymentMethodPickerVariant = "chips" | "select";

export interface PaymentMethodPickerProps {
  /** Which section is asking. Decides what the business has allowed here. */
  context: PaymentContext;
  /** Selected catalogue id, or "" / null when nothing is chosen yet. */
  value: string | null;
  onChange: (methodId: string) => void;
  /** Show آجل among the options. On by default; off where credit is meaningless. */
  includeCredit?: boolean;
  variant?: PaymentMethodPickerVariant;
  disabled?: boolean;
  /** Extra catalogue ids to allow even if the context would exclude them (e.g. the method already on a document). */
  ensureIds?: string[];
  /** Compact mode drops the label under the chip — for dense toolbar rows. */
  dense?: boolean;
  className?: string;
  /** Accessible name for the group / select. */
  ariaLabel?: string;
  /** Select-variant placeholder when `value` is empty. */
  placeholder?: string;
  lang?: "ar" | "en";
}

export function PaymentMethodPicker({
  context,
  value,
  onChange,
  includeCredit = true,
  variant = "chips",
  disabled = false,
  ensureIds,
  dense = false,
  className,
  ariaLabel,
  placeholder,
  lang = "ar",
}: PaymentMethodPickerProps) {
  const { methods, isLoading, isFallback } = usePaymentMethodsForContext(context, {
    includeCredit,
  });

  /**
   * A method already recorded on the document being edited may legitimately sit
   * outside the currently allowed contexts — the business changed its mind after
   * the invoice existed. Dropping it would silently rewrite the document, so it
   * is appended rather than filtered away.
   */
  const options = useMemo(() => {
    if (!ensureIds || ensureIds.length === 0) return methods;
    const present = new Set(methods.map((m) => m.id));
    const missing = ensureIds.filter((id) => id && !present.has(id));
    if (missing.length === 0) return methods;
    // Resolve the missing ids from the full catalogue via the same hook's data.
    const resolved: typeof methods = [];
    for (const id of missing) {
      const found = methods.find((m) => m.id === id);
      if (found) resolved.push(found);
    }
    return resolved.length ? [...methods, ...resolved] : methods;
  }, [methods, ensureIds]);

  const label = (id: string, nameAr: string, nameEn?: string) =>
    lang === "ar" ? nameAr : (nameEn ?? nameAr);

  if (variant === "select") {
    return (
      <select
        aria-label={ariaLabel}
        disabled={disabled || isLoading}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "h-9 w-full min-w-0 rounded-[12px] border border-input bg-surface/70 px-3 text-sm text-foreground",
          "focus:border-primary/60 focus:outline-none focus:ring-4 focus:ring-primary/10",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        {!value && (
          <option value="" disabled>
            {placeholder ?? (lang === "ar" ? "اختر طريقة الدفع" : "Select payment method")}
          </option>
        )}
        {options.map((method) => (
          <option key={method.id} value={method.id}>
            {label(method.id, method.nameAr, method.nameEn)}
          </option>
        ))}
      </select>
    );
  }

  // Before the catalogue resolves, the picker renders the shipped defaults via
  // the hook's fallback, so the cashier is never shown an empty row.
  if (options.length === 0) {
    return (
      <p
        className={cn("text-[11px] text-muted-foreground", className)}
        role="status"
        aria-live="polite"
      >
        {isFallback
          ? lang === "ar"
            ? "تعذّر تحميل طرق الدفع."
            : "Payment methods could not be loaded."
          : lang === "ar"
            ? "لا توجد طرق دفع مفعّلة لهذا القسم. فعّلها من الإعدادات ← طرق الدفع."
            : "No payment methods are enabled for this section. Enable them in Settings → Payment methods."}
      </p>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel ?? (lang === "ar" ? "طريقة الدفع" : "Payment method")}
      aria-busy={isLoading || undefined}
      className={cn("flex flex-wrap gap-1.5", className)}
    >
      {options.map((method) => {
        const selected = value === method.id;
        return (
          <button
            key={method.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(method.id)}
            title={paymentMethodLabel(method.id, lang)}
            className={cn(
              "group relative inline-flex items-center gap-1.5 rounded-xl border transition-all",
              dense ? "h-8 px-2.5 text-[11px]" : "h-9 px-3 text-xs",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              "disabled:cursor-not-allowed disabled:opacity-50",
              selected
                ? "border-primary bg-primary/10 text-foreground shadow-[inset_0_0_0_1px_var(--color-primary)]"
                : "border-border/80 bg-surface/70 text-muted-foreground hover:border-primary/40 hover:bg-surface-2 hover:text-foreground",
            )}
          >
            <PaymentMethodIcon
              iconKey={method.iconKey}
              ledgerKind={method.ledgerKind}
              tone={selected}
              className={dense ? "h-3.5 w-3.5" : "h-4 w-4"}
            />
            <span className="whitespace-nowrap font-semibold">
              {label(method.id, method.nameAr, method.nameEn)}
            </span>
            {selected && (
              <Check
                aria-hidden="true"
                className={cn("shrink-0", dense ? "h-3 w-3" : "h-3.5 w-3.5")}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Read-only rendering of a method on a stored document.
 *
 * Separate from the picker on purpose: a table cell has no state and no
 * context, and calling a picker there would make a list row look interactive.
 */
export function PaymentMethodChip({
  value,
  note,
  lang = "ar",
  className,
}: {
  value: string | null | undefined;
  note?: string | null;
  lang?: "ar" | "en";
  className?: string;
}) {
  const { methods } = usePaymentMethodsForContext(
    // Any context: this is a label, not an offer, so the widest list applies.
    "sales",
    { includeCredit: true },
  );

  const isSplit = value === "split" || Boolean(note?.includes("[دفع مجزأ:"));
  const method = methods.find((m) => m.id === value || m.legacyValue === value);

  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", className)}>
      <PaymentMethodIcon
        iconKey={isSplit ? "split" : (method?.iconKey ?? "generic")}
        ledgerKind={isSplit ? "OTHER" : method?.ledgerKind}
        className="h-3.5 w-3.5"
      />
      <span className="font-medium">{paymentMethodLabel(isSplit ? "split" : value, lang)}</span>
    </span>
  );
}

