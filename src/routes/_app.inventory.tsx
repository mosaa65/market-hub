import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Warehouse, Search, ArrowUpDown, AlertTriangle, X, Plus, Minus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/inventory")({
  head: () => ({ meta: [{ title: "Inventory — Vortex ERP" }] }),
  component: InventoryPage,
});

type Row = {
  id: string;
  name: string;
  sku: string | null;
  min_stock: number;
  inventory: { warehouse_id: string; quantity: number }[];
};

function InventoryPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [adjust, setAdjust] = useState<{ product: Row } | null>(null);

  const { data: warehouses } = useQuery({
    queryKey: ["warehouses"],
    queryFn: async () => {
      const { data, error } = await supabase.from("warehouses").select("id, name, code, is_default").eq("is_active", true).order("is_default", { ascending: false });
      if (error) throw error;
      const list = data ?? [];
      if (list.length && !warehouseId) setWarehouseId(list[0].id);
      return list;
    },
  });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["inventory"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, sku, min_stock, inventory(warehouse_id, quantity)")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows.filter((r) => !q || r.name.toLowerCase().includes(q) || (r.sku ?? "").toLowerCase().includes(q));
  }, [rows, query]);

  function qtyFor(r: Row) {
    if (!warehouseId) return r.inventory.reduce((a, i) => a + Number(i.quantity), 0);
    return Number(r.inventory.find((i) => i.warehouse_id === warehouseId)?.quantity ?? 0);
  }

  return (
    <>
      <PageHeader
        title={t("inventory.title")}
        subtitle={t("inventory.subtitle")}
      />

      <div className="panel-elevated overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="flex h-9 flex-1 min-w-[200px] items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={t("inventory.search")}
              className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
            />
          </div>
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none"
          >
            <option value="">{t("inventory.all_warehouses")}</option>
            {(warehouses ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <span className="text-[11px] text-muted-foreground tabular-nums">{filtered.length} {lang === "ar" ? "عنصر" : "items"}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 text-start font-medium">{t("products.product")}</th>
                <th className="px-4 py-2.5 text-start font-medium">SKU</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("products.min")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("inventory.on_hand")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("common.status")}</th>
                <th className="px-4 py-2.5 text-end font-medium">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-border/60">
                  <td colSpan={6} className="px-4 py-3"><div className="h-4 w-full rounded shimmer" /></td>
                </tr>
              ))}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-16 text-center">
                  <div className="mx-auto grid h-10 w-10 place-items-center rounded-md bg-surface border border-border">
                    <Warehouse className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="mt-3 text-sm text-foreground">{t("inventory.no_inventory")}</p>
                  <p className="text-xs text-muted-foreground">{t("inventory.empty_hint")}</p>
                </td></tr>
              )}
              {filtered.map((r) => {
                const q = qtyFor(r);
                const low = q <= Number(r.min_stock);
                return (
                  <tr key={r.id} className="border-b border-border/60 hover:bg-accent/40 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-foreground">{r.name}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{r.sku ?? "—"}</td>
                    <td className="px-4 py-2.5 text-end font-mono text-muted-foreground">{Number(r.min_stock)}</td>
                    <td className="px-4 py-2.5 text-end font-mono text-foreground">{q.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-end">
                      {low ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
                          <AlertTriangle className="h-3 w-3" /> {t("inventory.low")}
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">{t("inventory.ok")}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-end">
                      <button
                        onClick={() => setAdjust({ product: r })}
                        disabled={!warehouseId}
                        title={!warehouseId ? t("inventory.select_warehouse") : t("inventory.adjust_stock")}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-xs text-muted-foreground hover:text-foreground transition disabled:opacity-40"
                      ><ArrowUpDown className="h-3 w-3" /> {t("inventory.adjust")}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {adjust && warehouseId && (
        <AdjustDialog
          product={adjust.product}
          warehouseId={warehouseId}
          currentQty={qtyFor(adjust.product)}
          onClose={() => setAdjust(null)}
          onSaved={() => {
            setAdjust(null);
            qc.invalidateQueries({ queryKey: ["inventory"] });
          }}
        />
      )}
    </>
  );
}

function AdjustDialog({
  product, warehouseId, currentQty, onClose, onSaved,
}: {
  product: Row; warehouseId: string; currentQty: number;
  onClose: () => void; onSaved: () => void;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [mode, setMode] = useState<"in" | "out">("in");
  const [qty, setQty] = useState("1");
  const [unitCost, setUnitCost] = useState("0");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = Number(qty);
    if (!q || q <= 0) { toast.error(t("inventory.qty_required")); return; }
    setSaving(true);
    const signed = mode === "in" ? q : -q;
    const newQty = currentQty + signed;
    if (newQty < 0) { toast.error(t("inventory.negative")); setSaving(false); return; }

    // 1) upsert inventory row
    const { error: invErr } = await supabase
      .from("inventory")
      .upsert(
        { product_id: product.id, warehouse_id: warehouseId, quantity: newQty },
        { onConflict: "product_id,warehouse_id" }
      );
    if (invErr) { toast.error(invErr.message); setSaving(false); return; }

    // 2) log stock movement
    const { error: mvErr } = await supabase.from("stock_movements").insert({
      product_id: product.id,
      warehouse_id: warehouseId,
      movement_type: "adjustment",
      quantity: signed,
      unit_cost: Number(unitCost) || 0,
      note: note || null,
      created_by: user?.id ?? null,
    });
    if (mvErr) { toast.error(mvErr.message); setSaving(false); return; }

    toast.success(t("inventory.adjusted"));
    setSaving(false);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="panel-elevated w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t("inventory.adjust_stock")}</h2>
            <p className="text-[11px] text-muted-foreground">{product.name} · {t("inventory.on_hand")}: <span className="font-mono">{currentQty.toFixed(2)}</span></p>
          </div>
          <button type="button" onClick={onClose} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-5">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button" onClick={() => setMode("in")}
              className={`flex h-10 items-center justify-center gap-1.5 rounded-md border text-sm font-medium transition ${mode === "in" ? "border-success/50 bg-success/10 text-success" : "border-border bg-surface text-muted-foreground"}`}
            ><Plus className="h-4 w-4" /> {t("inventory.stock_in")}</button>
            <button
              type="button" onClick={() => setMode("out")}
              className={`flex h-10 items-center justify-center gap-1.5 rounded-md border text-sm font-medium transition ${mode === "out" ? "border-destructive/50 bg-destructive/10 text-destructive" : "border-border bg-surface text-muted-foreground"}`}
            ><Minus className="h-4 w-4" /> {t("inventory.stock_out")}</button>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t("common.quantity")}</span>
            <input type="number" step="0.01" min="0" value={qty} onChange={(e) => setQty(e.target.value)} className="h-9 rounded-md border border-border bg-surface px-3 text-sm outline-none" required autoFocus />
          </label>

          {mode === "in" && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t("inventory.unit_cost")}</span>
              <input type="number" step="0.01" min="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className="h-9 rounded-md border border-border bg-surface px-3 text-sm outline-none" />
            </label>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t("common.note")}</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="rounded-md border border-border bg-surface p-3 text-sm outline-none resize-none" placeholder={t("inventory.reason")} />
          </label>

          <div className="rounded-md border border-border bg-surface/60 p-3 text-xs">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>{t("inventory.new_on_hand")}</span>
              <span className="font-mono text-foreground">{(currentQty + (mode === "in" ? Number(qty) : -Number(qty || 0))).toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-surface/40 px-5 py-3">
          <button type="button" onClick={onClose} className="flex h-9 items-center rounded-md border border-border bg-surface px-3 text-xs font-medium text-muted-foreground hover:text-foreground transition">{t("common.cancel")}</button>
          <button type="submit" disabled={saving} className="flex h-9 items-center rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground hover:opacity-90 transition disabled:opacity-50">
            {saving ? t("common.saving") : t("inventory.apply")}
          </button>
        </div>
      </form>
    </div>
  );
}
