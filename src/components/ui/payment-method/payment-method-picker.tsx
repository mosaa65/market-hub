/**
 * PaymentMethodPicker — المكوّن الموحّد الوحيد لاختيار طريقة الدفع.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * DESIGN: THIS IS THE POS CONTROL, COPIED EXACTLY
 * ════════════════════════════════════════════════════════════════════════════
 * This uses the shared Radix Select used by the filter controls, with a compact
 * trigger recipe aligned to the POS payment switcher:
 *
 *   height        h-10
 *   radius        rounded-xl
 *   border        border-border/80
 *   surface       bg-surface
 *   typography    text-xs font-semibold text-foreground
 *   chevron       shared SelectTrigger chevron
 *   focus         focus:border-primary focus:ring-2 focus:ring-primary/20
 *
 * A single dropdown stays compact as a business enables more methods. The same
 * catalogue-backed logo and label appear in the trigger and each option.
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
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import {
  getPaymentMethodDefinition,
  getShippedPaymentMethod,
  isSplitPaymentValue,
  paymentMethodLabel,
  toCatalogId,
  type PaymentContext,
} from "@/lib/payments/payment-methods";
import {
  usePaymentMethods,
  usePaymentMethodsForContext,
  type ResolvedPaymentMethod,
} from "@/hooks/use-payment-methods";
import { PaymentMethodIcon } from "./payment-method-icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Resolve one `ensureIds` entry to a method, accepting EITHER a catalogue id or
 * a residual ENUM value.
 *
 * A historic sales return stored `mobile_money`, not `jawali`; a document
 * edited today must still show its method. The catalogue id is tried first, and
 * a stored value then resolves through the same index the read-only chip uses.
 * An entry that resolves to nothing — a value this build does not know — is
 * dropped rather than shown as a blank option.
 */
function resolveEnsureId(
  id: string | null | undefined,
  methods: ResolvedPaymentMethod[],
): ResolvedPaymentMethod | undefined {
  if (!id) return undefined;
  const byId = methods.find((method) => method.id === id);
  if (byId) return byId;
  const catalogId = toCatalogId(id);
  return catalogId ? methods.find((method) => method.id === catalogId) : undefined;
}

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
   *
   * A residual ENUM value (an old invoice that stored `mobile_money`) also
   * works: it is resolved to its canonical catalogue id and shown under that
   * id, so a historic document stays editable instead of losing its method.
   */
  ensureIds?: (string | null | undefined)[];
  /** Restrict options to values accepted by the current screen's write contract. */
  allowedLegacyValues?: readonly string[];
  className?: string;
  /** Accessible name for the select. */
  ariaLabel?: string;
  /** Placeholder shown when `value` is empty. */
  placeholder?: string;
  /**
   * Include the select in the screen's keyboard field order
   * (`data-form-nav`, see `src/lib/keyboard/form-navigation.ts`). On by
   * default: a payment method is a field like any other, and a counter that
   * works without a mouse must be able to land on it.
   */
  "data-form-nav"?: boolean;
}

