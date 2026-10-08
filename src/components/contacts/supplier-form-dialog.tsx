import { useEffect, useState } from "react";
import { Building2, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";

/**
 * SupplierFormDialog — the ONE supplier form for the whole application.
 *
 * Extracted verbatim from `_app.suppliers.tsx` so the Suppliers page and the
 * Purchase POS "add supplier" action share the same fields, validation, payload,
 * table and permissions. Purchase POS previously carried a two-field mini form
 * that produced records missing email/address; this replaces it.
 *
 * Note on permissions: `suppliers` is guarded by RLS for owner/manager/accountant
 * only. Callers must decide whether to offer this dialog at all — this component
 * does not bypass RLS and will surface a permission error if invoked by a role
 * that cannot write.
 */
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setEdit(initial ?? {});
  }, [open, initial]);

  if (!open) return null;

  async function save() {
    if (saving) return;
    if (!edit?.name?.trim()) return toast.error(t("suppliers.name_required"));
    setSaving(true);
    const payload = {
      name: edit.name.trim(),
      phone: edit.phone || null,
      email: edit.email || null,
      address: edit.address || null,
      is_active: edit.is_active ?? true,
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
        className="flex max-h-[90dvh] w-full max-w-md flex-col rounded-3xl border border-border/80 bg-surface p-5 sm:p-6 shadow-2xl backdrop-blur-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        dir={isAr ? "rtl" : "ltr"}
      >
        <div className="mb-4 flex shrink-0 items-center justify-between border-b border-border/50 pb-3">
          <div className="flex items-center gap-2">
            <Building2 className="size-4 text-primary" />
            <h3 className="text-lg font-semibold">
              {edit.id ? t("suppliers.edit") : t("suppliers.new")}
            </h3>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-surface-2 text-muted-foreground hover:text-foreground transition">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex-1 overflow-y-auto space-y-3.5 pe-1 custom-scrollbar">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                {t("common.name")} *
              </label>
              <input
                autoFocus
                value={edit.name ?? ""}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                className="h-10 w-full rounded-xl border border-input bg-surface px-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                {t("common.phone")}
              </label>
              <input
                value={edit.phone ?? ""}
                onChange={(e) => setEdit({ ...edit, phone: e.target.value })}
                className="h-10 w-full rounded-xl border border-input bg-surface px-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                {t("common.email")}
              </label>
              <input
                type="email"
                value={edit.email ?? ""}
                onChange={(e) => setEdit({ ...edit, email: e.target.value })}
                className="h-10 w-full rounded-xl border border-input bg-surface px-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                {t("common.address")}
              </label>
              <input
                value={edit.address ?? ""}
                onChange={(e) => setEdit({ ...edit, address: e.target.value })}
                className="h-10 w-full rounded-xl border border-input bg-surface px-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <label className="flex items-center gap-2 text-sm pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={edit.is_active ?? true}
                onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/20"
              />
              {t("common.active")}
            </label>

            {hint ? <p className="text-[11px] text-muted-foreground pt-1">{hint}</p> : null}
          </div>

          <div className="mt-4 flex shrink-0 justify-end gap-2 border-t border-border/50 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-xl border border-border px-4 text-sm font-medium hover:bg-surface-2"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground transition hover:opacity-90 disabled:pointer-events-none disabled:opacity-50 shadow-md shadow-primary/20"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>{saving ? (isAr ? "جاري الحفظ..." : "Saving...") : t("common.save")}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
