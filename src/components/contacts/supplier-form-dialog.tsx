import { useEffect, useState } from "react";
import {
  Building2,
  Check,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Phone,
  Sparkles,
  User,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { CountrySelector } from "@/components/country-selector";
import { COUNTRIES, Country, DEFAULT_COUNTRY } from "@/lib/country-data";
import { formatPhoneE164 } from "@/lib/phone-utils";

/**
 * SupplierFormDialog — the supplier form for the whole application.
 *
 * Mirrors the customer dialog's visual language (rounded-3xl backdrop, signature
 * header with icon container, section headers with `Sparkles` chip, icon-prefixed
 * inputs, dark submit / muted cancel footer) without changing the supplier
 * fields, validations, locked-cash-supplier guard, payload, or table.
 *
 * Extracted so both the Suppliers page and any future surface (purchases,
 * expense dialog) share the same fields and locked-supplier protection.
 */
export function isSystemCashSupplierName(name?: string | null): boolean {
  if (!name) return false;
  const n = name.trim().toLowerCase();
  return n === "مورد نقدي" || n === "cash supplier" || n === "walk-in supplier";
}

export interface SupplierRecord {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  balance?: number;
  is_active?: boolean;
  created_at?: string;
}

export interface SupplierFormDialogProps {
  open: boolean;
  onClose: () => void;
  initial?: Partial<SupplierRecord> | null;
  onSaved?: (record: SupplierRecord) => void;
  onSavedComplete?: () => void;
  hint?: string;
}

function parseSupplierPhone(raw?: string | null): { country: Country; local: string } {
  if (!raw || !raw.trim()) {
    return { country: DEFAULT_COUNTRY, local: "" };
  }
  const clean = raw.trim();
  for (const c of COUNTRIES) {
    if (clean.startsWith(c.dialCode)) {
      return { country: c, local: clean.slice(c.dialCode.length).trim() };
    }
  }
  for (const c of COUNTRIES) {
    const dialNoPlus = c.dialCode.replace("+", "");
    if (clean.startsWith("00" + dialNoPlus)) {
      return { country: c, local: clean.slice(("00" + dialNoPlus).length).trim() };
    }
    if (clean.startsWith(dialNoPlus) && clean.length >= dialNoPlus.length + 6) {
      return { country: c, local: clean.slice(dialNoPlus.length).trim() };
    }
  }
  return { country: DEFAULT_COUNTRY, local: clean };
}

export function SupplierFormDialog({
  open,
  onClose,
  initial,
  onSaved,
  onSavedComplete,
  hint,
}: SupplierFormDialogProps) {
  const { t, lang } = useI18n();
  const isAr = lang === "ar";
  const [edit, setEdit] = useState<Partial<SupplierRecord>>(initial ?? {});
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [phone, setPhone] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setEdit(initial ?? {});
      const parsed = parseSupplierPhone(initial?.phone);
      setCountry(parsed.country);
      setPhone(parsed.local);
    }
  }, [open, initial]);

  if (!open) return null;

  const isLockedCashSupplier = Boolean(edit.id && isSystemCashSupplierName(initial?.name));

  async function save() {
    if (saving) return;
    if (!edit?.name?.trim()) {
      return toast.error(t("suppliers.name_required") || t("common.required"));
    }
    if (isLockedCashSupplier) {
      if (edit.name.trim() !== (initial?.name ?? "").trim()) {
        toast.error(
          isAr
            ? "لا يمكن تعديل اسم «المورد النقدي» — حساب نظامي رسمي."
            : "Cannot change cash supplier name.",
        );
        return;
      }
      if (edit.is_active === false) {
        toast.error(
          isAr
            ? "لا يمكن تعطيل «المورد النقدي» — أساسي للمشتريات."
            : "Cannot deactivate cash supplier.",
        );
        return;
      }
    }
    setSaving(true);

    let finalPhone: string | null = null;
    if (phone.trim()) {
      finalPhone = formatPhoneE164(phone.trim(), country.dialCode);
    }

    const payload = {
      name: edit.name.trim(),
      phone: finalPhone,
      email: edit.email?.trim() || null,
      address: edit.address?.trim() || null,
      is_active: isLockedCashSupplier ? true : (edit.is_active ?? true),
    };

    const { data, error } = edit.id
      ? await supabase.from("suppliers").update(payload).eq("id", edit.id).select("*").single()
      : await supabase.from("suppliers").insert(payload).select("*").single();

    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(edit.id ? t("common.updated") : t("common.created"));
    if (data) onSaved?.(data as SupplierRecord);
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
              <Building2 className="size-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold tracking-tight text-foreground">
                {edit.id
                  ? isAr
                    ? "تعديل بيانات المورد"
                    : "Edit Supplier Profile"
                  : isAr
                    ? "إضافة مورد جديد"
                    : "New Supplier Registration"}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {isAr
                  ? "سجل البيانات الأساسية ومعلومات التواصل للمورد"
                  : "Fill in identity and contact info for the supplier"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-full bg-surface-2 text-muted-foreground transition hover:text-foreground cursor-pointer"
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
              {isLockedCashSupplier && (
                <div className="flex items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs font-semibold text-amber-700 dark:text-amber-300">
                  <Lock className="size-4 shrink-0 text-amber-500" />
                  <span>
                    {isAr
                      ? "هذا حساب «المورد النقدي» النظامي المعتمد للمشتريات النقدية، واسمه وحالته محميان لضمان استقرار العمليات."
                      : "Official Cash Supplier account; name and status are locked for system stability."}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Sparkles className="size-3.5 text-primary" />
                <span>{isAr ? "البيانات الأساسية" : "Primary Information"}</span>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  {t("common.name")} <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground z-10" />
                  <input
                    required
                    disabled={isLockedCashSupplier}
                    autoFocus={!isLockedCashSupplier}
                    value={edit.name ?? ""}
                    onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                    placeholder={isAr ? "اسم المورد أو الشركة" : "Supplier or Company Name"}
                    className="h-12 w-full rounded-2xl border border-border/80 bg-surface/80 ps-11 pe-4 text-sm font-medium transition placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
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

              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  {isAr ? "رقم الهاتف" : "Phone Number"}
                </label>
                <div className="flex gap-2">
                  <CountrySelector value={country} onChange={setCountry} disabled={saving} />
                  <div className="relative flex-1" dir="ltr">
                    <Phone className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground z-10" />
                    <input
                      type="tel"
                      dir="ltr"
                      disabled={saving}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="772217218"
                      maxLength={15}
                      className="h-12 w-full rounded-2xl border border-border/80 bg-surface/80 pl-11 pr-4 text-left font-mono text-sm font-medium transition placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {isAr
                    ? "الرمز الدولي الافتراضي: اليمن (+967). يمكنك تغيير الدولة من القائمة."
                    : "Default dial code: Yemen (+967). You can select another country."}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-foreground">
                    {t("common.email")}
                  </label>
                  <div className="relative" dir="ltr">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground z-10" />
                    <input
                      type="email"
                      dir="ltr"
                      value={edit.email ?? ""}
                      onChange={(e) => setEdit({ ...edit, email: e.target.value })}
                      placeholder="supplier@domain.com"
                      className="h-12 w-full rounded-2xl border border-border/80 bg-surface/80 pl-11 pr-4 text-left text-sm font-medium transition placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-foreground">
                    {isAr ? "العنوان أو المدينة" : "Address"}
                  </label>
                  <div className="relative">
                    <MapPin className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground z-10" />
                    <input
                      value={edit.address ?? ""}
                      onChange={(e) => setEdit({ ...edit, address: e.target.value })}
                      placeholder={isAr ? "المدينة، الحي، الشارع" : "City, District, Street"}
                      className="h-12 w-full rounded-2xl border border-border/80 bg-surface/80 ps-11 pe-4 text-sm font-medium transition placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Section 3: Active status */}
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Building2 className="size-3.5 text-primary" />
                <span>{isAr ? "حالة التفعيل" : "Active Status"}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-surface/60 p-3.5">
                <div>
                  <p className="text-xs font-bold text-foreground">
                    {isAr ? "حالة تفعيل المورد" : "Supplier Active Status"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {isAr
                      ? "المورد النشط يظهر تلقائياً في شاشات المشتريات وسندات الصرف"
                      : "Active suppliers appear in purchases and payment vouchers"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isLockedCashSupplier}
                  onClick={() =>
                    !isLockedCashSupplier &&
                    setEdit({ ...edit, is_active: !(edit.is_active ?? true) })
                  }
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    isLockedCashSupplier ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                  } ${(edit.is_active ?? true) ? "bg-primary" : "bg-muted"}`}
                  aria-pressed={Boolean(edit.is_active ?? true)}
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

          {/* Footer buttons styled exactly like the customer form's footer */}
          <div className="flex items-center gap-2 w-full pt-4 mt-3 border-t border-border/60">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 h-12 rounded-2xl bg-foreground text-background font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-foreground/15 hover:opacity-95 active:scale-[0.98] transition cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin text-primary" />
              ) : (
                <Check className="size-4 text-primary" />
              )}
              <span>
                {saving
                  ? isAr
                    ? "جاري الحفظ..."
                    : "Saving..."
                  : edit.id
                    ? isAr
                      ? "حفظ التعديلات"
                      : "Save Changes"
                    : isAr
                      ? "إضافة مورد"
                      : "Add Supplier"}
              </span>
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="h-12 px-5 sm:px-6 rounded-2xl bg-muted/80 text-muted-foreground hover:text-foreground font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition active:scale-[0.98] cursor-pointer"
            >
              <span>{isAr ? "إلغاء" : "Cancel"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
