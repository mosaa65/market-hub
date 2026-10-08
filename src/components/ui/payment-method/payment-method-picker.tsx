/**
 * PaymentMethodPicker — المكوّن الموحّد الوحيد لاختيار طريقة الدفع.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * DESIGN: THIS IS THE POS CONTROL, COPIED EXACTLY
 * ════════════════════════════════════════════════════════════════════════════
 * This is a native `<select>` with the identical class recipe used by the POS
 * payment switcher on main — not a re-interpretation of it:
 *
 *   height        h-10
 *   radius        rounded-xl
 *   border        border-border/80
 *   surface       bg-surface
 *   typography    text-xs font-semibold text-foreground
 *   chevron       ChevronDown, absolute end-3, h-4 w-4, text-muted-foreground
 *   focus         focus:border-primary focus:ring-2 focus:ring-primary/20
 *
 * Why a native select and not custom cards: it is what the till already uses, it
 * is keyboard- and touch-correct for free, it opens the OS picker on a phone,
 * and it stays one compact row no matter how many Yemeni methods a business
 * enables. A grid of cards would grow the checkout panel with every method
 * added — the opposite of what a cashier wants under time pressure.
 *
 * The icon is rendered as a static adornment at the START of the field, so a
 * method is recognisable by shape as well as by name. It is decorative: the
 * select's own option text is the accessible label.
 *
 * OPTION LABELS
 * -------------
 * They come from the same `pos.pm.*` keys the till already shipped, so "نقدي"
 * and "بطاقة" keep meaning exactly what they meant yesterday. A named Yemeni
 * institution (بنك الكريمي، جيب، فلوسك، ون كاش) has no such key, so it uses its
 * catalogue Arabic name — which is what makes it worth offering in the first
 * place. Its stored value is still a plain ENUM value, resolved by
 * `toLegacyPaymentValue` at the call site.
 *
 * WHAT IT READS
 * -------------
 * `usePaymentMethodsForContext(context)` returns only the methods this business
 * enabled for this section, in the business's own order. A disabled method is
 * never offered, and one section's choices never leak into another's.
 */

import { useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import {
  getPaymentMethodDefinition,
  paymentMethodLabel,
  type PaymentContext,
} from "@/lib/payments/payment-methods";
import { usePaymentMethodsForContext } from "@/hooks/use-payment-methods";
import { PaymentMethodIcon } from "./payment-method-icon";

export interface PaymentMethodPickerProps {
  /** Which section is asking. Decides what the business has allowed here. */
  context: PaymentContext;
  /** Selected catalogue id, or "" / null when nothing is chosen yet. */
  value: string | null;
  onChange: (methodId: string) => void;
  /** Show آجل among the options. On by default; off where credit is meaningless. */
  includeCredit?: boolean;
  disabled?: boolean;
  /**
   * Extra catalogue ids to keep selectable even if this context would exclude
   * them — for a method already recorded on the document being edited, so
   * changing the settings cannot silently rewrite history.
   */
  ensureIds?: string[];
  className?: string;
  /** Accessible name for the select. */
  ariaLabel?: string;
  /** Placeholder shown when `value` is empty. */
  placeholder?: string;
}

export function PaymentMethodPicker({
  context,
  value,
  onChange,
  includeCredit = true,
  disabled = false,
  ensureIds,
  className,
  ariaLabel,
  placeholder,
}: PaymentMethodPickerProps) {
  const { t, lang } = useI18n();
  const isRtl = lang === "ar";

  const { methods, isLoading } = usePaymentMethodsForContext(context, {
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
    const extra = ensureIds.filter(
      (id) => id && !present.has(id) && getPaymentMethodDefinition(id),
    );
    if (extra.length === 0) return methods;
    return [
      ...methods,
      ...extra
        .map((id) => methods.find((m) => m.id === id))
        .filter((m): m is (typeof methods)[number] => Boolean(m)),
    ];
  }, [methods, ensureIds]);

  /**
   * The label for a method, preferring the key POS already shipped.
   *
   * A named institution must NOT borrow the generic key: labelling بنك الكريمي
   * as "تحويل بنكي" would hide the very choice the operator made.
   */
  const labelFor = (id: string): string => {
    const definition = getPaymentMethodDefinition(id);
    const legacy = definition?.legacyValue;
    const isNamedInstitution =
      Boolean(definition) && definition?.nameAr !== paymentMethodLabel(legacy, "ar");
    if (legacy && !isNamedInstitution) return t(`pos.pm.${legacy}`);
    return isRtl ? (definition?.nameAr ?? id) : (definition?.nameEn ?? id);
  };

  /** The icon of the currently selected method, shown as the field adornment. */
  const selectedDefinition = value ? getPaymentMethodDefinition(value) : undefined;

  return (
    <div className={cn("relative min-w-0", className)}>
      {/* Adornment: the shape of the chosen method, so it reads at a glance. */}
      {selectedDefinition && (
        <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2">
          <PaymentMethodIcon
            iconKey={selectedDefinition.iconKey}
            ledgerKind={selectedDefinition.ledgerKind}
            className="h-4 w-4"
          />
        </span>
      )}

      <select
        aria-label={ariaLabel ?? (isRtl ? "طريقة الدفع" : "Payment method")}
        disabled={disabled || isLoading}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          // The POS select recipe, unchanged — including the appearance-none
          // reset and the absolute chevron that replace the native arrow.
          "h-10 w-full appearance-none rounded-xl border border-border/80 bg-surface",
          "ps-9 pe-9 text-xs font-semibold text-foreground",
          "outline-none transition",
          "focus:border-primary focus:ring-2 focus:ring-primary/20",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {!value && (
          <option value="" disabled>
            {placeholder ?? (isRtl ? "طريقة الدفع" : "Payment method")}
          </option>
        )}
        {options.map((method) => (
          <option key={method.id} value={method.id}>
            {labelFor(method.id)}
          </option>
        ))}
      </select>

      <ChevronDown className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