export function PaymentMethodPicker({
  context,
  value,
  onChange,
  includeCredit = true,
  disabled = false,
  ensureIds,
  allowedLegacyValues,
  className,
  ariaLabel,
  placeholder,
  "data-form-nav": formNav = true,
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
    // EVERY method the catalogue returned for this context — a business-created
    // one included. Filtering against a shipped-id list here is what previously
    // hid tenant methods and `card`/`cheque` from every picker.
    if (!ensureIds || ensureIds.length === 0) return methods;

    const present = new Set(methods.map((method) => method.id));
    const extra = ensureIds
      .map((id) => resolveEnsureId(id, methods))
      .filter((method): method is ResolvedPaymentMethod => Boolean(method))
      .filter(
        (method, index, all) =>
          // Deduplicate: two residual ENUM values may resolve to one method.
          !present.has(method.id) && all.findIndex((m) => m.id === method.id) === index,
      );

    return extra.length === 0 ? methods : [...methods, ...extra];
  }, [methods, ensureIds]);

  const selectableOptions = useMemo(() => {
    if (!allowedLegacyValues) return options;
    return options.filter(
      (method) => method.id === value || allowedLegacyValues.includes(method.legacyValue),
    );
  }, [options, allowedLegacyValues, value]);

  /**
   * The label for a method, read from the ONE authority: the catalogue row.
   *
   * A `labelById` literal map used to sit inside this function. It was a second
   * source of truth for names, it could not know a method the business created,
   * and it drifted from the catalogue whenever a name changed — so a shipped
   * method now simply uses its own `nameAr`/`nameEn`, which the seed defines and
   * the settings screen may override. `pos.pm.*` remains only as the fallback
   * for a shipped method the database named nothing for, which cannot happen but
   * costs nothing to honour.
   */
  const labelFor = (method: ResolvedPaymentMethod): string => {
    const name = isRtl ? method.nameAr : (method.nameEn ?? method.nameAr);
    if (name && name.trim()) return name;
    return t(`pos.pm.${method.legacyValue}`);
  };

  /**
   * The currently selected method, for the field's adornment.
   *
   * Read from the RESOLVED list — which includes a method this business created
   * and any row the database returned — before falling back to the shipped
   * registry. `getPaymentMethodDefinition` alone would drop the icon of a
   * tenant-created method that is in fact selected.
   */
  const selectedDefinition =
    (value ? options.find((method) => method.id === value) : undefined) ??
    (value ? getPaymentMethodDefinition(value) : undefined);
  const selectedMethod = value ? options.find((method) => method.id === value) : undefined;
  const selectedLabel = selectedMethod
    ? labelFor(selectedMethod)
    : value
      ? paymentMethodLabel(value, isRtl ? "ar" : "en")
      : undefined;

  return (
    <div className="relative min-w-0">
      <Select value={value ?? ""} onValueChange={onChange} dir={isRtl ? "rtl" : "ltr"}>
        <SelectTrigger
          aria-label={ariaLabel ?? (isRtl ? "طريقة الدفع" : "Payment method")}
          data-form-nav={formNav ? "" : undefined}
          disabled={disabled || isLoading}
          className={cn(
            "h-10 w-full rounded-xl border-border/80 bg-surface ps-9 text-xs font-semibold text-foreground",
            "focus:border-primary focus:ring-2 focus:ring-primary/20",
            className,
          )}
        >
          <SelectValue placeholder={placeholder ?? (isRtl ? "طريقة الدفع" : "Payment method")}>
            {selectedLabel}
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="start" className="min-w-[var(--radix-select-trigger-width)]">
          {selectableOptions.map((method) => (
            <SelectItem key={method.id} value={method.id} className="gap-2 py-2 ps-2 pe-8">
              <span className="flex min-w-0 items-center gap-2">
                <PaymentMethodIcon
                  iconKey={method.iconKey}
                  methodId={method.id}
                  ledgerKind={method.ledgerKind}
                  className="size-5"
                />
                <span className="truncate">{labelFor(method)}</span>
              </span>
            </SelectItem>
          ))}
          {allowedLegacyValues?.includes("split") && (
            <SelectItem value="split" className="gap-2 py-2 ps-2 pe-8">
              <span className="flex min-w-0 items-center gap-2">
                <PaymentMethodIcon iconKey="split" methodId="split" className="size-5" />
                <span>{isRtl ? "دفع بأكثر من طريقة" : "Split payment"}</span>
              </span>
            </SelectItem>
          )}
        </SelectContent>
      </Select>
      {selectedDefinition && (
        <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2">
          <PaymentMethodIcon
            iconKey={selectedDefinition.iconKey}
            methodId={selectedDefinition.id}
            ledgerKind={selectedDefinition.ledgerKind}
            className="size-4"
          />
        </span>
      )}
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
  methodId,
}: {
  value: string | null | undefined;
  note?: string | null;
  lang?: "ar" | "en";
  className?: string;
  /**
   * The catalogue id of the method the document was written with, when the row
   * knows it. A stored ENUM value alone cannot tell «بنك الكريمي» from a
   * generic «تحويل بنكي» — both store `bank_transfer` — so a caller that has
   * the id must pass it, and this component prefers it over the value.
   */
  methodId?: string | null;
}) {
  const { methods } = usePaymentMethods();

  // `isSplitPaymentValue` rather than a one-off string test: it also recognises
  // the English `[Split:` marker, which the inline check here missed, so an
  // English-mode split invoice used to render its raw note marker instead of
  // «دفع بأكثر من طريقة».
  //
  // The note is consulted ONLY when the stored value is absent.
  // `customer_payment_splits` is the authoritative breakdown for every invoice
  // written since the split engine shipped; the note is a compatibility path for
  // records that predate it, and treating it as the primary source would let a
  // free-text remark decide what the chip claims the payment was.
  const isSplit =
    value === "split" ||
    ((value === null || value === undefined) && isSplitPaymentValue(value, note));
  const method =
    methods.find((m) => methodId && m.id === methodId) ??
    methods.find((m) => m.id === value) ??
    methods.find((m) => m.legacyValue === value);

  // The business's own word wins over the catalogue's default. `methods` is the
  // resolved list, so this is already the tenant's naming where one exists.
  const label = isSplit
    ? lang === "ar"
      ? "دفع بأكثر من طريقة"
      : "Split payment"
    : method
      ? lang === "ar"
        ? method.nameAr
        : (method.nameEn ?? method.nameAr)
      : paymentMethodLabel(value, lang);

  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", className)}>
      <PaymentMethodIcon
        iconKey={isSplit ? "split" : (method?.iconKey ?? "generic")}
        methodId={methodId ?? method?.id}
        ledgerKind={isSplit ? "OTHER" : method?.ledgerKind}
        className="h-3.5 w-3.5"
      />
      <span className="font-medium">{label}</span>
    </span>
  );
}
