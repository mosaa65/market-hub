import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Search,
  ShieldCheck,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/settlements")({
  head: () => ({ meta: [{ title: "التسويات — فورتيكس ERP" }] }),
  component: SettlementsPage,
});

type SettlementRow = {
  id: string;
  movement_type: string;
  quantity: number;
  note: string | null;
  created_at: string;
  product_id: string;
  warehouse_id: string;
  created_by: string | null;
  unit_cost: number | null;
  reference: string | null;
  reference_type: string | null;
  products: { id: string; name: string; name_ar: string | null; sku: string | null } | null;
  warehouses: { id: string; name: string; name_ar: string | null; code: string | null } | null;
  profiles: { full_name: string | null } | null;
};

function SettlementsPage() {
  const { t, lang } = useI18n();
  const { hasRole, user } = useAuth();
  const canManageSettlement =
    hasRole("owner") || hasRole("manager") || hasRole("warehouse") || hasRole("accountant");
  const [query, setQuery] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["settlements"],
    queryFn: async (): Promise<SettlementRow[]> => {
      const { data, error } = await supabase
        .from("stock_movements")
        .select(
          "id, movement_type, quantity, note, created_at, product_id, warehouse_id, created_by, unit_cost, reference, reference_type, products(id,name,name_ar,sku), warehouses(id,name,name_ar,code)",
        )
        .in("movement_type", [
          "adjustment",
          "purchase",
          "sale",
          "transfer_in",
          "transfer_out",
          "return_in",
          "return_out",
          "opening",
          "purchase_return",
          "sale_return",
        ])
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;

      const rows = data ?? [];

      // لا توجد علاقة مباشرة بين stock_movements و profiles،
      // لذا نجلب أسماء المستخدمين بطلب منفصل ونطابقها عبر created_by.
      const creatorIds = Array.from(
        new Set(rows.map((row) => row.created_by).filter((id): id is string => Boolean(id))),
      );
      let profilesByUser: Record<string, { full_name: string | null }> = {};
      if (creatorIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", creatorIds);
        if (!profilesError && profiles) {
          profilesByUser = Object.fromEntries(
            profiles.map((profile) => [profile.id, { full_name: profile.full_name }]),
          );
        }
      }

      return rows.map((row) => ({
        ...row,
        profiles: row.created_by ? (profilesByUser[row.created_by] ?? null) : null,
      }));
    },
    enabled: canManageSettlement,
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data ?? [];
    return (data ?? []).filter((row) => {
      const productLabel =
        `${row.products?.name ?? ""} ${row.products?.name_ar ?? ""} ${row.products?.sku ?? ""}`.toLowerCase();
      const warehouseLabel =
        `${row.warehouses?.name ?? ""} ${row.warehouses?.name_ar ?? ""}`.toLowerCase();
      const userLabel = row.profiles?.full_name?.toLowerCase() ?? "";
      return (
        productLabel.includes(q) ||
        warehouseLabel.includes(q) ||
        userLabel.includes(q) ||
        (row.note ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, query]);

  if (!canManageSettlement) {
    return (
      <div className="panel-elevated rounded-3xl border border-border/80 bg-surface/90 p-8 text-center">
        <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <h3 className="text-lg font-semibold text-foreground">
          {lang === "ar" ? "لا يوجد صلاحية للتسويات" : "Settlement access denied"}
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {lang === "ar"
            ? "يحتاج المستخدم إلى صلاحية المخزون أو الإدارة لمشاهدة سجل التسويات."
            : "Inventory or admin access is required to view settlement records."}
        </p>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={lang === "ar" ? "التسويات والمراجعة" : "Stock Settlements"}
        subtitle={
          lang === "ar"
            ? "سجل واضح لكل حركة مخزون وتعديل مع مطابقة المستخدم والتاريخ والسبب"
            : "Clear audit trail for stock changes and review steps"
        }
      />
      <div className="panel-elevated overflow-hidden rounded-3xl border border-border/80 bg-surface/90 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 p-3.5">
          <div className="flex h-10 flex-1 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm shadow-2xs">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                lang === "ar"
                  ? "بحث في المنتج أو المستودع أو المستخدم أو السبب"
                  : "Search product, warehouse, user or reason"
              }
              className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground text-sm"
            />
          </div>
          <div className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold text-amber-600 dark:text-amber-300">
            {filtered.length} {lang === "ar" ? "حركة" : "records"}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 text-start font-medium">
                  {lang === "ar" ? "المنتج" : "Product"}
                </th>
                <th className="px-4 py-2.5 text-start font-medium">
                  {lang === "ar" ? "المستودع" : "Warehouse"}
                </th>
                <th className="px-4 py-2.5 text-start font-medium">
                  {lang === "ar" ? "النوع" : "Type"}
                </th>
                <th className="px-4 py-2.5 text-end font-medium">
                  {lang === "ar" ? "الكمية" : "Qty"}
                </th>
                <th className="px-4 py-2.5 text-start font-medium">
                  {lang === "ar" ? "السبب" : "Reason"}
                </th>
                <th className="px-4 py-2.5 text-start font-medium">
                  {lang === "ar" ? "المستخدم" : "User"}
                </th>
                <th className="px-4 py-2.5 text-start font-medium">
                  {lang === "ar" ? "التاريخ/الوقت" : "Date & time"}
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    {t("common.loading")}
                  </td>
                </tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center text-muted-foreground">
                    <ClipboardList className="mx-auto mb-3 h-8 w-8 opacity-60" />
                    {lang === "ar" ? "لا توجد حركات تسوية بعد" : "No settlement movements yet"}
                  </td>
                </tr>
              )}
              {filtered.map((row) => {
                const productName =
                  lang === "ar"
                    ? row.products?.name_ar || row.products?.name || "—"
                    : row.products?.name || row.products?.name_ar || "—";
                const warehouseName =
                  lang === "ar"
                    ? row.warehouses?.name_ar || row.warehouses?.name || "—"
                    : row.warehouses?.name || row.warehouses?.name_ar || "—";
                const movementLabel =
                  row.movement_type === "adjustment"
                    ? lang === "ar"
                      ? "تسوية"
                      : "Adjustment"
                    : row.movement_type;
                const isPositive = Number(row.quantity) >= 0;
                return (
                  <tr
                    key={row.id}
                    className="border-b border-border/60 hover:bg-accent/40 transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-foreground">{productName}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {row.products?.sku ?? "—"}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Warehouse className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{warehouseName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${isPositive ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : "border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-300"}`}
                      >
                        {movementLabel}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-end font-mono text-foreground">
                      {Number(row.quantity).toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {row.note || row.reference || (lang === "ar" ? "بدون سبب" : "No note")}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {row.profiles?.full_name ??
                        user?.email ??
                        (lang === "ar" ? "غير معروف" : "Unknown")}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
