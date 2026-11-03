import { useEffect, useState, useMemo } from "react";
import {
  Filter,
  Search,
  RotateCcw,
  Printer,
  Download,
  Eye,
  CheckCircle2,
  Calendar,
  Layers,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PAYMENT_METHOD_CATALOG } from "@/lib/payments/payment-methods";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import type {
  ReportColumnDefinition,
  ReportDefinition,
  ReportFilterDefinition,
  ReportFilterValues,
  ReportViewTemplateType,
} from "@/lib/reports/types";
import { searchReportFilterOptions } from "@/lib/reports/report-execution.functions";
import { ReportTemplateSelector } from "./report-template-selector";
import { ReportTemplateCreatorDialog } from "./report-template-creator-dialog";
import { ReportColumnVisibilityButton } from "./report-column-visibility-button";
import { TemplateTypeIndicator } from "./template-type-indicator";
import { UnifiedDimensionFilterControl } from "./unified-dimension-filter-control";
import {
  getDomainDimensions,
  type ReportDimensionKey,
} from "@/lib/reports/registry/groupby-registry";

interface ReportFiltersBarProps {
  filters: ReportFilterDefinition[];
  values: ReportFilterValues;
  onChange: (key: string, value: any) => void;
  onReset: () => void;
  onPreview?: () => void;
  onPrint?: () => void;
  onExport?: () => void;
  onOpenColumnPicker?: () => void;
  loading?: boolean;
  definition?: ReportDefinition;
  currentTemplate?: ReportViewTemplateType;
  onSelectReport?: (reportId: string) => void;
  columns?: ReportColumnDefinition[];
  columnVisibility?: Record<string, boolean>;
  onChangeVisibility?: (visibility: Record<string, boolean>) => void;
  onResetVisibility?: () => void;
  visibleColumnsCount?: number;
  totalColumnsCount?: number;
  currentView?: ReportViewTemplateType;
  onViewChange?: (view: ReportViewTemplateType) => void;
  isCustomMultiMethod?: boolean;
  selectedDimensions?: ReportDimensionKey[];
  onToggleDimension?: (dimension: ReportDimensionKey) => void;
}

const optionSourceByControl = {
  customer_select: "customers",
  supplier_select: "suppliers",
  warehouse_select: "warehouses",
  product_select: "products",
} as const;

/**
 * خيارات فلتر طريقة الدفع — من الكتالوج لا من قائمة محلية.
 *
 * القائمة السابقة كانت أربعة عناصر فقط وتسمّي البطاقة «شبكة / بطاقة» وتنسى
 * الشيك والمحفظة، فتقارير مبنية على فلتر الدفع لا تستطيع عزل هذه الطرق.
 */
const PAYMENT_METHODS = Array.from(
  new Map(
    PAYMENT_METHOD_CATALOG.map((method) => [
      method.legacyValue,
      { value: method.legacyValue, label: method.nameAr },
    ]),
  ).values(),
);

const INVOICE_STATUSES = [
  { value: "draft", label: "مسودة" },
  { value: "confirmed", label: "مؤكدة" },
  { value: "completed", label: "مكتملة" },
  { value: "cancelled", label: "ملغاة" },
  { value: "returned", label: "مرتجعة" },
];

