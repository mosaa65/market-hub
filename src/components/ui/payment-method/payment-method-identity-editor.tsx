/**
 * محرّر هوية طريقة الدفع — الاسم + الأيقونة، بصلاحية صاحب المنشأة والسوبر أدمن.
 *
 * WHAT THIS COMPONENT IS FOR
 * --------------------------
 * The catalogue decides HOW money moves: which account family a method settles
 * into, and which stored value a document keeps. Those are facts about the ENUM
 * and the ledger, and this component cannot touch them — the database refuses,
 * and the migration's guard trigger is the reason it can afford to try.
 *
 * What it edits is the two things that are genuinely the business's own:
 *
 *   • الاسم  — «بنك الكريمي» عند منشأة، و«حوالات صنعاء» عند أخرى.
 *   • الأيقونة — شكل تتعرف به المؤسسة من نظرة واحدة على شاشة الكاشير.
 *
 * WHY AN ICON IS CHOSEN FROM A LIST AND NEVER UPLOADED
 * ---------------------------------------------------
 * The plan's governing principle is that the client never uploads an icon. This
 * component honours it literally: every choice is a key into a lucide component
 * that is already in the bundle. So there is no upload, no URL, no base64, no
 * broken-image placeholder, and no network request to render a payment method —
 * and a business cannot make the till fail to paint by supplying a bad image.
 *
 * A note on what a tenant CANNOT do, stated plainly because it is a real limit:
 * a new method is bound to an existing stored value (`bank_transfer`,
 * `mobile_money`, …). The institution name lives in the catalogue and in the
 * reference the operator types; the document keeps the family. That is what
 * makes this feature additive — nothing historical has to move.
 */

import { useMemo, useState } from "react";
import { Check, LoaderCircle, Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  PAYMENT_ICON_CHOICES,
  getShippedPaymentMethod,
  type PaymentContext,
} from "@/lib/payments/payment-methods";
import {
  useUpdatePaymentMethodIdentity,
  type ResolvedPaymentMethod,
} from "@/hooks/use-payment-methods";
import { PaymentMethodIcon } from "./payment-method-icon";

export interface PaymentMethodIdentityEditorProps {
  method: ResolvedPaymentMethod;
  /** Retained for callers that hold a draft; the editor itself is stateless here. */
  contexts?: PaymentContext[];
  /** Called after a successful save so the parent can refresh its draft. */
  onSaved?: () => void;
  className?: string;
}

export function PaymentMethodIdentityEditor({
  method,
  onSaved,
  className,
}: PaymentMethodIdentityEditorProps) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const { rename, isSaving } = useUpdatePaymentMethodIdentity();

  const shipped = useMemo(() => getShippedPaymentMethod(method.id), [method.id]);

  const [open, setOpen] = useState(false);
  const [nameAr, setNameAr] = useState(method.nameAr);
  const [nameEn, setNameEn] = useState(method.nameEn ?? "");
  const [iconKey, setIconKey] = useState(method.iconKey);
  const [error, setError] = useState<string | null>(null);

  const trimmed = nameAr.trim();
  const canSave =
    trimmed.length > 0 && trimmed.length <= 60 && nameEn.trim().length <= 60 && !isSaving;

  const dirty =
    trimmed !== method.nameAr ||
    nameEn.trim() !== (method.nameEn ?? "") ||
    iconKey !== method.iconKey;

  /** Put the shipped name and icon back, for a method the business renamed. */
  function resetToShipped() {
    if (!shipped) return;
    setNameAr(shipped.nameAr);
    setNameEn(shipped.nameEn ?? "");
    setIconKey(shipped.iconKey);
    setError(null);
  }

  async function save() {
    setError(null);
    try {
      await rename({
        id: method.id,
        nameAr: trimmed,
        nameEn: nameEn.trim() || null,
        iconKey,
      });
      setOpen(false);
      onSaved?.();
    } catch (err) {
      // The database owns the rules; report what it said rather than guessing.
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className={cn("h-7 gap-1 px-2 text-[11px]", className)}
        title={ar ? "تعديل الاسم والأيقونة" : "Edit name and icon"}
      >
        <Pencil className="h-3 w-3" />
        {ar ? "تعديل" : "Edit"}
      </Button>
    );
  }

  return (
    <div
      className={cn("w-full rounded-xl border border-border/70 bg-surface-2/40 p-2.5", className)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-[160px] flex-1 flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground">
            {ar ? "الاسم (عربي)" : "Name (Arabic)"}
          </span>
          <input
            value={nameAr}
            onChange={(event) => setNameAr(event.target.value)}
            maxLength={60}
            aria-label={ar ? "الاسم بالعربية" : "Arabic name"}
            className="h-9 rounded-xl border border-border/80 bg-surface px-3 text-xs font-semibold text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>

        <label className="flex min-w-[140px] flex-1 flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground">
            {ar ? "الاسم (إنجليزي) — اختياري" : "Name (English) — optional"}
          </span>
          <input
            value={nameEn}
            onChange={(event) => setNameEn(event.target.value)}
            maxLength={60}
            aria-label={ar ? "الاسم بالإنجليزية" : "English name"}
            className="h-9 rounded-xl border border-border/80 bg-surface px-3 text-xs text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>
      </div>

      <div className="mt-2">
        <span className="text-[10px] font-medium text-muted-foreground">
          {ar ? "الأيقونة" : "Icon"}
        </span>
        {/* Keys into a bundled registry — never an uploaded image. */}
        <div className="mt-1 flex flex-wrap gap-1.5">
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
                  "grid h-8 w-8 place-items-center rounded-lg border transition",
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

      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        {ar
          ? "الاسم والأيقونة يظهران في كل الشاشات والفواتير. أما نوع الحساب والقيمة المخزّنة فمحسومة من الكتالوج ولا يتغيّرها التعديل — فيبقى الترحيل المحاسبي كما هو."
          : "The name and icon appear on every screen and document. The account family and the stored value come from the catalogue and are not changed here, so ledger posting stays exactly as it was."}
      </p>

      {error ? (
        <p className="mt-1.5 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-[10px] leading-relaxed text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => void save()}
          disabled={!canSave || !dirty}
          className="h-8 gap-1 text-[11px]"
        >
          {isSaving ? (
            <LoaderCircle className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3" />
          )}
          {ar ? "حفظ" : "Save"}
        </Button>

        {shipped ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resetToShipped}
            disabled={isSaving}
            className="h-8 gap-1 text-[11px]"
          >
            <RotateCcw className="h-3 w-3" />
            {ar ? "استعادة الاسم الأصلي" : "Restore shipped"}
          </Button>
        ) : null}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            // Abandon the draft rather than leaving a half-typed name behind.
            setNameAr(method.nameAr);
            setNameEn(method.nameEn ?? "");
            setIconKey(method.iconKey);
            setError(null);
            setOpen(false);
          }}
          disabled={isSaving}
          className="h-8 text-[11px]"
        >
          {ar ? "إلغاء" : "Cancel"}
        </Button>
      </div>
    </div>
  );
}
