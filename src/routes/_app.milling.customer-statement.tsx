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
import { createFileRoute, useSearch, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import {
  Scale,
  Cog,
  PackageCheck,
  Plus,
  Trash2,
  Check,
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
import {
  TableToolbar,
  type FilterDefinition,
  type FilterValues,
} from "@/components/ui/table-toolbar";
import { PrimaryAction } from "@/components/ui/primary-action";
import { RecordsViewToggle } from "@/components/ui/records-view-toggle";
import { QuickFilterBar } from "@/components/ui/quick-filter-bar";
import { RecordsView } from "@/components/ui/records-view";
import type { DataTableColumn, DataTableSort } from "@/components/ui/data-table";
import { VortexMetricCard } from "@/components/vortex-ui";
import { RecordsSkeleton } from "@/components/ui/records-states";
import { LuxuryPrintPreviewModal } from "@/components/luxury-print-preview-modal";
import { UnifiedPrintModal } from "@/components/milling/unified-print-modal";
import { DocumentShareDialog } from "@/components/communication/document-share-dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchCustodyStatement,
  fetchCustodyServiceMoney,
  fetchOutputItems,
  fetchGrainItems,
  fetchGrainTypes,
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
  head: () => ({ meta: [{ title: "أمانات الطحن — فورتكس ERP" }] }),
  component: () => <CustomerCustodyPageBase mode="milling" />,
});

type TypeFilter = "ALL" | "RAW" | "OUTPUT" | "ACTIVE" | "ZERO";
/**
 * واجهتان منفصلتان فعلياً بمسارين مستقلين (طلب مالك المطحنة):
 *  - /milling/customer-statement   ← أمانات الطحن (الحبوب الخام والطحن)
 *  - /milling/custody-delivery     ← أمانات التسليم (النواتج وصرفها)
 */
export type CustodyMode = "milling" | "delivery";

const CUSTODY_ROUTES = {
  milling: "/milling/customer-statement",
  delivery: "/milling/custody-delivery",
} as const;

const PRESET_CAPACITIES = [50, 40, 25, 20, 10];

