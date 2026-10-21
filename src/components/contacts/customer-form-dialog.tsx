import { useEffect, useState } from "react";
import { User, Phone, Mail, MapPin, Wallet, Sparkles, X, Loader2, Check, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { CountrySelector } from "@/components/country-selector";
import { COUNTRIES, Country, DEFAULT_COUNTRY } from "@/lib/country-data";
import { formatPhoneE164 } from "@/lib/phone-utils";
import { AmountInput } from "@/components/ui/amount-input";

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

export function isSystemCashCustomerName(name?: string | null): boolean {
  if (!name) return false;
  const n = name.trim().toLowerCase();
  return n === "عميل نقدي" || n === "walk-in" || n === "walk-in customer" || n === "cash customer";
}

function parseCustomerPhone(raw?: string | null): { country: Country; local: string } {
  if (!raw || !raw.trim()) {
    return { country: DEFAULT_COUNTRY, local: "" };
  }
  const clean = raw.trim();
  // Check known dial codes
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
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [phone, setPhone] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Re-seed the form whenever the dialog opens for a new target.
  useEffect(() => {
    if (open) {
      setEdit(initial ?? {});
      const parsed = parseCustomerPhone(initial?.phone);
      setCountry(parsed.country);
      setPhone(parsed.local);
    }
  }, [open, initial]);

  if (!open) return null;

  const isLockedCashCustomer = Boolean(
    (edit.id && (edit as { is_system?: boolean }).is_system) ||
    (edit.id && isSystemCashCustomerName(initial?.name)),
  );

  async function save() {
    if (saving) return;
    if (!edit?.name?.trim()) return toast.error(t("common.required"));
    if (isLockedCashCustomer) {
      if (edit.name.trim() !== (initial?.name ?? "").trim()) {
        toast.error(
          isAr
            ? "لا يمكن تعديل اسم «العميل النقدي» — حساب نظامي رسمي."
            : "Cannot change cash customer name.",
        );
        return;
      }
      if (edit.is_active === false) {
        toast.error(
          isAr
            ? "لا يمكن تعطيل «العميل النقدي» — أساسي لنقاط البيع."
            : "Cannot deactivate cash customer.",
        );
        return;
      }
    }
    setSaving(true);
    try {
      const finalPhone = phone.trim() ? formatPhoneE164(phone.trim(), country.dialCode) : null;
      const payload = {
        name: edit.name.trim(),
        phone: finalPhone,
        email: edit.email?.trim() || null,
        address: edit.address?.trim() || null,
        credit_limit: Number(edit.credit_limit ?? 0),
        is_active: isLockedCashCustomer ? true : (edit.is_active ?? true),
      };

      const { data, error } = edit.id
        ? await supabase.from("customers").update(payload).eq("id", edit.id).select("*").single()
        : await supabase.from("customers").insert(payload).select("*").single();

      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(
        edit.id
          ? t("common.updated")
          : isAr
            ? "تمت إضافة العميل بنجاح"
            : "Customer created successfully",
      );
      if (data) onSaved?.(data as CustomerRecord);
      onSavedComplete?.();
      onClose();
    } catch (error) {
      console.error("[customers] save failed", error);
      toast.error(
        isAr ? "تعذّر حفظ بيانات العميل. حاول مرة أخرى." : "Could not save customer details.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/60 p-0 backdrop-blur-sm animate-in fade-in duration-200 sm:items-center sm:p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-border/80 bg-background/95 p-5 shadow-2xl backdrop-blur-md animate-in slide-in-from-bottom-3 duration-200 sm:max-h-[90dvh] sm:rounded-3xl sm:p-7 sm:zoom-in-95"
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
            disabled={saving}
            className="grid size-8 place-items-center rounded-full bg-surface-2 text-muted-foreground transition hover:text-foreground disabled:pointer-events-none disabled:opacity-50 cursor-pointer"
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
              {isLockedCashCustomer && (
                <div className="flex items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs font-semibold text-amber-700 dark:text-amber-300">
                  <Lock className="size-4 shrink-0 text-amber-500" />
                  <span>
                    {isAr
                      ? "هذا حساب «العميل النقدي» النظامي المعتمد للمبيعات الفورية، واسمه وحالته محميان لضمان استقرار نقاط البيع."
                      : "This is the official Cash Customer account; name and status are locked for POS integrity."}
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
                  <User className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    required
                    disabled={isLockedCashCustomer}
                    autoFocus={!isLockedCashCustomer}
                    value={edit.name ?? ""}
                    onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                    placeholder={isAr ? "اسم العميل أو المؤسسة" : "Customer or Company Name"}
                    className="h-12 w-full rounded-2xl border border-border/80 bg-surface/80 px-4 ps-10 text-sm font-medium transition placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
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

              {/* Phone Input with Country Selector */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  {isAr ? "رقم الهاتف" : "Phone Number"}
                </label>
                <div className="flex gap-2">
                  <CountrySelector value={country} onChange={setCountry} disabled={saving} />
                  <div className="relative flex-1">
                    <Phone className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="tel"
                      dir="ltr"
                      disabled={saving}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="770000000"
                      maxLength={15}
                      className="h-12 w-full rounded-2xl border border-border/80 bg-surface/80 px-4 ps-10 text-right text-sm font-medium transition placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
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
                  <div className="relative">
                    <Mail className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="email"
                      dir="ltr"
                      value={edit.email ?? ""}
                      onChange={(e) => setEdit({ ...edit, email: e.target.value })}
                      placeholder="customer@domain.com"
                      className="h-12 w-full rounded-2xl border border-border/80 bg-surface/80 px-4 ps-10 text-right text-sm font-medium transition placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-foreground">
                    {isAr ? "العنوان أو المدينة" : "Address"}
                  </label>
                  <div className="relative">
                    <MapPin className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={edit.address ?? ""}
                      onChange={(e) => setEdit({ ...edit, address: e.target.value })}
                      placeholder={isAr ? "المدينة، الحي، الشارع" : "City, District, Street"}
                      className="h-12 w-full rounded-2xl border border-border/80 bg-surface/80 px-4 ps-10 text-sm font-medium transition placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
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
                <AmountInput
                  min={0}
                  showInWords={false}
                  aria-label={isAr ? "حد الائتمان المسموح" : "Credit limit"}
                  value={edit.credit_limit ?? null}
                  onValueChange={(v) => setEdit({ ...edit, credit_limit: v ?? 0 })}
                  className="h-12 rounded-2xl text-sm font-medium"
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
                  disabled={isLockedCashCustomer}
                  onClick={() =>
                    !isLockedCashCustomer &&
                    setEdit({ ...edit, is_active: !(edit.is_active ?? true) })
                  }
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    isLockedCashCustomer ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                  } ${(edit.is_active ?? true) ? "bg-primary" : "bg-muted"}`}
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

          {/* Footer buttons styled exactly like the filter sheet footer in Vortex UI */}
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
                      ? "إضافة عميل"
                      : "Add Customer"}
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
