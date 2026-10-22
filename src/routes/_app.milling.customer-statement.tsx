/**
 * /milling/customer-statement — واجهة الأمانات الشاملة (Customer Custody Hub).
 *
 * مصممة بذات مستوى الفخامة والترتيب المعتمد في واجهة المخزون:
 *   1. بطاقات إحصائية فخمة (KPIs) ترصد إجمالي الأمانات، الحبوب، والنواتج.
 *   2. أنماط عرض متعددة (جدول بيانات متقدم، بطاقات تفاعلية، عرض مضغوط).
 *   3. شريط فلاتر وبحث لحظي ذكي (بالعميل، بالصنف، بالكود، بالمستودع، ونوع الأمانة).
 *   4. اختصارات ذكية للإجراءات السريعة:
 *      - فورم طحن فوري أنيق وعالي الدقة لحبوب العميل.
 *      - فورم تسليم نواتج مباشر بنقرة زر وسند تسليم رسمي.
 *      - كشف حركات تفصيلي لكل عميل مع خيارات الطباعة الفاخرة والمشاركة عبر واتساب.
 */
import { createFileRoute, useSearch, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import {
  Scale,
  Cog,
  PackageCheck,
  Search,
  Filter,
  LayoutGrid,
  List,
  TableProperties,
  Sparkles,
  Plus,
  Trash2,
  ChevronLeft,
  Check,
  AlertCircle,
  Phone,
  Warehouse,
  User,
  RefreshCw,
  Printer,
  Share2,
  Eye,
  CheckCircle2,
  FileText,
  Clock,
  X,
  Wheat,
  Boxes,
  ArrowRight,
  TrendingDown,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ModuleGuard } from "@/lib/modules";
import { LuxuryPrintPreviewModal } from "@/components/luxury-print-preview-modal";
import { UnifiedPrintModal } from "@/components/milling/unified-print-modal";
import { DocumentShareDialog } from "@/components/communication/document-share-dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchCustodyStatement,
  fetchCustodyServiceMoney,
  fetchOutputItems,
  fetchGrainItems,
  custodyMilling,
  custodyDelivery,
  buildMillingDocumentUnifiedDoc,
  buildCustodyDeliveryDoc,
  type CustodyStatementRow,
  type CustodyMoneyRow,
  type CustodyLine,
  type ProductOption,
} from "@/lib/milling";
import {
  MillingPanel,
  MillingField,
  MillingInput,
  MillingSelect,
  MillingTextarea,
  Pill,
  Mono,
  MillingEmpty,
  fmtNum,
} from "@/components/milling/milling-ui";
import { QuantityInput } from "@/components/ui/quantity-input";
import { getCompanyCurrencySymbol } from "@/lib/format";
import { usePersistedViewMode } from "@/hooks/use-persisted-view-mode";
import type { RecordsViewMode } from "@/components/ui/records-view";
import type { UnifiedDocumentData } from "@/lib/templates/types";

export const Route = createFileRoute("/_app/milling/customer-statement")({
  validateSearch: (search: Record<string, unknown>): { customerId?: string } => ({
    customerId: typeof search.customerId === "string" ? search.customerId : undefined,
  }),
  head: () => ({ meta: [{ title: "الأمانات — فورتكس ERP" }] }),
  component: CustomerCustodyPage,
});

type TypeFilter = "ALL" | "RAW" | "OUTPUT" | "ACTIVE" | "ZERO";

const PRESET_CAPACITIES = [50, 40, 25, 20, 10];

function CustomerCustodyPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const currencySymbol = useMemo(() => getCompanyCurrencySymbol(), []);
  const { customerId: preselectedCustomerId } = useSearch({
    from: "/_app/milling/customer-statement",
  });

  /* Unified records vocabulary: cards | list (was "compact") | table — persisted per screen. */
  const [viewMode, setViewMode] = usePersistedViewMode("milling-custody", "table");

  function changeViewMode(mode: RecordsViewMode) {
    setViewMode(mode);
  }

  // معايير البحث والفلترة
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedWarehouse, setSelectedWarehouse] = useState("ALL");
  const [selectedCustomer, setSelectedCustomer] = useState(preselectedCustomerId || "ALL");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ACTIVE");

  // حالات النوافذ المنبثقة
  const [millingModalOpen, setMillingModalOpen] = useState(false);
  const [deliveryModalOpen, setDeliveryModalOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState<CustodyStatementRow | null>(null);

  // حالات الطباعة والمشاركة
  const [printDoc, setPrintDoc] = useState<UnifiedDocumentData | null>(null);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareData, setShareData] = useState<{
    customerName: string;
    phone?: string;
    docNumber?: string;
  } | null>(null);

  // استعلام سجلات كشف الأمانات
  const statementQuery = useQuery({
    queryKey: ["milling", "custody-statement"],
    queryFn: () => fetchCustodyStatement(),
  });

  // استعلام المستودعات للفلترة
  const warehousesQuery = useQuery({
    queryKey: ["milling", "warehouses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, name, name_ar")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // استعلام العملاء للفلترة
  const customersQuery = useQuery({
    queryKey: ["milling", "customers-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, phone")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // استعلام أصناف النواتج والحبوب لنماذج الطحن والتسليم
  const outputItemsQuery = useQuery({
    queryKey: ["milling", "output-items"],
    queryFn: fetchOutputItems,
  });

  const grainItemsQuery = useQuery({
    queryKey: ["milling", "grain-items"],
    queryFn: fetchGrainItems,
  });

  const rawRows = statementQuery.data ?? [];

  // الإحصائيات العلوية (KPIs)
  const stats = useMemo(() => {
    let totalRemainingBags = 0;
    let totalRemainingKg = 0;
    let rawBags = 0;
    let rawKg = 0;
    let outputBags = 0;
    let outputKg = 0;
    const activeCustomers = new Set<string>();
    const activeWarehouses = new Set<string>();

    for (const r of rawRows) {
      const remB = Number(r.remaining_bags ?? 0);
      const remK = Number(r.remaining_kg ?? 0);

      if (remB > 0 || remK > 0) {
        totalRemainingBags += remB;
        totalRemainingKg += remK;
        activeCustomers.add(r.customer_id);
        activeWarehouses.add(r.warehouse_id);

        if (r.item_class === "RAW_MATERIAL") {
          rawBags += remB;
          rawKg += remK;
        } else {
          outputBags += remB;
          outputKg += remK;
        }
      }
    }

    return {
      totalRemainingBags,
      totalRemainingKg,
      rawBags,
      rawKg,
      outputBags,
      outputKg,
      activeCustomersCount: activeCustomers.size,
      activeWarehousesCount: activeWarehouses.size,
    };
  }, [rawRows]);

  // تصفية السجلات
  const filteredRows = useMemo(() => {
    let list = rawRows;

    // تصفية العميل
    if (selectedCustomer !== "ALL") {
      list = list.filter((r) => r.customer_id === selectedCustomer);
    }

    // تصفية المستودع
    if (selectedWarehouse !== "ALL") {
      list = list.filter((r) => r.warehouse_id === selectedWarehouse);
    }

    // تصفية نوع الأمانة والرصيد
    if (typeFilter === "RAW") {
      list = list.filter(
        (r) => r.item_class === "RAW_MATERIAL" && (r.remaining_bags > 0 || r.remaining_kg > 0),
      );
    } else if (typeFilter === "OUTPUT") {
      list = list.filter(
        (r) => r.item_class !== "RAW_MATERIAL" && (r.remaining_bags > 0 || r.remaining_kg > 0),
      );
    } else if (typeFilter === "ACTIVE") {
      list = list.filter((r) => Number(r.remaining_bags) > 0 || Number(r.remaining_kg) > 0);
    } else if (typeFilter === "ZERO") {
      list = list.filter((r) => Number(r.remaining_bags) <= 0 && Number(r.remaining_kg) <= 0);
    }

    // البحث النصي
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      list = list.filter(
        (r) =>
          (r.customer_name_ar || "").toLowerCase().includes(q) ||
          (r.item_name_ar || "").toLowerCase().includes(q) ||
          (r.sku || "").toLowerCase().includes(q) ||
          (r.warehouse_name_ar || "").toLowerCase().includes(q),
      );
    }

    return list;
  }, [rawRows, selectedCustomer, selectedWarehouse, typeFilter, searchTerm]);

  // فتح نافذة الطحن المباشر لصنف محدد
  function openMilling(row: CustodyStatementRow) {
    setSelectedRow(row);
    setMillingModalOpen(true);
  }

  // فتح نافذة التسليم المباشر لصنف محدد
  function openDelivery(row: CustodyStatementRow) {
    setSelectedRow(row);
    setDeliveryModalOpen(true);
  }

  // فتح سجل حركات العميل
  function openHistory(row: CustodyStatementRow) {
    setSelectedRow(row);
    setHistoryModalOpen(true);
  }

  return (
    <ModuleGuard moduleId="milling_operations">
      <div className="mx-auto max-w-7xl space-y-4 p-4">
        {/* رأس الصفحة مع أزرار الإجراءات السريعة */}
        <PageHeader
          title="الأمانات"
          subtitle="متابعة وإدارة أمانات العملاء العينية، الأرصدة المتبقية، الطحن المباشر، وتسليم النواتج."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedRow(null);
                  setMillingModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-amber-600 active:scale-95"
              >
                <Cog className="h-4 w-4" />
                طحن أمانة حبوب
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedRow(null);
                  setDeliveryModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700 active:scale-95"
              >
                <PackageCheck className="h-4 w-4" />
                تسليم نواتج أمانة
              </button>

              <button
                type="button"
                onClick={() => void qc.invalidateQueries({ queryKey: ["milling"] })}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
                title="تحديث البيانات"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">تحديث</span>
              </button>
            </div>
          }
        />

        {/* بطاقات الإحصائيات العلوية الفخمة (KPIs) */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* إجمالي رصيد الأمانات */}
          <div className="rounded-2xl border border-border/80 bg-surface-1/90 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">
                إجمالي رصيد الأمانات
              </span>
              <div className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10 text-primary">
                <Scale className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-black tabular-nums text-foreground">
                {fmtNum(stats.totalRemainingBags)}
              </span>
              <span className="text-xs font-bold text-muted-foreground">كيس</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              الوزن الصافي:{" "}
              <strong className="text-foreground">{fmtNum(stats.totalRemainingKg)}</strong> كجم
            </p>
          </div>

          {/* حبوب خام بانتظار الطحن */}
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                حبوب خام (بانتظار الطحن)
              </span>
              <div className="grid h-8 w-8 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                <Wheat className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-black tabular-nums text-amber-600 dark:text-amber-400">
                {fmtNum(stats.rawBags)}
              </span>
              <span className="text-xs font-bold text-muted-foreground">كيس</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              الوزن: <strong className="text-foreground">{fmtNum(stats.rawKg)}</strong> كجم بانتظار
              الطحن
            </p>
          </div>

          {/* نواتج جاهزة للتسليم */}
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                نواتج (جاهزة للتسليم)
              </span>
              <div className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <Boxes className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-black tabular-nums text-emerald-600 dark:text-emerald-400">
                {fmtNum(stats.outputBags)}
              </span>
              <span className="text-xs font-bold text-muted-foreground">كيس</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              الوزن: <strong className="text-foreground">{fmtNum(stats.outputKg)}</strong> كجم دقيق
              ونخالة
            </p>
          </div>

          {/* العملاء والمستودعات */}
          <div className="rounded-2xl border border-border/80 bg-surface-1/90 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">العملاء النشطون</span>
              <div className="grid h-8 w-8 place-items-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
                <User className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-black tabular-nums text-foreground">
                {fmtNum(stats.activeCustomersCount)}
              </span>
              <span className="text-xs font-bold text-muted-foreground">عميل له أمانات</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              موزعة في <strong className="text-foreground">{stats.activeWarehousesCount}</strong>{" "}
              مستودعات
            </p>
          </div>
        </div>

        {/* شريط الأدوات والفلاتر والبحث اللحظي */}
        <div className="rounded-2xl border border-border/80 bg-surface-1/90 p-4 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* حقل البحث */}
            <div className="relative w-full sm:w-80">
              <Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <MillingInput
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="بحث بالعميل، الصنف، الكود، المستودع…"
                className="ps-9 font-medium"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="absolute end-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* الفلاتر المنسدلة: المستودع والعميل */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-44">
                <MillingSelect
                  value={selectedWarehouse}
                  onChange={(e) => setSelectedWarehouse(e.target.value)}
                  className="text-xs font-semibold"
                >
                  <option value="ALL">كل المستودعات</option>
                  {(warehousesQuery.data ?? []).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name_ar || w.name}
                    </option>
                  ))}
                </MillingSelect>
              </div>

              <div className="w-48">
                <MillingSelect
                  value={selectedCustomer}
                  onChange={(e) => setSelectedCustomer(e.target.value)}
                  className="text-xs font-semibold"
                >
                  <option value="ALL">كل العملاء</option>
                  {(customersQuery.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </MillingSelect>
              </div>

              {/* أزرار تبديل نمط العرض (مثل المخزون) */}
              <div className="flex rounded-xl bg-muted p-1 border border-border">
                <button
                  type="button"
                  onClick={() => changeViewMode("table")}
                  className={`p-1.5 rounded-lg transition ${
                    viewMode === "table"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="عرض جدول البيانات"
                >
                  <TableProperties className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => changeViewMode("cards")}
                  className={`p-1.5 rounded-lg transition ${
                    viewMode === "cards"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="عرض البطاقات"
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => changeViewMode("list")}
                  className={`p-1.5 rounded-lg transition ${
                    viewMode === "list"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  title="عرض مضغوط مكثف"
                >
                  <List className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {/* أزرار التصفية السريعة (Filter Chips) */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/60">
            {[
              { id: "ACTIVE", label: "أرصدة متبقية نشطة" },
              { id: "RAW", label: "حبوب خام (للطحن)" },
              { id: "OUTPUT", label: "نواتج (للتسليم)" },
              { id: "ALL", label: "جميع السجلات" },
              { id: "ZERO", label: "مصفاة بالكامل (0)" },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setTypeFilter(f.id as TypeFilter)}
                className={`rounded-xl px-3 py-1 text-xs font-semibold transition ${
                  typeFilter === f.id
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "border border-border/80 bg-surface-2/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}

            <span className="ms-auto text-xs text-muted-foreground">
              عرض {filteredRows.length} صنف أمانة
            </span>
          </div>
        </div>

        {/* عرض البيانات حسب النمط المختار */}
        {statementQuery.isLoading ? (
          <div className="rounded-2xl border border-border p-12 text-center">
            <RefreshCw className="h-6 w-6 animate-spin mx-auto text-primary" />
            <p className="mt-2 text-xs font-semibold text-muted-foreground">
              جارٍ تحميل أرصدة وسجلات الأمانات…
            </p>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/80 p-12 text-center">
            <MillingEmpty
              title="لا توجد أمانات مطابقة لمعايير البحث الحالية"
              hint="غيّر معايير الفلترة أو اختر مستودعاً أو عميلاً آخر."
            />
          </div>
        ) : viewMode === "table" ? (
          /* نمط الجدول الرئيسي المتقدم */
          <div className="overflow-hidden rounded-2xl border border-border/80 bg-surface-1/90 shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/70 text-muted-foreground bg-muted/40 font-bold">
                    <th className="px-4 py-3 text-start">العميل صاحب الأمانة</th>
                    <th className="px-3 py-3 text-start">صنف الأمانة</th>
                    <th className="px-3 py-3 text-start">المستودع</th>
                    <th className="px-3 py-3 text-center">الوارد (المستلم)</th>
                    <th className="px-3 py-3 text-center">المنصرف (المطحون/المسلّم)</th>
                    <th className="px-4 py-3 text-center bg-primary/5 text-primary">
                      الرصيد المتبقي الحالي
                    </th>
                    <th className="px-3 py-3 text-center">آخر حركة</th>
                    <th className="px-4 py-3 text-end">الإجراءات السريعة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredRows.map((r, idx) => {
                    const remB = Number(r.remaining_bags ?? 0);
                    const remK = Number(r.remaining_kg ?? 0);
                    const isRaw = r.item_class === "RAW_MATERIAL";
                    const isZero = remB <= 0 && remK <= 0;

                    return (
                      <tr
                        key={`${r.customer_id}-${r.item_id}-${r.warehouse_id}-${idx}`}
                        className="transition hover:bg-muted/40"
                      >
                        {/* العميل */}
                        <td className="px-4 py-3 font-bold text-foreground">
                          <div>{r.customer_name_ar || "—"}</div>
                        </td>

                        {/* الصنف وشارة التصنيف */}
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-foreground">{r.item_name_ar}</span>
                            <span
                              className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                                isRaw
                                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                                  : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                              }`}
                            >
                              {isRaw ? "حبوب خام" : "ناتج طحن"}
                            </span>
                          </div>
                          {r.sku && (
                            <span className="text-[10px] font-mono text-muted-foreground">
                              {r.sku}
                            </span>
                          )}
                        </td>

                        {/* المستودع */}
                        <td className="px-3 py-3 text-muted-foreground">
                          {r.warehouse_name_ar || "—"}
                        </td>

                        {/* الوارد */}
                        <td className="px-3 py-3 text-center tabular-nums text-muted-foreground">
                          <div>{fmtNum(r.received_bags)} كيس</div>
                          <div className="text-[10px]">({fmtNum(r.received_kg)} كجم)</div>
                        </td>

                        {/* المنصرف */}
                        <td className="px-3 py-3 text-center tabular-nums text-muted-foreground">
                          <div>{fmtNum(r.issued_bags)} كيس</div>
                          <div className="text-[10px]">({fmtNum(r.issued_kg)} كجم)</div>
                        </td>

                        {/* الرصيد المتبقي الحالي */}
                        <td className="px-4 py-3 text-center tabular-nums bg-primary/5">
                          {isZero ? (
                            <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                              تم التسليم بالكامل
                            </span>
                          ) : (
                            <div className="space-y-0.5">
                              <span className="text-sm font-black text-primary">
                                {fmtNum(remB)} كيس
                              </span>
                              <div className="text-[11px] font-bold text-foreground">
                                {fmtNum(remK)} كجم
                              </div>
                            </div>
                          )}
                        </td>

                        {/* آخر حركة */}
                        <td className="px-3 py-3 text-center text-muted-foreground text-[11px]">
                          {r.last_movement_at
                            ? new Date(r.last_movement_at).toLocaleDateString("ar-EG")
                            : "—"}
                        </td>

                        {/* الإجراءات السريعة */}
                        <td className="px-4 py-3 text-end">
                          <div className="inline-flex items-center gap-1.5">
                            {/* زر طحن إذا كان الصنف مادة خام وله رصيد */}
                            {isRaw && !isZero && (
                              <button
                                type="button"
                                onClick={() => openMilling(r)}
                                className="inline-flex items-center gap-1 rounded-xl bg-amber-500/15 px-2.5 py-1 text-xs font-bold text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 transition"
                                title="طحن من رصيد حبوب هذا العميل"
                              >
                                <Cog className="h-3.5 w-3.5" />
                                <span>طحن</span>
                              </button>
                            )}

                            {/* زر تسليم إذا كان له رصيد */}
                            {!isZero && (
                              <button
                                type="button"
                                onClick={() => openDelivery(r)}
                                className="inline-flex items-center gap-1 rounded-xl bg-emerald-500/15 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25 transition"
                                title="تسليم الأمانة للعميل"
                              >
                                <PackageCheck className="h-3.5 w-3.5" />
                                <span>تسليم</span>
                              </button>
                            )}

                            {/* زر عرض الكشف */}
                            <button
                              type="button"
                              onClick={() => openHistory(r)}
                              className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-2 py-1 text-xs font-medium text-foreground hover:bg-muted transition"
                              title="كشف حساب الأمانة للعميل"
                            >
                              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="hidden sm:inline">الكشف</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : viewMode === "cards" ? (
          /* نمط البطاقات التفاعلية (Cards Grid) */
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredRows.map((r, idx) => {
              const remB = Number(r.remaining_bags ?? 0);
              const remK = Number(r.remaining_kg ?? 0);
              const isRaw = r.item_class === "RAW_MATERIAL";
              const isZero = remB <= 0 && remK <= 0;

              return (
                <div
                  key={`${r.customer_id}-${r.item_id}-${r.warehouse_id}-${idx}`}
                  className="rounded-2xl border border-border/80 bg-surface-1/90 p-4 shadow-sm flex flex-col justify-between space-y-3 transition hover:border-primary/40 hover:shadow-md"
                >
                  <div>
                    {/* رأس البطاقة: العميل ونوع الصنف */}
                    <div className="flex items-start justify-between gap-2 border-b border-border/60 pb-2.5">
                      <div>
                        <h4 className="font-bold text-sm text-foreground">
                          {r.customer_name_ar || "—"}
                        </h4>
                        <span className="text-[11px] text-muted-foreground">
                          مستودع: {r.warehouse_name_ar || "—"}
                        </span>
                      </div>
                      <span
                        className={`rounded-lg px-2 py-0.5 text-[10px] font-bold ${
                          isRaw
                            ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                            : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        }`}
                      >
                        {isRaw ? "حبوب خام" : "ناتج طحن"}
                      </span>
                    </div>

                    {/* الصنف والرصيد المتبقي الرئيسي */}
                    <div className="mt-3 flex items-center justify-between">
                      <div>
                        <span className="text-xs text-muted-foreground">صنف الأمانة:</span>
                        <p className="font-bold text-sm text-foreground">{r.item_name_ar}</p>
                      </div>

                      <div className="text-end">
                        <span className="text-[11px] text-muted-foreground">الرصيد المتبقي:</span>
                        {isZero ? (
                          <p className="text-xs font-bold text-muted-foreground">مصفاة بالكامل</p>
                        ) : (
                          <div>
                            <span className="text-xl font-black text-primary">
                              {fmtNum(remB)}{" "}
                              <span className="text-xs font-semibold text-muted-foreground">
                                كيس
                              </span>
                            </span>
                            <div className="text-xs font-bold text-foreground">
                              {fmtNum(remK)} كجم
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ملخص الوارد والمنصرف */}
                    <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-muted/40 p-2.5 text-[11px]">
                      <div>
                        <span className="text-muted-foreground">المستلم (وارد):</span>
                        <div className="font-bold text-foreground">
                          {fmtNum(r.received_bags)} كيس ({fmtNum(r.received_kg)} كجم)
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">المصروف (صادر):</span>
                        <div className="font-bold text-foreground">
                          {fmtNum(r.issued_bags)} كيس ({fmtNum(r.issued_kg)} كجم)
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* أزرار العمليات السريعة بأسفل البطاقة */}
                  <div className="pt-2 border-t border-border/60 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => openHistory(r)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      كشف الحركات
                    </button>

                    <div className="flex items-center gap-1.5">
                      {isRaw && !isZero && (
                        <button
                          type="button"
                          onClick={() => openMilling(r)}
                          className="inline-flex items-center gap-1 rounded-xl bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 transition"
                        >
                          <Cog className="h-3.5 w-3.5" />
                          طحن
                        </button>
                      )}

                      {!isZero && (
                        <button
                          type="button"
                          onClick={() => openDelivery(r)}
                          className="inline-flex items-center gap-1 rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-600 transition"
                        >
                          <PackageCheck className="h-3.5 w-3.5" />
                          تسليم
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* نمط العرض المضغوط عالي الكثافة (Compact View) */
          <div className="overflow-hidden rounded-2xl border border-border/80 bg-surface-1/90 shadow-sm">
            <div className="divide-y divide-border/40">
              {filteredRows.map((r, idx) => {
                const remB = Number(r.remaining_bags ?? 0);
                const remK = Number(r.remaining_kg ?? 0);
                const isRaw = r.item_class === "RAW_MATERIAL";
                const isZero = remB <= 0 && remK <= 0;

                return (
                  <div
                    key={`${r.customer_id}-${r.item_id}-${r.warehouse_id}-${idx}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-xs hover:bg-muted/40 transition"
                  >
                    <div className="flex items-center gap-3 min-w-56">
                      <span className="font-bold text-foreground">{r.customer_name_ar}</span>
                      <span className="text-muted-foreground">•</span>
                      <span className="font-semibold text-muted-foreground">{r.item_name_ar}</span>
                      <span
                        className={`rounded-md px-1.5 py-0.2 text-[10px] font-bold ${
                          isRaw
                            ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                            : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        }`}
                      >
                        {isRaw ? "خام" : "ناتج"}
                      </span>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-muted-foreground">
                        المستودع: <span className="font-semibold">{r.warehouse_name_ar}</span>
                      </div>

                      <div className="tabular-nums">
                        الرصيد:{" "}
                        {isZero ? (
                          <span className="text-muted-foreground font-semibold">مصفاة</span>
                        ) : (
                          <strong className="text-primary font-black">
                            {fmtNum(remB)} كيس ({fmtNum(remK)} كجم)
                          </strong>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        {isRaw && !isZero && (
                          <button
                            type="button"
                            onClick={() => openMilling(r)}
                            className="rounded-lg bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300"
                          >
                            طحن
                          </button>
                        )}
                        {!isZero && (
                          <button
                            type="button"
                            onClick={() => openDelivery(r)}
                            className="rounded-lg bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300"
                          >
                            تسليم
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openHistory(r)}
                          className="rounded-lg border border-border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
                        >
                          كشف
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─── مودال الطحن السريع (Quick Milling Dialog) المصلح بالكامل ─── */}
        {millingModalOpen && (
          <QuickMillingModal
            open={millingModalOpen}
            onClose={() => setMillingModalOpen(false)}
            initialRow={selectedRow}
            outputItems={outputItemsQuery.data ?? []}
            grainItems={grainItemsQuery.data ?? []}
            customers={customersQuery.data ?? []}
            warehouses={warehousesQuery.data ?? []}
            onSuccess={() => {
              void qc.invalidateQueries({ queryKey: ["milling"] });
              setMillingModalOpen(false);
            }}
          />
        )}

        {/* ─── مودال التسليم السريع (Quick Delivery Dialog) ─── */}
        {deliveryModalOpen && (
          <QuickDeliveryModal
            open={deliveryModalOpen}
            onClose={() => setDeliveryModalOpen(false)}
            initialRow={selectedRow}
            customers={customersQuery.data ?? []}
            warehouses={warehousesQuery.data ?? []}
            onSuccess={(voucherDoc) => {
              void qc.invalidateQueries({ queryKey: ["milling"] });
              setDeliveryModalOpen(false);
              if (voucherDoc) {
                setPrintDoc(voucherDoc);
                setPrintModalOpen(true);
              }
            }}
          />
        )}

        {/* ─── مودال كشف حركات أمانة العميل ─── */}
        {historyModalOpen && selectedRow && (
          <CustomerCustodyHistoryModal
            open={historyModalOpen}
            onClose={() => setHistoryModalOpen(false)}
            row={selectedRow}
            onPrint={(doc) => {
              setPrintDoc(doc);
              setPrintModalOpen(true);
            }}
            onShare={(data) => {
              setShareData(data);
              setShareDialogOpen(true);
            }}
          />
        )}

        {/* نافذة الطباعة الفاخرة الموحدة لسندات وفواتير المطحنة */}
        {printDoc && (
          <UnifiedPrintModal
            open={printModalOpen}
            onClose={() => {
              setPrintModalOpen(false);
              setPrintDoc(null);
            }}
            doc={printDoc}
            stage={printDoc.docType === "delivery_note" ? "delivery" : "intake"}
          />
        )}

        {/* نافذة المشاركة الفورية عبر واتساب */}
        <DocumentShareDialog
          open={shareDialogOpen}
          onClose={() => setShareDialogOpen(false)}
          title="مشاركة كشف وسند الأمانة"
          documentType="milling_document"
          millingDocumentNumber={shareData?.docNumber || ""}
          customer={
            shareData
              ? {
                  id: selectedRow?.customer_id || "",
                  name: shareData.customerName,
                  phone: shareData.phone || undefined,
                  balance: 0,
                }
              : undefined
          }
        />
      </div>
    </ModuleGuard>
  );
}

/* =========================================================================
   مكون مودال الطحن السريع (Quick Milling Modal) المصلح بالكامل
   ========================================================================= */
function QuickMillingModal({
  open,
  onClose,
  initialRow,
  outputItems,
  grainItems,
  customers,
  warehouses,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  initialRow: CustodyStatementRow | null;
  outputItems: ProductOption[];
  grainItems: ProductOption[];
  customers: { id: string; name: string; phone?: string | null }[];
  warehouses: { id: string; name: string; name_ar: string | null }[];
  onSuccess: () => void;
}) {
  const [customerId, setCustomerId] = useState(initialRow?.customer_id || "");
  const [warehouseId, setWarehouseId] = useState(initialRow?.warehouse_id || "");
  const [grainItemId, setGrainItemId] = useState(initialRow?.item_id || "");

  // الحبوب المطحونة — أكياس ووزن مستقلان (V2: بلا اشتقاق من أي سعة)
  const [bagsOut, setBagsOut] = useState("");
  const [kgOut, setKgOut] = useState("");

  // نواتج الطحن (الدقيق والنخالة) — أكياس ووزن مستقلان لكل سطر
  const [outputs, setOutputs] = useState<{ itemId: string; bags: string; kg: string }[]>([
    { itemId: "", bags: "", kg: "" },
  ]);

  const [notes, setNotes] = useState("");

  // رصيد الحبوب المتاح لهذا العميل والصنف
  const maxAvailableBags = initialRow ? Number(initialRow.remaining_bags ?? 0) : 9999;
  const maxAvailableKg = initialRow ? Number(initialRow.remaining_kg ?? 0) : 999999;

  // عند تغيير عدد الأكياس المطحونة — بلا احتساب تلقائي
  function handleBagsOutChange(v: string) {
    setBagsOut(v);
  }

  // إضافة ناتج جديد
  function addOutputLine() {
    setOutputs((prev) => [...prev, { itemId: "", bags: "", kg: "" }]);
  }

  // حذف سطر ناتج
  function removeOutputLine(index: number) {
    setOutputs((prev) => prev.filter((_, i) => i !== index));
  }

  // تعديل سطر ناتج — بلا أي اشتقاق من السعة
  function updateOutputLine(index: number, field: "itemId" | "bags" | "kg", val: any) {
    setOutputs((prev) => prev.map((line, i) => (i !== index ? line : { ...line, [field]: val })));
  }

  // حساب إجمالي النواتج لمقارنتها بوزن الحبوب المطحونة
  const totalOutputsKg = useMemo(() => {
    return outputs.reduce((acc, line) => acc + (Number(line.kg) || 0), 0);
  }, [outputs]);

  const totalGrainKg = Number(kgOut) || 0;
  const extractionRatio = totalGrainKg > 0 ? Math.round((totalOutputsKg / totalGrainKg) * 100) : 0;

  const millingMutation = useMutation({
    mutationFn: async () => {
      const validOutputs: CustodyLine[] = outputs
        .filter((o) => o.itemId && (Number(o.bags) > 0 || Number(o.kg) > 0))
        .map((o) => ({
          itemId: o.itemId,
          bags: Number(o.bags) || 0,
          kg: Number(o.kg) || 0,
        }));

      return custodyMilling({
        customerId,
        warehouseId,
        grainItemId,
        bagsOut: Number(bagsOut) || 0,
        kgOut: Number(kgOut) || 0,
        outputs: validOutputs,
        notes: notes.trim() || undefined,
      });
    },
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.message || "تعذر تسجيل عملية الطحن.");
        return;
      }
      toast.success("تم تسجيل عملية الطحن وإيداع النواتج في أمانات العميل بنجاح.");
      onSuccess();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "خطأ غير متوقع"),
  });

  const canSubmit =
    Boolean(customerId && warehouseId && grainItemId) &&
    (Number(bagsOut) > 0 || Number(kgOut) > 0) &&
    outputs.some((o) => o.itemId && (Number(o.bags) > 0 || Number(o.kg) > 0));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-card shadow-2xl overflow-hidden my-8">
        {/* رأس المودال */}
        <div className="flex items-center justify-between border-b border-border/70 p-4 bg-muted/40">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <Cog className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-foreground">طحن أمانة حبوب العميل</h3>
              <p className="text-xs text-muted-foreground">
                خصم الحبوب المطحونة وإيداع الدقيق والنخالة في رصيد أمانات العميل.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* جسم المودال */}
        <div className="space-y-4 p-5 max-h-[80vh] overflow-y-auto">
          {/* معلومات العميل والمستودع والصنف */}
          <div className="grid gap-3 sm:grid-cols-3">
            <MillingField label="العميل *">
              <MillingSelect
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                disabled={Boolean(initialRow)}
                className="font-semibold text-xs"
              >
                <option value="">اختر العميل…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </MillingSelect>
            </MillingField>

            <MillingField label="المستودع *">
              <MillingSelect
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                disabled={Boolean(initialRow)}
                className="font-semibold text-xs"
              >
                <option value="">اختر المستودع…</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name_ar || w.name}
                  </option>
                ))}
              </MillingSelect>
            </MillingField>

            <MillingField label="صنف الحبوب المطحونة *">
              <MillingSelect
                value={grainItemId}
                onChange={(e) => setGrainItemId(e.target.value)}
                disabled={Boolean(initialRow)}
                className="font-semibold text-xs"
              >
                <option value="">اختر الحبوب…</option>
                {grainItems.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name_ar || g.name}
                  </option>
                ))}
              </MillingSelect>
            </MillingField>
          </div>

          {/* بطاقة الرصيد المتاح للحبوب */}
          {initialRow && (
            <div className="flex items-center justify-between rounded-xl border border-amber-500/25 bg-amber-500/5 px-3.5 py-2 text-xs">
              <span className="font-semibold text-muted-foreground">رصيد الحبوب المتاح للطحن:</span>
              <div className="flex items-center gap-2">
                <span className="font-bold text-amber-700 dark:text-amber-300">
                  {fmtNum(initialRow.remaining_bags)} كيس
                </span>
                <span>•</span>
                <span className="font-bold text-foreground">
                  {fmtNum(initialRow.remaining_kg)} كجم
                </span>
              </div>
            </div>
          )}

          {/* كمية الحبوب المطحونة (أكياس ووزن) */}
          <div className="rounded-xl border border-border/80 bg-surface-2/40 p-3.5 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-foreground">
              <span>كمية الحبوب المراد طحنها (المنصرف من الخام):</span>
              <span className="text-[11px] font-normal text-muted-foreground">
                الأكياس والوزن مستقلان — الوزن من الميزان
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <MillingField label="عدد الأكياس المطحونة *">
                <QuantityInput
                  decimals={0}
                  min={1}
                  max={maxAvailableBags}
                  placeholder="0"
                  aria-label="عدد الأكياس المطحونة"
                  value={bagsOut === "" ? null : Number(bagsOut)}
                  onValueChange={(v) => handleBagsOutChange(v == null ? "" : String(v))}
                  className="font-bold text-amber-600 dark:text-amber-400"
                />
              </MillingField>

              <MillingField label="الوزن الإجمالي بالكجم *">
                <QuantityInput
                  decimals={2}
                  min={0.1}
                  unit="kg"
                  placeholder="0.00"
                  aria-label="الوزن الإجمالي بالكجم"
                  value={kgOut === "" ? null : Number(kgOut)}
                  onValueChange={(v) => {
                    setKgOut(v == null ? "" : String(v));
                  }}
                  className="font-bold"
                />
              </MillingField>
            </div>
          </div>

          {/* قسم نواتج الطحن المودعة في الأمانات */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-foreground">
                نواتج الطحن المودعة في رصيد العميل:
              </span>
              <button
                type="button"
                onClick={addOutputLine}
                className="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary hover:bg-primary/20 transition"
              >
                <Plus className="h-3.5 w-3.5" />
                إضافة ناتج
              </button>
            </div>

            <div className="space-y-2">
              {outputs.map((line, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-12 gap-2 items-center rounded-xl border border-border/80 bg-surface-2/60 p-2 text-xs"
                >
                  {/* صنف الناتج */}
                  <div className="col-span-5">
                    <MillingSelect
                      value={line.itemId}
                      onChange={(e) => updateOutputLine(idx, "itemId", e.target.value)}
                      className="font-semibold text-xs"
                    >
                      <option value="">اختر الناتج (دقيق/نخالة)…</option>
                      {outputItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name_ar || item.name}
                        </option>
                      ))}
                    </MillingSelect>
                  </div>

                  {/* سعة الكيس — معلومة وصفية فقط: لا تُقرأ ولا تُحسب منها */}
                  <div className="col-span-2 rounded-lg border border-border/60 bg-muted/40 p-1.5 text-center">
                    <span className="text-[10px] text-muted-foreground">سعة العبوة وصف فقط</span>
                  </div>

                  {/* عدد الأكياس */}
                  <div className="col-span-2">
                    <QuantityInput
                      decimals={0}
                      min={0}
                      placeholder="أكياس"
                      aria-label="عدد الأكياس"
                      value={line.bags === "" ? null : Number(line.bags)}
                      onValueChange={(v) =>
                        updateOutputLine(idx, "bags", v == null ? "" : String(v))
                      }
                      className="font-bold text-center text-xs"
                    />
                  </div>

                  {/* الوزن كجم */}
                  <div className="col-span-2">
                    <QuantityInput
                      decimals={2}
                      min={0}
                      placeholder="كجم"
                      aria-label="الوزن كجم"
                      value={line.kg === "" ? null : Number(line.kg)}
                      onValueChange={(v) => updateOutputLine(idx, "kg", v == null ? "" : String(v))}
                      className="font-bold text-center text-xs"
                    />
                  </div>

                  {/* حذف */}
                  <div className="col-span-1 text-center">
                    {outputs.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeOutputLine(idx)}
                        className="rounded-lg p-1 text-rose-500 hover:bg-rose-500/10 transition"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* شريط المطابقة الذكي */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/60 p-3 text-xs">
              <div className="flex items-center gap-3">
                <span>
                  حبوب خام مطحونة: <strong className="text-foreground">{totalGrainKg}</strong> كجم
                </span>
                <span>•</span>
                <span>
                  إجمالي النواتج: <strong className="text-foreground">{totalOutputsKg}</strong> كجم
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">نسبة الاستخراج:</span>
                <span
                  className={`font-black tabular-nums ${
                    extractionRatio > 105
                      ? "text-rose-600"
                      : extractionRatio >= 90
                        ? "text-emerald-600"
                        : "text-amber-600"
                  }`}
                >
                  {extractionRatio}%
                </span>
              </div>
            </div>
          </div>

          {/* ملاحظات الطحن */}
          <MillingField label="ملاحظات تشغيلية">
            <MillingInput
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="مثال: طحن ناعم درجة أولى — مشغل الوردية الصباحية"
            />
          </MillingField>
        </div>

        {/* أزرار الإجراءات */}
        <div className="flex items-center justify-end gap-2 border-t border-border/70 p-4 bg-muted/30">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted"
          >
            إلغاء
          </button>
          <button
            type="button"
            disabled={!canSubmit || millingMutation.isPending}
            onClick={() => millingMutation.mutate()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-5 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {millingMutation.isPending ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                جارٍ تنفيذ الطحن…
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                تأكيد وقيد عملية الطحن
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   مكون مودال التسليم السريع (Quick Delivery Modal)
   ========================================================================= */
function QuickDeliveryModal({
  open,
  onClose,
  initialRow,
  customers,
  warehouses,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  initialRow: CustodyStatementRow | null;
  customers: { id: string; name: string }[];
  warehouses: { id: string; name: string; name_ar: string | null }[];
  onSuccess: (doc?: UnifiedDocumentData) => void;
}) {
  const [customerId, setCustomerId] = useState(initialRow?.customer_id || "");
  const [warehouseId, setWarehouseId] = useState(initialRow?.warehouse_id || "");
  const [itemId, setItemId] = useState(initialRow?.item_id || "");
  const [bags, setBags] = useState("");
  const [kg, setKg] = useState("");
  const [notes, setNotes] = useState("");

  const maxBags = initialRow ? Number(initialRow.remaining_bags ?? 0) : 9999;
  const maxKg = initialRow ? Number(initialRow.remaining_kg ?? 0) : 999999;

  // زر بنقرة واحدة لتسليم كامل الرصيد المتبقي
  function handleDeliverAll() {
    if (initialRow) {
      setBags(String(initialRow.remaining_bags));
      setKg(String(initialRow.remaining_kg));
    }
  }

  const deliveryMutation = useMutation({
    mutationFn: async () => {
      return custodyDelivery({
        customerId,
        warehouseId,
        lines: [
          {
            itemId,
            bags: Number(bags) || 0,
            kg: Number(kg) || 0,
          },
        ],
        notes: notes.trim() || undefined,
      });
    },
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.message || "تعذر تسجيل التسليم.");
        return;
      }
      toast.success("تم تسجيل تسليم الأمانة للعميل بنجاح.");

      const docNumber = (res.data as string) || `DEL-${Date.now().toString().slice(-6)}`;
      const selectedCust = customers.find((c) => c.id === customerId);
      const selectedWh = warehouses.find((w) => w.id === warehouseId);
      const prevBags = Number(initialRow?.remaining_bags ?? bags);
      const prevKg = Number(initialRow?.remaining_kg ?? kg);
      const delBags = Number(bags) || 0;
      const delKg = Number(kg) || 0;
      const remBags = Math.max(0, prevBags - delBags);
      const remKg = Math.max(0, prevKg - delKg);

      const voucherDoc = buildCustodyDeliveryDoc({
        docNumber,
        customerName: selectedCust?.name || initialRow?.customer_name_ar || "عميل أمانة",
        warehouseName:
          selectedWh?.name_ar ||
          selectedWh?.name ||
          initialRow?.warehouse_name_ar ||
          "المستودع الرئيسي",
        lines: [
          {
            itemName: initialRow?.item_name_ar || "صنف ناتج",
            previousBags: prevBags,
            previousKg: prevKg,
            deliveredBags: delBags,
            deliveredKg: delKg,
            remainingBags: remBags,
            remainingKg: remKg,
            unit: delBags > 0 ? "كيس" : "كجم",
            note: notes.trim() || undefined,
          },
        ],
        notes: notes.trim() || undefined,
      });

      onSuccess(voucherDoc);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "خطأ غير متوقع"),
  });

  const canSubmit =
    Boolean(customerId && warehouseId && itemId) && (Number(bags) > 0 || Number(kg) > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
        {/* الرأس */}
        <div className="flex items-center justify-between border-b border-border/70 p-4 bg-muted/40">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <PackageCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-foreground">تسليم أمانة للعميل</h3>
              <p className="text-xs text-muted-foreground">
                صرف وخروج الأمانات من المستودع لصاحب الأمانة.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* النموذج */}
        <div className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <MillingField label="العميل المستلم *">
              <MillingSelect
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                disabled={Boolean(initialRow)}
                className="font-semibold text-xs"
              >
                <option value="">اختر العميل…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </MillingSelect>
            </MillingField>

            <MillingField label="المستودع *">
              <MillingSelect
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                disabled={Boolean(initialRow)}
                className="font-semibold text-xs"
              >
                <option value="">اختر المستودع…</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name_ar || w.name}
                  </option>
                ))}
              </MillingSelect>
            </MillingField>
          </div>

          {/* بطاقة الرصيد المتاح للصنف المسلم */}
          {initialRow && (
            <div className="flex items-center justify-between rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 text-xs">
              <div>
                <span className="text-muted-foreground">صنف الأمانة:</span>
                <p className="font-bold text-foreground text-sm">{initialRow.item_name_ar}</p>
              </div>

              <div className="text-end">
                <span className="text-muted-foreground">الرصيد المتاح للتسليم:</span>
                <div className="font-black text-emerald-700 dark:text-emerald-300">
                  {fmtNum(initialRow.remaining_bags)} كيس ({fmtNum(initialRow.remaining_kg)} كجم)
                </div>
              </div>
            </div>
          )}

          {/* كمية التسليم وزر تسليم كامل الرصيد */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-muted-foreground">
                الكمية المراد تسليمها للعميل:
              </label>
              {initialRow && (
                <button
                  type="button"
                  onClick={handleDeliverAll}
                  className="rounded-lg bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
                >
                  تسليم كامل الرصيد
                </button>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <MillingField label="عدد الأكياس المسلمة">
                <QuantityInput
                  decimals={0}
                  min={1}
                  max={maxBags}
                  placeholder="0"
                  aria-label="عدد الأكياس المسلمة"
                  value={bags === "" ? null : Number(bags)}
                  onValueChange={(v) => setBags(v == null ? "" : String(v))}
                  className="font-bold text-emerald-600 dark:text-emerald-400"
                />
              </MillingField>

              <MillingField label="الوزن الإجمالي بالكجم">
                <QuantityInput
                  decimals={2}
                  min={0.1}
                  unit="kg"
                  placeholder="0.00"
                  aria-label="الوزن الإجمالي بالكجم"
                  value={kg === "" ? null : Number(kg)}
                  onValueChange={(v) => setKg(v == null ? "" : String(v))}
                  className="font-bold"
                />
              </MillingField>
            </div>
          </div>

          <MillingField label="ملاحظات التسليم والمستلم">
            <MillingInput
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="مثال: استلم بواسطة السائق / رقم الشاحنة أو الإشعار"
            />
          </MillingField>
        </div>

        {/* الإجراءات */}
        <div className="flex items-center justify-end gap-2 border-t border-border/70 p-4 bg-muted/30">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted"
          >
            إلغاء
          </button>
          <button
            type="button"
            disabled={!canSubmit || deliveryMutation.isPending}
            onClick={() => deliveryMutation.mutate()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deliveryMutation.isPending ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                جارٍ تسجيل التسليم…
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                تأكيد تسليم الأمانة
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   مكون مودال كشف حركات أمانة العميل وتاريخها
   ========================================================================= */
function CustomerCustodyHistoryModal({
  open,
  onClose,
  row,
  onPrint,
  onShare,
}: {
  open: boolean;
  onClose: () => void;
  row: CustodyStatementRow;
  onPrint: (doc: UnifiedDocumentData) => void;
  onShare: (data: { customerName: string; phone?: string; docNumber?: string }) => void;
}) {
  // جلب سجل الحركات للعميل والصنف
  const ledgerQuery = useQuery({
    queryKey: ["milling", "customer-ledger", row.customer_id, row.item_id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("custody_ledger")
        .select("*")
        .eq("customer_id", row.customer_id)
        .eq("item_id", row.item_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const lines = ledgerQuery.data ?? [];

  // E4ب: دفتر حركة الأمانات — فلترة بالنوع (INTAKE/MILLING/DELIVERY/ADJUSTMENT)
  const [typeFilter, setTypeFilter] = useState("ALL");
  const TYPE_FILTERS = [
    { v: "ALL", label: "الكل", tone: "" },
    { v: "INTAKE", label: "استلام", tone: "text-emerald-600" },
    { v: "MILLING", label: "طحن", tone: "text-amber-600" },
    { v: "DELIVERY", label: "تسليم", tone: "text-blue-600" },
    { v: "ADJUSTMENT", label: "تسويات", tone: "text-rose-600" },
  ] as const;
  const filteredLines =
    typeFilter === "ALL" ? lines : lines.filter((l: any) => l.entry_type === typeFilter);

  // إعداد مستند للطباعة الموحدة
  function handlePrintStatement() {
    const doc: UnifiedDocumentData = {
      docType: "mill_document",
      title: "كشف حساب أمانات العميل العيني",
      number: `CUST-${row.customer_id.slice(0, 8).toUpperCase()}`,
      date: new Date().toISOString(),
      partyLabel: "صاحب الأمانة / العميل:",
      partyName: row.customer_name_ar,
      warehouse: row.warehouse_name_ar || "المستودع الرئيسي",
      movementType: `حركات الصنف: ${row.item_name_ar} (${row.item_class === "RAW_MATERIAL" ? "حبوب خام" : "نواتج"})`,
      status: Number(row.remaining_bags) > 0 ? "رصيد أمانات قائم" : "تم تسليم كامل الأمانة",
      lines: lines.map((l: any) => ({
        product: `${l.entry_type === "INTAKE" ? "استلام" : l.entry_type === "MILLING" ? "طحن" : "تسليم"} [${l.doc_number || "—"}]`,
        qty: Number(l.bags_in || l.bags_out || 0),
        unit: "كيس",
        price: 0,
        total: 0,
        note: `${Number(l.kg_in || l.kg_out || 0)} كجم | ${l.notes || ""}`,
      })),
      subtotal: 0,
      total: 0,
      paid: 0,
      balance: 0,
      notes: `الرصيد المتبقي الحالي في المستودع: ${fmtNum(row.remaining_bags)} كيس (${fmtNum(row.remaining_kg)} كجم). أمانات عينية خاصة بالعميل.`,
    };
    onPrint(doc);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-3xl rounded-2xl border border-border bg-card shadow-2xl overflow-hidden my-8">
        {/* الرأس */}
        <div className="flex items-center justify-between border-b border-border/70 p-4 bg-muted/40">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-foreground">
                كشف حركات الأمانة: {row.customer_name_ar}
              </h3>
              <p className="text-xs text-muted-foreground">
                صنف: {row.item_name_ar} • المستودع: {row.warehouse_name_ar}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrintStatement}
              className="inline-flex items-center gap-1 rounded-xl bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90"
            >
              <Printer className="h-3.5 w-3.5" />
              طباعة الكشف
            </button>
            <button
              type="button"
              onClick={() =>
                onShare({
                  customerName: row.customer_name_ar,
                  docNumber: `CUST-${row.customer_id.slice(0, 8)}`,
                })
              }
              className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground hover:bg-muted"
            >
              <Share2 className="h-3.5 w-3.5 text-emerald-600" />
              واتساب
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ملخص الرصيد الحالي */}
        <div className="grid grid-cols-3 gap-3 p-4 bg-surface-2/40 border-b border-border/60 text-xs text-center">
          <div>
            <span className="text-muted-foreground">إجمالي الوارد (مستلم):</span>
            <p className="font-bold text-foreground mt-0.5">
              {fmtNum(row.received_bags)} كيس ({fmtNum(row.received_kg)} كجم)
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">إجمالي المنصرف (صادر):</span>
            <p className="font-bold text-foreground mt-0.5">
              {fmtNum(row.issued_bags)} كيس ({fmtNum(row.issued_kg)} كجم)
            </p>
          </div>
          <div className="bg-primary/10 rounded-xl p-1.5">
            <span className="text-primary font-bold">الرصيد المتبقي حالياً:</span>
            <p className="font-black text-primary text-sm mt-0.5">
              {fmtNum(row.remaining_bags)} كيس ({fmtNum(row.remaining_kg)} كجم)
            </p>
          </div>
        </div>

        {/* جدول الحركات */}
        <div className="p-4 max-h-96 overflow-y-auto">
          {/* E4ب: فلترة دفتر الحركة بالنوع */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.v}
                type="button"
                onClick={() => setTypeFilter(f.v)}
                className={`rounded-full border px-3 py-1 text-[11px] font-bold transition ${
                  typeFilter === f.v
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {ledgerQuery.isLoading ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              جارٍ تحميل سجل الحركات…
            </div>
          ) : filteredLines.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              لا توجد حركات مطابقة لهذا الصنف.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 text-muted-foreground font-bold">
                  <th className="pb-2 text-start">نوع الحركة</th>
                  <th className="pb-2 text-start">رقم السند/المستند</th>
                  <th className="pb-2 text-center">وارد (داخل)</th>
                  <th className="pb-2 text-center">منصرف (خارج)</th>
                  <th className="pb-2 text-start">الملاحظات</th>
                  <th className="pb-2 text-end">التاريخ والوقت</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {filteredLines.map((l: any) => (
                  <tr key={l.id} className="hover:bg-muted/30">
                    <td className="py-2.5 font-bold">
                      {l.entry_type === "INTAKE" ? (
                        <span className="text-emerald-600">استلام أمانة</span>
                      ) : l.entry_type === "MILLING" ? (
                        <span className="text-amber-600">طحن</span>
                      ) : l.entry_type === "DELIVERY" ? (
                        <span className="text-blue-600">تسليم ناتج</span>
                      ) : l.entry_type === "ADJUSTMENT" ? (
                        <span className="text-rose-600">تسوية موثّقة</span>
                      ) : (
                        <span>تعديل</span>
                      )}
                    </td>
                    <td className="py-2.5 font-mono text-foreground font-semibold">
                      {l.doc_number || "—"}
                    </td>
                    <td className="py-2.5 text-center tabular-nums font-semibold text-emerald-600">
                      {Number(l.bags_in) > 0 || Number(l.kg_in) > 0
                        ? `${fmtNum(l.bags_in)} كيس (${fmtNum(l.kg_in)} كجم)`
                        : "—"}
                    </td>
                    <td className="py-2.5 text-center tabular-nums font-semibold text-rose-600">
                      {Number(l.bags_out) > 0 || Number(l.kg_out) > 0
                        ? `${fmtNum(l.bags_out)} كيس (${fmtNum(l.kg_out)} كجم)`
                        : "—"}
                    </td>
                    <td className="py-2.5 text-muted-foreground">{l.notes || "—"}</td>
                    <td className="py-2.5 text-end text-muted-foreground text-[11px]">
                      {new Date(l.created_at).toLocaleString("ar-EG")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* الإغلاق */}
        <div className="flex justify-end border-t border-border/70 p-3 bg-muted/20">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-border px-4 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
