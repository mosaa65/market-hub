import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ClipboardList, Plus, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ModuleGuard } from "@/lib/modules";
import { useAuth } from "@/lib/auth";
import { MillingPanel } from "@/components/milling/milling-ui";
import {
  loadProductionOrderHistory,
  reverseProductionOrder,
  type ProductionOrderSummary,
} from "@/lib/production/production-orders";
import { translateRpcError } from "@/lib/errors/rpc-errors";

export const Route = createFileRoute("/_app/milling/production-orders")({
  head: () => ({ meta: [{ title: "سجل تشغيلات الإنتاج — فورتكس ERP" }] }),
  component: ProductionOrderHistoryPage,
});

function ProductionOrderHistoryPage() {
  const queryClient = useQueryClient();
  const { hasRole } = useAuth();
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["company-production-order-history"],
    queryFn: loadProductionOrderHistory,
  });
  const reversal = useMutation({
    mutationFn: (input: { orderId: string; reason: string }) =>
      reverseProductionOrder(input.orderId, input.reason),
    onSuccess: async (_id, input) => {
      toast.success(`تم عكس تشغيلة الإنتاج: ${input.reason}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["company-production-order-history"] }),
        queryClient.invalidateQueries({ queryKey: ["company-production"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory"] }),
        queryClient.invalidateQueries({ queryKey: ["milling"] }),
      ]);
    },
    onError: (error) =>
      toast.error(translateRpcError(error, "ar", "تعذر عكس التشغيلة. قد تكون لها حركات مخزون لاحقة.")),
  });

  const centersById = useMemo(
    () => new Map((query.data?.centers ?? []).map((center) => [center.id, center.name_ar || center.name])),
    [query.data?.centers],
  );
  const visibleOrders = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("ar");
    return (query.data?.orders ?? []).filter((order) => {
      if (!normalized) return true;
      const center = centersById.get(order.cost_center_id) ?? "";
      return `${order.order_number} ${center} ${order.production_date}`
        .toLocaleLowerCase("ar")
        .includes(normalized);
    });
  }, [centersById, query.data?.orders, search]);

  const canReverse = hasRole("owner") || hasRole("manager") || hasRole("accountant");
  const statusLabel = (status: string) =>
    status === "POSTED"
      ? "مرحّلة"
      : status === "REVERSED"
        ? "معكوسة"
        : status === "CANCELLED"
          ? "ملغاة"
          : status;
  const money = (value: number | string) =>
    new Intl.NumberFormat("ar-YE", { maximumFractionDigits: 2 }).format(Number(value) || 0);

  return (
    <ModuleGuard moduleId="milling_operations">
      <div className="mx-auto max-w-screen-2xl space-y-5 p-3 sm:p-5 lg:p-6">
        <PageHeader
          title="سجل تشغيلات الإنتاج"
          subtitle="متابعة التشغيلات المرحلة وتكاليف المواد والتحويل ومخرجات المخزون."
          actions={
            <Link
              to="/milling/manufacture"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:opacity-90"
            >
              <Plus className="size-4" /> تشغيلة جديدة
            </Link>
          }
        />

        <MillingPanel>
          <div className="flex flex-col gap-3 border-b border-border/60 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
                <ClipboardList className="size-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold">سجل الإنتاج</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  عكس التشغيلة ينشئ قيوداً عكسية ويرد المواد إذا لم توجد حركات لاحقة على الأصناف أو الدفعات.
                </p>
              </div>
            </div>
            <label className="relative block w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ابحث برقم التشغيلة أو المركز"
                aria-label="البحث في تشغيلات الإنتاج"
                className="h-10 w-full rounded-xl border border-input bg-background ps-9 pe-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
          </div>

          {query.isLoading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">جارٍ تحميل سجل الإنتاج…</div>
          ) : query.error ? (
            <div className="m-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              تعذر تحميل التشغيلات. {String(query.error)}
            </div>
          ) : visibleOrders.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-10 text-center">
              <ClipboardList className="size-8 text-muted-foreground/60" />
              <p className="text-sm font-semibold">
                {search ? "لا توجد تشغيلات تطابق البحث." : "لم تُسجل أي تشغيلة إنتاج بعد."}
              </p>
              {!search && (
                <Link
                  to="/milling/manufacture"
                  className="inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline"
                >
                  ابدأ تشغيلة إنتاج <ArrowRight className="size-4" />
                </Link>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1020px] text-start text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-muted-foreground">
                    <th className="p-3">رقم التشغيلة</th>
                    <th className="p-3">التاريخ</th>
                    <th className="p-3">مركز التكلفة</th>
                    <th className="p-3">الحالة</th>
                    <th className="p-3">تكلفة المواد</th>
                    <th className="p-3">تكاليف التحويل</th>
                    <th className="p-3">إجمالي التكلفة</th>
                    <th className="p-3">تكلفة النواتج</th>
                    {canReverse && <th className="p-3">الإجراء</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleOrders.map((order: ProductionOrderSummary) => (
                    <tr key={order.id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="p-3 font-mono font-bold">{order.order_number}</td>
                      <td className="p-3">{order.production_date}</td>
                      <td className="p-3">{centersById.get(order.cost_center_id) ?? "—"}</td>
                      <td className="p-3" title={order.reversal_reason ?? undefined}>
                        <span
                          className={`inline-flex rounded-full px-2 py-1 font-semibold ${
                            order.status === "POSTED"
                              ? "bg-emerald-500/10 text-emerald-700"
                              : order.status === "REVERSED"
                                ? "bg-rose-500/10 text-rose-700"
                                : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {statusLabel(order.status)}
                        </span>
                      </td>
                      <td className="p-3 tabular-nums">{money(order.material_cost)}</td>
                      <td className="p-3 tabular-nums">{money(order.conversion_cost)}</td>
                      <td className="p-3 font-bold tabular-nums">{money(order.total_cost)}</td>
                      <td className="p-3 tabular-nums">{money(order.output_cost)}</td>
                      {canReverse && (
                        <td className="p-3">
                          {order.status === "POSTED" && (
                            <button
                              type="button"
                              disabled={reversal.isPending}
                              title="عكس التشغيلة قبل الحركات اللاحقة"
                              aria-label={`عكس تشغيلة الإنتاج ${order.order_number}`}
                              onClick={() => {
                                const reason = window.prompt(`سبب عكس تشغيلة الإنتاج ${order.order_number}`);
                                if (reason?.trim()) {
                                  reversal.mutate({ orderId: order.id, reason: reason.trim() });
                                }
                              }}
                              className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-amber-500/10 hover:text-amber-700 disabled:opacity-50"
                            >
                              <RotateCcw className="size-4" />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t border-border/60 p-3 text-[11px] text-muted-foreground">
            يعرض آخر {query.data?.orders.length ?? 0} تشغيلة. تظهر تكلفة المنتج في بطاقة حركة المخزون وتتبع البيع.
          </div>
        </MillingPanel>
      </div>
    </ModuleGuard>
  );
}
