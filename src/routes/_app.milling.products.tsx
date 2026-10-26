/**
 * /milling/products — إدارة أصناف الأمانات (حبوب خام + نواتج طحن).
 *
 * صفحة مبسّطة مخصصة لقسم المطحنة — تعرض فقط المنتجات المعلّمة
 * `is_custody_item = true` في تبويبين: حبوب خام ونواتج مطحونة.
 * الإضافة والتعديل عبر `CustodyProductFormDialog` المنبثق.
 *
 * أسباب الفصل عن `/products`:
 *  - المنتجات العامة تحمل عشرات الحقول (ضريبة، باركود، تتبع …)
 *    ومنتج الأمانة يحتاج فقط: اسم + كود + سعة العبوة.
 *  - موظف المطحنة لا يحتاج دخول كتالوج البيع بالكامل.
 *  - الأمانات معلّمة بعلم واحد `is_custody_item` ولا تختلط مع المبيعات.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  Wheat,
  Factory,
  Package,
  Plus,
  Search,
  Pencil,
  ToggleLeft,
  ToggleRight,
  Scale,
  Tag,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { ModuleGuard } from "@/lib/modules";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import {
  CustodyProductFormDialog,
  type CustodyProductFormData,
} from "@/components/milling/custody-product-form-dialog";
import {
  MillingPanel,
  MillingSectionTitle,
  MillingEmpty,
  fmtNum,
} from "@/components/milling/milling-ui";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------- route setup -- */

export const Route = createFileRoute("/_app/milling/products")({
  head: () => ({ meta: [{ title: "أصناف الأمانات — فورتكس ERP" }] }),
  component: CustodyProductsPage,
});

/* ------------------------------------------------------------ types -- */

interface CustodyProduct {
  id: string;
  sku: string;
  name: string | null;
  name_ar: string;
  item_class: string;
  is_active: boolean;
  package_weight_kg: number | null;
  sale_price: number;
  cost_price: number;
  created_at: string;
}

type TabValue = "raw" | "output";

/* --------------------------------------------------------- component -- */

