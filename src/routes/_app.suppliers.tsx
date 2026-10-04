/**
 * SuppliersPage — شاشة الموردين بتصميم Vortex الحديث
 *
 * - نموذج موحّد داخل Sheet/Drawer (بدل Dialog القديم)
 * - Supplier Details Drawer مستوحى من تفاصيل العملاء: بيانات · رصيد ·
 *   إجمالي المشتريات · الفواتير · المدفوعات · سجل التعاملات
 * - Empty/Loading States موحّدة
 *
 * لا يوجد تغيير في منطق قاعدة البيانات (قراءة فقط + حفظ بيانات المورد).
 */

import { ModuleGuard } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Receipt,
  Search,
  Trash2,
  TrendingUp,
  Wallet,
  Warehouse,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { money } from "@/lib/format";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { supplierMessage } from "@/lib/whatsapp-templates";
import { toast } from "sonner";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/feedback";
import { StatusBadge } from "@/components/ui/status-badge";
import { VortexDrawerDialog, VortexMetricCard } from "@/components/vortex-ui";
import { FormField } from "@/components/ui/form-field";
import { FormGrid } from "@/components/ui/form-layout";
import { FieldInput } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { useDebtIndex } from "@/hooks/use-debts-overview";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/suppliers")({
  head: () => ({ meta: [{ title: "الموردون — فورتيكس ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="purchases">
      <SuppliersPage />
    </ModuleGuard>
  ),
});

interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  balance: number;
  is_active: boolean;
  created_at: string;
}

interface SupplierInvoice {
  id: string;
  invoice_number: string;
  total: number | null;
  paid: number | null;
  status: string | null;
  created_at: string;
}

interface SupplierReturn {
  id: string;
  return_number: string;
  total: number | null;
  created_at: string;
}

