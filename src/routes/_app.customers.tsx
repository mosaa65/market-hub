import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Users, Plus, Search, Pencil, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/customers")({
  head: () => ({ meta: [{ title: "العملاء — فورتيكس ERP" }] }),
  component: CustomersPage,
});

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  credit_limit: number;
  balance: number;
  loyalty_points: number;
  is_active: boolean;
  created_at: string;
}

function CustomersPage() {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<Partial<Customer> | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("customers").select("*").order("name");
    setRows((data ?? []) as Customer[]);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  const filtered = rows.filter(r =>
    !search || r.name.toLowerCase().includes(search.toLowerCase()) ||
    (r.phone ?? "").includes(search) || (r.email ?? "").toLowerCase().includes(search.toLowerCase())
  );

  async function save() {
    if (!edit?.name?.trim()) return toast.error(t("common.required"));
    const payload = {
      name: edit.name.trim(),
      phone: edit.phone || null,
      email: edit.email || null,
      address: edit.address || null,
      credit_limit: Number(edit.credit_limit ?? 0),
      is_active: edit.is_active ?? true,
    };
    const { error } = edit.id
      ? await supabase.from("customers").update(payload).eq("id", edit.id)
      : await supabase.from("customers").insert(payload);
    if (error) return toast.error(error.message);
    toast.success(edit.id ? t("common.updated") : t("common.created"));
    setEdit(null); await load();
  }
  async function remove(id: string) {
    if (!confirm(t("common.confirm_delete"))) return;
    const { error } = await supabase.from("customers").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("common.deleted")); await load();
  }

  return (
    <>
      <PageHeader title={t("customers.title")} subtitle={t("customers.subtitle")} />
      <div className="panel-elevated p-4">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-10 flex-1 items-center gap-2 rounded-full border border-input bg-surface px-4 text-sm">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder={lang === "ar" ? "ابحث في العملاء..." : "Search customers…"}
              className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground" />
          </div>
          <button onClick={() => setEdit({})} className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-sm shadow-primary/20 hover:opacity-90 transition">
            <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{lang === "ar" ? "عميل جديد" : "New customer"}</span>
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-start font-medium">{t("common.name")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("common.phone")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("common.email")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("customers.credit_limit")}</th>
                <th className="px-3 py-2 text-end font-medium">{t("common.balance")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("common.status")}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={7} className="py-10 text-center text-muted-foreground">{t("common.loading")}</td></tr>
              : filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-muted-foreground">
                  <Users className="mx-auto mb-2 h-8 w-8 opacity-50" />{t("customers.no_customers")}
                </td></tr>
              ) : filtered.map(r => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-surface-2/50">
                  <td className="px-3 py-2.5 font-medium">{r.name}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.phone ?? "—"}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.email ?? "—"}</td>
                  <td className="px-3 py-2.5 text-end font-mono">{money(Number(r.credit_limit))}</td>
                  <td className="px-3 py-2.5 text-end font-mono">{money(Number(r.balance))}</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${r.is_active ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : "border-border bg-muted text-muted-foreground"}`}>
                      {r.is_active ? t("common.active") : t("common.inactive")}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-end">
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => setEdit(r)} title={t("common.edit")} className="grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-muted-foreground hover:bg-surface-2 hover:text-foreground transition"><Pencil className="h-3.5 w-3.5" /></button>
                      <button onClick={() => remove(r.id)} title={t("common.delete")} className="grid h-8 w-8 place-items-center rounded-full border border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10 transition"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {edit && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4">
          <div className="panel-elevated w-full max-w-md p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{edit.id ? (lang === "ar" ? "تعديل العميل" : "Edit customer") : (lang === "ar" ? "عميل جديد" : "New customer")}</h3>
              <button onClick={() => setEdit(null)} className="rounded p-1 hover:bg-surface-2"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <Input label={`${t("common.name")} *`} value={edit.name ?? ""} onChange={v => setEdit({ ...edit, name: v })} />
              <div className="grid grid-cols-2 gap-3">
                <Input label={t("common.phone")} value={edit.phone ?? ""} onChange={v => setEdit({ ...edit, phone: v })} />
                <Input label={t("common.email")} value={edit.email ?? ""} onChange={v => setEdit({ ...edit, email: v })} type="email" />
              </div>
              <Input label={t("common.address")} value={edit.address ?? ""} onChange={v => setEdit({ ...edit, address: v })} />
              <Input label={t("customers.credit_limit")} value={String(edit.credit_limit ?? 0)} onChange={v => setEdit({ ...edit, credit_limit: Number(v) as any })} type="number" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={edit.is_active ?? true} onChange={e => setEdit({ ...edit, is_active: e.target.checked })} className="h-4 w-4 rounded border-border" />
                {t("common.active")}
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setEdit(null)} className="h-9 rounded-md border border-border px-4 text-sm hover:bg-surface-2">{t("common.cancel")}</button>
              <button onClick={save} className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">{t("common.save")}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" />
    </div>
  );
}
