import { useEffect, useState } from "react";
import {
  User,
  Phone,
  Mail,
  MapPin,
  Wallet,
  Sparkles,
  X,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";

/**
 * CustomerFormDialog — the ONE customer form for the whole application.
 *
 * Extracted verbatim from `_app.customers.tsx` so the Customers page and the POS
 * "add customer" action share the same fields, validation, payload, table and
 * permission surface. There is deliberately no simplified POS variant: two forms
 * would drift and produce records the Customers page cannot render correctly.
 *
 * `onSaved` receives the created/updated row so POS can select it immediately
 * without clearing the cart.
 */
export interface CustomerRecord {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  credit_limit: number;
  balance?: number;
  loyalty_points?: number;
  is_active?: boolean;
  created_at?: string;
}

export interface CustomerFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** Existing customer to edit; omit or pass `{}` to create. */
  initial?: Partial<CustomerRecord> | null;
  onSaved?: (record: CustomerRecord) => void;
  /** Called after a successful save in addition to `onSaved` (e.g. reload list). */
  onSavedComplete?: () => void;
  /** Extra note shown under the form, e.g. "the customer will be selected". */
  hint?: string;
}

export function CustomerFormDialog({
  open,
  onClose,
  initial,
  onSaved,
  onSavedComplete,
  hint,
}: CustomerFormDialogProps) {
  const { t, lang } = useI18n();
  const isAr = lang === "ar";
  const [edit, setEdit] = useState<Partial<CustomerRecord>>(initial ?? {});
  const [saving, setSaving] = useState(false);

  // Re-seed the form whenever the dialog opens for a new target.
  useEffect(() => {
    if (open) setEdit(initial ?? {});
  }, [open, initial]);

  if (!open) return null;

  async function save() {
    if (saving) return;
    if (!edit?.name?.trim()) return toast.error(t("common.required"));
    setSaving(true);
    const payload = {
      name: edit.name.trim(),
      phone: edit.phone || null,
      email: edit.email || null,
      address: edit.address || null,
      credit_limit: Number(edit.credit_limit ?? 0),
      is_active: edit.is_active ?? true,
    };
    const { data, error } = edit.id
      ? await supabase.from("customers").update(payload).eq("id", edit.id).select("*").single()
      : await supabase.from("customers").insert(payload).select("*").single();
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(edit.id ? t("common.updated") : t("common.created"));
    if (data) onSaved?.(data as CustomerRecord);
    onSavedComplete?.();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto"
      onClick={() => !saving && onClose()}
    >
      <div
        className="flex max-h-[90dvh] w-full max-w-lg flex-col rounded-3xl border border-border/80 bg-background/95 p-5 sm:p-7 shadow-2xl backdrop-blur-md animate-in zoom-in-95 duration-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        dir={isAr ? "rtl" : "ltr"}
      >
        <div className="flex shrink-0 items-start justify-between border-b border-border/60 pb-4">
          <div className="flex items-center gap-3.5">
            <div className="grid size-11 place-items-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
              <User className="size-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold tracking-tight text-foreground">
                {edit.id
                  ? isAr
                    ? "تعديل بيانات العميل"
                    : "Edit Customer Profile"
                  : isAr
                    ? "إضافة عميل جديد"
                    : "New Customer Registration"}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {isAr
                  ? "سجل البيانات الأساسية ومعلومات التواصل والحد الائتماني"
                  : "Fill in identity, contact info, and credit terms"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-full bg-surface-2 text-muted-foreground transition hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="flex min-h-0 flex-1 flex-col mt-4"
        >
          <div className="flex-1 overflow-y-auto space-y-4 pe-1 custom-scrollbar">
            {/* Section 1: Identity */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Sparkles className="size-3.5 text-primary" />
                <span>{isAr ? "البيانات الأساسية" : "Primary Information"}</span>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  {t("common.name")} <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    required
                    autoFocus
                    value={edit.name ?? ""}
                    onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                    placeholder={isAr ? "اسم العميل أو المؤسسة" : "Customer or Company Name"}
                    className="h-11 w-full rounded-2xl border border-border/80 bg-surface/80 px-4 pr-10 text-sm font-medium transition placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>
            </div>

            {/* Section 2: Contact */}
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Phone className="size-3.5 text-primary" />
                <span>{isAr ? "بيانات الاتصال والتواصل" : "Contact Details"}</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-foreground">
                    {t("common.phone")}
                  </label>
                  <div className="relative">
                    <Phone className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      dir="ltr"
                      value={edit.phone ?? ""}
                      onChange={(e) => setEdit({ ...edit, phone: e.target.value })}
                      placeholder="+966 5x xxx xxxx"
                      className="h-11 w-full rounded-2xl border border-border/80 bg-surface/80 px-4 pr-10 text-right text-sm font-medium transition placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-foreground">
                    {t("common.email")}
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="email"
                      dir="ltr"
                      value={edit.email ?? ""}
                      onChange={(e) => setEdit({ ...edit, email: e.target.value })}
                      placeholder="customer@domain.com"
                      className="h-11 w-full rounded-2xl border border-border/80 bg-surface/80 px-4 pr-10 text-right text-sm font-medium transition placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  {isAr ? "العنوان أو المدينة" : "Address"}
                </label>
                <div className="relative">
                  <MapPin className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={edit.address ?? ""}
                    onChange={(e) => setEdit({ ...edit, address: e.target.value })}
                    placeholder={isAr ? "المدينة، الحي، الشارع" : "City, District, Street"}
                    className="h-11 w-full rounded-2xl border border-border/80 bg-surface/80 px-4 pr-10 text-sm font-medium transition placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>
            </div>

            {/* Section 3: Credit & status */}
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Wallet className="size-3.5 text-primary" />
                <span>{isAr ? "الحد الائتماني والحالة" : "Credit & Status"}</span>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  {isAr ? "حد الائتمان المسموح" : "Credit Limit"}
                </label>
                <input
                  type="number"
                  dir="ltr"
                  min={0}
                  step="any"
                  value={edit.credit_limit ?? 0}
                  onChange={(e) => setEdit({ ...edit, credit_limit: Number(e.target.value) })}
                  className="h-11 w-full rounded-2xl border border-border/80 bg-surface/80 px-4 text-right font-mono text-sm font-medium transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {isAr
                    ? "أقصى مبلغ يمكن للعميل شراؤه بالآجل قبل إيقاف الفواتير."
                    : "Maximum allowable credit before blocking future credit sales."}
                </p>
              </div>

              <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-surface/60 p-3.5">
                <div>
                  <p className="text-xs font-bold text-foreground">
                    {isAr ? "حالة تفعيل العميل" : "Customer Active Status"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {isAr
                      ? "العميل النشط يظهر تلقائياً في شاشات البيع ونقاط البيع"
                      : "Active customers appear in POS and sales invoices"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEdit({ ...edit, is_active: !(edit.is_active ?? true) })}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    (edit.is_active ?? true) ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block size-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      (edit.is_active ?? true) ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>

            {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-border/60 pt-4 mt-3">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="h-11 rounded-2xl border border-border/80 bg-surface px-5 text-xs font-bold text-muted-foreground transition hover:bg-surface-2 hover:text-foreground active:scale-95"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex h-11 items-center gap-2 rounded-2xl bg-primary px-6 text-xs font-bold text-primary-foreground shadow-md shadow-primary/25 transition hover:bg-primary/90 active:scale-95 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              <span>{edit.id ? t("common.save_changes") : t("common.create")}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