function SuppliersPage() {
  const { t, lang } = useI18n();
  const isAr = lang === "ar";
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<Partial<Supplier> | null>(null);
  const [detail, setDetail] = useState<Supplier | null>(null);

  const {
    data: rows = [],
    isLoading,
    error,
    refetch,
  } = useQuery<Supplier[]>({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Supplier[];
    },
  });

  // أرصدة مؤكَّدة من الدفتر (بدل الاعتماد على العمود المخزَّن)
  const { index: ledgerIndex } = useDebtIndex("supplier");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.phone, r.email].some((v) => (v ?? "").toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const ledgerBalanceOf = useMemo(() => {
    return (s: Supplier) => ledgerIndex.get(s.id)?.ledgerBalance ?? Number(s.balance ?? 0);
  }, [ledgerIndex]);

  const stats = useMemo(() => {
    let payable = 0;
    let credit = 0;
    let active = 0;
    for (const r of rows) {
      const bal = ledgerBalanceOf(r);
      if (bal > 0) payable += bal;
      else if (bal < 0) credit += Math.abs(bal);
      if (r.is_active) active += 1;
    }
    return { payable, credit, active, net: payable - credit };
  }, [rows, ledgerBalanceOf]);

  const columns: DataTableColumn<Supplier>[] = useMemo(
    () => [
      {
        key: "name",
        header: t("common.name"),
        cell: (r) => <p className="truncate font-medium text-foreground">{r.name || "—"}</p>,
        sortable: true,
      },
      {
        key: "phone",
        header: t("common.phone"),
        cell: (r) => (
          <span className="text-xs text-muted-foreground" dir="ltr">
            {r.phone ?? "—"}
          </span>
        ),
        hideBelow: "sm",
      },
      {
        key: "email",
        header: t("common.email"),
        cell: (r) => (
          <span className="truncate text-xs text-muted-foreground">{r.email ?? "—"}</span>
        ),
        hideBelow: "lg",
      },
      {
        key: "balance",
        header: t("common.balance"),
        align: "end",
        cell: (r) => {
          const bal = ledgerBalanceOf(r);
          return (
            <span
              className={cn(
                "font-mono font-semibold",
                bal > 0
                  ? "text-amber-600 dark:text-amber-400"
                  : bal < 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-foreground",
              )}
            >
              {money(bal)}
            </span>
          );
        },
        sortable: true,
        sortValue: ledgerBalanceOf,
      },
      {
        key: "status",
        header: t("common.status"),
        cell: (r) => (
          <StatusBadge tone={r.is_active ? "success" : "neutral"}>
            {r.is_active ? t("common.active") : t("common.inactive")}
          </StatusBadge>
        ),
      },
      {
        key: "actions",
        header: "",
        align: "end",
        cell: (r) => (
          <div className="flex justify-end gap-1.5">
            <WhatsAppButton
              phone={r.phone}
              message={supplierMessage({
                name: r.name,
                balance: money(ledgerBalanceOf(r)),
                lang,
              })}
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDetail(r);
              }}
              title={isAr ? "عرض التفاصيل" : "View details"}
              className="grid size-8 place-items-center rounded-xl border-border bg-surface text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <Receipt className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setEdit(r);
              }}
              title={t("common.edit")}
              className="grid size-8 place-items-center rounded-xl border-border bg-surface text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <Pencil className="size-3.5" />
            </button>
            <SupplierDeleteButton id={r.id} onDone={() => void refetch()} />
          </div>
        ),
      },
    ],
    [t, lang, isAr, ledgerBalanceOf, refetch],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("suppliers.title")}
        subtitle={t("suppliers.subtitle")}
        actions={
          <button
            onClick={() => setEdit({})}
            className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> {t("suppliers.new")}
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <VortexMetricCard
          title={isAr ? "إجمالي الموردين" : "Total Suppliers"}
          value={rows.length}
          icon={<Building2 className="size-5" />}
          subtitle={`${stats.active} ${isAr ? "نشط" : "active"}`}
        />
        <VortexMetricCard
          title={isAr ? "مستحق للموردين" : "Payables"}
          value={money(stats.payable)}
          tone="warning"
          icon={<Wallet className="size-5" />}
          subtitle={isAr ? "ذمم دائنة" : "Credit balances"}
        />
        <VortexMetricCard
          title={isAr ? "رصيد دائن لنا" : "Advances"}
          value={money(stats.credit)}
          tone="success"
          icon={<CheckCircle2 className="size-5" />}
          subtitle={isAr ? "مدفوع مقدماً" : "Prepaid"}
        />
        <VortexMetricCard
          title={isAr ? "الصافي" : "Net Position"}
          value={money(stats.net)}
          icon={<TrendingUp className="size-5" />}
          subtitle={isAr ? "صافي الدفتر" : "Ledger net"}
        />
      </div>

      <div className="panel-elevated p-4">
        <div className="relative mb-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("suppliers.search")}
            className="h-10 w-full rounded-full border-border bg-surface px-4 pe-10 text-sm transition focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/12"
          />
          <Search className="pointer-events-none absolute end-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>

        {error ? (
          <EmptyState
            tone="danger"
            icon={<AlertTriangle className="size-5" />}
            title={isAr ? "تعذر تحميل الموردين" : "Could not load suppliers"}
            description={error.message}
            action={
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                {isAr ? "إعادة المحاولة" : "Retry"}
              </Button>
            }
          />
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            loading={isLoading}
            initialLoading={isLoading}
            minWidth={680}
            onRowClick={(r) => setDetail(r)}
            empty={{
              icon: <Building2 className="size-5" />,
              title: search
                ? isAr
                  ? "لا توجد نتائج مطابقة"
                  : "No matching suppliers"
                : t("suppliers.no_suppliers"),
              description: isAr
                ? "سجّل أول مورد لتصدر له فواتير الشراء وتتبع المستحقات."
                : "Register your first supplier to raise purchase invoices.",
              action: (
                <button
                  onClick={() => setEdit({})}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
                >
                  <Plus className="h-4 w-4" /> {t("suppliers.new")}
                </button>
              ),
            }}
          />
        )}
      </div>

      <SupplierFormSheet
        open={edit !== null}
        initial={edit}
        onOpenChange={(open) => {
          if (!open) setEdit(null);
        }}
        onSaved={() => void refetch()}
      />

      <SupplierDetailsDrawer
        supplier={detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Delete                                                             */
/* ------------------------------------------------------------------ */

function SupplierDeleteButton({ id, onDone }: { id: string; onDone: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      title={t("common.delete")}
      onClick={async (e) => {
        e.stopPropagation();
        if (!confirm(t("suppliers.delete_confirm"))) return;
        const { error } = await supabase.from("suppliers").delete().eq("id", id);
        if (error) return toast.error(error.message);
        toast.success(t("common.deleted"));
        onDone();
      }}
      className="grid size-8 place-items-center rounded-xl border-destructive/30 bg-destructive/5 text-destructive transition hover:bg-destructive/10"
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Form sheet                                                         */
/* ------------------------------------------------------------------ */

function SupplierFormSheet({
  open,
  initial,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  initial: Partial<Supplier> | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t, lang } = useI18n();
  const isAr = lang === "ar";
  const [form, setForm] = useState<Partial<Supplier>>({});
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [seededKey, setSeededKey] = useState<string | null>(null);

  // تهيئة النموذج مرة واحدة لكل فتح بقيمة مختلفة
  const seedKey = initial?.id ?? "__new__";
  if (open && seededKey !== seedKey) {
    setSeededKey(seedKey);
    setForm({
      name: initial?.name ?? "",
      phone: initial?.phone ?? "",
      email: initial?.email ?? "",
      address: initial?.address ?? "",
      is_active: initial?.is_active ?? true,
    });
    setNameError(null);
  }

  async function submit() {
    if (saving) return;
    if (!form.name?.trim()) {
      setNameError(t("suppliers.name_required"));
      return toast.error(t("suppliers.name_required"));
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      phone: form.phone || null,
      email: form.email || null,
      address: form.address || null,
      is_active: form.is_active ?? true,
    };
    const { error } = initial?.id
      ? await supabase.from("suppliers").update(payload).eq("id", initial.id)
      : await supabase.from("suppliers").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(initial?.id ? t("common.updated") : t("common.created"));
    onOpenChange(false);
    onSaved();
  }

  return (
    <VortexDrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      eyebrow={isAr ? "الموردون" : "Suppliers"}
      icon={<Building2 className="h-5 w-5" />}
      title={initial?.id ? t("suppliers.edit") : t("suppliers.new")}
      bodyClassName="space-y-4"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            loading={saving}
            onClick={submit}
            className="rounded-xl bg-primary font-semibold text-primary-foreground"
          >
            {saving ? (isAr ? "جاري الحفظ..." : "Saving…") : t("common.save")}
          </Button>
        </div>
      }
    >
      <FormGrid cols={2}>
        <FormField label={t("common.name")} required error={nameError} span={2} icon={Building2}>
          {(p) => (
            <FieldInput
              {...p}
              value={form.name ?? ""}
              onValueChange={(v) => {
                setForm((f) => ({ ...f, name: v }));
                if (v.trim()) setNameError(null);
              }}
              placeholder={isAr ? "اسم المورد" : "Supplier name"}
            />
          )}
        </FormField>

        <FormField label={t("common.phone")} icon={Phone}>
          {(p) => (
            <FieldInput
              {...p}
              type="phone"
              value={form.phone ?? ""}
              onValueChange={(v) => setForm((f) => ({ ...f, phone: v }))}
              placeholder="+967 7XX XXX"
              dir="ltr"
            />
          )}
        </FormField>

        <FormField label={t("common.email")} icon={Mail}>
          {(p) => (
            <FieldInput
              {...p}
              type="email"
              value={form.email ?? ""}
              onValueChange={(v) => setForm((f) => ({ ...f, email: v }))}
              placeholder="name@example.com"
              dir="ltr"
            />
          )}
        </FormField>

        <FormField label={t("common.address")} icon={MapPin} span={2}>
          {(p) => (
            <FieldInput
              {...p}
              value={form.address ?? ""}
              onValueChange={(v) => setForm((f) => ({ ...f, address: v }))}
              placeholder={isAr ? "العنوان الكامل" : "Full address"}
            />
          )}
        </FormField>

        <FormField label={t("common.status")} span={2}>
          <div className="flex items-center gap-2.5 rounded-xl border-border/80 bg-surface/52 px-3 py-2.5">
            <Switch
              id="supplier-active"
              checked={form.is_active ?? true}
              onCheckedChange={(checked) => setForm((f) => ({ ...f, is_active: checked }))}
            />
            <label htmlFor="supplier-active" className="text-sm text-foreground">
              {form.is_active === false ? t("common.inactive") : t("common.active")}
            </label>
          </div>
        </FormField>
      </FormGrid>
    </VortexDrawerDialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Details drawer                                                     */
/* ------------------------------------------------------------------ */

function SupplierDetailsDrawer({
  supplier,
  onOpenChange,
}: {
  supplier: Supplier | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, lang } = useI18n();
  const isAr = lang === "ar";

  const { data: docs, isLoading: docsLoading } = useQuery<{
    invoices: SupplierInvoice[];
    returns: SupplierReturn[];
  }>({
    queryKey: ["supplier-details", supplier?.id],
    queryFn: async () => {
      if (!supplier) return { invoices: [], returns: [] };
      const [invoices, returns] = await Promise.all([
        supabase
          .from("purchase_invoices")
          .select("id,invoice_number,total,paid,status,created_at")
          .eq("supplier_id", supplier.id)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("purchase_returns")
          .select("id,return_number,total,created_at")
          .eq("supplier_id", supplier.id)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      return {
        invoices: (invoices.data ?? []) as SupplierInvoice[],
        returns: (returns.data ?? []) as SupplierReturn[],
      };
    },
    enabled: Boolean(supplier),
  });

  const invoices = useMemo(() => docs?.invoices ?? [], [docs]);
  const returns = useMemo(() => docs?.returns ?? [], [docs]);

  const totals = useMemo(() => {
    const totalPurchases = invoices.reduce((s, i) => s + Number(i.total ?? 0), 0);
    const totalPaid = invoices.reduce((s, i) => s + Number(i.paid ?? 0), 0);
    const totalReturns = returns.reduce((s, r) => s + Number(r.total ?? 0), 0);
    const outstanding = invoices.reduce(
      (s, i) => s + (Number(i.total ?? 0) - Number(i.paid ?? 0)),
      0,
    );
    const timeline = [
      ...invoices.map((i) => ({
        id: i.id,
        label: `${isAr ? "فاتورة" : "Invoice"} ${i.invoice_number}`,
        date: i.created_at,
        amount: Number(i.total ?? 0),
      })),
      ...returns.map((r) => ({
        id: r.id,
        label: `${isAr ? "مرتجع" : "Return"} ${r.return_number}`,
        date: r.created_at,
        amount: -Number(r.total ?? 0),
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return { totalPurchases, totalPaid, totalReturns, outstanding, timeline };
  }, [invoices, returns, isAr]);

  return (
    <VortexDrawerDialog
      open={Boolean(supplier)}
      onOpenChange={onOpenChange}
      size="lg"
      eyebrow={isAr ? "ملف المورد" : "Supplier profile"}
      icon={<Building2 className="h-5 w-5" />}
      title={supplier?.name ?? ""}
      subtitle={
        supplier
          ? [supplier.phone, supplier.email, supplier.address].filter(Boolean).join(" · ") ||
            undefined
          : undefined
      }
      bodyClassName="space-y-4"
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <VortexMetricCard
          title={isAr ? "الرصيد" : "Balance"}
          value={money(Number(supplier?.balance ?? 0))}
          tone={Number(supplier?.balance ?? 0) > 0 ? "warning" : "success"}
          icon={<Wallet className="size-5" />}
        />
        <VortexMetricCard
          title={isAr ? "إجمالي المشتريات" : "Total Purchases"}
          value={money(totals.totalPurchases)}
          icon={<Receipt className="size-5" />}
          subtitle={`${totals.totalReturns > 0 ? `${invoices.length} ${isAr ? "فاتورة" : "invoices"}` : ""}`}
        />
        <VortexMetricCard
          title={isAr ? "إجمالي المدفوع" : "Total Paid"}
          value={money(totals.totalPaid)}
          tone="success"
          icon={<CheckCircle2 className="size-5" />}
        />
        <VortexMetricCard
          title={isAr ? "المتبقي" : "Outstanding"}
          value={money(totals.outstanding)}
          tone={totals.outstanding > 0 ? "warning" : "success"}
          icon={<AlertTriangle className="size-5" />}
        />
      </div>

      <Tabs defaultValue="all" className="space-y-3">
        <TabsList className="w-full justify-start overflow-x-auto rounded-xl p-1">
          <TabsTrigger value="all" className="rounded-lg text-xs">
            {isAr ? "الكل" : "All"}
          </TabsTrigger>
          <TabsTrigger value="invoices" className="rounded-lg text-xs">
            {isAr ? "الفواتير" : "Invoices"}
          </TabsTrigger>
          <TabsTrigger value="payments" className="rounded-lg text-xs">
            {isAr ? "المدفوعات" : "Payments"}
          </TabsTrigger>
          <TabsTrigger value="info" className="rounded-lg text-xs">
            {isAr ? "البيانات" : "Details"}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-0">
          <Timeline entries={totals.timeline} loading={docsLoading} isAr={isAr} />
        </TabsContent>

        <TabsContent value="invoices" className="mt-0">
          <DocTable
            rows={invoices}
            loading={docsLoading}
            emptyLabel={isAr ? "لا توجد فواتير" : "No invoices"}
            hint={isAr ? "لم يُصدر لهذا المورد أي أمر شراء بعد." : "No purchase orders raised yet."}
          />
        </TabsContent>

        <TabsContent value="payments" className="mt-0">
          <DocTable
            rows={invoices.filter((i) => Number(i.paid ?? 0) > 0)}
            loading={docsLoading}
            emptyLabel={isAr ? "لا توجد مدفوعات" : "No payments"}
            paidColumn
            hint={
              isAr
                ? "تُشتقّ المدفوعات من حقل paid في فواتير الشراء."
                : "Payments are derived from the paid field on purchase invoices."
            }
          />
        </TabsContent>

        <TabsContent value="info" className="mt-0 space-y-2">
          <InfoRow icon={Phone} label={t("common.phone")} value={supplier?.phone} dir="ltr" />
          <InfoRow icon={Mail} label={t("common.email")} value={supplier?.email} dir="ltr" />
          <InfoRow icon={MapPin} label={t("common.address")} value={supplier?.address} />
          <InfoRow
            icon={Warehouse}
            label={t("common.status")}
            value={supplier?.is_active ? t("common.active") : t("common.inactive")}
          />
          {supplier?.created_at && (
            <InfoRow
              icon={Receipt}
              label={isAr ? "تاريخ التسجيل" : "Registered"}
              value={new Date(supplier.created_at).toLocaleDateString()}
            />
          )}
        </TabsContent>
      </Tabs>
    </VortexDrawerDialog>
  );
}

function Timeline({
  entries,
  loading,
  isAr,
}: {
  entries: { id: string; label: string; date: string; amount: number }[];
  loading: boolean;
  isAr: boolean;
}) {
  if (loading) {
    return (
      <ul className="space-y-1.5">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="h-14 animate-pulse rounded-xl bg-muted/50" />
        ))}
      </ul>
    );
  }
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<Receipt className="size-4" />}
        title={isAr ? "لا توجد حركات بعد" : "No activity yet"}
        description={
          isAr
            ? "ستظهر هنا كل فواتير الشراء والمرتجعات الخاصة بهذا المورد."
            : "Purchase invoices and returns will appear here."
        }
      />
    );
  }
  return (
    <ul className="space-y-1.5">
      {entries.map((e) => (
        <li
          key={e.id}
          className="flex items-center justify-between gap-3 rounded-xl border-border/70 bg-surface/60 px-3 py-2.5"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{e.label}</p>
            <p className="text-[11px] text-muted-foreground">{new Date(e.date).toLocaleString()}</p>
          </div>
          <span
            className={cn(
              "shrink-0 font-mono text-sm font-semibold",
              e.amount >= 0 ? "text-foreground" : "text-rose-600 dark:text-rose-400",
            )}
          >
            {money(e.amount)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function DocTable({
  rows,
  loading,
  emptyLabel,
  hint,
  paidColumn,
}: {
  rows: SupplierInvoice[];
  loading: boolean;
  emptyLabel: string;
  hint?: string;
  paidColumn?: boolean;
}) {
  const { lang } = useI18n();
  const isAr = lang === "ar";

  if (loading) {
    return (
      <div className="space-y-1.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-11 animate-pulse rounded-xl bg-muted/50" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Receipt className="size-4" />}
        title={emptyLabel}
        description={hint ?? (isAr ? "لا توجد سجلات." : "No records.")}
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border-border/70">
      <table className="w-full text-sm">
        <thead className="bg-surface-2/60 text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-start">{isAr ? "المستند" : "Document"}</th>
            <th className="px-3 py-2 text-start">{isAr ? "التاريخ" : "Date"}</th>
            <th className="px-3 py-2 text-end">{isAr ? "الإجمالي" : "Total"}</th>
            {paidColumn && <th className="px-3 py-2 text-end">{isAr ? "المدفوع" : "Paid"}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border/60">
              <td className="px-3 py-2 font-mono text-xs text-foreground">{r.invoice_number}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {new Date(r.created_at).toLocaleDateString()}
              </td>
              <td className="px-3 py-2 text-end font-mono text-foreground">
                {money(Number(r.total ?? 0))}
              </td>
              {paidColumn && (
                <td className="px-3 py-2 text-end font-mono text-emerald-600 dark:text-emerald-400">
                  {money(Number(r.paid ?? 0))}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  dir,
}: {
  icon: typeof Phone;
  label: string;
  value?: string | null;
  dir?: "ltr" | "rtl";
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border-border/70 bg-surface/60 px-3 py-2.5">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground" dir={dir}>
        {value || "—"}
      </span>
    </div>
  );
}
