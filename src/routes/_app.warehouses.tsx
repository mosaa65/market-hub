/**
 * WarehousesPage — شاشة المستودعات بتصميم Vortex الحديث
 *
 * - بطاقة/جدول موحّد مع إحصائيات مختصرة لكل مستودع (عدد الأصناف · الكمية · القيمة)
 * - Warehouse Details Drawer: بيانات · حالة · إحصائيات · مواقع التخزين المدعومة
 * - نموذج موحّد داخل Sheet/Drawer بدل Dialog القديم
 * - Empty/Loading States موحّدة
 */

import { ModuleGuard, useModules } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Boxes,
  Building2,
  CheckCircle2,
  Hash,
  Layers,
  MapPin,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Warehouse as WarehouseIcon,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/feedback";
import { StatusBadge } from "@/components/ui/status-badge";
import { VortexDrawerDialog, VortexMetricCard } from "@/components/vortex-ui";
import { FormField } from "@/components/ui/form-field";
import { FormGrid } from "@/components/ui/form-layout";
import { FieldInput } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/warehouses")({
  head: () => ({ meta: [{ title: "المستودعات — فورتيكس ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="multi_warehouse">
      <WarehousesPage />
    </ModuleGuard>
  ),
});

type Row = {
  id: string;
  name: string;
  name_ar: string | null;
  code: string | null;
  address: string | null;
  is_default: boolean;
  is_active: boolean;
};

type WarehouseStats = {
  /** number of distinct products with a stock row in this warehouse */
  skuCount: number;
  /** summed quantity across all stock rows */
  totalQty: number;
  /** summed quantity of active products with a known cost price */
  stockValue: number;
};

function WarehousesPage() {
  const { checkQuota } = useModules();
  const { t, lang } = useI18n();
  const isAr = lang === "ar";
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [detail, setDetail] = useState<Row | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["warehouses-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, name, name_ar, code, address, is_default, is_active")
        .order("is_default", { ascending: false })
        .order("name");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  /** Per-warehouse aggregates, computed once from the inventory table. */
  const { data: statsByWarehouse } = useQuery<Record<string, WarehouseStats>>({
    queryKey: ["warehouses-admin-stats"],
    queryFn: async () => {
      const [invRes, costRes] = await Promise.all([
        supabase.from("inventory").select("warehouse_id,quantity,product_id"),
        supabase.from("products").select("id,cost_price").eq("is_active", true),
      ]);
      const costByProduct = new Map<string, number>();
      for (const p of costRes.data ?? []) {
        costByProduct.set(p.id, Number(p.cost_price ?? 0));
      }
      const out: Record<string, WarehouseStats> = {};
      for (const row of invRes.data ?? []) {
        const wid = row.warehouse_id as string;
        const bucket = (out[wid] ??= { skuCount: 0, totalQty: 0, stockValue: 0 });
        bucket.skuCount += 1;
        const qty = Number(row.quantity ?? 0);
        bucket.totalQty += qty;
        bucket.stockValue += qty * (costByProduct.get(row.product_id as string) ?? 0);
      }
      return out;
    },
  });

  const emptyStats: WarehouseStats = { skuCount: 0, totalQty: 0, stockValue: 0 };
  const statsOf = (id: string) => statsByWarehouse?.[id] ?? emptyStats;

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return data ?? [];
    return (data ?? []).filter((r) =>
      [r.name, r.name_ar, r.code, r.address].some((x) => (x ?? "").toLowerCase().includes(s)),
    );
  }, [data, q]);

  const totals = useMemo(() => {
    let sku = 0;
    let qty = 0;
    let value = 0;
    let active = 0;
    for (const r of data ?? []) {
      const st = statsOf(r.id);
      sku += st.skuCount;
      qty += st.totalQty;
      value += st.stockValue;
      if (r.is_active) active += 1;
    }
    return { sku, qty, value, active, count: (data ?? []).length };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- statsOf derives from statsByWarehouse
  }, [data, statsByWarehouse]);

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("warehouses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("common.deleted") || "Deleted");
      qc.invalidateQueries({ queryKey: ["warehouses-admin"] });
      qc.invalidateQueries({ queryKey: ["warehouses"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setDefault = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("warehouses").update({ is_default: false }).neq("id", id);
      const { error } = await supabase
        .from("warehouses")
        .update({ is_default: true, is_active: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["warehouses-admin"] });
      qc.invalidateQueries({ queryKey: ["warehouses"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const displayName = (r: Row) => (isAr ? r.name_ar || r.name : r.name || r.name_ar || "—");
  const secondaryName = (r: Row) => (isAr ? r.name : r.name_ar);

  const columns: DataTableColumn<Row>[] = useMemo(
    () => [
      {
        key: "name",
        header: t("warehouses.name"),
        cell: (r) => (
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-foreground">{displayName(r)}</span>
            {r.is_default && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                <Star className="size-3" />
                {t("warehouses.is_default")}
              </span>
            )}
          </div>
        ),
        sortable: true,
        sortValue: displayName,
      },
      {
        key: "code",
        header: t("warehouses.code"),
        cell: (r) => (
          <span className="font-mono text-xs text-muted-foreground">{r.code ?? "—"}</span>
        ),
        hideBelow: "sm",
      },
      {
        key: "address",
        header: t("warehouses.address"),
        cell: (r) => (
          <span className="truncate text-xs text-muted-foreground">{r.address ?? "—"}</span>
        ),
        hideBelow: "lg",
      },
      {
        key: "skus",
        header: isAr ? "الأصناف" : "Items",
        align: "end",
        cell: (r) => (
          <span className="font-mono text-xs text-foreground">{statsOf(r.id).skuCount}</span>
        ),
        sortable: true,
        sortValue: (r) => statsOf(r.id).skuCount,
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
            {!r.is_default && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDefault.mutate(r.id);
                }}
                className="grid size-8 place-items-center rounded-xl border-border bg-surface text-muted-foreground transition hover:bg-muted hover:text-primary"
                title={t("warehouses.set_default")}
              >
                <Star className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setEditing(r);
                setFormOpen(true);
              }}
              className="grid size-8 place-items-center rounded-xl border-border bg-surface text-muted-foreground transition hover:bg-muted hover:text-foreground"
              title={t("common.edit")}
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`${t("common.delete")}?`)) remove.mutate(r.id);
              }}
              className="grid size-8 place-items-center rounded-xl border-destructive/30 bg-destructive/5 text-destructive transition hover:bg-destructive/10"
              title={t("common.delete")}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- helpers derive from t/lang/statsByWarehouse
    [t, lang, statsByWarehouse, setDefault, remove],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("warehouses.title")}
        subtitle={t("warehouses.subtitle")}
        actions={
          <button
            onClick={() => {
              const qCheck = checkQuota("warehouses", (data ?? []).length);
              if (!qCheck.allowed) {
                toast.error(isAr ? qCheck.message?.ar : qCheck.message?.en);
                return;
              }
              setEditing(null);
              setFormOpen(true);
            }}
            className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> {t("warehouses.new")}
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <VortexMetricCard
          title={isAr ? "إجمالي المستودعات" : "Warehouses"}
          value={totals.count}
          icon={<WarehouseIcon className="size-5" />}
          subtitle={`${totals.active} ${isAr ? "نشط" : "active"}`}
        />
        <VortexMetricCard
          title={isAr ? "الأصناف المخزنة" : "Stored Items"}
          value={totals.sku}
          icon={<Boxes className="size-5" />}
          subtitle={isAr ? "صنف عبر كل المستودعات" : "SKUs across all"}
        />
        <VortexMetricCard
          title={isAr ? "إجمالي الكميات" : "Total Quantity"}
          value={Math.round(totals.qty).toLocaleString("ar-YE")}
          tone="info"
          icon={<Layers className="size-5" />}
        />
        <VortexMetricCard
          title={isAr ? "قيمة المخزون" : "Stock Value"}
          value={money(totals.value)}
          tone="success"
          icon={<CheckCircle2 className="size-5" />}
          subtitle={isAr ? "بسعر التكلفة" : "At cost price"}
        />
      </div>

      <div className="panel-elevated overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <div className="relative flex-1">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("common.search")}
              className="h-10 w-full rounded-full border-border bg-surface px-4 pe-10 text-sm transition focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/12"
            />
            <Search className="pointer-events-none absolute end-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <span className="pointer-events-none absolute start-4 top-1/2 hidden -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground sm:block">
              {filtered.length}
            </span>
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={isLoading}
          initialLoading={isLoading}
          minWidth={720}
          onRowClick={(r) => setDetail(r)}
          empty={{
            icon: <Boxes className="size-5" />,
            title: q ? (isAr ? "لا توجد نتائج" : "No results") : t("warehouses.empty"),
            description: t("warehouses.empty_hint"),
            action: (
              <button
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
              >
                <Plus className="h-4 w-4" /> {t("warehouses.new")}
              </button>
            ),
          }}
        />
      </div>

      <WarehouseFormSheet
        open={formOpen}
        initial={editing}
        onOpenChange={(open) => {
          if (!open) setFormOpen(false);
        }}
        onSaved={() => {
          setFormOpen(false);
          qc.invalidateQueries({ queryKey: ["warehouses-admin"] });
          qc.invalidateQueries({ queryKey: ["warehouses"] });
        }}
      />

      <WarehouseDetailsDrawer
        warehouse={detail}
        stats={detail ? statsOf(detail.id) : emptyStats}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Form sheet                                                         */
/* ------------------------------------------------------------------ */

function WarehouseFormSheet({
  open,
  initial,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  initial: Row | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t, lang } = useI18n();
  const isAr = lang === "ar";
  const [form, setForm] = useState({
    name: "",
    name_ar: "",
    code: "",
    address: "",
    is_default: false,
    is_active: true,
  });
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [seededKey, setSeededKey] = useState<string | null>(null);

  const seedKey = initial?.id ?? "__new__";
  if (open && seededKey !== seedKey) {
    setSeededKey(seedKey);
    setForm({
      name: initial?.name ?? "",
      name_ar: initial?.name_ar ?? "",
      code: initial?.code ?? "",
      address: initial?.address ?? "",
      is_default: initial?.is_default ?? false,
      is_active: initial?.is_active ?? true,
    });
    setNameError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name_ar.trim() && !form.name.trim()) {
      setNameError(t("catalog.name_required"));
      return toast.error(t("catalog.name_required"));
    }
    setSaving(true);
    const payload = {
      name: form.name.trim() || form.name_ar.trim(),
      name_ar: form.name_ar.trim() || null,
      code: form.code.trim() || null,
      address: form.address.trim() || null,
      is_default: form.is_default,
      is_active: form.is_active,
    };
    if (form.is_default) {
      await supabase
        .from("warehouses")
        .update({ is_default: false })
        .neq("id", initial?.id ?? "00000000-0000-0000-0000-000000000000");
    }
    const { error } = initial
      ? await supabase.from("warehouses").update(payload).eq("id", initial.id)
      : await supabase.from("warehouses").insert(payload);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("common.saved") || "Saved");
    onSaved();
  }

  return (
    <VortexDrawerDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      eyebrow={isAr ? "المستودعات" : "Warehouses"}
      icon={<WarehouseIcon className="h-5 w-5" />}
      title={initial ? t("warehouses.edit") : t("warehouses.new")}
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
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <FormGrid cols={2}>
          <FormField label={t("warehouses.name_ar")} required error={nameError} icon={Building2}>
            {(p) => (
              <FieldInput
                {...p}
                value={form.name_ar}
                onValueChange={(v) => {
                  setForm((f) => ({ ...f, name_ar: v }));
                  if (v.trim()) setNameError(null);
                }}
                dir="rtl"
              />
            )}
          </FormField>

          <FormField label={t("warehouses.name")} icon={Building2}>
            {(p) => (
              <FieldInput
                {...p}
                value={form.name}
                onValueChange={(v) => setForm((f) => ({ ...f, name: v }))}
                dir="ltr"
              />
            )}
          </FormField>

          <FormField label={t("warehouses.code")} icon={Hash}>
            {(p) => (
              <FieldInput
                {...p}
                type="sku"
                value={form.code}
                onValueChange={(v) => setForm((f) => ({ ...f, code: v }))}
                placeholder="WH-01"
                dir="ltr"
              />
            )}
          </FormField>

          <FormField label={t("common.status")}>
            <div className="flex items-center gap-2.5 rounded-xl border-border/80 bg-surface/52 px-3 py-2.5">
              <Switch
                id="warehouse-active"
                checked={form.is_active}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, is_active: checked }))}
              />
              <label htmlFor="warehouse-active" className="text-sm text-foreground">
                {form.is_active ? t("common.active") : t("common.inactive")}
              </label>
            </div>
          </FormField>

          <FormField label={t("warehouses.address")} icon={MapPin} span={2}>
            {(p) => (
              <FieldInput
                {...p}
                value={form.address}
                onValueChange={(v) => setForm((f) => ({ ...f, address: v }))}
              />
            )}
          </FormField>

          <FormField label={t("warehouses.is_default")} span={2}>
            <div className="flex items-center gap-2.5 rounded-xl border-border/80 bg-surface/52 px-3 py-2.5">
              <Switch
                id="warehouse-default"
                checked={form.is_default}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, is_default: checked }))}
              />
              <label htmlFor="warehouse-default" className="text-sm text-foreground">
                {t("warehouses.set_default")}
              </label>
            </div>
          </FormField>
        </FormGrid>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </VortexDrawerDialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Details drawer                                                     */
