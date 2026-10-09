/**
 * إضافة طريقة دفع من إنشاء المنشأة.
 *
 * مؤشر صريح لما لا تجلبه هذه الشاشة، لأنه أهم من ما تجلبه:
 * لا يرفع العميل صورة، ولا يكتب رابطاً، ولا يختار نوع حساب محاسبي.
 *
 * WHY THE TWO CHOICES ARE THE WHOLE FORM
 * --------------------------------------
 * A method needs a name, an icon, and — the part that is not cosmetic — which
 * family of money it represents. The last one is asked as a plain question
 * («كيف تُحصَّل؟») and the account family is DERIVED from the answer by the
 * database:
 *
 *   bank_transfer / cheque  ->  BANK    (يخرج عبر البنك)
 *   mobile_money            ->  WALLET  (محفظة)
 *   card                    ->  CARD
 *   cash                    ->  CASH
 *
 * Deriving it rather than offering it is what makes the feature safe. A
 * dropdown of account kinds would let a business point a wallet at the till and
 * silently overstate cash for as long as nobody looked. There is no such
 * dropdown here, and the RPC does not accept one either.
 */

import { useState } from "react";
import { LoaderCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VortexDrawerDialog } from "@/components/vortex-ui";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  PAYMENT_CONTEXTS,
  PAYMENT_CONTEXT_LABELS,
  PAYMENT_ICON_CHOICES,
  type LegacyPaymentValue,
  type PaymentContext,
} from "@/lib/payments/payment-methods";
import { useCreateTenantPaymentMethod, usePaymentMethods } from "@/hooks/use-payment-methods";
import { PaymentMethodIcon } from "./payment-method-icon";

/** The ways a business may actually collect. `credit` and `split` excluded, on purpose. */
const COLLECTION_OPTIONS: readonly {
  value: LegacyPaymentValue;
  ar: string;
  en: string;
  hint: string;
}[] = [
  {
    value: "bank_transfer",
    ar: "حوالة بنكية",
    en: "Bank transfer",
    hint: "تُسوّى على الحساب البنكي (1111)",
  },
  {
    value: "mobile_money",
    ar: "محفظة إلكترونية",
    en: "Mobile wallet",
    hint: "تُسوّى على الحساب البنكي/المحافظ (1111)",
  },
  { value: "card", ar: "بطاقة / شبكة", en: "Card", hint: "تُسوّى على الشبكة (1111)" },
  { value: "cheque", ar: "شيك", en: "Cheque", hint: "تُسوّى على الحساب البنكي (1111)" },
  { value: "cash", ar: "نقداً", en: "Cash", hint: "تُسوّى على الصندوق (1101)" },
];

export interface AddPaymentMethodDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
  /** Pre-select the collection way when the screen was opened from a family row. */
  initialLegacyValue?: LegacyPaymentValue;
}

