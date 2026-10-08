import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { StockAdjustmentDialog } from "@/components/stock/stock-adjustment-dialog";
import {
  Boxes,
  ClipboardList,
  FileCheck,
  LayoutGrid,
  List,
  RefreshCw,
  Scale,
  ShieldCheck,
  TableProperties,
  TrendingDown,
  TrendingUp,
  Warehouse,
  Plus,
} from "lucide-react";
import { type PageGuideConfig } from "@/components/page-guide";
import { VortexMetricCard } from "@/components/vortex-ui";
import { RecordsView, type RecordsViewMode } from "@/components/ui/records-view";
import {
  TableToolbar,
  ToolbarAction,
  type FilterDefinition,
  type FilterValues,
  type SortOption,
} from "@/components/ui/table-toolbar";
import { type DataTableColumn, type DataTableSort } from "@/components/ui/data-table";
import { useBreakpoint } from "@/design/breakpoints";
import { QUERY_KEYS } from "@/lib/query-keys";

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

type ViewMode = RecordsViewMode;

const settlementGuideConfig: PageGuideConfig = {
  title: "دليل التسويات والمطابقة المخزنية",
  subtitle:
    "شرح شامل لكيفية معالجة الفروقات الجردية وتأثير كل حركة على الأرصدة والقيود المحاسبية وسجل التدقيق الداخلي.",
  badge: "إدارة المخزون والرقابة",
  icon: <Scale className="h-5 w-5 text-sky-500" />,
  summaryText:
    "شاشة التسويات هي صمام الأمان للرقابة المخزنية؛ تسجل بدقة وبصمة رقمية غير قابلة للتلاعب كل حركة تؤثر على رصيد المستودعات، سواء كانت تسوية يدوية لمعالجة عجز/فائض جردي، أو حركات آلية ناتجة عن فواتير بيع وشراء وترجيع.",
  overviewCards: [
    {
      title: "التسوية الجردية (Stock Adjustment)",
      description:
        "إدخال مباشر لتعديل رصيد صنف في مستودع محدد لمطابقة الجرد الفعلي على الرفوف مع الرصيد الدفتري للنظام.",
      icon: <Boxes className="h-4 w-4" />,
    },
    {
      title: "التتبع المالي والمحاسبي",
      description:
        "الفروقات الموجبة تُعامل كإيرادات فروق جرد، بينما العجز يسجل في حساب خسائر العجز أو التلف المحاسبي.",
      icon: <TrendingUp className="h-4 w-4" />,
    },
    {
      title: "سجل تدقيق كامل (Audit Trail)",
      description:
        "كل حركة تسجل اسم المستخدم الذي نفذها، التكلفة التاريخية، التاريخ والوقت بدقة، وسبب التسوية.",
      icon: <FileCheck className="h-4 w-4" />,
    },
    {
      title: "الربط مع الفواتير والتحويلات",
      description:
        "تعرض الشاشة بجانب التسويات كافة حركات الإدخال والإخراج الناتجة عن نقاط البيع، المشتريات، والتحويل بين الفروع.",
      icon: <RefreshCw className="h-4 w-4" />,
    },
  ],
  matrixTitle: "مصفوفة تأثير العمليات على المخزون والحسابات العامة",
  matrixDescription:
    "جدول تحليلي يوضح الأثر الفوري لكل نوع حركة على قاعدة البيانات، القيود اليومية، وأرصدة التكلفة:",
  impactMatrix: {
    columns: [
      { key: "type", label: "نوع الحركة", className: "w-[18%]" },
      { key: "stockImpact", label: "التأثير على رصيد المستودع", className: "w-[24%]" },
      { key: "financialImpact", label: "الأثر المالي والقيد المحاسبي", className: "w-[30%]" },
      { key: "triggerCondition", label: "سبب الحدوث ومصدر البيانات", className: "w-[28%]" },
    ],
    rows: [
      {
        badge: { label: "تسوية فائض (+)", variant: "emerald" },
        fields: {
          type: "تسوية بالزيادة (Adjustment In)",
          stockImpact: "زيادة الرصيد المتاح للصنف في المستودع المحدد فوراً بالقيمة المدخلة.",
          financialImpact: "من حـ/ المخزون (مدين) إلى حـ/ أرباح وفروقات جردية (دائن) بسعر التكلفة.",
          triggerCondition: "اكتشاف بضاعة فعلية زائدة أثناء عمليات الجرد الدوري أو السنوي.",
        },
      },
      {
        badge: { label: "تسوية عجز (-)", variant: "rose" },
        fields: {
          type: "تسوية بالنقص (Adjustment Out)",
          stockImpact: "تخفيض الرصيد المتاح للصنف لمنع البيع السالب أو الوهمي.",
          financialImpact: "من حـ/ عجز وفاقد مخزني (مدين) إلى حـ/ المخزون (دائن) بقيمة التكلفة.",
          triggerCondition: "تلف بضاعة، انتهاء صلاحية، أو نقص مثبت بمحضر جرد رسمي.",
        },
      },
      {
        badge: { label: "شراء (+)", variant: "blue" },
        fields: {
          type: "فاتورة مشتريات (Purchase)",
          stockImpact: "زيادة كميات المخزون وتحديث متوسط التكلفة المرجح (WAC).",
          financialImpact: "من حـ/ المخزون إلى حـ/ المورد أو الصندوق/البنك بحسب طريقة الدفع.",
          triggerCondition: "اعتماد فاتورة مشتريات أو إدخال عبر نقطة المشتريات (POP).",
        },
      },
      {
        badge: { label: "بيع (-)", variant: "purple" },
        fields: {
          type: "فاتورة مبيعات (Sale)",
          stockImpact: "خصم الكميات المباعة فوراً من مستودع نقطة البيع أو المستودع الرئيسي.",
          financialImpact:
            "إثبات الإيراد + قيد تكلفة البضاعة المباعة (COGS) من حـ/ التكلفة إلى حـ/ المخزون.",
          triggerCondition: "إتمام عملية بيع في الكاشير (POS) أو فاتورة مبيعات معتمدة.",
        },
      },
      {
        badge: { label: "تحويل (⇄)", variant: "amber" },
        fields: {
          type: "تحويل بين مستودعين (Transfer)",
          stockImpact: "خصم من المستودع المصدر وإضافة إلى المستودع الهدف دون تغيير الإجمالي العام.",
          financialImpact:
            "قيد مناقلة بين مراكز التكلفة وحسابات الفروع المعنية دون أثر على الأرباح.",
          triggerCondition: "مناقلة مخزنية بين المعارض والمستودعات المركزية.",
        },
      },
    ],
  },
  stepsTitle: "الخطوات القياسية لتنفيذ تسوية مخزنية صحيحة",
  steps: [
    {
      number: "1",
      title: "إجراء الجرد الفعلي ومطابقة الباركود",
      description:
        "قم بعد الكميات الموجودة فعلياً في المستودع ومقارنتها بالرقم الظاهر في شاشة المخزون.",
    },
    {
      number: "2",
      title: "تحديد الصنف والمستودع بدقة",
      description: "تأكد من اختيار المستودع الصحيح لتفادي ترحيل كميات لمستودع فرع آخر بالخطأ.",
    },
    {
      number: "3",
      title: "تسجيل السبب والمبرر الإداري",
      description:
        "كتابة سبب التسوية (مثل: تلف ناتج عن سوء تخزين، عجز جرد شهر مارس) لسلامة التدقيق المالي.",
    },
    {
      number: "4",
      title: "مراجعة السجل بعد الحفظ",
      description:
        "تظهر الحركة فوراً في هذا الجدول مع إبراز المستخدم والوقت والتكلفة لضمان الشفافية.",
    },
  ],
  rulesTitle: "الضوابط والتحذيرات الرقابية",
  rules: [
    {
      type: "danger",
      title: "منع التعديل بأثر رجعي أو الحذف المباشر",
      description:
        "حركات المخزون تُسجل كحركات غير قابلة للحذف (Append-Only)؛ في حال وجود خطأ في تسوية سابقة، يجب تصحيحها بتسوية عكسية جديدة موثقة.",
    },
    {
      type: "warning",
      title: "صلاحيات الوصول والرقابة الثنائية",
      description:
        "صفحة التسويات تقتصر على أصحاب الصلاحيات المخولة (المالك، المدير، المحاسب، أمين المستودع) لمنع أي تلاعب غير مصرح به.",
    },
    {
      type: "info",
      title: "حماية بيانات الشركة وقاعدة البيانات الحية",
      description:
        "جميع الاستعلامات مفهرسة ومهيأة للعمل السريع دون استهلاك موارد الخادم أو التأثير على حركة البيع المستمرة.",
    },
  ],
  footerTip: "فورتيكس ERP — التدقيق الرقمي الموحد والمطابقة المحاسبية اللحظية",
};