/* ------------------------------------------------------------------ */

function WarehouseDetailsDrawer({
  warehouse,
  stats,
  onOpenChange,
}: {
  warehouse: Row | null;
  stats: WarehouseStats;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, lang } = useI18n();
  const isAr = lang === "ar";

  /** Top stocked lines — a compact proxy for "storage locations" until the
   *  schema exposes explicit bin/rack data. */
  const { data: topLines = [], isLoading: linesLoading } = useQuery({
    queryKey: ["warehouse-detail-lines", warehouse?.id],
    queryFn: async () => {
      if (!warehouse) return [];
      const { data, error } = await supabase
        .from("inventory")
        .select("quantity,products(id,name_ar,sku,cost_price)")
        .eq("warehouse_id", warehouse.id)
        .limit(200);
      if (error) throw error;
      return (data ?? []) as {
        quantity: number | null;
        products: {
          id: string;
          name: string;
          name_ar: string | null;
          sku: string | null;
          cost_price: number | null;
        } | null;
      }[];
    },
    enabled: Boolean(warehouse),
  });

  const sorted = useMemo(
    () =>
      [...topLines]
        .filter((l) => l.products)
        .sort((a, b) => Number(b.quantity ?? 0) - Number(a.quantity ?? 0))
        .slice(0, 20),
    [topLines],
  );

  const displayName = warehouse
    ? isAr
      ? warehouse.name_ar || warehouse.name
      : warehouse.name || warehouse.name_ar || "—"
    : "—";

  return (
    <VortexDrawerDialog
      open={Boolean(warehouse)}
      onOpenChange={onOpenChange}
      size="lg"
      eyebrow={isAr ? "ملف المستودع" : "Warehouse profile"}
      icon={<WarehouseIcon className="h-5 w-5" />}
      title={displayName}
      subtitle={warehouse?.address ?? undefined}
      bodyClassName="space-y-4"
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <VortexMetricCard
          title={isAr ? "الأصناف" : "Items"}
          value={stats.skuCount}
          icon={<Boxes className="size-5" />}
        />
        <VortexMetricCard
          title={isAr ? "إجمالي الكميات" : "Quantity"}
          value={Math.round(stats.totalQty).toLocaleString("ar-YE")}
          tone="info"
          icon={<Layers className="size-5" />}
        />
        <VortexMetricCard
          title={isAr ? "قيمة المخزون" : "Stock Value"}
          value={money(stats.stockValue)}
          tone="success"
          icon={<CheckCircle2 className="size-5" />}
          subtitle={isAr ? "بسعر التكلفة" : "At cost"}
        />
        <VortexMetricCard
          title={t("common.status")}
          value={warehouse?.is_active ? (isAr ? "نشط" : "Active") : isAr ? "متوقف" : "Inactive"}
          tone={warehouse?.is_active ? "success" : "neutral"}
          icon={<Star className="size-5" />}
          subtitle={
            warehouse?.is_default ? (isAr ? "المستودع الافتراضي" : "Default warehouse") : undefined
          }
        />
      </div>

      <Tabs defaultValue="info" className="space-y-3">
        <TabsList className="w-full justify-start overflow-x-auto rounded-xl p-1">
          <TabsTrigger value="info" className="rounded-lg text-xs">
            {isAr ? "البيانات" : "Details"}
          </TabsTrigger>
          <TabsTrigger value="stock" className="rounded-lg text-xs">
            {isAr ? "أعلى الأصناف" : "Top items"}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="mt-0 space-y-2">
          <InfoRow icon={Building2} label={t("warehouses.name_ar")} value={warehouse?.name_ar} />
          <InfoRow icon={Building2} label={t("warehouses.name")} value={warehouse?.name} />
          <InfoRow icon={Hash} label={t("warehouses.code")} value={warehouse?.code} dir="ltr" />
          <InfoRow icon={MapPin} label={t("warehouses.address")} value={warehouse?.address} />
          <InfoRow
            icon={Star}
            label={t("warehouses.is_default")}
            value={warehouse?.is_default ? t("common.yes") : t("common.no")}
          />
        </TabsContent>

        <TabsContent value="stock" className="mt-0">
          {linesLoading ? (
            <ul className="space-y-1.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <li key={i} className="h-12 animate-pulse rounded-xl bg-muted/50" />
              ))}
            </ul>
          ) : sorted.length === 0 ? (
            <EmptyState
              icon={<Boxes className="size-4" />}
              title={isAr ? "لا توجد أصناف" : "No items"}
              description={
                isAr
                  ? "لا يوجد رصيد مسجَّل في هذا المستودع حتى الآن."
                  : "No stock recorded in this warehouse yet."
              }
            />
          ) : (
            <ul className="space-y-1.5">
              {sorted.map((l) => {
                const qty = Number(l.quantity ?? 0);
                const value = qty * Number(l.products?.cost_price ?? 0);
                const pct = stats.totalQty > 0 ? Math.min(100, (qty / stats.totalQty) * 100) : 0;
                return (
                  <li
                    key={l.products?.id}
                    className="rounded-xl border-border/70 bg-surface/60 px-3 py-2.5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {isAr ? l.products?.name_ar || l.products?.name : l.products?.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {l.products?.sku ?? "—"}
                        </p>
                      </div>
                      <div className="shrink-0 text-end">
                        <p className="font-mono text-sm font-semibold text-foreground">
                          {qty.toFixed(2)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">{money(value)}</p>
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          qty > 0 ? "bg-primary" : "bg-destructive",
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </VortexDrawerDialog>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  dir,
}: {
  icon: typeof Hash;
  label: string;
  value?: string | null;
  dir?: "ltr" | "rtl";
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border-border/70 bg-surface/60 px-3 py-2.5">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="w-32 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground" dir={dir}>
        {value || "—"}
      </span>
    </div>
  );
}