function CustodyProductsPage() {
  const db = supabase as any;
  const qc = useQueryClient();

  const [tab, setTab] = useState<TabValue>("raw");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogDefaultClass, setDialogDefaultClass] = useState<
    "RAW_MATERIAL" | "FINISHED_GOOD" | "BY_PRODUCT"
  >("RAW_MATERIAL");
  const [editingProduct, setEditingProduct] = useState<CustodyProductFormData | null>(null);

  /* ---- fetch custody products ---- */
  const { data: products = [], isLoading } = useQuery({
    queryKey: ["custody-products"],
    queryFn: async () => {
      const { data, error } = await db
        .from("products")
        .select(
          "id, sku, name, name_ar, item_class, is_active, package_weight_kg, sale_price, cost_price, created_at",
        )
        .eq("is_custody_item", true)
        .order("item_class")
        .order("name_ar");
      if (error) throw error;
      return (data || []) as CustodyProduct[];
    },
  });

  /* ---- filter by tab + search ---- */
  const filtered = useMemo(() => {
    const byTab = products.filter((p) =>
      tab === "raw"
        ? p.item_class === "RAW_MATERIAL"
        : p.item_class === "FINISHED_GOOD" || p.item_class === "BY_PRODUCT",
    );
    const q = search.trim().toLowerCase();
    if (!q) return byTab;
    return byTab.filter(
      (p) =>
        (p.name_ar || "").toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q) ||
        (p.name || "").toLowerCase().includes(q),
    );
  }, [products, tab, search]);

  /* ---- counts for badges ---- */
  const rawCount = products.filter((p) => p.item_class === "RAW_MATERIAL").length;
  const outputCount = products.filter(
    (p) => p.item_class === "FINISHED_GOOD" || p.item_class === "BY_PRODUCT",
  ).length;

  /* ---- toggle active mutation ---- */
  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await db.from("products").update({ is_active: active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم تحديث الحالة");
      qc.invalidateQueries({ queryKey: ["custody-products"] });
      qc.invalidateQueries({ queryKey: ["milling"] });
    },
    onError: (err: any) => toast.error(err?.message || "فشل التحديث"),
  });

  /* ---- handlers ---- */
  const handleCreate = (cls: "RAW_MATERIAL" | "FINISHED_GOOD" | "BY_PRODUCT") => {
    setEditingProduct(null);
    setDialogDefaultClass(cls);
    setDialogOpen(true);
  };

  const handleEdit = (p: CustodyProduct) => {
    setEditingProduct({
      id: p.id,
      name_ar: p.name_ar,
      sku: p.sku,
      package_weight_kg: p.package_weight_kg,
      item_class: p.item_class as "RAW_MATERIAL" | "FINISHED_GOOD" | "BY_PRODUCT",
      is_active: p.is_active,
    });
    setDialogDefaultClass(p.item_class as any);
    setDialogOpen(true);
  };

  /* ---- class display helpers ---- */
  const classIcon = (cls: string) =>
    cls === "RAW_MATERIAL" ? Wheat : cls === "BY_PRODUCT" ? Package : Factory;
  const classLabel = (cls: string) =>
    cls === "RAW_MATERIAL" ? "حبوب خام" : cls === "BY_PRODUCT" ? "ناتج ثانوي" : "ناتج طحن";
  const classColor = (cls: string) =>
    cls === "RAW_MATERIAL"
      ? "text-amber-600 dark:text-amber-400 bg-amber-500/15"
      : cls === "BY_PRODUCT"
        ? "text-orange-600 dark:text-orange-400 bg-orange-500/15"
        : "text-emerald-600 dark:text-emerald-400 bg-emerald-500/15";

  return (
    <ModuleGuard moduleId="milling_operations">
      <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
        <PageHeader
          title="أصناف الأمانات"
          subtitle="الحبوب الخام ونواتج الطحن المستخدمة في عمليات الأمانات"
          actions={
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  handleCreate(tab === "raw" ? "RAW_MATERIAL" : "FINISHED_GOOD")
                }
                className={cn(
                  "flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold text-white transition-all",
                  "bg-gradient-to-l from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400",
                  "shadow-sm hover:shadow-md",
                )}
              >
                <Plus className="h-4 w-4" />
                {tab === "raw" ? "نوع حبوب جديد" : "ناتج طحن جديد"}
              </button>
            </div>
          }
        />

        {/* ── ملخص سريع ── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            icon={<Wheat className="h-4 w-4" />}
            label="أنواع الحبوب"
            value={rawCount}
            color="amber"
          />
          <StatCard
            icon={<Factory className="h-4 w-4" />}
            label="نواتج الطحن"
            value={outputCount}
            color="emerald"
          />
          <StatCard
            icon={<Scale className="h-4 w-4" />}
            label="إجمالي الأصناف"
            value={products.length}
            color="blue"
          />
          <StatCard
            icon={<Tag className="h-4 w-4" />}
            label="الأصناف النشطة"
            value={products.filter((p) => p.is_active).length}
            color="purple"
          />
        </div>

        {/* ── تبويبات ── */}
        <SegmentedTabs<TabValue>
          value={tab}
          onChange={setTab}
          ariaLabel="تبويبات أصناف الأمانات"
          items={[
            {
              value: "raw",
              label: "الحبوب الخام",
              icon: <Wheat className="h-3.5 w-3.5" />,
              badge: (
                <span className="mr-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                  {rawCount}
                </span>
              ),
            },
            {
              value: "output",
              label: "النواتج المطحونة",
              icon: <Factory className="h-3.5 w-3.5" />,
              badge: (
                <span className="mr-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                  {outputCount}
                </span>
              ),
            },
          ]}
        />

        {/* ── حقل البحث ── */}
        <div className="relative">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث بالاسم أو الكود..."
            className="w-full rounded-xl border border-border/60 bg-surface-1/80 py-2.5 pr-10 pl-4 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition-all"
          />
        </div>

        {/* ── قائمة الأصناف ── */}
        <MillingPanel>
          <MillingSectionTitle
            icon={tab === "raw" ? <Wheat className="h-4 w-4" /> : <Factory className="h-4 w-4" />}
            title={tab === "raw" ? "الحبوب الخام المستلمة" : "النواتج المستخرجة"}
            subtitle={
              tab === "raw"
                ? "أنواع الحبوب التي يودعها العملاء لدى المطحنة"
                : "المنتجات الناتجة عن عمليات الطحن (دقيق، نخالة …)"
            }
            action={
              <button
                onClick={() =>
                  handleCreate(
                    tab === "raw"
                      ? "RAW_MATERIAL"
                      : "FINISHED_GOOD",
                  )
                }
                className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 transition-colors hover:bg-amber-500/20"
              >
                <Plus className="h-3 w-3" />
                إضافة
              </button>
            }
          />

          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">جارِ التحميل…</span>
            </div>
          ) : filtered.length === 0 ? (
            <MillingEmpty
              title={
                search
                  ? `لا توجد أصناف تطابق «${search}»`
                  : tab === "raw"
                    ? "لم تُضف أنواع حبوب بعد"
                    : "لم تُضف نواتج طحن بعد"
              }
              hint={
                search
                  ? "جرّب البحث بكلمة أخرى"
                  : tab === "raw"
                    ? "اضغط «إضافة» بالأعلى لإنشاء أول نوع حبوب خام"
                    : "اضغط «إضافة» بالأعلى لإنشاء أول ناتج طحن"
              }
            />
          ) : (
            <div className="divide-y divide-border/40">
              {filtered.map((p) => {
                const Icon = classIcon(p.item_class);
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/30"
                  >
                    {/* أيقونة النوع */}
                    <div
                      className={cn(
                        "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
                        classColor(p.item_class),
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>

                    {/* الاسم والتفاصيل */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground truncate">
                          {p.name_ar}
                        </span>
                        {!p.is_active && (
                          <span className="rounded-md bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                            معطّل
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        {p.package_weight_kg && (
                          <span className="text-[11px] text-muted-foreground flex items-center gap-0.5">
                            <Scale className="h-3 w-3" />
                            {fmtNum(p.package_weight_kg)} كجم
                          </span>
                        )}
                        <span
                          className={cn(
                            "text-[10px] rounded-md px-1.5 py-0.5 font-medium",
                            classColor(p.item_class),
                          )}
                        >
                          {classLabel(p.item_class)}
                        </span>
                      </div>
                    </div>

                    {/* أزرار الإجراءات */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleEdit(p)}
                        title="تعديل"
                        className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() =>
                          toggleMutation.mutate({ id: p.id, active: !p.is_active })
                        }
                        title={p.is_active ? "تعطيل الصنف" : "تفعيل الصنف"}
                        className={cn(
                          "grid h-8 w-8 place-items-center rounded-lg transition-colors",
                          p.is_active
                            ? "text-emerald-600 hover:bg-emerald-500/10"
                            : "text-red-500 hover:bg-red-500/10",
                        )}
                      >
                        {p.is_active ? (
                          <ToggleRight className="h-4 w-4" />
                        ) : (
                          <ToggleLeft className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </MillingPanel>

        {/* ── نصيحة ── */}
        {tab === "output" && filtered.length > 0 && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-300">
            💡 النواتج الثانوية (نخالة / ردة) يمكن إضافتها بنوع «ناتج ثانوي» لتمييزها عن المنتج
            الرئيسي (الدقيق).
          </div>
        )}

        {/* ── Dialog ── */}
        <CustodyProductFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          defaultClass={dialogDefaultClass}
          editing={editingProduct}
        />
      </div>
    </ModuleGuard>
  );
}

/* ----------------------------------------------------------- stat card -- */

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: "amber" | "emerald" | "blue" | "purple";
}) {
  const colorMap = {
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    purple: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  };

  return (
    <div
      className={cn(
        "rounded-xl border p-3 flex items-center gap-3 transition-colors",
        colorMap[color],
      )}
    >
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/50 dark:bg-white/5">
        {icon}
      </div>
      <div>
        <p className="text-lg font-bold leading-none">{value}</p>
        <p className="text-[10px] mt-0.5 opacity-80">{label}</p>
      </div>
    </div>
  );
}