function SettlementsPage() {
  const { lang } = useI18n();
  const isRtl = lang === "ar";
  const { hasRole, user } = useAuth();
  const queryClient = useQueryClient();
  const breakpoint = useBreakpoint();
  const tableUsesHorizontalScroll =
    breakpoint === "xs" || breakpoint === "sm" || breakpoint === "md";
  const canManageSettlement =
    hasRole("owner") || hasRole("manager") || hasRole("warehouse") || hasRole("accountant");

  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<FilterValues>({});
  const [sortKey, setSortKey] = useState<string>("date_desc");
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [isAdjustmentOpen, setIsAdjustmentOpen] = useState(false);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: QUERY_KEYS.settlements,
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

  const productLabel = useCallback(
    (row: SettlementRow) =>
      isRtl
        ? row.products?.name_ar || row.products?.name
        : row.products?.name || row.products?.name_ar,
    [isRtl],
  );
  const warehouseLabel = useCallback(
    (row: SettlementRow) =>
      isRtl
        ? row.warehouses?.name_ar || row.warehouses?.name
        : row.warehouses?.name || row.warehouses?.name_ar,
    [isRtl],
  );

  const movementLabel = useCallback(
    (type: string) => {
      const map: Record<string, { ar: string; en: string }> = {
        adjustment: { ar: "تسوية", en: "Adjustment" },
        opening: { ar: "رصيد أول المدة", en: "Opening stock" },
        purchase: { ar: "شراء", en: "Purchase" },
        sale: { ar: "بيع", en: "Sale" },
        transfer_in: { ar: "تحويل وارد", en: "Transfer in" },
        transfer_out: { ar: "تحويل صادر", en: "Transfer out" },
        return_in: { ar: "مرتجع وارد", en: "Return in" },
        return_out: { ar: "مرتجع صادر", en: "Return out" },
        purchase_return: { ar: "مرتجع مشتريات", en: "Purchase return" },
        sale_return: { ar: "مرتجع مبيعات", en: "Sales return" },
      };
      const entry = map[type];
      return entry ? (isRtl ? entry.ar : entry.en) : type;
    },
    [isRtl],
  );

  const sourceLabel = useCallback(
    (type: string | null) => {
      const map: Record<string, { ar: string; en: string }> = {
        purchase: { ar: "فاتورة شراء", en: "Purchase invoice" },
        stock_opening: { ar: "مستند رصيد أول المدة", en: "Opening-stock document" },
        stock_adjustment: { ar: "مستند تسوية مخزون", en: "Stock-adjustment document" },
        sales_invoice: { ar: "فاتورة بيع", en: "Sales invoice" },
        stock_transfer: { ar: "تحويل مخزون", en: "Stock transfer" },
      };
      if (!type) return "—";
      const entry = map[type];
      return entry ? (isRtl ? entry.ar : entry.en) : type;
    },
    [isRtl],
  );

  /* ---------------- search + filter ---------------- */
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data ?? [];
    return (data ?? []).filter((row) => {
      const productText =
        `${row.products?.name ?? ""} ${row.products?.name_ar ?? ""} ${row.products?.sku ?? ""}`.toLowerCase();
      const warehouseText =
        `${row.warehouses?.name ?? ""} ${row.warehouses?.name_ar ?? ""}`.toLowerCase();
      const userText = row.profiles?.full_name?.toLowerCase() ?? "";
      return (
        productText.includes(q) ||
        warehouseText.includes(q) ||
        userText.includes(q) ||
        (row.note ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, query]);

  const filterDefinitions: FilterDefinition[] = useMemo(() => {
    const rows = data ?? [];
    const defs: FilterDefinition[] = [];
    const typeOptions = Array.from(new Set(rows.map((r) => r.movement_type))).map((value) => ({
      value,
      label: movementLabel(value),
    }));
    if (typeOptions.length) {
      defs.push({
        key: "movement_type",
        label: isRtl ? "نوع الحركة" : "Movement type",
        type: "select",
        options: typeOptions,
      });
    }
    const whOptions = Array.from(
      new Map(
        rows
          .filter((r) => r.warehouse_id)
          .map((r) => [r.warehouse_id, { value: r.warehouse_id, label: warehouseLabel(r) ?? "—" }]),
      ).values(),
    );
    if (whOptions.length) {
      defs.push({
        key: "warehouse_id",
        label: isRtl ? "المستودع" : "Warehouse",
        type: "select",
        options: whOptions,
      });
    }
    const userOptions = Array.from(
      new Map(
        rows
          .filter((r) => r.created_by && r.profiles?.full_name)
          .map((r) => [
            r.created_by as string,
            { value: r.created_by as string, label: r.profiles?.full_name ?? "" },
          ]),
      ).values(),
    );
    if (userOptions.length) {
      defs.push({
        key: "created_by",
        label: isRtl ? "المستخدم" : "User",
        type: "select",
        options: userOptions,
      });
    }
    defs.push({ key: "created_at", label: isRtl ? "التاريخ" : "Date", type: "date-range" });
    return defs;
  }, [data, isRtl, movementLabel, warehouseLabel]);

  const filtered = useMemo(() => {
    return searched.filter((row) => {
      if (filters.movement_type && row.movement_type !== filters.movement_type) return false;
      if (filters.warehouse_id && row.warehouse_id !== filters.warehouse_id) return false;
      if (filters.created_by && row.created_by !== filters.created_by) return false;
      if (filters.created_at && typeof filters.created_at === "object") {
        const rowTime = new Date(row.created_at).getTime();
        if (filters.created_at.from && rowTime < new Date(filters.created_at.from).getTime())
          return false;
        if (filters.created_at.to) {
          const to = new Date(filters.created_at.to);
          to.setHours(23, 59, 59, 999);
          if (rowTime > to.getTime()) return false;
        }
      }
      return true;
    });
  }, [searched, filters]);

  /* ---------------- KPI ---------------- */
  const kpi = useMemo(() => {
    const rows = data ?? [];
    let additions = 0;
    let deductions = 0;
    for (const row of rows) {
      if (Number(row.quantity) >= 0) additions++;
      else deductions++;
    }
    return { total: rows.length, additions, deductions };
  }, [data]);

  /* ---------------- sort ---------------- */
  const sortOptions: SortOption[] = useMemo(
    () => [
      { value: "date_desc", label: isRtl ? "الأحدث أولاً" : "Newest first" },
      { value: "date_asc", label: isRtl ? "الأقدم أولاً" : "Oldest first" },
      { value: "qty_desc", label: isRtl ? "الكمية (الأعلى)" : "Quantity (high)" },
      { value: "qty_asc", label: isRtl ? "الكمية (الأقل)" : "Quantity (low)" },
      { value: "type", label: isRtl ? "نوع الحركة" : "Movement type" },
    ],
    [isRtl],
  );

  const sortedRows = useMemo(() => {
    const list = [...filtered];
    if (sort) {
      const dir = sort.direction === "asc" ? 1 : -1;
      switch (sort.key) {
        case "quantity":
          return list.sort((a, b) => (Number(a.quantity) - Number(b.quantity)) * dir);
        case "type":
          return list.sort((a, b) => a.movement_type.localeCompare(b.movement_type) * dir);
        case "date":
          return list.sort(
            (a, b) => (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir,
          );
        default:
          break;
      }
    }
    switch (sortKey) {
      case "date_asc":
        return list.sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
      case "qty_desc":
        return list.sort((a, b) => Number(b.quantity) - Number(a.quantity));
      case "qty_asc":
        return list.sort((a, b) => Number(a.quantity) - Number(b.quantity));
      case "type":
        return list.sort((a, b) => a.movement_type.localeCompare(b.movement_type));
      default:
        return list.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
    }
  }, [filtered, sort, sortKey]);

  /* ---------------- classic table columns ---------------- */
  const columns = useMemo<DataTableColumn<SettlementRow>[]>(() => {
    const cols: DataTableColumn<SettlementRow>[] = [
      {
        key: "product",
        header: isRtl ? "المنتج" : "Product",
        width: "w-[240px]",
        cell: (row) => (
          <div className="py-0.5">
            <div className="truncate font-medium text-foreground">{productLabel(row) ?? "—"}</div>
            <div className="font-mono text-[11px] text-muted-foreground">
              {row.products?.sku ?? "—"}
            </div>
          </div>
        ),
      },
      {
        key: "warehouse",
        header: isRtl ? "المستودع" : "Warehouse",
        width: "w-[180px]",
        cell: (row) => (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Warehouse className="h-3.5 w-3.5" />
            <span>{warehouseLabel(row) ?? "—"}</span>
          </div>
        ),
      },
      {
        key: "type",
        header: isRtl ? "النوع" : "Type",
        sortable: true,
        width: "w-[150px]",
        sortValue: (row) => row.movement_type,
        cell: (row) => {
          const isPositive = Number(row.quantity) >= 0;
          return (
            <span
              className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] ${isPositive ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : "border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-300"}`}
            >
              {movementLabel(row.movement_type)}
            </span>
          );
        },
      },
      {
        key: "source",
        header: isRtl ? "المستند المصدر" : "Source document",
        width: "w-[170px]",
        cell: (row) => (
          <span className="text-[11px] text-muted-foreground">
            {sourceLabel(row.reference_type)}
          </span>
        ),
      },
      {
        key: "quantity",
        header: isRtl ? "الكمية" : "Qty",
        sortable: true,
        align: "end",
        width: "w-[120px]",
        sortValue: (row) => Number(row.quantity),
        cell: (row) => (
          <span className="font-mono text-foreground">{Number(row.quantity).toFixed(2)}</span>
        ),
      },
      {
        key: "reason",
        header: isRtl ? "السبب" : "Reason",
        width: "w-[220px]",
        cell: (row) => (
          <span className="block truncate text-muted-foreground">
            {row.note || row.reference || (isRtl ? "بدون سبب" : "No note")}
          </span>
        ),
      },
      {
        key: "user",
        header: isRtl ? "المستخدم" : "User",
        width: "w-[160px]",
        cell: (row) => (
          <span className="text-muted-foreground">
            {row.profiles?.full_name ?? user?.email ?? (isRtl ? "غير معروف" : "Unknown")}
          </span>
        ),
      },
      {
        key: "date",
        header: isRtl ? "التاريخ/الوقت" : "Date & time",
        sortable: true,
        width: "w-[180px]",
        sortValue: (row) => new Date(row.created_at).getTime(),
        cell: (row) => (
          <span className="text-muted-foreground">{new Date(row.created_at).toLocaleString()}</span>
        ),
      },
    ];
    return cols;
  }, [isRtl, productLabel, warehouseLabel, movementLabel, sourceLabel, user?.email]);

  const rendererProps = (row: SettlementRow) => ({
    row,
    isRtl,
    productName: productLabel(row) ?? "—",
    warehouseName: warehouseLabel(row) ?? "—",
    movementName: movementLabel(row.movement_type),
    sourceName: sourceLabel(row.reference_type),
    userName: row.profiles?.full_name ?? user?.email ?? (isRtl ? "غير معروف" : "Unknown"),
  });

  const hasActiveCriteria = Boolean(query.trim()) || Object.keys(filters).length > 0;

  if (!canManageSettlement) {
    return (
      <div className="panel-elevated rounded-3xl border border-border/80 bg-surface/90 p-8 text-center">
        <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <h3 className="text-lg font-semibold text-foreground">
          {isRtl ? "لا يوجد صلاحية للتسويات" : "Settlement access denied"}
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {isRtl
            ? "يحتاج المستخدم إلى صلاحية المخزون أو الإدارة لمشاهدة سجل التسويات."
            : "Inventory or admin access is required to view settlement records."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-12">
      <PageHeader
        title={isRtl ? "التسويات والمراجعة" : "Stock Settlements"}
        subtitle={
          isRtl
            ? "سجل واضح لكل حركة مخزون وتعديل مع مطابقة المستخدم والتاريخ والسبب"
            : "Clear audit trail for stock changes and review steps"
        }
        guide={settlementGuideConfig}
      />

      {/* ─── KPI cards ─── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <VortexMetricCard
          title={isRtl ? "إجمالي الحركات" : "Total movements"}
          value={kpi.total}
          subtitle={isRtl ? "المحمّلة حالياً" : "Currently loaded"}
          icon={<ClipboardList className="size-5" />}
          tone="info"
        />
        <VortexMetricCard
          title={isRtl ? "إضافات (فائض)" : "Additions (surplus)"}
          value={kpi.additions}
          subtitle={isRtl ? "حركات موجبة" : "Positive movements"}
          icon={<TrendingUp className="size-5" />}
          tone="success"
        />
        <VortexMetricCard
          title={isRtl ? "إخصومات (عجز)" : "Deductions (shortage)"}
          value={kpi.deductions}
          subtitle={isRtl ? "حركات سالبة" : "Negative movements"}
          icon={<TrendingDown className="size-5" />}
          tone="danger"
        />
        <VortexMetricCard
          title={isRtl ? "النتائج المطابقة" : "Matching results"}
          value={filtered.length}
          subtitle={isRtl ? "بعد البحث والفلترة" : "After search & filters"}
          icon={<Boxes className="size-5" />}
          tone="default"
        />
      </div>

      {/* ─── Standard VORTEX TableToolbar ─── */}
      <TableToolbar
        sticky
        lang={lang}
        search={{
          value: query,
          onValueChange: setQuery,
          placeholder: isRtl
            ? "بحث في المنتج أو المستودع أو المستخدم أو السبب"
            : "Search product, warehouse, user or reason",
          resultCount: filtered.length,
          loading: isFetching && !isLoading,
        }}
        filters={{ definitions: filterDefinitions, values: filters, onValueChange: setFilters }}
        sort={{
          options: sortOptions,
          value: sortKey,
          onValueChange: (value) => {
            setSortKey(value);
            setSort(null);
          },
          label: isRtl ? "ترتيب" : "Sort",
        }}
        viewToggle={
          <ToolbarAction
            label={
              viewMode === "cards"
                ? isRtl
                  ? "بطاقات"
                  : "Cards"
                : viewMode === "list"
                  ? isRtl
                    ? "قائمة"
                    : "List"
                  : isRtl
                    ? "كلاسيكي"
                    : "Classic"
            }
            icon={
              viewMode === "cards" ? (
                <LayoutGrid />
              ) : viewMode === "list" ? (
                <List />
              ) : (
                <TableProperties />
              )
            }
            onClick={() =>
              setViewMode((prev) =>
                prev === "cards" ? "list" : prev === "list" ? "table" : "cards",
              )
            }
            tone="ghost"
          />
        }
        action={
          <ToolbarAction
            label={isRtl ? "تسوية جديدة" : "New adjustment"}
            icon={<Plus />}
            tone="primary"
            onClick={() => setIsAdjustmentOpen(true)}
          />
        }
      />

      {/* ─── Records: cards / list / classic table — shared scaffold ─── */}
      <RecordsView<SettlementRow>
        rows={sortedRows}
        getRowId={(row) => row.id}
        viewMode={viewMode}
        loading={isLoading}
        refreshing={isFetching && !isLoading}
        error={error}
        onRetry={() => void refetch()}
        columns={columns}
        sort={sort}
        onSortChange={setSort}
        minWidth={1180}
        horizontalScroll={tableUsesHorizontalScroll}
        renderCard={(row) => <SettlementCard {...rendererProps(row)} />}
        renderListRow={(row) => <SettlementListRow {...rendererProps(row)} />}
        empty={{
          icon: <ClipboardList />,
          title: hasActiveCriteria
            ? isRtl
              ? "لا توجد حركات مطابقة"
              : "No matching movements"
            : isRtl
              ? "لا توجد حركات تسوية بعد"
              : "No settlement movements yet",
          description: hasActiveCriteria
            ? isRtl
              ? "جرّب تعديل البحث أو الفلاتر."
              : "Try adjusting your search or filters."
            : isRtl
              ? "ابدأ بإجراء تسوية جردية جديدة."
              : "Start by recording a new stock adjustment.",
        }}
      />

      {isAdjustmentOpen && (
        <StockAdjustmentDialog
          onClose={() => setIsAdjustmentOpen(false)}
          onSaved={() => {
            setIsAdjustmentOpen(false);
            queryClient.invalidateQueries({ queryKey: QUERY_KEYS.settlements });
            queryClient.invalidateQueries({ queryKey: ["inventory"] });
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Settlement renderers                                               */
/* ------------------------------------------------------------------ */

interface SettlementRendererProps {
  row: SettlementRow;
  isRtl: boolean;
  productName: string;
  warehouseName: string;
  movementName: string;
  sourceName: string;
  userName: string;
}

function SettlementCard({
  row,
  isRtl,
  productName,
  warehouseName,
  movementName,
  sourceName,
  userName,
}: SettlementRendererProps) {
  const isPositive = Number(row.quantity) >= 0;
  return (
    <div className="card-mullak group relative flex h-full flex-col justify-between rounded-2xl p-3 transition-all duration-200 hover:shadow-md sm:p-4.5">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className={`h-12 w-1.5 shrink-0 rounded-full ${isPositive ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]" : "bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.3)]"}`}
        />
        <div className="grid size-11 shrink-0 place-items-center rounded-2xl border border-primary/20 bg-primary/10 text-primary transition-transform group-hover:scale-105">
          {isPositive ? <TrendingUp className="size-5" /> : <TrendingDown className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-xs font-bold text-foreground sm:text-sm">
            {productName}
          </span>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {row.products?.sku ?? "—"}
          </div>
          <span
            className={`mt-1 inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[9px] font-bold ${isPositive ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : "border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-300"}`}
          >
            {movementName}
          </span>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 truncate">
          <Warehouse className="size-2.5" />
          {warehouseName}
        </span>
        <span className="truncate">{sourceName}</span>
        <span className="col-span-2 truncate">
          {row.note || row.reference || (isRtl ? "بدون سبب" : "No note")}
        </span>
      </div>

      <div className="mt-3 flex items-end justify-between border-t border-border/60 pt-2.5">
        <span className="truncate text-[10px] text-muted-foreground">{userName}</span>
        <span className="font-mono text-base font-bold text-foreground">
          {Number(row.quantity).toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function SettlementListRow({
  row,
  isRtl,
  productName,
  warehouseName,
  movementName,
  sourceName,
  userName,
}: SettlementRendererProps) {
  const isPositive = Number(row.quantity) >= 0;
  return (
    <div className="card-mullak group relative flex flex-col justify-between gap-3 rounded-2xl border p-3.5 transition-all duration-200 hover:border-primary/50 hover:shadow-md sm:p-4 md:flex-row md:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          aria-hidden
          className={`h-11 w-1.5 shrink-0 rounded-full sm:h-12 ${isPositive ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" : "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.45)]"}`}
        />
        <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary transition-all group-hover:scale-105 group-hover:bg-primary group-hover:text-primary-foreground">
          {isPositive ? <TrendingUp className="size-5" /> : <TrendingDown className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate text-sm font-bold leading-snug text-foreground">
              {productName}
            </h4>
            <span
              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[9px] font-bold ${isPositive ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" : "border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-300"}`}
            >
              {movementName}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 truncate">
              <Warehouse className="size-2.5" />
              {warehouseName}
            </span>
            <span className="truncate">— {sourceName}</span>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-4 border-t border-border/50 pt-2 ps-4 text-xs md:border-t-0 md:pt-0">
        <span className="hidden max-w-[120px] truncate text-[11px] text-muted-foreground sm:inline">
          {userName}
        </span>
        <span className="hidden font-mono text-[11px] text-muted-foreground lg:inline">
          {new Date(row.created_at).toLocaleString()}
        </span>
        <div className="text-end">
          <p className="font-mono text-base font-bold tracking-tight text-foreground">
            {Number(row.quantity).toFixed(2)}
          </p>
          <p className="text-[10px] text-muted-foreground">{isRtl ? "الكمية" : "Qty"}</p>
        </div>
      </div>
    </div>
  );
}