export function ReportFiltersBar({
  filters,
  values,
  onChange,
  onReset,
  onPreview,
  onPrint,
  onExport,
  onOpenColumnPicker,
  loading,
  definition,
  onSelectReport,
  columns,
  columnVisibility,
  onChangeVisibility,
  onResetVisibility,
  visibleColumnsCount,
  totalColumnsCount,
  currentView,
  onViewChange,
  isCustomMultiMethod,
  selectedDimensions = [],
  onToggleDimension,
}: ReportFiltersBarProps) {
  const [searchDraft, setSearchDraft] = useState(values.search || "");
  const [optionsBySource, setOptionsBySource] = useState<
    Record<string, Array<{ id: string; label: string }>>
  >({});
  const [, setOptionsLoading] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState("this_month");

  const domainDimensions = useMemo(
    () => getDomainDimensions(definition?.domain || "sales"),
    [definition?.domain],
  );

  const selectableFilters = useMemo(
    () => filters.filter((f) => f.controlType in optionSourceByControl),
    [filters],
  );

  useEffect(() => {
    if (searchDraft === (values.search || "")) return;
    const timeout = window.setTimeout(() => onChange("search", searchDraft), 300);
    return () => window.clearTimeout(timeout);
  }, [searchDraft, values.search, onChange]);

  useEffect(() => {
    let active = true;
    setOptionsLoading(true);
    const domainSources = ["customers", "suppliers", "warehouses", "products", "branches"] as const;
    Promise.all(
      domainSources.map(
        async (source) => [source, await searchReportFilterOptions({ data: { source } })] as const,
      ),
    )
      .then((entries) => {
        if (active) setOptionsBySource(Object.fromEntries(entries));
      })
      .finally(() => {
        if (active) setOptionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function handlePresetChange(preset: string) {
    setSelectedPreset(preset);
    const today = new Date();
    let start = "";
    let end = today.toISOString().split("T")[0];

    if (preset === "today") {
      start = end;
    } else if (preset === "yesterday") {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      start = y.toISOString().split("T")[0];
      end = start;
    } else if (preset === "this_week") {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      start = d.toISOString().split("T")[0];
    } else if (preset === "this_month") {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      start = firstDay.toISOString().split("T")[0];
    } else if (preset === "last_month") {
      const firstDay = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const lastDay = new Date(today.getFullYear(), today.getMonth(), 0);
      start = firstDay.toISOString().split("T")[0];
      end = lastDay.toISOString().split("T")[0];
    } else if (preset === "all") {
      start = "";
      end = "";
    }

    onChange("startDate", start);
    onChange("endDate", end);
  }

  // Count active filters
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (values.startDate || values.endDate) count++;
    if (values.search) count++;
    selectableFilters.forEach((f) => {
      if (values[f.key]) count++;
    });
    if (values.paymentMethod && values.paymentMethod !== "all") count++;
    if (values.status && values.status !== "all") count++;
    return count;
  }, [values, selectableFilters]);

  const handleSelectReport = (reportId: string) => {
    if (onSelectReport) {
      onSelectReport(reportId);
    } else {
      const url = new URL(window.location.href);
      url.searchParams.set("report", reportId);
      window.location.href = url.toString();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* ── شريط التحكم العلوي الموحد: اختيار القالب + إنشاء قالب جديد + ظهور وتخصيص الأعمدة بجانب بعضها ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-2 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* 1. زر يفتح قائمة منسدلة لاختيار نوع القالب حسب التقرير */}
          <ReportTemplateSelector
            currentDomain={definition?.domain || "sales"}
            activeReportId={definition?.id}
            onSelectReport={handleSelectReport}
          />

          {/* 2. مكون إنشاء وتصميم قالب جديد وتسميته وحفظه */}
          <ReportTemplateCreatorDialog
            currentDomain={definition?.domain || "sales"}
            activeReportId={definition?.id}
            onTemplateCreated={handleSelectReport}
          />

          {/* 3. مكون ظهور الأعمدة منقول بجانب مكون اختيار القالب ومكون إنشاء قالب */}
          <ReportColumnVisibilityButton
            columns={columns || definition?.columns}
            columnVisibility={columnVisibility}
            onChangeVisibility={onChangeVisibility}
            onResetVisibility={onResetVisibility}
            onClick={onOpenColumnPicker}
            visibleCount={visibleColumnsCount}
            totalCount={totalColumnsCount || definition?.columns.length}
          />

          {/* 4. أيقونات التنقل المصغرة بين القوالب الثلاثة مع تمييز قالب التجميع المخصص */}
          <TemplateTypeIndicator
            currentView={currentView}
            onViewChange={onViewChange}
            isCustomMultiMethod={isCustomMultiMethod}
          />
        </div>

        {activeFiltersCount > 0 && (
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
            <span>{activeFiltersCount} فلاتر نشطة</span>
          </div>
        )}
      </div>

      {/* ── Mobile Controls (< md) ── */}
      <div className="flex md:hidden items-center justify-between gap-2 border border-border rounded-xl bg-card p-2.5 shadow-xs">
        <div className="flex items-center gap-2">
          <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
            <SheetTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5">
                <Filter className="h-3.5 w-3.5" />
                <span>الفلاتر</span>
                {activeFiltersCount > 0 && (
                  <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px]">
                    {activeFiltersCount}
                  </Badge>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
              <SheetHeader>
                <SheetTitle className="text-sm font-bold text-foreground">
                  خيارات الفلترة
                </SheetTitle>
              </SheetHeader>
              <div className="space-y-2.5 py-3 text-xs">
                {/* Mobile Filter Controls */}
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-foreground">الفترة الزمنية</label>
                  <Select onValueChange={handlePresetChange} value={selectedPreset}>
                    <SelectTrigger className="h-7 text-xs w-full">
                      <SelectValue placeholder="اختر الفترة" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="today">اليوم</SelectItem>
                      <SelectItem value="yesterday">أمس</SelectItem>
                      <SelectItem value="this_week">آخر 7 أيام</SelectItem>
                      <SelectItem value="this_month">الشهر الحالي</SelectItem>
                      <SelectItem value="last_month">الشهر السابق</SelectItem>
                      <SelectItem value="all">كل الفترات</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="grid grid-cols-2 gap-1.5 pt-1">
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-muted-foreground block">من</span>
                      <Input
                        type="date"
                        value={values.startDate || ""}
                        onChange={(e) => onChange("startDate", e.target.value)}
                        className="h-7 text-xs w-full"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-muted-foreground block">إلى</span>
                      <Input
                        type="date"
                        value={values.endDate || ""}
                        onChange={(e) => onChange("endDate", e.target.value)}
                        className="h-7 text-xs w-full"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-foreground">البحث السريع</label>
                  <Input
                    value={searchDraft}
                    onChange={(e) => setSearchDraft(e.target.value)}
                    placeholder="رقم الفاتورة، المرجع، الاسم..."
                    className="h-7 text-xs w-full"
                  />
                </div>

                {selectableFilters.map((filter) => {
                  const source =
                    optionSourceByControl[filter.controlType as keyof typeof optionSourceByControl];
                  const options = optionsBySource[source] || [];
                  const currentValue = values[filter.key] || "all";

                  return (
                    <div key={filter.key} className="space-y-1">
                      <label className="text-[11px] font-medium text-foreground">
                        {filter.labelAr}
                      </label>
                      <Select
                        value={currentValue}
                        onValueChange={(val) =>
                          onChange(filter.key, val === "all" ? undefined : val)
                        }
                      >
                        <SelectTrigger className="h-7 text-xs w-full">
                          <SelectValue placeholder={`كل ${filter.labelAr}`} />
                        </SelectTrigger>
                        <SelectContent className="max-h-[220px]">
                          <SelectItem value="all">كل {filter.labelAr}</SelectItem>
                          {options.map((opt) => (
                            <SelectItem key={opt.id} value={opt.id}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-foreground">طريقة الدفع</label>
                    <Select
                      value={values.paymentMethod || "all"}
                      onValueChange={(val) =>
                        onChange("paymentMethod", val === "all" ? undefined : val)
                      }
                    >
                      <SelectTrigger className="h-7 text-xs w-full">
                        <SelectValue placeholder="طريقة الدفع" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">كل طرق الدفع</SelectItem>
                        {PAYMENT_METHODS.map((pm) => (
                          <SelectItem key={pm.value} value={pm.value}>
                            {pm.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-foreground">حالة الفاتورة</label>
                    <Select
                      value={values.status || "all"}
                      onValueChange={(val) => onChange("status", val === "all" ? undefined : val)}
                    >
                      <SelectTrigger className="h-7 text-xs w-full">
                        <SelectValue placeholder="حالة الفاتورة" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">كل الحالات</SelectItem>
                        {INVOICE_STATUSES.map((st) => (
                          <SelectItem key={st.value} value={st.value}>
                            {st.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex gap-2 pt-2.5 border-t border-border">
                  <Button
                    onClick={() => {
                      if (onPreview) onPreview();
                      setMobileFiltersOpen(false);
                    }}
                    className="flex-1 h-7 text-xs font-semibold"
                  >
                    معاينة النتائج
                  </Button>
                  <Button
                    onClick={() => {
                      onReset();
                      setMobileFiltersOpen(false);
                    }}
                    variant="outline"
                    className="h-7 text-xs"
                  >
                    إعادة ضبط
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* ── لوحة الفلاتر الثلاثية المنظمة بتنسيق النظام ومرونة الشاشات ── */}
      <div className="hidden md:grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 rounded-xl border border-border bg-card p-2.5 shadow-xs">
        {/* ── البطاقة 1: الفلترة الزمنية والبحث ── */}
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-2 shadow-xs">
          <div className="flex items-center justify-between border-b border-border pb-1.5">
            <span className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
              <Calendar className="h-3 w-3 text-primary" />
              الفترة والبحث
            </span>
            <span className="text-[9px] text-muted-foreground">التاريخ والنص</span>
          </div>

          <div className="space-y-1.5">
            {/* الفترة الزمنية */}
            <div>
              <label className="text-[10px] font-medium text-foreground block mb-0.5">
                الفترة الزمنية
              </label>
              <Select onValueChange={handlePresetChange} value={selectedPreset}>
                <SelectTrigger className="h-[26px] w-full text-[10px] px-2 py-0.5">
                  <SelectValue placeholder="اختر الفترة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today" className="text-[11px] py-1">
                    اليوم
                  </SelectItem>
                  <SelectItem value="yesterday" className="text-[11px] py-1">
                    أمس
                  </SelectItem>
                  <SelectItem value="this_week" className="text-[11px] py-1">
                    آخر 7 أيام
                  </SelectItem>
                  <SelectItem value="this_month" className="text-[11px] py-1">
                    الشهر الحالي
                  </SelectItem>
                  <SelectItem value="last_month" className="text-[11px] py-1">
                    الشهر السابق
                  </SelectItem>
                  <SelectItem value="all" className="text-[11px] py-1">
                    كل الفترات
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* حقول التاريخ مرنة ومفصولة بنظام شبكي يمنع التراكب نهائياً */}
            <div className="grid grid-cols-2 gap-1.5">
              <div className="space-y-0.5 min-w-0">
                <span className="text-[9px] text-muted-foreground block mb-0.5">من تاريخ</span>
                <Input
                  type="date"
                  value={values.startDate || ""}
                  onChange={(e) => onChange("startDate", e.target.value)}
                  className="h-[26px] w-full text-[10px] px-2 py-0.5 min-w-0"
                />
              </div>
              <div className="space-y-0.5 min-w-0">
                <span className="text-[9px] text-muted-foreground block mb-0.5">إلى تاريخ</span>
                <Input
                  type="date"
                  value={values.endDate || ""}
                  onChange={(e) => onChange("endDate", e.target.value)}
                  className="h-[26px] w-full text-[10px] px-2 py-0.5 min-w-0"
                />
              </div>
            </div>

            {/* البحث السريع */}
            <div className="space-y-0.5 pt-0.5">
              <span className="text-[9px] text-muted-foreground block mb-0.5">البحث السريع</span>
              <div className="relative">
                <Search className="absolute right-2 top-1.5 h-3 w-3 text-muted-foreground pointer-events-none" />
                <Input
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                  placeholder="رقم الفاتورة، المرجع، الاسم..."
                  className="h-[26px] pr-7 pl-2 text-[10px] w-full"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── البطاقة 2 و 3 الموحدة: أطراف التعامل، المخزون، والخيارات (تجميع + فلترة موحدة في نفس المكون) ── */}
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-2 shadow-xs md:col-span-2">
          <div className="flex items-center justify-between border-b border-border pb-1.5">
            <span className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
              <Users className="h-3 w-3 text-primary" />
              أبعاد التجميع والفلترة الموحدة
            </span>
            <span className="text-[9px] text-muted-foreground">
              اضغط <strong className="text-primary">(+) باليسار</strong> لإضافة البعد للأعمدة
              والتجميع | اضغط <strong className="text-primary">باليمين</strong> لتحديد خيارات
              الفلترة
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 flex-1 content-start">
            {/* 1. بعد وفلتر العميل */}
            {domainDimensions.some((d) => d.key === "customer") && (
              <UnifiedDimensionFilterControl
                label="العميل"
                icon={Users}
                dimensionKey="customer"
                isGrouped={selectedDimensions.includes("customer")}
                onToggleGroup={() => onToggleDimension?.("customer")}
                options={optionsBySource["customers"] || []}
                selectedIds={values.customerIds || (values.customerId ? [values.customerId] : [])}
                onChangeSelectedIds={(ids) => {
                  onChange("customerIds", ids.length > 0 ? ids : undefined);
                  onChange("customerId", undefined);
                }}
                disabled={loading}
              />
            )}

            {/* 2. بعد وفلتر المورد */}
            {domainDimensions.some((d) => d.key === "supplier") && (
              <UnifiedDimensionFilterControl
                label="المورد"
                icon={Users}
                dimensionKey="supplier"
                isGrouped={selectedDimensions.includes("supplier")}
                onToggleGroup={() => onToggleDimension?.("supplier")}
                options={optionsBySource["suppliers"] || []}
                selectedIds={values.supplierIds || (values.supplierId ? [values.supplierId] : [])}
                onChangeSelectedIds={(ids) => {
                  onChange("supplierIds", ids.length > 0 ? ids : undefined);
                  onChange("supplierId", undefined);
                }}
                disabled={loading}
              />
            )}

            {/* 3. بعد وفلتر الصنف / المنتج */}
            {domainDimensions.some((d) => d.key === "product") && (
              <UnifiedDimensionFilterControl
                label="المنتج / الصنف"
                icon={Layers}
                dimensionKey="product"
                isGrouped={selectedDimensions.includes("product")}
                onToggleGroup={() => onToggleDimension?.("product")}
                options={optionsBySource["products"] || []}
                selectedIds={values.productIds || (values.productId ? [values.productId] : [])}
                onChangeSelectedIds={(ids) => {
                  onChange("productIds", ids.length > 0 ? ids : undefined);
                  onChange("productId", undefined);
                }}
                disabled={loading}
              />
            )}

            {/* 4. بعد وفلتر الفرع */}
            {domainDimensions.some((d) => d.key === "branch") && (
              <UnifiedDimensionFilterControl
                label="الفرع"
                icon={Layers}
                dimensionKey="branch"
                isGrouped={selectedDimensions.includes("branch")}
                onToggleGroup={() => onToggleDimension?.("branch")}
                options={optionsBySource["branches"] || []}
                selectedIds={values.branchIds || (values.branchId ? [values.branchId] : [])}
                onChangeSelectedIds={(ids) => {
                  onChange("branchIds", ids.length > 0 ? ids : undefined);
                  onChange("branchId", undefined);
                }}
                disabled={loading}
              />
            )}

            {/* 5. بعد وفلتر المستودع */}
            {domainDimensions.some((d) => d.key === "warehouse") && (
              <UnifiedDimensionFilterControl
                label="المستودع"
                icon={Layers}
                dimensionKey="warehouse"
                isGrouped={selectedDimensions.includes("warehouse")}
                onToggleGroup={() => onToggleDimension?.("warehouse")}
                options={optionsBySource["warehouses"] || []}
                selectedIds={
                  values.warehouseIds || (values.warehouseId ? [values.warehouseId] : [])
                }
                onChangeSelectedIds={(ids) => {
                  onChange("warehouseIds", ids.length > 0 ? ids : undefined);
                  onChange("warehouseId", undefined);
                }}
                disabled={loading}
              />
            )}

            {/* 6. بعد وفلتر طريقة الدفع */}
            {domainDimensions.some((d) => d.key === "payment_method") && (
              <UnifiedDimensionFilterControl
                label="طريقة الدفع"
                icon={Layers}
                dimensionKey="payment_method"
                isGrouped={selectedDimensions.includes("payment_method")}
                onToggleGroup={() => onToggleDimension?.("payment_method")}
                options={PAYMENT_METHODS.map((pm) => ({ id: pm.value, label: pm.label }))}
                selectedIds={
                  values.paymentMethods || (values.paymentMethod ? [values.paymentMethod] : [])
                }
                onChangeSelectedIds={(ids) => {
                  onChange("paymentMethods", ids.length > 0 ? ids : undefined);
                  onChange("paymentMethod", undefined);
                }}
                disabled={loading}
              />
            )}
          </div>

          {/* سطر دلالي سفلي */}
          <div className="pt-1.5 border-t border-border/50 text-[9px] text-muted-foreground flex items-center justify-between">
            <span className="truncate">المصدر: {definition?.dataSourceName || "سجل العمليات"}</span>
            <span className="truncate font-mono">{definition?.rowGrainAr || "حركة مفصلة"}</span>
          </div>
        </div>
      </div>

      {/* ── شريط أزرار الإجراءات والطباعة والتصدير ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* زر معاينة */}
          <Button
            size="sm"
            variant="default"
            onClick={onPreview}
            disabled={loading}
            className="h-7 text-xs font-semibold gap-1.5 px-3"
          >
            <Eye className="h-3 w-3" />
            <span>معاينة</span>
          </Button>

          {/* زر إعادة الفلترة */}
          <Button
            size="sm"
            variant="outline"
            onClick={onReset}
            className="h-7 text-xs gap-1.5 px-2.5"
          >
            <RotateCcw className="h-3 w-3" />
            <span>إعادة الفلترة</span>
          </Button>

          {/* زر إلغاء */}
          <Button
            size="sm"
            variant="ghost"
            onClick={onReset}
            className="h-7 text-xs px-2.5 text-muted-foreground hover:text-foreground"
          >
            <span>إلغاء</span>
          </Button>
        </div>

        {/* أزرار الطباعة والتصدير */}
        <div className="flex items-center gap-1.5">
          {onPrint && (
            <Button
              size="sm"
              variant="outline"
              onClick={onPrint}
              disabled={loading}
              className="h-7 w-7 p-0"
              title="طباعة التقرير"
            >
              <Printer className="h-3.5 w-3.5" />
            </Button>
          )}

          {onExport && (
            <Button
              size="sm"
              variant="outline"
              onClick={onExport}
              disabled={loading}
              className="h-7 w-7 p-0"
              title="تصدير Excel / CSV"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
