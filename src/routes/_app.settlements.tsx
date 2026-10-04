import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { SettlementWizardSheet } from "@/components/stock/settlement-wizard-sheet";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  ClipboardList,
  Plus,
  Scale,
  Search,
  ShieldCheck,
  Warehouse as WarehouseIcon,
  Boxes,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  FileCheck,
} from "lucide-react";
import { type PageGuideConfig } from "@/components/page-guide";

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

/** تسميات حركة المخزون — نفس القيم الموجودة مسبقًا، موحّدة في مكان واحد. */
function movementTypeLabel(type: string, lang: "ar" | "en") {
  const map: Record<string, { ar: string; en: string }> = {
    adjustment: { ar: "تسوية", en: "Adjustment" },
    opening: { ar: "رصيد أول المدة", en: "Opening stock" },
  };
  return map[type]?.[lang] ?? type;
}

function sourceTypeLabel(type: string | null, lang: "ar" | "en") {
  const map: Record<string, { ar: string; en: string }> = {
    purchase: { ar: "فاتورة شراء", en: "Purchase invoice" },
    stock_opening: { ar: "مستند رصيد أول المدة", en: "Opening-stock document" },
    stock_adjustment: { ar: "مستند تسوية مخزون", en: "Stock-adjustment document" },
    sales_invoice: { ar: "فاتورة بيع", en: "Sales invoice" },
    stock_transfer: { ar: "تحويل مخزون", en: "Stock transfer" },
  };
  return (type && map[type]?.[lang]) || type || "—";
}

function SettlementsPage() {
  const { t, lang } = useI18n();
  const { hasRole, user } = useAuth();
  const queryClient = useQueryClient();
  const canManageSettlement =
    hasRole("owner") || hasRole("manager") || hasRole("warehouse") || hasRole("accountant");
  const [query, setQuery] = useState("");
  const [isAdjustmentOpen, setIsAdjustmentOpen] = useState(false);

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

  const productLabel = (row: SettlementRow) =>
    lang === "ar"
      ? row.products?.name_ar || row.products?.name || "—"
      : row.products?.name || row.products?.name_ar || "—";
  const warehouseLabel = (row: SettlementRow) =>
    lang === "ar"
      ? row.warehouses?.name_ar || row.warehouses?.name || "—"
      : row.warehouses?.name || row.warehouses?.name_ar || "—";

  const columns: DataTableColumn<SettlementRow>[] = useMemo(
    () => [
      {
        key: "product",
        header: lang === "ar" ? "المنتج" : "Product",
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{productLabel(row)}</p>
            <p className="text-[11px] text-muted-foreground">{row.products?.sku ?? "—"}</p>
          </div>
        ),
      },
      {
        key: "warehouse",
        header: lang === "ar" ? "المستودع" : "Warehouse",
        cell: (row) => (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <WarehouseIcon className="size-3.5 shrink-0" />
            {warehouseLabel(row)}
          </span>
        ),
      },
      {
        key: "movement_type",
        header: lang === "ar" ? "النوع" : "Type",
        cell: (row) => (
          <StatusBadge tone={Number(row.quantity) >= 0 ? "success" : "danger"}>
            {movementTypeLabel(row.movement_type, lang)}
          </StatusBadge>
        ),
      },
      {
        key: "reference_type",
        header: lang === "ar" ? "المستند المصدر" : "Source document",
        cell: (row) => (
          <span className="text-[11px] text-muted-foreground">
            {sourceTypeLabel(row.reference_type, lang)}
          </span>
        ),
        hideBelow: "lg",
      },
      {
        key: "quantity",
        header: lang === "ar" ? "الكمية" : "Qty",
        align: "end",
        cell: (row) => (
          <span
            className={
              Number(row.quantity) >= 0
                ? "font-mono text-foreground"
                : "font-mono font-semibold text-rose-600 dark:text-rose-400"
            }
          >
            {Number(row.quantity).toFixed(2)}
          </span>
        ),
        sortable: true,
        sortValue: (row) => Number(row.quantity),
      },
      {
        key: "note",
        header: lang === "ar" ? "السبب" : "Reason",
        cell: (row) => (
          <span className="truncate text-xs text-muted-foreground">
            {row.note || row.reference || (lang === "ar" ? "بدون سبب" : "No note")}
          </span>
        ),
        hideBelow: "md",
      },
      {
        key: "user",
        header: lang === "ar" ? "المستخدم" : "User",
        cell: (row) => (
          <span className="text-xs text-muted-foreground">
            {row.profiles?.full_name ?? user?.email ?? (lang === "ar" ? "غير معروف" : "Unknown")}
          </span>
        ),
        hideBelow: "lg",
      },
      {
        key: "created_at",
        header: lang === "ar" ? "التاريخ/الوقت" : "Date & time",
        cell: (row) => (
          <span className="text-xs text-muted-foreground">
            {new Date(row.created_at).toLocaleString()}
          </span>
        ),
        hideBelow: "sm",
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- label helpers derive from lang
    [lang, user],
  );

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
        guide={settlementGuideConfig}
      />
      <div className="panel-elevated overflow-hidden rounded-3xl border border-border/80 bg-surface/90 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 p-3.5">
          <div className="flex flex-1 min-w-[260px] items-center gap-2 rounded-full border border-border bg-surface px-4 h-10 text-sm shadow-2xs">
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
          <div className="flex items-center gap-2">
            <div className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold text-amber-600 dark:text-amber-300">
              {filtered.length} {lang === "ar" ? "حركة" : "records"}
            </div>
            {canManageSettlement && (
              <button
                type="button"
                onClick={() => setIsAdjustmentOpen(true)}
                className="flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-xs font-bold text-primary-foreground shadow-sm hover:opacity-90 transition"
              >
                <Plus className="h-4 w-4" />
                <span>{lang === "ar" ? "إجراء تسوية جردية جديدة" : "New Stock Adjustment"}</span>
              </button>
            )}
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.id}
          loading={isLoading}
          initialLoading={isLoading}
          minWidth={1000}
          empty={{
            icon: <ClipboardList className="size-5" />,
            title: query
              ? lang === "ar"
                ? "لا توجد نتائج مطابقة"
                : "No matching records"
              : lang === "ar"
                ? "لا توجد حركات تسوية بعد"
                : "No settlement movements yet",
            description:
              lang === "ar"
                ? "ابدأ تسوية جرقية جديدة عبر المعالج لiveness مطابقة الجرد مع رصيد الدفتر."
                : "Start a new settlement from the wizard to reconcile the count with the ledger.",
            action: canManageSettlement ? (
              <Button
                type="button"
                onClick={() => setIsAdjustmentOpen(true)}
                className="rounded-xl bg-primary font-semibold text-primary-foreground"
              >
                <Plus className="size-4" />
                {lang === "ar" ? "إجراء تسوية جردية جديدة" : "New Stock Adjustment"}
              </Button>
            ) : undefined,
          }}
        />
      </div>

      <SettlementWizardSheet
        open={isAdjustmentOpen}
        onOpenChange={setIsAdjustmentOpen}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ["settlements"] });
          queryClient.invalidateQueries({ queryKey: ["inventory"] });
        }}
      />
    </>
  );
}
