import { ModuleGuard, useModules } from "@/lib/modules";
import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertTriangle,
  ArrowRightLeft,
  Boxes,
  CalendarClock,
  LayoutGrid,
  List,
  Loader2,
  Package,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  TableProperties,
  Trash2,
  Warehouse,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { FieldInput, NumberInput, fieldSurfaceClass } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { FormActions, FormGrid, FormSection } from "@/components/ui/form-layout";
import { VortexDrawerDialog } from "@/components/vortex-ui";
import { EmptyState } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";
import { DataTable, type DataTableColumn, type DataTableSort } from "@/components/ui/data-table";
import {
  TableToolbar,
  ToolbarAction,
  applyFilters,
  type FilterDefinition,
  type FilterValues,
  type SortOption,
} from "@/components/ui/table-toolbar";
import { type PageGuideConfig } from "@/components/page-guide";
import { buildSearchIndex, fuzzySearch } from "@/design/fuzzy";
import { qtyCell } from "@/lib/format";
import { useBreakpoint } from "@/design/breakpoints";
import { QUERY_KEYS } from "@/lib/query-keys";
import { useRealtimeTable } from "@/lib/realtime";

export const Route = createFileRoute("/_app/transfers")({
  head: () => ({ meta: [{ title: "تحويلات المخزون — فورتيكس ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="multi_warehouse">
      <TransfersPage />
    </ModuleGuard>
  ),
});

const TRANSFERS_PAGE_SIZE = 50;

type WarehouseRef = { id?: string; name: string; name_ar: string | null } | null;

type TransferRow = {
  id: string;
  transfer_number: string | null;
  status: string | null;
  note: string | null;
  created_at: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  from: WarehouseRef;
  to: WarehouseRef;
  stock_transfer_items: { quantity: number | null }[] | null;
};

/**
 * Real statuses that already exist in the database (`stock_transfers.status`).
 * The UI only *reads* these values — nothing is written or normalised here.
 */
const TRANSFER_STATUSES = ["draft", "pending", "completed", "cancelled"] as const;

const transferGuideConfig: PageGuideConfig = {
  title: "دليل تحويلات المخزون بين المستودعات",
  subtitle:
    "شرح شامل لمناقلة البضاعة بين الفروع والمستودعات، مع ضوابط منع التحويل بأكثر من الرصيد المتاح وضمان سلامة الأرصدة والتكلفة.",
  badge: "إدارة المخزون والمناقلات",
  icon: <ArrowRightLeft className="h-5 w-5 text-purple-500" />,
  summaryText:
    "شاشة التحويلات هي أداة المناقلة الرسمية بين مواقع التخزين؛ تسجّل انتقال الكميات من المستودع المصدر إلى المستودع الهدف في حركة واحدة متوازنة، وتخصم من رصيد الأول وتضيف للثاني دون التأثير على إجمالي المخزون أو الأرباح.",
  overviewCards: [
    {
      title: "مناقلة مخزنية متوازنة",
      description:
        "خصم فوري من رصيد المستودع المصدر وإضافة مطابقة للمستودع الهدف، مع بقاء إجمالي الكميات على مستوى المنشأة دون تغيير.",
      icon: <ArrowRightLeft className="h-4 w-4" />,
    },
    {
      title: "حماية من التحويل الزائد",
      description:
        "لا يمكن تحويل كمية تتجاوز الرصيد الفعلي المتاح في المستودع المصدر، ويظهر التنبيه لحظياً على سطر البند.",
      icon: <ShieldCheck className="h-4 w-4" />,
    },
    {
      title: "رقم تحويل متسلسل وتدقيق كامل",
      description:
        "كل تحويل يحمل رقماً متسلسلاً فريداً مع تاريخ الإنشاء ومستخدم التنفيذ وملاحظات المبرر الإداري.",
      icon: <Sparkles className="h-4 w-4" />,
    },
    {
      title: "أثر محاسبي بلا أرباح",
      description:
        "التحويل قيد مناقلة بين مراكز التكلفة فقط؛ لا يُثبت إيراداً ولا خسارة ولا يؤثر على قائمة الدخل.",
      icon: <Boxes className="h-4 w-4" />,
    },
  ],
  matrixTitle: "مصفوفة أثر التحويل على الأرصدة والقيود",
  matrixDescription: "جدول تحليلي يوضح ما يحدث في قاعدة البيانات ودفتر اليومية عند كل تحويل:",
  impactMatrix: {
    columns: [
      { key: "type", label: "الحركة", className: "w-[20%]" },
      { key: "stockImpact", label: "التأثير على رصيد المستودعات", className: "w-[30%]" },
      { key: "financialImpact", label: "الأثر المالي والقيد المحاسبي", className: "w-[30%]" },
      { key: "triggerCondition", label: "مصدر البيانات", className: "w-[20%]" },
    ],
    rows: [
      {
        badge: { label: "تحويل صادر (−)", variant: "rose" },
        fields: {
          type: "خصم المستودع المصدر",
          stockImpact: "تخفيض الكمية المحوّلة من رصيد الصنف في المستودع المصدر.",
          financialImpact: "قيد مناقلة دائن لحساب مخزون الفرع المصدر بسعر التكلفة.",
          triggerCondition: "سجل حركة المخزون transfer_out.",
        },
      },
      {
        badge: { label: "تحويل وارد (+)", variant: "emerald" },
        fields: {
          type: "إضافة المستودع الهدف",
          stockImpact: "إضافة الكمية نفسها إلى رصيد الصنف في المستودع الهدف.",
          financialImpact: "قيد مناقلة مدين لحساب مخزون الفرع الهدف بنفس التكلفة.",
          triggerCondition: "سجل حركة المخزون transfer_in.",
        },
      },
      {
        badge: { label: "بدون أثر ربحية", variant: "slate" },
        fields: {
          type: "إجمالي المنشأة",
          stockImpact: "لا يتغير إجمالي الكميات على مستوى المنشأة إطلاقاً.",
          financialImpact: "لا يوجد إيراد أو تكلفة بضاعة مباعة؛ الأثر على الميزانية فقط.",
          triggerCondition: "قاعدة التوزيع الداخلي للنظام.",
        },
      },
    ],
  },
  stepsTitle: "الخطوات القياسية لتنفيذ تحويل مخزني سليم",
  steps: [
    {
      number: "1",
      title: "تحديد المستودع المصدر",
      description:
        "اختر المستودع الذي تحمل البضاعة رصيداً فعلياً فيه، وسيتم تحميل أرصدته المتاحة تلقائياً.",
    },
    {
      number: "2",
      title: "تحديد المستودع الهدف",
      description: "اختر الفرع أو المستودع المستقبل، ولا يمكن أن يكون نفس المستودع المصدر.",
    },
    {
      number: "3",
      title: "إضافة البنود والكميات",
      description:
        "ابحث عن الأصناف وأضفها، وسيمنع النظام أي كمية تتجاوز الرصيد المتاح لحظياً بالمصدر.",
    },
    {
      number: "4",
      title: "تدوين الملاحظات والحفظ",
      description:
        "اكتب سبب التحويل (إعادة توازن، طلب فرع، توزيع موسمي) ثم احفظ لترحيل الحركة فوراً.",
    },
  ],
  rulesTitle: "الضوابط والتحذيرات الرقابية",
  rules: [
    {
      type: "danger",
      title: "منع التحويل بأكثر من الرصيد المتاح",
      description:
        "أي كمية تتجاوز رصيد المستودع المصدر تُرفض على مستوى الواجهة وقاعدة البيانات معاً لمنع الرصيد السالب.",
    },
    {
      type: "warning",
      title: "الحركات المخزنية غير قابلة للحذف",
      description:
        "التحويل المنفّذ يُسجل كحركة غير قابلة للحذف (Append-Only)؛ التصحيح يكون بتحويل عكسي جديد موثق.",
    },
    {
      type: "info",
      title: "الصلاحيات المخولة للتحويل",
      description:
        "الوصول إلى التحويلات متاح للمالك والمدير وأمين المستودع فقط، لمنع أي مناقلة غير مصرح بها.",
    },
  ],
  footerTip: "فورتيكس ERP — مناقلات مخزنية موثقة وأرصدة فروع متطابقة لحظياً",
};

function TransfersPage() {
  const { t, lang } = useI18n();
  const { hasRole, isPlatformAdmin, isPlatformSuperadmin } = useAuth();
  const canManageTransfers =
    isPlatformAdmin ||
    isPlatformSuperadmin ||
    hasRole("owner") ||
    hasRole("manager") ||
    hasRole("warehouse");
  const breakpoint = useBreakpoint();
  const tableUsesHorizontalScroll =
    breakpoint === "xs" || breakpoint === "sm" || breakpoint === "md";
  const qc = useQueryClient();

  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<FilterValues>({});
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const [quickFilter, setQuickFilter] = useState<"all" | "incoming" | "outgoing">("all");
  const [viewMode, setViewMode] = useState<"grid" | "list" | "table">("grid");
  const [open, setOpen] = useState(false);

  const label = (en?: string | null, ar?: string | null) =>
    (lang === "ar" ? ar || en : en || ar) ?? "—";

  const statusLabel = (status: string | null) =>
    status ? t(`transfers.status.${status}`) : t("transfers.status.pending");

  const statusTone = (status: string | null): "success" | "danger" | "neutral" | "warning" =>
    status === "completed"
      ? "success"
      : status === "cancelled"
        ? "danger"
        : status === "draft"
          ? "neutral"
          : "warning";

  const itemCount = (row: TransferRow) => row.stock_transfer_items?.length ?? 0;

  const totalQty = (row: TransferRow) =>
    (row.stock_transfer_items ?? []).reduce(
      (sum, item) => sum + Math.abs(Number(item.quantity) || 0),
      0,
    );

  /* ---------------- warehouse options (for filters) ---------------- */
  const { data: warehouses } = useQuery({
    queryKey: QUERY_KEYS.warehouses,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, name, name_ar, code")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: canManageTransfers,
  });

  /*
   * Streaming read of the transfer ledger.
   *
   * The previous version asked for a hard `.limit(100)` and stopped there, so any
   * transfer older than the newest 100 rows was invisible. It now pages 50 rows
   * at a time with `.range()`, exactly like the products/settlements pages.
   * The SELECT columns, joins and ordering are unchanged; no schema, RLS or RPC
   * was touched.
   */
  const {
    data: transferPages,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["transfers"],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const from = pageParam * TRANSFERS_PAGE_SIZE;
      const to = from + TRANSFERS_PAGE_SIZE - 1;
      const { data, error: rowsError } = await supabase
        .from("stock_transfers")
        .select(
          "*, from:warehouses!stock_transfers_from_warehouse_id_fkey(id,name,name_ar), to:warehouses!stock_transfers_to_warehouse_id_fkey(id,name,name_ar), stock_transfer_items(quantity)",
        )
        .order("created_at", { ascending: false })
        .range(from, to);
      if (rowsError) throw rowsError;
      const rows = (data ?? []) as unknown as TransferRow[];
      return { rows, hasMore: rows.length === TRANSFERS_PAGE_SIZE };
    },
    getNextPageParam: (lastPage, pages) => (lastPage.hasMore ? pages.length : undefined),
    enabled: canManageTransfers,
  });

  const rows = useMemo(
    () => transferPages?.pages.flatMap((page) => page.rows) ?? [],
    [transferPages],
  );

  useRealtimeTable<TransferRow>(
    { table: "stock_transfers", queryKey: ["transfers"], debounceMs: 120 },
    qc,
  );

  /* ---------------- search (fuzzy, Arabic-normalised) ---------------- */
  const searchIndex = useMemo(
    () =>
      buildSearchIndex(rows, (r) => [
        r.transfer_number,
        r.note,
        r.from?.name,
        r.from?.name_ar,
        r.to?.name,
        r.to?.name_ar,
      ]),
    [rows],
  );

  const searched = useMemo(() => {
    const q = query.trim();
    if (!q) return rows;
    return fuzzySearch(searchIndex, q, { threshold: 0.5, requireAll: true }).map((m) => m.item);
  }, [rows, query, searchIndex]);

  /* ---------------- filter definitions ---------------- */
  const filterDefinitions = useMemo<FilterDefinition[]>(() => {
    const defs: FilterDefinition[] = [
      {
        key: "status",
        label: t("transfers.filter.status"),
        type: "select",
        options: TRANSFER_STATUSES.map((status) => ({
          value: status,
          label: t(`transfers.status.${status}`),
        })),
      },
    ];
    if (warehouses?.length) {
      defs.push({
        key: "from",
        label: t("transfers.filter.from"),
        type: "select",
        options: warehouses.map((w: any) => ({ value: w.id, label: label(w.name, w.name_ar) })),
      });
      defs.push({
        key: "to",
        label: t("transfers.filter.to"),
        type: "select",
        options: warehouses.map((w: any) => ({ value: w.id, label: label(w.name, w.name_ar) })),
      });
    }
    defs.push({ key: "created_at", label: t("transfers.sort.date"), type: "date-range" });
    return defs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouses, lang, t]);

  const filtered = useMemo(
    () =>
      applyFilters(
        searched,
        filters,
        {
          status: (r) => r.status ?? "pending",
          from: (r) => r.from_warehouse_id,
          to: (r) => r.to_warehouse_id,
        },
        { dateAccessors: { created_at: (r) => r.created_at } },
      ),
    [searched, filters],
  );

  const displayRows = useMemo(() => {
    return filtered.filter((r) => {
      if (quickFilter === "incoming") return r.status === "completed" || r.status === "pending";
      if (quickFilter === "outgoing") return r.status === "draft" || r.status === "cancelled";
      return true;
    });
  }, [filtered, quickFilter]);

  /* ---------------- KPI counts (over loaded rows) ---------------- */
  const kpi = useMemo(() => {
    let itemsMoved = 0;
    let today = 0;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    for (const r of rows) {
      itemsMoved += itemCount(r);
      if (new Date(r.created_at).getTime() >= startOfToday.getTime()) today++;
    }
    return { itemsMoved, today };
  }, [rows]);

  /* ---------------- sort ---------------- */
  const sortOptions = useMemo<SortOption[]>(() => {
    void sort;
    return [
      { value: "", label: lang === "ar" ? "الافتراضي (الأحدث)" : "Default (newest)" },
      { value: "date", label: t("transfers.sort.date") },
      { value: "number", label: t("transfers.sort.number") },
      { value: "items", label: t("transfers.sort.items") },
    ];
  }, [lang, t, sort]);

  const sortedRows = useMemo(() => {
    if (!sort?.key) return displayRows;
    const dir = sort.direction === "desc" ? -1 : 1;
    const val = (r: TransferRow): string | number => {
      switch (sort.key) {
        case "number":
          return r.transfer_number ?? "";
        case "items":
          return itemCount(r);
        default:
          return new Date(r.created_at).getTime();
      }
    };
    return [...displayRows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), lang === "ar" ? "ar" : "en") * dir;
    });
  }, [displayRows, sort, lang]);

  /* ---------------- classic table columns ---------------- */
  const columns = useMemo<DataTableColumn<TransferRow>[]>(() => {
    return [
      {
        key: "number",
        header: t("transfers.number"),
        sortable: true,
        width: "w-[150px]",
        sortValue: (r) => r.transfer_number ?? "",
        cell: (r) => (
          <div className="flex flex-col py-0.5">
            <span className="font-mono text-xs font-semibold text-foreground">
              {r.transfer_number ?? "—"}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {new Date(r.created_at).toLocaleDateString()}
            </span>
          </div>
        ),
      },
      {
        /** Sortable mirror of the date shown under the transfer number, so the
         * "date" option in the sort menu has a column to sort by. */
        key: "date",
        header: lang === "ar" ? "التاريخ" : "Date",
        sortable: true,
        width: "w-[130px]",
        sortValue: (r) => new Date(r.created_at).getTime(),
        cell: (r) => (
          <span className="font-mono text-xs text-muted-foreground">
            {new Date(r.created_at).toLocaleDateString()}
          </span>
        ),
      },
      {
        key: "route",
        header: `${t("transfers.from")} / ${t("transfers.to")}`,
        width: "w-[300px]",
        cell: (r) => (
          <div className="flex items-center gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-foreground">
              <Warehouse className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{label(r.from?.name, r.from?.name_ar)}</span>
            </span>
            <ArrowRightLeft className="size-3.5 shrink-0 text-primary" />
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-foreground">
              <Warehouse className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{label(r.to?.name, r.to?.name_ar)}</span>
            </span>
          </div>
        ),
      },
      {
        key: "status",
        header: t("transfers.status.label"),
        width: "w-[130px]",
        cell: (r) => (
          <StatusBadge tone={statusTone(r.status)} dot>
            {statusLabel(r.status)}
          </StatusBadge>
        ),
      },
      {
        key: "items",
        header: t("transfers.items"),
        align: "end",
        sortable: true,
        width: "w-[110px]",
        sortValue: (r) => itemCount(r),
        cell: (r) => (
          <span className="font-mono text-xs font-bold tabular-nums text-foreground">
            {itemCount(r).toLocaleString()}
          </span>
        ),
      },
      {
        key: "qty",
        header: t("transfers.qty"),
        align: "end",
        width: "w-[110px]",
        cell: (r) => (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {qtyCell(totalQty(r))}
          </span>
        ),
      },
      {
        key: "note",
        header: t("transfers.note"),
        width: "w-[200px]",
        cell: (r) => (
          <span className="block truncate text-xs text-muted-foreground">{r.note ?? "—"}</span>
        ),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, t]);

  const emptyState = (
    <div className="card-mullak flex flex-col items-center justify-center space-y-3 p-12 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-muted/30 text-muted-foreground">
        <ArrowRightLeft className="size-8" />
      </div>
      <h4 className="text-base font-bold text-foreground">{t("transfers.empty")}</h4>
      <p className="max-w-sm text-xs text-muted-foreground">{t("transfers.empty_hint")}</p>
      <Button size="sm" icon={<Plus />} onClick={() => setOpen(true)}>
        {t("transfers.new")}
      </Button>
    </div>
  );

  if (!canManageTransfers) {
    return (
      <div className="panel-elevated rounded-3xl border border-border/80 bg-surface/90 p-8 text-center">
        <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <h3 className="text-lg font-semibold text-foreground">
          {lang === "ar" ? "لا يوجد صلاحية للتحويلات" : "Transfer access denied"}
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {lang === "ar"
            ? "يحتاج المستخدم إلى صلاحية المستودعات أو الإدارة لمشاهدة التحويلات."
            : "Warehouse or admin access is required to view transfers."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-12">
      <PageHeader
        title={t("transfers.title")}
        subtitle={t("transfers.subtitle")}
        guide={transferGuideConfig}
      />

      {/* ─── KPI cards ─── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="card-mullak group relative flex items-center justify-between overflow-hidden p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:text-xs">
              {t("transfers.kpi.total")}
            </p>
            <h3 className="mt-1 font-mono text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              {rows.length.toLocaleString()}
            </h3>
            <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground/80">
              <Sparkles className="size-3 text-primary" />
              {lang === "ar" ? "داخل السجل المحمّل" : "in loaded ledger"}
            </span>
          </div>
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm transition-transform group-hover:scale-105">
            <ArrowRightLeft className="size-6" />
          </div>
          <div className="pointer-events-none absolute -left-6 -top-6 size-20 rounded-full bg-primary/10 blur-xl" />
        </div>

        <div className="card-mullak group relative flex items-center justify-between overflow-hidden p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-500/90 sm:text-xs">
              {t("transfers.kpi.items")}
            </p>
            <h3 className="mt-1 font-mono text-xl font-bold tracking-tight text-emerald-400 sm:text-2xl">
              {kpi.itemsMoved.toLocaleString()}
            </h3>
            <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-emerald-500/80">
              <Boxes className="size-3" />
              {lang === "ar" ? "بنود منقولة" : "line items"}
            </span>
          </div>
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 shadow-sm transition-transform group-hover:scale-105">
            <Boxes className="size-6" />
          </div>
          <div className="pointer-events-none absolute -left-6 -top-6 size-20 rounded-full bg-emerald-500/10 blur-xl" />
        </div>

        <div className="card-mullak group relative flex items-center justify-between overflow-hidden p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-500/90 sm:text-xs">
              {t("transfers.kpi.today")}
            </p>
            <h3 className="mt-1 font-mono text-xl font-bold tracking-tight text-blue-400 sm:text-2xl">
              {kpi.today.toLocaleString()}
            </h3>
            <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-blue-500/80">
              <CalendarClock className="size-3" />
              {lang === "ar" ? "تحويلات اليوم" : "transfers today"}
            </span>
          </div>
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl border border-blue-500/20 bg-blue-500/10 text-blue-400 shadow-sm transition-transform group-hover:scale-105">
            <CalendarClock className="size-6" />
          </div>
          <div className="pointer-events-none absolute -left-6 -top-6 size-20 rounded-full bg-blue-500/10 blur-xl" />
        </div>

        <div className="card-mullak group relative flex items-center justify-between overflow-hidden p-4 sm:p-5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-500/90 sm:text-xs">
              {lang === "ar" ? "مسودات ومعلّقة" : "Draft & pending"}
            </p>
            <h3 className="mt-1 font-mono text-xl font-bold tracking-tight text-amber-400 sm:text-2xl">
              {rows
                .filter((r) => r.status === "draft" || r.status === "pending")
                .length.toLocaleString()}
            </h3>
            <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-amber-500/80">
              <AlertTriangle className="size-3" />
              {lang === "ar" ? "تحتاج متابعة" : "needs follow-up"}
            </span>
          </div>
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-400 shadow-sm transition-transform group-hover:scale-105">
            <AlertTriangle className="size-6" />
          </div>
          <div className="pointer-events-none absolute -left-6 -top-6 size-20 rounded-full bg-amber-500/10 blur-xl" />
        </div>
      </div>

      {/* ─── Toolbar: search + filters + sort + view toggle + quick pills ─── */}
      <div className="pt-2 sm:pt-3.5">
        <TableToolbar
          sticky
          search={{
            value: query,
            onValueChange: setQuery,
            placeholder:
              lang === "ar" ? "ابحث برقم التحويل أو المستودع" : "Search number or warehouse",
            resultCount: rows.length,
            loading: isFetching && !isLoading,
          }}
          filters={{ definitions: filterDefinitions, values: filters, onValueChange: setFilters }}
          sort={{
            options: sortOptions,
            value: sort?.key ?? "",
            onValueChange: (v) => setSort(v ? { key: v, direction: "asc" } : null),
            label: lang === "ar" ? "ترتيب" : "Sort",
          }}
          viewToggle={
            <ToolbarAction
              label={
                viewMode === "grid"
                  ? t("transfers.view_grid")
                  : viewMode === "list"
                    ? t("transfers.view_list")
                    : t("transfers.view_classic")
              }
              icon={
                viewMode === "grid" ? (
                  <LayoutGrid />
                ) : viewMode === "list" ? (
                  <List />
                ) : (
                  <TableProperties />
                )
              }
              onClick={() =>
                setViewMode((prev) =>
                  prev === "grid" ? "list" : prev === "list" ? "table" : "grid",
                )
              }
              tone="ghost"
            />
          }
          action={
            <ToolbarAction
              label={t("transfers.new")}
              icon={<Plus />}
              tone="primary"
              onClick={() => setOpen(true)}
            />
          }
        >
          {viewMode !== "table" && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {(
                [
                  { id: "all", label: t("transfers.quick.all"), count: rows.length },
                  {
                    id: "incoming",
                    label: t("transfers.quick.incoming"),
                    count: rows.filter((r) => r.status === "completed" || r.status === "pending")
                      .length,
                  },
                  {
                    id: "outgoing",
                    label: t("transfers.quick.outgoing"),
                    count: rows.filter((r) => r.status === "draft" || r.status === "cancelled")
                      .length,
                  },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setQuickFilter(f.id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition ${
                    quickFilter === f.id
                      ? "border-primary bg-primary text-primary-foreground shadow-xs shadow-primary/20"
                      : "border-border/70 bg-surface/70 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                  }`}
                >
                  <span>{f.label}</span>
                  <span
                    className={`rounded-full px-1.5 font-mono text-[10px] ${
                      quickFilter === f.id
                        ? "bg-white/20 text-white"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {f.count}
                  </span>
                </button>
              ))}
            </div>
          )}
        </TableToolbar>
      </div>

      {/* ─── Grid view ─── */}
      {viewMode === "grid" ? (
        <div className="space-y-4">
          {isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="card-mullak h-44 animate-pulse rounded-2xl bg-surface-2/40"
                />
              ))}
            </div>
          ) : sortedRows.length === 0 ? (
            emptyState
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
                {sortedRows.map((r) => (
                  <div
                    key={r.id}
                    className={`card-mullak group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-r-4 p-4 transition-all duration-200 sm:p-5 ${
                      r.status === "completed"
                        ? "border-r-emerald-500 hover:border-emerald-500/60"
                        : r.status === "cancelled"
                          ? "border-r-red-500 hover:border-red-500/60"
                          : r.status === "draft"
                            ? "border-r-muted-foreground/40 hover:border-border"
                            : "border-r-amber-500 hover:border-amber-500/60"
                    }`}
                  >
                    <div className="mb-2.5 flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 truncate rounded-md border border-border/60 bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {r.transfer_number ?? "—"}
                      </span>
                      <StatusBadge tone={statusTone(r.status)} dot>
                        {statusLabel(r.status)}
                      </StatusBadge>
                    </div>

                    <div className="mb-3 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-xs text-foreground">
                        <Warehouse className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{label(r.from?.name, r.from?.name_ar)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 ps-1 text-[11px] text-muted-foreground">
                        <ArrowRightLeft className="size-3 shrink-0 text-primary" />
                        <span>{lang === "ar" ? "إلى" : "to"}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                        <Warehouse className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{label(r.to?.name, r.to?.name_ar)}</span>
                      </div>
                    </div>

                    {r.note && (
                      <p className="mb-3 line-clamp-1 text-[11px] text-muted-foreground/80">
                        {r.note}
                      </p>
                    )}

                    <div className="mt-auto flex items-end justify-between gap-2 border-t border-border/60 pt-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-medium text-muted-foreground">
                          {t("transfers.items")}
                        </p>
                        <p className="font-mono text-lg font-bold tracking-tight text-foreground">
                          {itemCount(r).toLocaleString()}
                        </p>
                      </div>
                      <div className="text-end">
                        <p className="text-[10px] font-medium text-muted-foreground">
                          {t("transfers.qty")}
                        </p>
                        <p className="font-mono text-xs font-semibold tabular-nums text-muted-foreground">
                          {qtyCell(totalQty(r))}
                        </p>
                        <p className="font-mono text-[10px] text-muted-foreground/70">
                          {new Date(r.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {hasNextPage && (
                <div className="flex justify-center pt-4">
                  <button
                    onClick={() => void fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="flex items-center gap-2 rounded-2xl border border-border/80 bg-surface px-6 py-2.5 text-xs font-bold text-foreground shadow-sm transition hover:bg-surface-2 active:scale-95 disabled:opacity-50"
                  >
                    {isFetchingNextPage ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        <span>{t("transfers.loading_more")}</span>
                      </>
                    ) : (
                      <span>{t("transfers.load_more")}</span>
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ) : viewMode === "list" ? (
        /* ─── List view ─── */
        <div className="space-y-3">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="card-mullak h-20 animate-pulse rounded-2xl bg-surface-2/40"
                />
              ))}
            </div>
          ) : sortedRows.length === 0 ? (
            emptyState
          ) : (
            <>
              <div className="space-y-2.5">
                {sortedRows.map((r) => (
                  <div
                    key={r.id}
                    className="card-mullak group relative flex flex-col justify-between gap-3 rounded-2xl border p-3.5 transition-all duration-200 hover:border-primary/50 hover:shadow-md sm:p-4 md:flex-row md:items-center"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span
                        aria-hidden
                        className={`h-11 w-1.5 shrink-0 rounded-full sm:h-12 ${
                          r.status === "completed"
                            ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"
                            : r.status === "cancelled"
                              ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.45)]"
                              : r.status === "draft"
                                ? "bg-muted-foreground/30"
                                : "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                        }`}
                      />
                      <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary transition-all group-hover:scale-105 group-hover:bg-primary group-hover:text-primary-foreground">
                        <ArrowRightLeft className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="truncate font-mono text-sm font-bold leading-snug text-foreground">
                            {r.transfer_number ?? "—"}
                          </h4>
                          <StatusBadge tone={statusTone(r.status)} dot>
                            {statusLabel(r.status)}
                          </StatusBadge>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1 text-[10px]">
                            <Warehouse className="size-2.5" />
                            {label(r.from?.name, r.from?.name_ar)}
                          </span>
                          <ArrowRightLeft className="size-3 text-primary" />
                          <span className="inline-flex items-center gap-1 text-[10px]">
                            <Warehouse className="size-2.5" />
                            {label(r.to?.name, r.to?.name_ar)}
                          </span>
                          {r.note && <span className="truncate text-[10px]">— {r.note}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-3 border-t border-border/50 pt-2 ps-4 text-xs sm:gap-4 md:border-t-0 md:pt-0">
                      <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
                        {new Date(r.created_at).toLocaleString()}
                      </span>
                      <div className="text-end">
                        <p className="font-mono text-base font-bold tracking-tight text-foreground">
                          {itemCount(r).toLocaleString()}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{t("transfers.items")}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {hasNextPage && (
                <div className="flex justify-center pt-4">
                  <button
                    onClick={() => void fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="flex items-center gap-2 rounded-2xl border border-border/80 bg-surface px-6 py-2.5 text-xs font-bold text-foreground shadow-sm transition hover:bg-surface-2 active:scale-95 disabled:opacity-50"
                  >
                    {isFetchingNextPage ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        <span>{t("transfers.loading_more")}</span>
                      </>
                    ) : (
                      <span>{t("transfers.load_more")}</span>
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        /* ─── Classic table view with infinite scroll sentinel ─── */
        <div className="panel-elevated -mx-1 overflow-hidden rounded-2xl border border-border/70 sm:mx-0">
          <DataTable
            className="px-0"
            columns={columns}
            rows={displayRows}
            rowKey={(r) => r.id}
            loading={isLoading}
            initialLoading={isLoading}
            refreshing={isFetching && !isLoading && !isFetchingNextPage}
            error={(error as Error) ?? null}
            onRetry={() => refetch()}
            sort={sort}
            onSortChange={setSort}
            infinite
            hasMore={Boolean(hasNextPage)}
            onLoadMore={() => {
              if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
            }}
            loadingMore={isFetchingNextPage}
            pageSize={TRANSFERS_PAGE_SIZE}
            totalCount={rows.length}
            minWidth={1050}
            horizontalScroll={tableUsesHorizontalScroll}
            stickyHeader
            empty={{
              icon: <ArrowRightLeft />,
              title: t("transfers.empty"),
              description: t("transfers.empty_hint"),
              action: (
                <Button size="sm" icon={<Plus />} onClick={() => setOpen(true)}>
                  {t("transfers.new")}
                </Button>
              ),
            }}
          />
        </div>
      )}

      <p className="px-1 text-[11px] text-muted-foreground/70">{t("transfers.scope_hint")}</p>

      {open && (
        <NewTransferDialog
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            qc.invalidateQueries({ queryKey: ["transfers"] });
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  New transfer dialog — same write path (RPC) as before.            */
/* ------------------------------------------------------------------ */

function NewTransferDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t, lang } = useI18n();
  const { isModuleEnabled } = useModules();
  const hasMultiWarehouse = isModuleEnabled("multi_warehouse");
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<{ product_id: string; name: string; quantity: number }[]>([]);
  // رصيد المستودع المصدر لكل منتج: product_id -> الكمية المتاحة
  const [stockByProduct, setStockByProduct] = useState<Record<string, number>>({});
  const [stockLoading, setStockLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [catalogueLoaded, setCatalogueLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("warehouses").select("id,name,name_ar").eq("is_active", true).order("name"),
      supabase
        .from("products")
        .select("id,name,name_ar,sku")
        .eq("is_active", true)
        .order("name")
        .limit(200),
    ]).then(([w, p]) => {
      setWarehouses(w.data ?? []);
      setProducts(p.data ?? []);
      setCatalogueLoaded(true);
    });
  }, []);

  // جلب الرصيد الفعلي للمستودع المصدر حتى نمنع تحويل كمية تتجاوز المتوفر.
  useEffect(() => {
    if (!from) {
      setStockByProduct({});
      return;
    }
    let cancelled = false;
    setStockLoading(true);
    supabase
      .from("inventory")
      .select("product_id,quantity")
      .eq("warehouse_id", from)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          toast.error(error.message);
          setStockByProduct({});
        } else {
          const map: Record<string, number> = {};
          for (const row of (data ?? []) as { product_id: string; quantity: number | null }[]) {
            map[row.product_id] = Number(row.quantity ?? 0);
          }
          setStockByProduct(map);
        }
        setStockLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from]);

  const availableFor = (productId: string) => stockByProduct[productId] ?? 0;

  /** الأسطر التي تتجاوز الرصيد المتوفر لحظيًا في المستودع المصدر */
  const oversoldLines = useMemo(
    () => lines.filter((line) => line.quantity > availableFor(line.product_id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- availableFor يقرأ stockByProduct مباشرة
    [lines, stockByProduct],
  );

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
      return [...l, { product_id: p.id, name: p.name_ar || p.name, quantity: 1 }];
    });
    setSearch("");
  }

  /** تُستخدم عند تغيير المستودع المصدر: تُنقّي الأسطر التي لم يعد لها رصيد كافٍ */
  function handleFromChange(next: string) {
    setFrom(next);
    setTo((current) => (current === next ? "" : current));
  }

  async function save() {
    if (!from || !to || from === to || lines.length === 0) {
      toast.error(t("transfers.check_form"));
      return;
    }
    if (stockLoading) {
      toast.error(t("transfers.stock_loading"));
      return;
    }
    if (oversoldLines.length > 0) {
      toast.error(
        lang === "ar"
          ? `الكمية المطلوبة تتجاوز الرصيد المتوفر: ${oversoldLines.map((l) => l.name).join("، ")}`
          : `Quantity exceeds available stock for: ${oversoldLines.map((l) => l.name).join(", ")}`,
      );
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("create_stock_transfer" as any, {
      _from: from,
      _to: to,
      _note: note || null,
      _items: lines as any,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("transfers.done"));
    setLines([]);
    setNote("");
    onSaved();
  }

  return (
    <VortexDrawerDialog
      open={true}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      size="lg"
      title={t("transfers.new")}
      description={t("transfers.dialog")}
      footer={
        <div className="flex w-full items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="flex-1 sm:flex-initial min-w-[110px] rounded-xl font-medium"
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            form="transfer-form"
            loading={saving}
            disabled={
              lines.length === 0 || stockLoading || oversoldLines.length > 0 || !from || !to
            }
            className="flex-1 sm:flex-initial min-w-[140px] rounded-xl bg-primary font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                {lang === "ar" ? "جارٍ تنفيذ التحويل..." : "Executing transfer…"}
              </span>
            ) : stockLoading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                {lang === "ar" ? "جارٍ التحقق من الأرصدة..." : "Verifying stock…"}
              </span>
            ) : (
              t("common.save")
            )}
          </Button>
        </div>
      }
    >
      <form
        id="transfer-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="flex flex-col gap-6"
      >
        <FormSection
          title={lang === "ar" ? "بيانات التحويل" : "Transfer details"}
          description={
            lang === "ar"
              ? "اختر المستودع المصدر ثم الوجهة — يُمنع اختيار المستودع نفسه للطرفين."
              : "Pick the source then the destination — the same warehouse cannot be both."
          }
        >
          <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
            <WarehousePicker
              label={t("transfers.from")}
              icon={<Warehouse className="size-4" />}
              tone="source"
              warehouses={warehouses}
              value={from}
              onChange={handleFromChange}
              disabledIds={to ? [to] : []}
              loading={stockLoading}
              footer={
                from && !stockLoading ? (
                  <span className="text-[11px] text-muted-foreground">
                    {lang === "ar"
                      ? `${Object.keys(stockByProduct).length} صنف برصيد في هذا المستودع`
                      : `${Object.keys(stockByProduct).length} items in stock here`}
                  </span>
                ) : null
              }
              lang={lang}
            />

            <div className="hidden md:flex md:items-center md:justify-center">
              <span className="grid size-9 place-items-center rounded-full border border-border/80 bg-muted/60 text-muted-foreground">
                <ArrowRightLeft className="size-4 rtl:rotate-180" />
              </span>
            </div>

            <WarehousePicker
              label={t("transfers.to")}
              icon={<Warehouse className="size-4" />}
              tone="destination"
              warehouses={warehouses}
              value={to}
              onChange={setTo}
              disabledIds={from ? [from] : []}
              loading={catalogueLoaded && warehouses.length === 0}
              lang={lang}
            />
          </div>

          <div className="md:hidden">
            <FormField label={t("transfers.note")}>
              {(p) => (
                <FieldInput
                  id={p.id}
                  aria-describedby={p["aria-describedby"]}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={lang === "ar" ? "سبب التحويل..." : "Reason for the transfer..."}
                />
              )}
            </FormField>
          </div>

          {!hasMultiWarehouse && (
            <p className="text-[11px] text-muted-foreground">
              {lang === "ar"
                ? "تحويل المستودعات يتطلب تفعيل وحدة تعدد المستودعات."
                : "Warehouse transfers require the multi-warehouse module."}
            </p>
          )}

          {!catalogueLoaded && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {lang === "ar" ? "جارٍ تحميل البيانات..." : "Loading data…"}
            </div>
          )}
        </FormSection>

        <FormSection title={lang === "ar" ? "بنود التحويل" : "Transfer items"}>
          <div className="relative">
            <FieldInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("transfers.search_product")}
              className="ps-9"
            />
            <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground" />
            {search && filtered.length > 0 && (
              <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-border bg-popover shadow-lg">
                {filtered.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent"
                    onClick={() => addLine(p)}
                  >
                    <span className="truncate">
                      {lang === "ar" ? (p.name_ar ?? p.name) : p.name}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">{p.sku}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-3 overflow-hidden rounded-xl border border-border/70">
            <table className="w-full text-sm">
              <thead className="bg-surface-2/60 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-start font-medium">
                    {lang === "ar" ? "المنتج" : "Product"}
                  </th>
                  <th className="px-3 py-2 text-end font-medium">
                    {lang === "ar" ? "المتاح بالمصدر" : "Available at source"}
                  </th>
                  <th className="px-3 py-2 text-start font-medium">{t("transfers.qty")}</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-0">
                      <EmptyState
                        icon={<Package className="size-4" />}
                        title={t("transfers.add_products")}
                        description={
                          lang === "ar"
                            ? "ابحث عن صنف أعلاه لإضافته — سيظهر رصيده المتاح من المستودع المصدر."
                            : "Search for an item above — its available source balance will be shown."
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  lines.map((l, i) => {
                    const available = availableFor(l.product_id);
                    const exceeds = l.quantity > available;
                    return (
                      <tr key={l.product_id} className="border-b border-border/50 last:border-0">
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <Package className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate text-xs">{l.name}</span>
                          </div>
                        </td>
                        <td
                          className={`px-3 py-2.5 text-end font-mono text-xs ${
                            exceeds ? "font-semibold text-destructive" : "text-muted-foreground"
                          }`}
                        >
                          {stockLoading ? "…" : qtyCell(available)}
                        </td>
                        <td className="px-3 py-2.5">
                          <NumberInput
                            min={0}
                            value={l.quantity}
                            onValueChange={(next) =>
                              setLines((ls) =>
                                ls.map((x, j) => (j === i ? { ...x, quantity: next ?? 0 } : x)),
                              )
                            }
                            className={`w-24 ${exceeds ? "border-destructive text-destructive" : ""}`}
                          />
                          {exceeds && (
                            <p className="mt-1 text-[10px] font-medium text-destructive">
                              {lang === "ar"
                                ? `الرصيد المتوفر ${available} فقط`
                                : `Only ${available} available`}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-end">
                          <IconButton
                            type="button"
                            size="sm"
                            variant="danger"
                            tooltip
                            ariaLabel={t("common.delete")}
                            icon={<Trash2 />}
                            round
                            onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {oversoldLines.length > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-destructive">
              <AlertTriangle className="size-3.5" />
              {lang === "ar"
                ? "راجع الكميات المظللة قبل الحفظ"
                : "Review the highlighted quantities before saving"}
            </p>
          )}

          {from && !stockLoading && lines.length === 0 && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Warehouse className="size-3.5 shrink-0" />
              {lang === "ar"
                ? `الرصيد المتاح في المستودع المصدر: ${Object.keys(stockByProduct).length} صنف`
                : `Available at source: ${Object.keys(stockByProduct).length} items`}
            </p>
          )}

          {from && to && (
            <p className="flex flex-wrap items-center gap-1.5 rounded-xl border-border/70 bg-surface-2/40 px-3 py-2 text-[11px] text-muted-foreground">
              <span className="font-semibold text-foreground">
                {warehouses.find((w) => w.id === from)
                  ? lang === "ar"
                    ? warehouses.find((w) => w.id === from)?.name_ar ||
                      warehouses.find((w) => w.id === from)?.name
                    : warehouses.find((w) => w.id === from)?.name
                  : "—"}
              </span>
              <ArrowRightLeft className="size-3.5 shrink-0 rtl:rotate-180" />
              <span className="font-semibold text-foreground">
                {warehouses.find((w) => w.id === to)
                  ? lang === "ar"
                    ? warehouses.find((w) => w.id === to)?.name_ar ||
                      warehouses.find((w) => w.id === to)?.name
                    : warehouses.find((w) => w.id === to)?.name
                  : "—"}
              </span>
            </p>
          )}

          {hasMultiWarehouse && warehouses.length === 0 && catalogueLoaded && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {lang === "ar" ? "لا توجد مستودعات مفعّلة" : "No active warehouses found"}
            </p>
          )}
        </FormSection>
      </form>
    </VortexDrawerDialog>
  );
}
/* ------------------------------------------------------------------ */
/*  WarehousePicker — بطاقات مرئية لاختيار مستودع                       */
/*  تستبدل الـ Select التقليدي، وتمنع اختيار نفس المستودع للطرفين،   */
/*  وتعرض حالة الرصيد قبل النقل بوضوح.                                 */
/* ------------------------------------------------------------------ */

type PickerWarehouse = { id: string; name: string; name_ar?: string | null };

function WarehousePicker({
  label,
  icon,
  tone,
  warehouses,
  value,
  onChange,
  disabledIds,
  loading,
  footer,
  lang,
}: {
  label: string;
  icon: React.ReactNode;
  tone: "source" | "destination";
  warehouses: PickerWarehouse[];
  value: string;
  onChange: (id: string) => void;
  /** مستودعات لا يجوز اختيارها (لمنع المصدر = الوجهة). */
  disabledIds: string[];
  loading?: boolean;
  footer?: React.ReactNode;
  lang: "ar" | "en";
}) {
  const isAr = lang === "ar";
  const name = (w: PickerWarehouse) => (isAr ? w.name_ar || w.name : w.name || w.name_ar || "—");

  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground/90">
        {icon}
        {label}
        <span className="font-bold text-destructive">*</span>
      </p>

      {loading ? (
        <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      ) : warehouses.length === 0 ? (
        <EmptyState
          icon={<Warehouse className="size-4" />}
          title={isAr ? "لا توجد مستودعات" : "No warehouses"}
          description={
            isAr ? "أضف مستودعاً نشطاً للمتابعة." : "Add an active warehouse to continue."
          }
        />
      ) : (
        <div
          role="radiogroup"
          aria-label={label}
          className={cn(
            "grid gap-2",
            tone === "source" ? "sm:grid-cols-2 md:grid-cols-1" : "sm:grid-cols-2 md:grid-cols-1",
          )}
        >
          {warehouses.map((w) => {
            const active = w.id === value;
            const blocked = disabledIds.includes(w.id);
            return (
              <button
                key={w.id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={blocked}
                title={
                  blocked
                    ? isAr
                      ? "لا يمكن اختيار نفس المستودع للطرفين"
                      : "The same warehouse cannot be both sides"
                    : undefined
                }
                onClick={() => !blocked && onChange(w.id)}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-xl border p-3 text-start transition",
                  active
                    ? tone === "source"
                      ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                      : "border-emerald-500/60 bg-emerald-500/5 ring-2 ring-emerald-500/20"
                    : "border-border/80 hover:bg-muted/50",
                  blocked && "cursor-not-allowed opacity-40 hover:bg-transparent",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {name(w)}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {blocked
                      ? isAr
                        ? "غير متاح للاختيار"
                        : "Not selectable"
                      : isAr
                        ? tone === "source"
                          ? "مستودع المصدر"
                          : "مستودع الوجهة"
                        : tone === "source"
                          ? "Source warehouse"
                          : "Destination warehouse"}
                  </span>
                </span>
                {active ? (
                  <CheckCircle2
                    className={cn(
                      "size-4 shrink-0",
                      tone === "source" ? "text-primary" : "text-emerald-500",
                    )}
                  />
                ) : blocked ? (
                  <AlertTriangle className="size-4 shrink-0 text-muted-foreground" />
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {footer && <div className="pt-0.5">{footer}</div>}
    </div>
  );
}
