import { ModuleGuard, useModules } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, Trash2, RotateCcw, Search } from "lucide-react";

export const Route = createFileRoute("/_app/purchase-returns")({
  head: () => ({ meta: [{ title: "مرتجعات المشتريات — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="returns">
      <PurchaseReturnsPage />
    </ModuleGuard>
  ),
});

interface Line {
  product_id: string;
  name: string;
  quantity: number;
  unit_cost: number;
  tax_rate: number;
}

function PurchaseReturnsPage() {
  const { isModuleEnabled } = useModules();
  const hasMultiWarehouse = isModuleEnabled("multi_warehouse");
  const { t, lang } = useI18n();
  const [purchaseReturns, setPurchaseReturns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const whName = (w?: { name: string; name_ar?: string | null } | null) =>
    !w ? "—" : lang === "ar" ? w.name_ar || w.name : w.name || w.name_ar || "—";

  async function load() {
    setLoading(true);
    const pr = await supabase
      .from("purchase_returns")
      .select("*, suppliers(name), warehouses(name,name_ar)")
      .order("created_at", { ascending: false })
      .limit(100);
    setPurchaseReturns(pr.data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = purchaseReturns.filter(
    (r) =>
      !search ||
      r.return_number.toLowerCase().includes(search.toLowerCase()) ||
      (r.suppliers?.name ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title={lang === "ar" ? "مرتجعات المشتريات" : "Purchase Returns"}
        subtitle={
          lang === "ar"
            ? "سجل وأداء مرتجعات المشتريات إلى الموردين"
            : "Track supplier purchase returns"
        }
        actions={<NewPurchaseReturn onSaved={load} />}
      />

      <div className="panel-elevated p-4">
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground rtl:left-auto rtl:right-3" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              lang === "ar"
                ? "ابحث برقم المرتجع أو اسم المورد..."
                : "Search return # or supplier..."
            }
            className="h-10 w-full rounded-md border border-input bg-surface pl-9 pr-3 text-sm rtl:pl-3 rtl:pr-9 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
        </div>

        <Card className="border-0 shadow-none bg-transparent">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead># {lang === "ar" ? "رقم المرتجع" : "Return #"}</TableHead>
                  <TableHead>{lang === "ar" ? "التاريخ" : "Date"}</TableHead>
                  <TableHead>{lang === "ar" ? "المورد" : "Supplier"}</TableHead>
                  {hasMultiWarehouse && (
                    <TableHead>{lang === "ar" ? "المستودع" : "Warehouse"}</TableHead>
                  )}
                  <TableHead>{lang === "ar" ? "طريقة الاسترداد" : "Refund Method"}</TableHead>
                  <TableHead className="text-end">{lang === "ar" ? "الإجمالي" : "Total"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      colSpan={hasMultiWarehouse ? 6 : 5}
                      className="text-center text-muted-foreground py-8"
                    >
                      {t("common.loading")}
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={hasMultiWarehouse ? 6 : 5}
                      className="text-center text-muted-foreground py-12"
                    >
                      <RotateCcw className="mx-auto mb-2 h-8 w-8 opacity-40" />
                      {lang === "ar" ? "لا توجد مرتجعات مشتريات" : "No purchase returns"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs font-semibold">
                        {r.return_number}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>{r.suppliers?.name ?? "—"}</TableCell>
                      {hasMultiWarehouse && <TableCell>{whName(r.warehouses)}</TableCell>}
                      <TableCell className="text-xs">{r.refund_method ?? "cash"}</TableCell>
                      <TableCell className="text-end font-mono font-semibold">
                        {money(Number(r.total))}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function NewPurchaseReturn({
  onSaved,
  hasMultiWarehouse,
}: {
  onSaved: () => void;
  hasMultiWarehouse?: boolean;
}) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [supplierId, setSupplierId] = useState<string>("");
  const [refundMethod, setRefundMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      supabase.from("warehouses").select("id,name,name_ar").eq("is_active", true).order("name"),
      supabase.from("suppliers").select("id,name").eq("is_active", true).order("name"),
      supabase
        .from("products")
        .select("id,name,name_ar,sku,cost_price,tax_rate")
        .eq("is_active", true)
        .order("name")
        .limit(200),
    ]).then(([w, s, p]) => {
      setWarehouses(w.data ?? []);
      setSuppliers(s.data ?? []);
      setProducts(p.data ?? []);
      if (!warehouseId && w.data?.[0]) setWarehouseId(w.data[0].id);
    });
  }, [open]);

  const filtered = useMemo(
    () =>
      products
        .filter(
          (p) =>
            !search ||
            p.name.toLowerCase().includes(search.toLowerCase()) ||
            (p.name_ar ?? "").includes(search) ||
            p.sku?.toLowerCase().includes(search.toLowerCase()),
        )
        .slice(0, 8),
    [products, search],
  );

  function addLine(p: any) {
    setLines((l) => {
      const ex = l.find((x) => x.product_id === p.id);
      if (ex) return l.map((x) => (x.product_id === p.id ? { ...x, quantity: x.quantity + 1 } : x));
      return [
        ...l,
        {
          product_id: p.id,
          name: lang === "ar" ? p.name_ar || p.name : p.name || p.name_ar,
          quantity: 1,
          unit_cost: Number(p.cost_price),
          tax_rate: Number(p.tax_rate ?? 0),
        },
      ];
    });
    setSearch("");
  }

  function removeLine(pid: string) {
    setLines((l) => l.filter((x) => x.product_id !== pid));
  }

  function updateQty(pid: string, qty: number) {
    if (qty < 1) return removeLine(pid);
    setLines((l) => l.map((x) => (x.product_id === pid ? { ...x, quantity: qty } : x)));
  }

  const total = lines.reduce((a, l) => a + l.quantity * l.unit_cost * (1 + l.tax_rate / 100), 0);

  async function save() {
    if (!warehouseId || !supplierId || lines.length === 0) {
      toast.error(t("common.fill_form"));
      return;
    }
    const { error } = await supabase.rpc("create_purchase_return" as any, {
      _invoice_id: null,
      _warehouse_id: warehouseId,
      _supplier_id: supplierId,
      _refund_method: refundMethod,
      _note: note || null,
      _items: lines as any,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      lang === "ar" ? "تم تسجيل مرتجع المشتريات بنجاح" : "Purchase return recorded successfully",
    );
    setOpen(false);
    setLines([]);
    setNote("");
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 me-1" />
          {lang === "ar" ? "مرتجع مشتريات جديد" : "New Purchase Return"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{lang === "ar" ? "إنشاء مرتجع مشتريات" : "New Purchase Return"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div
            className={`grid grid-cols-1 ${hasMultiWarehouse ? "sm:grid-cols-3" : "sm:grid-cols-2"} gap-3`}
          >
            {hasMultiWarehouse && (
              <div className="grid gap-1.5">
                <Label>{lang === "ar" ? "المستودع" : "Warehouse"}</Label>
                <Select value={warehouseId} onValueChange={setWarehouseId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {lang === "ar" ? w.name_ar || w.name : w.name || w.name_ar}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label>{lang === "ar" ? "المورد" : "Supplier"}</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={lang === "ar" ? "اختر المورد..." : "Select supplier..."}
                  />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{lang === "ar" ? "طريقة الاسترداد" : "Refund method"}</Label>
              <Select value={refundMethod} onValueChange={setRefundMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">{lang === "ar" ? "نقدًا" : "Cash"}</SelectItem>
                  <SelectItem value="card">{lang === "ar" ? "بطاقة" : "Card"}</SelectItem>
                  <SelectItem value="bank">{lang === "ar" ? "تحويل بنكي" : "Bank"}</SelectItem>
                  <SelectItem value="credit">
                    {lang === "ar" ? "خصم من رصيد المورد" : "Deduct Balance"}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="relative">
            <Label className="mb-1.5 block">
              {lang === "ar" ? "إضافة أصناف المرتجع" : "Add Return Items"}
            </Label>
            <Input
              placeholder={lang === "ar" ? "ابحث بالاسم أو الرمز..." : "Search product or SKU..."}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && filtered.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-60 overflow-auto">
                {filtered.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent text-start"
                    onClick={() => addLine(p)}
                  >
                    <span>{lang === "ar" ? p.name_ar || p.name : p.name || p.name_ar}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {money(Number(p.cost_price))}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {lines.length > 0 && (
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{lang === "ar" ? "المنتج" : "Product"}</TableHead>
                    <TableHead>{lang === "ar" ? "الكمية" : "Qty"}</TableHead>
                    <TableHead>{lang === "ar" ? "التكلفة" : "Cost"}</TableHead>
                    <TableHead className="text-end">
                      {lang === "ar" ? "الإجمالي" : "Total"}
                    </TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => (
                    <TableRow key={l.product_id}>
                      <TableCell className="font-medium">{l.name}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={1}
                          value={l.quantity}
                          onChange={(e) => updateQty(l.product_id, parseInt(e.target.value) || 1)}
                          className="w-20 h-8"
                        />
                      </TableCell>
                      <TableCell className="font-mono">{money(l.unit_cost)}</TableCell>
                      <TableCell className="text-end font-mono font-semibold">
                        {money(l.quantity * l.unit_cost * (1 + l.tax_rate / 100))}
                      </TableCell>
                      <TableCell className="text-end">
                        <button
                          type="button"
                          onClick={() => removeLine(l.product_id)}
                          className="text-destructive hover:opacity-80"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label>{lang === "ar" ? "ملاحظات" : "Notes"}</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={lang === "ar" ? "سبب المرتجع..." : "Reason for return..."}
            />
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div className="text-sm">
              <span className="text-muted-foreground">
                {lang === "ar" ? "إجمالي المرتجع:" : "Total Return:"}{" "}
              </span>
              <span className="text-lg font-bold font-mono text-primary">{money(total)}</span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={save}>{t("common.save")}</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