export function AddPaymentMethodDialog({
  open,
  onOpenChange,
  onCreated,
  initialLegacyValue = "bank_transfer",
}: AddPaymentMethodDialogProps) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { methods } = usePaymentMethods();
  const { create, isCreating } = useCreateTenantPaymentMethod();

  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [iconKey, setIconKey] = useState("wallet");
  const [legacyValue, setLegacyValue] = useState<LegacyPaymentValue>(initialLegacyValue);
  const [contexts, setContexts] = useState<PaymentContext[]>([
    "pos",
    "sales",
    "purchases",
    "expenses",
    "customer_collection",
  ]);
  const [error, setError] = useState<string | null>(null);

  const trimmed = nameAr.trim();
  const duplicate = methods.some((m) => m.nameAr.trim() === trimmed && m.isActive);
  const canSubmit =
    trimmed.length > 0 && trimmed.length <= 60 && contexts.length > 0 && !isCreating && !duplicate;

  function reset() {
    setNameAr("");
    setNameEn("");
    setIconKey("wallet");
    setLegacyValue(initialLegacyValue);
    setContexts(["pos", "sales", "purchases", "expenses", "customer_collection"]);
    setError(null);
  }

  async function submit() {
    setError(null);
    try {
      const id = await create({
        nameAr: trimmed,
        nameEn: nameEn.trim() || null,
        iconKey,
        legacyValue,
        contexts,
      });
      reset();
      onOpenChange(false);
      onCreated?.(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function toggleContext(context: PaymentContext) {
    setContexts((current) =>
      current.includes(context) ? current.filter((c) => c !== context) : [...current, context],
    );
  }

  const inputClass =
    "h-10 w-full rounded-xl border border-border/80 bg-surface px-3 text-xs font-semibold text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

  return (
    <VortexDrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      icon={<Plus className="size-5" />}
      title={ar ? "إضافة طريقة دفع" : "Add a payment method"}
      subtitle={
        ar
          ? "طريقة تخصّ منشأتك — تظهر في الأقسام التي تختارها فوراً"
          : "A method of your own — it appears in the sections you choose"
      }
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isCreating}>
            {ar ? "إلغاء" : "Cancel"}
          </Button>
          <Button onClick={() => void submit()} disabled={!canSubmit} className="gap-2">
            {isCreating ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {ar ? "إضافة الطريقة" : "Add method"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">
              {ar ? "الاسم (عربي)" : "Name (Arabic)"}
            </span>
            <input
              value={nameAr}
              onChange={(event) => setNameAr(event.target.value)}
              maxLength={60}
              autoFocus
              placeholder={ar ? "مثال: حوالات صنعاء" : "e.g. Sanaa Transfers"}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">
              {ar ? "الاسم (إنجليزي) — اختياري" : "Name (English) — optional"}
            </span>
            <input
              value={nameEn}
              onChange={(event) => setNameEn(event.target.value)}
              maxLength={60}
              className={inputClass}
            />
          </label>
        </div>

        {duplicate ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
            {ar
              ? "توجد طريقة مفعّلة بهذا الاسم — عدّل اسمها بدل إضافة أخرى."
              : "An active method already uses this name — rename it instead."}
          </p>
        ) : null}

        <div>
          <span className="text-[11px] font-medium text-muted-foreground">
            {ar ? "كيف تُحصَّل؟" : "How is it collected?"}
          </span>
          <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
            {COLLECTION_OPTIONS.map((option) => {
              const selected = option.value === legacyValue;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setLegacyValue(option.value)}
                  aria-pressed={selected}
                  className={cn(
                    "rounded-xl border p-2 text-start transition",
                    selected
                      ? "border-primary bg-primary/10"
                      : "border-border/70 bg-surface hover:bg-surface-2",
                  )}
                >
                  <span className="block text-[11px] font-bold text-foreground">
                    {ar ? option.ar : option.en}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    {option.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <span className="text-[11px] font-medium text-muted-foreground">
            {ar ? "الأيقونة" : "Icon"}
          </span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {PAYMENT_ICON_CHOICES.map((choice) => {
              const selected = choice.key === iconKey;
              return (
                <button
                  key={choice.key}
                  type="button"
                  onClick={() => setIconKey(choice.key)}
                  aria-pressed={selected}
                  title={ar ? choice.labelAr : choice.labelEn}
                  className={cn(
                    "grid h-9 w-9 place-items-center rounded-lg border transition",
                    selected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/70 bg-surface text-muted-foreground hover:bg-surface-2",
                  )}
                >
                  <PaymentMethodIcon iconKey={choice.key} className="h-4 w-4" tone={selected} />
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <span className="text-[11px] font-medium text-muted-foreground">
            {ar ? "الأقسام التي تظهر فيها" : "Sections where it appears"}
          </span>
          {/* `credit` has no context of its own: it is not a way of collecting. */}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {PAYMENT_CONTEXTS.filter((c) => c !== "sales_returns" && c !== "purchase_returns").map(
              (context) => {
                const selected = contexts.includes(context);
                const label = ar
                  ? PAYMENT_CONTEXT_LABELS[context].ar
                  : PAYMENT_CONTEXT_LABELS[context].en;
                return (
                  <button
                    key={context}
                    type="button"
                    onClick={() => toggleContext(context)}
                    aria-pressed={selected}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[10px] font-medium transition",
                      selected
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-border/70 bg-surface text-muted-foreground hover:bg-surface-2",
                    )}
                  >
                    {label}
                  </button>
                );
              },
            )}
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            {ar
              ? "مرتجعات المبيعات والمشتريات لا تعرض إلا النقدي والآجل — لا محافظ ولا بنوك."
              : "Sales and purchase returns only offer cash and credit — never a wallet or a bank."}
          </p>
        </div>

        {error ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-[11px] leading-relaxed text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </VortexDrawerDialog>
  );
}
