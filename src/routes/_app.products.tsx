import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { Plus, Package, Search } from "lucide-react";

export const Route = createFileRoute("/_app/products")({
  head: () => ({ meta: [{ title: "Products — Vortex ERP" }] }),
  component: ProductsPage,
});

function ProductsPage() {
  const { t } = useI18n();
  const { data, isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, sku, barcode, sale_price, cost_price, min_stock, is_active, category:categories(name), brand:brands(name)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <>
      <PageHeader
        title={t("products.title")}
        subtitle="Catalog, pricing, barcodes and stock thresholds."
        actions={
          <button className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 transition">
            <Plus className="h-3.5 w-3.5" /> {t("common.new")}
          </button>
        }
      />

      <div className="panel-elevated overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <div className="flex h-9 flex-1 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground" placeholder="Search products, SKU, barcode..." />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 text-start font-medium">Product</th>
                <th className="px-4 py-2.5 text-start font-medium">SKU</th>
                <th className="px-4 py-2.5 text-start font-medium">Category</th>
                <th className="px-4 py-2.5 text-end font-medium">Cost</th>
                <th className="px-4 py-2.5 text-end font-medium">Price</th>
                <th className="px-4 py-2.5 text-end font-medium">Min Stock</th>
                <th className="px-4 py-2.5 text-end font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-border/60">
                  <td colSpan={7} className="px-4 py-3"><div className="h-4 w-full rounded shimmer" /></td>
                </tr>
              ))}
              {!isLoading && (data?.length ?? 0) === 0 && (
                <tr><td colSpan={7} className="px-4 py-16 text-center">
                  <div className="mx-auto grid h-10 w-10 place-items-center rounded-md bg-surface border border-border">
                    <Package className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="mt-3 text-sm text-foreground">No products yet</p>
                  <p className="text-xs text-muted-foreground">Add your first product to start tracking inventory.</p>
                </td></tr>
              )}
              {data?.map((p: any) => (
                <tr key={p.id} className="border-b border-border/60 hover:bg-accent/40 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-foreground">{p.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{p.sku ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{p.category?.name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-end font-mono">{Number(p.cost_price).toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-end font-mono text-foreground">{Number(p.sale_price).toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-end font-mono text-muted-foreground">{Number(p.min_stock)}</td>
                  <td className="px-4 py-2.5 text-end">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${p.is_active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                      {p.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