export function CustomerCustodyPageBase({ mode }: { mode: CustodyMode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const currencySymbol = useMemo(() => getCompanyCurrencySymbol(), []);
  const { customerId: preselectedCustomerId } = useSearch({
    from:
      mode === "milling" ? "/_app/milling/customer-statement" : "/_app/milling/custody-delivery",
  });

  /* Unified records vocabulary: cards | list | table — persisted per screen. */
  const [viewMode, setViewMode] = usePersistedViewMode("milling-custody", "table");

  // معايير البحث والفلترة
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedWarehouse, setSelectedWarehouse] = useState("ALL");
  const [selectedCustomer, setSelectedCustomer] = useState(preselectedCustomerId || "ALL");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(mode === "milling" ? "RAW" : "OUTPUT");

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

  // ── حالة الفلاتر والترتيب الموحدة (Unified Filter/Sort State) ──
  const [custodyFilters, setCustodyFilters] = useState<FilterValues>({});
  const [sortKey, setSortKey] = useState("");

  // عدادات سريعة لشارات الفلاتر السريعة
  const counts = useMemo(() => {
    let active = 0;
    let raw = 0;
    let output = 0;
    let zero = 0;
    for (const r of rawRows) {
      const remB = Number(r.remaining_bags ?? 0);
      const remK = Number(r.remaining_kg ?? 0);
      const isZero = remB <= 0 && remK <= 0;
      if (isZero) {
        zero++;
        continue;
      }
      active++;
      if (r.item_class === "RAW_MATERIAL") raw++;
      else output++;
    }
    return { active, raw, output, zero };
  }, [rawRows]);

  // تصفية السجلات
  const filteredRows = useMemo(() => {
    let list = rawRows;

    // تصفية العميل (من الفلاتر الموحدة أو الاختيار المسبق من الرابط)
    const customerFilter = (custodyFilters.customer_id as string) || selectedCustomer;
    if (customerFilter && customerFilter !== "ALL") {
      list = list.filter((r) => r.customer_id === customerFilter);
    }

    // تصفية المستودع (من الفلاتر الموحدة)
    const warehouseFilter = (custodyFilters.warehouse_id as string) || selectedWarehouse;
    if (warehouseFilter && warehouseFilter !== "ALL") {
      list = list.filter((r) => r.warehouse_id === warehouseFilter);
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

    // الترتيب الموحد
    if (sortKey) {
      list = [...list].sort((a, b) => {
        switch (sortKey) {
          case "customer_asc":
            return (a.customer_name_ar || "").localeCompare(b.customer_name_ar || "", "ar");
          case "customer_desc":
            return (b.customer_name_ar || "").localeCompare(a.customer_name_ar || "", "ar");
          case "remaining_desc":
            return (
              Number(b.remaining_bags) * 50 +
              Number(b.remaining_kg) -
              (Number(a.remaining_bags) * 50 + Number(a.remaining_kg))
            );
          case "remaining_asc":
            return (
              Number(a.remaining_bags) * 50 +
              Number(a.remaining_kg) -
              (Number(b.remaining_bags) * 50 + Number(b.remaining_kg))
            );
          case "recent_desc":
            return (
              new Date(b.last_movement_at || 0).getTime() -
              new Date(a.last_movement_at || 0).getTime()
            );
          default:
            return 0;
        }
      });
    }

    return list;
  }, [
    rawRows,
    custodyFilters,
    selectedCustomer,
    selectedWarehouse,
    typeFilter,
    searchTerm,
    sortKey,
  ]);

  // تعريفات الفلاتر الموحدة (لوحة الفلترة الجانبية)
  const custodyFilterDefinitions: FilterDefinition[] = useMemo(
    () => [
      {
        key: "warehouse_id",
        label: "المستودع",
        type: "select" as const,
        options: [
          { value: "ALL", label: "كل المستودعات" },
          ...(warehousesQuery.data ?? []).map((w) => ({
            value: w.id,
            label: w.name_ar || w.name,
          })),
        ],
      },
      {
        key: "customer_id",
        label: "العميل",
        type: "select" as const,
        options: [
          { value: "ALL", label: "كل العملاء" },
          ...(customersQuery.data ?? []).map((c) => ({
            value: c.id,
            label: c.name,
          })),
        ],
      },
    ],
    [warehousesQuery.data, customersQuery.data],
  );

  // خيارات الترتيب الموحدة
  const custodySortOptions = useMemo(
    () => [
      { value: "", label: "الترتيب الافتراضي" },
      { value: "customer_asc", label: "العميل (أ - ي)" },
      { value: "customer_desc", label: "العميل (ي - أ)" },
      { value: "remaining_desc", label: "الأعلى رصيداً" },
      { value: "remaining_asc", label: "الأقل رصيداً" },
      { value: "recent_desc", label: "الأحدث حركة" },
    ],
    [],
  );

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

  // ── الحالة المشتركة للترتيب في نمط الجدول (رأس الجدول) ──
  const [tableSort, setTableSort] = useState<DataTableSort | null>(null);

  // ── أعمدة جدول السجلات الموحدة (DataTable) ──
  const custodyColumns: DataTableColumn<CustodyStatementRow>[] = [
    {
      key: "customer_name_ar",
      header: "العميل صاحب الأمانة",
      align: "start",
      sortable: true,
      sortValue: (r) => r.customer_name_ar ?? "",
      cell: (r) => <div className="font-bold text-foreground">{r.customer_name_ar || "—"}</div>,
    },
    {
      key: "item_name_ar",
      header: "صنف الأمانة",
      align: "start",
      sortable: true,
      sortValue: (r) => r.item_name_ar ?? "",
      cell: (r) => {
        const isRaw = r.item_class === "RAW_MATERIAL";
        return (
          <div>
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
            {r.sku && <span className="text-[10px] font-mono text-muted-foreground">{r.sku}</span>}
          </div>
        );
      },
    },
    {
      key: "warehouse_name_ar",
      header: "المستودع",
      align: "start",
      hideBelow: "md",
      cell: (r) => <span className="text-muted-foreground">{r.warehouse_name_ar || "—"}</span>,
    },
    {
      key: "received_bags",
      header: "الوارد (المستلم)",
      align: "center",
      hideBelow: "lg",
      sortable: true,
      sortValue: (r) => Number(r.received_bags),
      cell: (r) => (
        <div className="tabular-nums text-muted-foreground">
          <div>{fmtNum(r.received_bags)} كيس</div>
          <div className="text-[10px]">({fmtNum(r.received_kg)} كجم)</div>
        </div>
      ),
    },
    {
      key: "issued_bags",
      header: "المنصرف (المطحون/المسلّم)",
      align: "center",
      hideBelow: "lg",
      sortable: true,
      sortValue: (r) => Number(r.issued_bags),
      cell: (r) => (
        <div className="tabular-nums text-muted-foreground">
          <div>{fmtNum(r.issued_bags)} كيس</div>
          <div className="text-[10px]">({fmtNum(r.issued_kg)} كجم)</div>
        </div>
      ),
    },
    {
      key: "remaining_bags",
      header: "الرصيد المتبقي الحالي",
      align: "center",
      sortable: true,
      sortValue: (r) => Number(r.remaining_bags),
      cell: (r) => {
        const remB = Number(r.remaining_bags ?? 0);
        const remK = Number(r.remaining_kg ?? 0);
        const isZero = remB <= 0 && remK <= 0;
        return isZero ? (
          <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
            تم التسليم بالكامل
          </span>
        ) : (
          <div className="tabular-nums space-y-0.5">
            <span className="text-sm font-black text-primary">{fmtNum(remB)} كيس</span>
            <div className="text-[11px] font-bold text-foreground">{fmtNum(remK)} كجم</div>
          </div>
        );
      },
    },
    {
      key: "last_movement_at",
      header: "آخر حركة",
      align: "center",
      hideBelow: "lg",
      sortable: true,
      sortValue: (r) => r.last_movement_at ?? "",
      cell: (r) => (
        <span className="text-[11px] text-muted-foreground">
          {r.last_movement_at ? new Date(r.last_movement_at).toLocaleDateString("ar-EG") : "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "الإجراءات السريعة",
      align: "end",
      width: "w-56",
      cell: (r) => {
        const remB = Number(r.remaining_bags ?? 0);
        const remK = Number(r.remaining_kg ?? 0);
        const isRaw = r.item_class === "RAW_MATERIAL";
        const isZero = remB <= 0 && remK <= 0;
        return (
          <div className="inline-flex items-center gap-1.5">
            {mode === "milling"
              ? isRaw &&
                !isZero && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openMilling(r);
                    }}
                    title="طحن من رصيد حبوب هذا العميل"
                    className="inline-flex items-center gap-1 rounded-xl bg-amber-500/15 px-2.5 py-1 text-xs font-bold text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 transition"
                  >
                    <Cog className="h-3.5 w-3.5" />
                    <span>طحن</span>
                  </button>
                )
              : !isZero && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openDelivery(r);
                    }}
                    title="تسليم الأمانة للعميل"
                    className="inline-flex items-center gap-1 rounded-xl bg-emerald-500/15 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25 transition"
                  >
                    <PackageCheck className="h-3.5 w-3.5" />
                    <span>تسليم</span>
                  </button>
                )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openHistory(r);
              }}
              title="كشف حساب الأمانة للعميل"
              className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-2 py-1 text-xs font-medium text-foreground hover:bg-muted transition"
            >
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="hidden sm:inline">الكشف</span>
            </button>
          </div>
        );
      },
    },
  ];

  // ── بطاقة السجل الموحدة (نمط البطائق) ──
  const renderCustodyCard = (r: CustodyStatementRow) => {
    const remB = Number(r.remaining_bags ?? 0);
    const remK = Number(r.remaining_kg ?? 0);
    const isRaw = r.item_class === "RAW_MATERIAL";
    const isZero = remB <= 0 && remK <= 0;

    return (
      <div className="flex h-full flex-col justify-between gap-3 rounded-2xl border border-border/80 bg-surface-1/90 p-4 shadow-sm transition hover:border-primary/40 hover:shadow-md">
        <div>
          {/* رأس البطاقة: العميل ونوع الصنف */}
          <div className="flex items-start justify-between gap-2 border-b border-border/60 pb-2.5">
            <div>
              <h4 className="font-bold text-sm text-foreground">{r.customer_name_ar || "—"}</h4>
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
                    <span className="text-xs font-semibold text-muted-foreground">كيس</span>
                  </span>
                  <div className="text-xs font-bold text-foreground">{fmtNum(remK)} كجم</div>
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
        <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
          <button
            type="button"
            onClick={() => openHistory(r)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <FileText className="h-3.5 w-3.5" />
            كشف الحركات
          </button>

          <div className="flex items-center gap-1.5">
            {mode === "milling" && isRaw && !isZero && (
              <button
                type="button"
                onClick={() => openMilling(r)}
                className="inline-flex items-center gap-1 rounded-xl bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 transition"
              >
                <Cog className="h-3.5 w-3.5" />
                طحن
              </button>
            )}

            {mode === "delivery" && !isZero && (
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
  };

  // ── سطر القائمة المضغوطة الموحد (نمط القائمة) ──
  const renderCustodyListRow = (r: CustodyStatementRow) => {
    const remB = Number(r.remaining_bags ?? 0);
    const remK = Number(r.remaining_kg ?? 0);
    const isRaw = r.item_class === "RAW_MATERIAL";
    const isZero = remB <= 0 && remK <= 0;

    return (
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-xs transition hover:bg-muted/40">
        <div className="flex min-w-56 items-center gap-3">
          <span className="font-bold text-foreground">{r.customer_name_ar}</span>
          <span className="text-muted-foreground">•</span>
          <span className="font-semibold text-muted-foreground">{r.item_name_ar}</span>
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
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
              <span className="font-semibold text-muted-foreground">مصفاة</span>
            ) : (
              <strong className="font-black text-primary">
                {fmtNum(remB)} كيس ({fmtNum(remK)} كجم)
              </strong>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {mode === "milling" && isRaw && !isZero && (
              <button
                type="button"
                onClick={() => openMilling(r)}
                className="rounded-lg bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300"
              >
                طحن
              </button>
            )}
            {mode === "delivery" && !isZero && (
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
  };

  return (
    <ModuleGuard moduleId="milling_operations">
      <div className="mx-auto max-w-7xl space-y-4 p-4">
        {/* ─── التنقل بين الواجهتين المنفصلتين (مساران مستقلان) ── */}
        <div className="grid w-full max-w-md grid-cols-2 gap-1 rounded-2xl border-border/80 bg-muted/60 p-1">
          <Link
            to={CUSTODY_ROUTES.milling}
            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all ${
              mode === "milling"
                ? "bg-background text-amber-700 shadow-xs dark:text-amber-300"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Cog className="h-4 w-4" />
            أمانات الطحن
            <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-black text-amber-700 dark:text-amber-300">
              {counts.raw}
            </span>
          </Link>
          <Link
            to={CUSTODY_ROUTES.delivery}
            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all ${
              mode === "delivery"
                ? "bg-background text-emerald-700 shadow-xs dark:text-emerald-300"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <PackageCheck className="h-4 w-4" />
            أمانات التسليم
            <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-black text-emerald-700 dark:text-emerald-300">
              {counts.output}
            </span>
          </Link>
        </div>

        {/* رأس الصفحة مع أزرار الإجراءات السريعة */}
        <PageHeader
          title={mode === "milling" ? "الأمانات — الطحن" : "الأمانات — التسليم"}
          subtitle={
            mode === "milling"
              ? "متابعة أرصدة الحبوب الخام المودعة وتسجيل عمليات الطحن وإيداع النواتج."
              : "متابعة النواتج الجاهزة وتسليمها لصاحب الأمانة مع سند تسليم رسمي."
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {mode === "milling" ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRow(null);
                    setMillingModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-amber-600 active:scale-95"
                >
                  <Cog className="h-4 w-4" />
                  عملية طحن جديدة
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRow(null);
                    setDeliveryModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700 active:scale-95"
                >
                  <PackageCheck className="h-4 w-4" />
                  عملية تسليم جديدة
                </button>
              )}

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

        {/* بطاقات الإحصائيات العلوية (KPIs) — VortexMetricCard الموحدة */}
        <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
          <VortexMetricCard
            title="إجمالي رصيد الأمانات"
            value={fmtNum(stats.totalRemainingBags)}
            subtitle={`الوزن الصافي: ${fmtNum(stats.totalRemainingKg)} كجم`}
            icon={<Scale className="size-5" />}
            iconClassName="bg-primary/10 text-primary border border-primary/20"
            badge="الكلي"
            highlight={typeFilter === "ACTIVE"}
            onClick={() => setTypeFilter("ACTIVE")}
            className="cursor-pointer"
          />
          <VortexMetricCard
            title="حبوب خام (بانتظار الطحن)"
            value={fmtNum(stats.rawBags)}
            subtitle={`الوزن: ${fmtNum(stats.rawKg)} كجم بانتظار الطحن`}
            icon={<Wheat className="size-5" />}
            iconClassName="bg-amber-500/10 text-amber-500 border border-amber-500/20"
            badge="للطحن"
            highlight={typeFilter === "RAW"}
            onClick={() => setTypeFilter("RAW")}
            className="cursor-pointer"
          />
          <VortexMetricCard
            title="نواتج (جاهزة للتسليم)"
            value={fmtNum(stats.outputBags)}
            subtitle={`الوزن: ${fmtNum(stats.outputKg)} كجم دقيق ونخالة`}
            icon={<Boxes className="size-5" />}
            iconClassName="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
            badge="للتسليم"
            highlight={typeFilter === "OUTPUT"}
            onClick={() => setTypeFilter("OUTPUT")}
            className="cursor-pointer"
          />
          <VortexMetricCard
            title="العملاء النشطون"
            value={fmtNum(stats.activeCustomersCount)}
            subtitle={`موزعة في ${stats.activeWarehousesCount} مستودعات`}
            icon={<User className="size-5" />}
            iconClassName="bg-sky-500/10 text-sky-500 border border-sky-500/20"
            badge="أمانات"
            onClick={() => setTypeFilter("ALL")}
            className="cursor-pointer"
          />
        </div>

        {/* ─── شريط الأدوات الموحد: بحث + فلاتر + ترتيب + تبديل العرض + إجراء رئيسي ─── */}
        <TableToolbar
          sticky
          search={{
            value: searchTerm,
            onValueChange: setSearchTerm,
            placeholder: "ابحث بالعميل، الصنف، الكود، المستودع…",
            resultCount: filteredRows.length,
          }}
          filters={{
            definitions: custodyFilterDefinitions,
            values: custodyFilters,
            onValueChange: setCustodyFilters,
          }}
          sort={{
            options: custodySortOptions,
            value: sortKey,
            onValueChange: setSortKey,
          }}
          viewToggle={<RecordsViewToggle value={viewMode} onChange={setViewMode} />}
          action={
            mode === "milling" ? (
              <PrimaryAction
                label="طحن أمانة"
                icon={<Cog />}
                onClick={() => {
                  setSelectedRow(null);
                  setMillingModalOpen(true);
                }}
              />
            ) : (
              <PrimaryAction
                label="تسليم نواتج"
                icon={<PackageCheck />}
                onClick={() => {
                  setSelectedRow(null);
                  setDeliveryModalOpen(true);
                }}
              />
            )
          }
        >
          {/* أزرار التصفية السريعة الموحدة (QuickFilterBar) — مرئية في كل أنماط العرض */}
          <QuickFilterBar
            items={[
              { id: "ALL", label: "جميع السجلات", count: rawRows.length },
              { id: "ACTIVE", label: "أرصدة متبقية نشطة", count: counts.active, tone: "success" },
              ...(mode === "milling"
                ? ([
                    { id: "RAW", label: "حبوب خام (للطحن)", count: counts.raw, tone: "warning" },
                  ] as const)
                : ([
                    { id: "OUTPUT", label: "نواتج (للتسليم)", count: counts.output, tone: "info" },
                  ] as const)),
              { id: "ZERO", label: "مصفاة بالكامل", count: counts.zero, tone: "danger" },
            ]}
            value={typeFilter}
            onChange={(id) => setTypeFilter(id as TypeFilter)}
          />
        </TableToolbar>

        {/* ─── سجلات الأمانات: عرض موحد (جدول / بطائق / قائمة) عبر RecordsView ─── */}
        <RecordsView<CustodyStatementRow>
          rows={filteredRows}
          getRowId={(r) => `${r.customer_id}-${r.item_id}-${r.warehouse_id}`}
          viewMode={viewMode}
          loading={statementQuery.isLoading}
          refreshing={statementQuery.isFetching && !statementQuery.isLoading}
          error={statementQuery.error}
          onRetry={() => void statementQuery.refetch()}
          columns={custodyColumns}
          sort={tableSort}
          onSortChange={setTableSort}
          minWidth={1120}
          horizontalScroll
          renderCard={renderCustodyCard}
          renderListRow={renderCustodyListRow}
          empty={{
            icon: mode === "milling" ? <Wheat /> : <PackageCheck />,
            title:
              mode === "milling"
                ? "لا توجد حبوب خام مطابقة لمعايير البحث الحالية"
                : "لا توجد نواتج جاهزة للتسليم مطابقة لمعايير البحث الحالية",
            description:
              mode === "milling"
                ? "سجّل استلام أمانة من شاشة الاستقبال أو غيّر معايير الفلترة."
                : "سجّل عملية طحن أولاً لتُودع النواتج في أمانات العميل، أو غيّر الفلترة.",
          }}
        />

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

  // E6/M5: نوع الحبة المرجعي — يعبّئ الفاقد ونسب النواتج الافتراضية
  const [grainTypeId, setGrainTypeId] = useState("");
  const grainTypes = useQuery({
    queryKey: ["milling", "grain-types"],
    queryFn: fetchGrainTypes,
    enabled: open,
  });

  const selectedGrainType = useMemo(
    () => (grainTypes.data ?? []).find((t) => t.id === grainTypeId) ?? null,
    [grainTypes.data, grainTypeId],
  );

  /**
   * تغيير نوع الحبة المرجعي: تعبئة تلقائية للفاقد ونسبة النواتج
   * من الخصائص الافتراضية للنوع. كل القيم تبقى قابلة للتعديل يدوياً.
   */
  function changeGrainType(id: string) {
    setGrainTypeId(id);
    const type = (grainTypes.data ?? []).find((t) => t.id === id);
    if (!type) return;

    const milledKg = Number(kgOut) || 0;

    // سطور النواتج الافتراضية: مطابقة نسب النوع مع كتالوج النواتج
    // (الفاقد الافتراضي يظهر كتلميح — هذا المودال بلا حقل فاقد مستقل)
    const map = type.default_output_map ?? [];
    if (map.length > 0) {
      const prefilled = map
        .map((g) => {
          const match = outputItems.find(
            (p) =>
              (p.name_ar && g.label && p.name_ar.includes(g.label)) ||
              (p.name && g.label && p.name.toLowerCase().includes(g.label.toLowerCase())),
          );
          if (!match) return null;
          const kg = milledKg > 0 ? Math.round(((milledKg * g.ratio) / 100) * 100) / 100 : 0;
          return { itemId: match.id, bags: "", kg: kg ? String(kg) : "" };
        })
        .filter((l): l is { itemId: string; bags: string; kg: string } => l !== null);
      if (prefilled.length > 0) setOutputs(prefilled);
    }
  }
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
        grainTypeId: grainTypeId || null,
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
            </div>

            {/* ترويسة أعمدة النواتج */}
            <div className="grid grid-cols-12 gap-2 px-2 py-1 text-[11px] font-bold text-muted-foreground bg-muted/50 rounded-lg">
              <div className="col-span-5">صنف الناتج المستخرج</div>
              <div className="col-span-3 text-center">الأكياس</div>
              <div className="col-span-3 text-center">الوزن (كجم)</div>
              <div className="col-span-1 text-center">حذف</div>
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

                  {/* عدد الأكياس */}
                  <div className="col-span-3">
                    <QuantityInput
                      decimals={0}
                      min={0}
                      placeholder="0"
                      aria-label="عدد الأكياس"
                      value={line.bags === "" ? null : Number(line.bags)}
                      onValueChange={(v) =>
                        updateOutputLine(idx, "bags", v == null ? "" : String(v))
                      }
                      className="font-bold text-center text-xs"
                    />
                  </div>

                  {/* الوزن كجم */}
                  <div className="col-span-3">
                    <QuantityInput
                      decimals={2}
                      min={0}
                      placeholder="0.00"
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

            <button
              type="button"
              onClick={addOutputLine}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-emerald-500/40 bg-emerald-500/[0.04] hover:bg-emerald-500/[0.08] text-xs font-bold text-emerald-700 dark:text-emerald-300 transition"
            >
              <Plus className="h-4 w-4" />
              <span>إضافة سطر ناتج جديد</span>
            </button>
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

          {/* بطاقة الرصيد المتاح للصنف المسلم — بطاقة موحدة */}
          {initialRow && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3.5 py-2.5 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-500/15 text-emerald-600">
                  <PackageCheck className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <span className="block text-[10px] text-muted-foreground">صنف الأمانة</span>
                  <p className="truncate font-bold text-foreground text-xs">
                    {initialRow.item_name_ar}
                  </p>
                </div>
              </div>

              <div className="text-end shrink-0">
                <span className="block text-[10px] text-muted-foreground">
                  الرصيد المتاح للتسليم
                </span>
                <div className="font-black tabular-nums text-emerald-700 dark:text-emerald-300">
                  {fmtNum(initialRow.remaining_bags)} كيس ({fmtNum(initialRow.remaining_kg)} كجم)
                </div>
              </div>
            </div>
          )}

          {/* كمية التسليم وزر تسليم كامل الرصيد — قسم موحد */}
          <div className="rounded-xl border border-border/80 bg-surface-2/40 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-foreground">
                الكمية المراد تسليمها للعميل
              </label>
              {initialRow && (
                <button
                  type="button"
                  onClick={handleDeliverAll}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 transition"
                >
                  <PackageCheck className="h-3 w-3" />
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

              <MillingField label="الوزن الإجمالي (كجم)">
                <QuantityInput
                  decimals={2}
                  min={0.1}
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

        {/* ملخص الرصيد الحالي — بطاقات موحدة للتصميم المتماسك */}
        <div className="grid grid-cols-3 gap-3 p-4 border-b border-border/60 text-xs">
          <div className="flex flex-col items-center justify-center gap-1 rounded-xl bg-muted/40 p-3 text-center">
            <span className="block text-[11px] font-medium text-muted-foreground">
              إجمالي الوارد (مستلم)
            </span>
            <p className="font-bold text-foreground text-sm leading-tight">
              {fmtNum(row.received_bags)} <span className="text-[10px] font-normal">كيس</span> (
              {fmtNum(row.received_kg)} كجم)
            </p>
          </div>
          <div className="flex flex-col items-center justify-center gap-1 rounded-xl bg-muted/40 p-3 text-center">
            <span className="block text-[11px] font-medium text-muted-foreground">
              إجمالي المنصرف (صادر)
            </span>
            <p className="font-bold text-foreground text-sm leading-tight">
              {fmtNum(row.issued_bags)} <span className="text-[10px] font-normal">كيس</span> (
              {fmtNum(row.issued_kg)} كجم)
            </p>
          </div>
          <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-primary/20 bg-primary/5 p-3 text-center">
            <span className="block text-[11px] font-bold text-primary">الرصيد المتبقي حالياً</span>
            <p className="font-black text-primary text-base leading-tight">
              {fmtNum(row.remaining_bags)} <span className="text-[10px] font-semibold">كيس</span> (
              {fmtNum(row.remaining_kg)} كجم)
            </p>
          </div>
        </div>

        {/* جدول الحركات — دفتر الحركة الموحد */}
        <div className="p-4 max-h-96 overflow-y-auto">
          {/* E4ب: فلترة دفتر الحركة بالنوع */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.v}
                type="button"
                onClick={() => setTypeFilter(f.v)}
                className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
                  typeFilter === f.v
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {ledgerQuery.isLoading ? (
            <div className="flex flex-col items-center justify-center p-8 text-xs text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin mb-2 text-primary/60" />
              جارٍ تحميل سجل الحركات…
            </div>
          ) : filteredLines.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 p-8 text-center">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-muted/50 mb-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
              </div>
              <h5 className="font-bold text-sm text-foreground mb-0.5">لا توجد حركات مطابقة</h5>
              <p className="text-xs text-muted-foreground">
                لا توجد حركات مسجلة لهذا الصنف أو ضمن التصفية المحددة.
              </p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/60 bg-muted/20 text-muted-foreground font-bold">
                  <th className="px-3 py-2.5 text-start text-[11px]">نوع الحركة</th>
                  <th className="px-3 py-2.5 text-start text-[11px]">رقم السند/المستند</th>
                  <th className="px-3 py-2.5 text-center text-[11px]">وارد (داخل)</th>
                  <th className="px-3 py-2.5 text-center text-[11px]">منصرف (خارج)</th>
                  <th className="px-3 py-2.5 text-start text-[11px]">الملاحظات</th>
                  <th className="px-3 py-2.5 text-end text-[11px]">التاريخ والوقت</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {filteredLines.map((l: any) => (
                  <tr key={l.id} className="transition-colors hover:bg-muted/20">
                    <td className="px-3 py-2.5">
                      {l.entry_type === "INTAKE" ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                          استلام أمانة
                        </span>
                      ) : l.entry_type === "MILLING" ? (
                        <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                          طحن
                        </span>
                      ) : l.entry_type === "DELIVERY" ? (
                        <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-600">
                          تسليم ناتج
                        </span>
                      ) : l.entry_type === "ADJUSTMENT" ? (
                        <span className="inline-flex items-center rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-600">
                          تسوية موثّقة
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                          تعديل
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-foreground font-semibold text-[11px]">
                      {l.doc_number || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-center tabular-nums font-semibold text-emerald-600">
                      {Number(l.bags_in) > 0 || Number(l.kg_in) > 0
                        ? `${fmtNum(l.bags_in)} كيس (${fmtNum(l.kg_in)} كجم)`
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-center tabular-nums font-semibold text-rose-600">
                      {Number(l.bags_out) > 0 || Number(l.kg_out) > 0
                        ? `${fmtNum(l.bags_out)} كيس (${fmtNum(l.kg_out)} كجم)`
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground text-[11px]">
                      {l.notes || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-end text-muted-foreground text-[11px] tabular-nums">
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
