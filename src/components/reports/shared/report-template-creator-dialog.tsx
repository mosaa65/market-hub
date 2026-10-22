import { useState, useMemo } from "react";
import { Plus, Sparkles, Check, SlidersHorizontal, CheckSquare, Square } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ReportDomain, ReportViewTemplateType } from "@/lib/reports/types";
import { ReportRegistry } from "@/lib/reports/registry";
import {
  saveCustomTemplate,
  type CustomReportTemplate,
} from "@/lib/reports/custom-templates-store";

interface ReportTemplateCreatorDialogProps {
  currentDomain: ReportDomain;
  activeReportId?: string;
  onTemplateCreated: (newTemplateId: string) => void;
  triggerButton?: React.ReactNode;
}

export function ReportTemplateCreatorDialog({
  currentDomain,
  activeReportId,
  onTemplateCreated,
  triggerButton,
}: ReportTemplateCreatorDialogProps) {
  const [open, setOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [groupBy, setGroupBy] = useState<CustomReportTemplate["groupBy"]>("product");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState("all");
  const [viewTemplate, setViewTemplate] = useState<ReportViewTemplateType>("grouped");

  // Get base report columns for domain
  const domainReports = useMemo(() => ReportRegistry.getByDomain(currentDomain), [currentDomain]);
  const baseReport = useMemo(() => {
    return domainReports.find((r) => r.id === activeReportId) || domainReports[0];
  }, [domainReports, activeReportId]);

  const availableColumns = useMemo(() => {
    return baseReport ? baseReport.columns : [];
  }, [baseReport]);

  const [selectedColumnKeys, setSelectedColumnKeys] = useState<string[]>(() => {
    return baseReport ? baseReport.columns.map((c) => c.key) : [];
  });

  function toggleColumn(key: string) {
    setSelectedColumnKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  function handleSave() {
    const trimmedName = templateName.trim();
    if (!trimmedName) return;

    const secondaryFilter =
      paymentMethodFilter !== "all"
        ? {
            key: "paymentMethod",
            value: paymentMethodFilter,
            label:
              paymentMethodFilter === "cash"
                ? "نقدي فقط"
                : paymentMethodFilter === "card"
                  ? "بطاقة فقط"
                  : paymentMethodFilter === "credit"
                    ? "آجل فقط"
                    : "تحويل بنكي",
          }
        : undefined;

    const saved = saveCustomTemplate({
      name: trimmedName,
      domain: currentDomain,
      baseReportId: baseReport?.id || "rep-sales-product",
      groupBy,
      secondaryFilter,
      viewTemplate,
      visibleColumns: selectedColumnKeys,
      description: `قالب مخصص تم إنشاؤه بواسطة المستخدم (${groupBy})`,
    });

    setOpen(false);
    setTemplateName("");
    onTemplateCreated(saved.id);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {triggerButton || (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 border-border bg-card px-2.5 text-xs font-semibold text-foreground hover:bg-muted shadow-xs"
          >
            <Plus className="h-3.5 w-3.5 text-primary" />
            <span>قالب جديد</span>
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="max-w-lg p-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-foreground">
            <Sparkles className="h-4 w-4 text-amber-500" />
            إنشاء وتصميم قالب تقرير جديد
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            صمم قالباً مخصصاً لتقارير {currentDomain === "sales" ? "المبيعات" : "النظام"} ليظهر في
            قائمة القوالب الجاهزة للاستخدام المستمر.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5 py-2 text-xs">
          {/* اسم القالب */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground">
              اسم القالب <span className="text-destructive">*</span>
            </label>
            <Input
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="مثال: مبيعات حسب المنتج وطريقة الدفع، أو كشف الفروع"
              className="h-8 text-xs"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* التجميع الأساسي */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">نمط التجميع الأساسي</label>
              <Select value={groupBy} onValueChange={(val: any) => setGroupBy(val)}>
                <SelectTrigger className="h-8 text-xs w-full">
                  <SelectValue placeholder="اختر التجميع" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="product">حسب الصنف / المنتج</SelectItem>
                  <SelectItem value="customer">حسب العميل</SelectItem>
                  <SelectItem value="branch">حسب الفرع</SelectItem>
                  <SelectItem value="warehouse">حسب المستودع</SelectItem>
                  <SelectItem value="payment_method">حسب طريقة الدفع</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* شرط ثانوي مسبق (طريقة الدفع) */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">
                تصفية طريقة السداد المسبقة
              </label>
              <Select value={paymentMethodFilter} onValueChange={setPaymentMethodFilter}>
                <SelectTrigger className="h-8 text-xs w-full">
                  <SelectValue placeholder="كل طرق السداد" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل طرق السداد (عام)</SelectItem>
                  <SelectItem value="cash">نقدي فقط</SelectItem>
                  <SelectItem value="card">شبكة / بطاقة فقط</SelectItem>
                  <SelectItem value="credit">آجل فقط</SelectItem>
                  <SelectItem value="bank_transfer">تحويل بنكي فقط</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* نوع العرض الرئيسي */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground">طريقة عرض القالب</label>
            <Select value={viewTemplate} onValueChange={(val: any) => setViewTemplate(val)}>
              <SelectTrigger className="h-8 text-xs w-full">
                <SelectValue placeholder="طريقة العرض" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="grouped">
                  قالب التجميع والتحليل — تجميع متعدد الطرق (موصى به)
                </SelectItem>
                <SelectItem value="detailed_table">
                  قالب الجدول التفصيلي (Detailed Table)
                </SelectItem>
                <SelectItem value="chart">قالب الرسم البياني والمؤشرات (Chart View)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* تحديد الأعمدة المراد ظهورها */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
                الأعمدة الافتراضية للقالب ({selectedColumnKeys.length}/{availableColumns.length})
              </label>
              <button
                type="button"
                onClick={() =>
                  setSelectedColumnKeys(
                    selectedColumnKeys.length === availableColumns.length
                      ? [availableColumns[0]?.key || ""]
                      : availableColumns.map((c) => c.key),
                  )
                }
                className="text-[11px] text-primary hover:underline"
              >
                {selectedColumnKeys.length === availableColumns.length
                  ? "إلغاء التحديد"
                  : "تحديد الكل"}
              </button>
            </div>

            <div className="max-h-36 overflow-y-auto rounded-lg border border-border bg-muted/20 p-2 space-y-1 [scrollbar-width:thin]">
              <div className="grid grid-cols-2 gap-1.5">
                {availableColumns.map((col) => {
                  const isChecked = selectedColumnKeys.includes(col.key);
                  return (
                    <button
                      key={col.key}
                      type="button"
                      onClick={() => toggleColumn(col.key)}
                      className="flex items-center gap-2 p-1.5 text-right rounded hover:bg-muted text-xs transition-colors"
                    >
                      {isChecked ? (
                        <CheckSquare className="h-3.5 w-3.5 text-primary shrink-0" />
                      ) : (
                        <Square className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                      <span className="truncate text-[11px] text-foreground">{col.labelAr}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2 border-t border-border">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            className="h-8 text-xs"
          >
            إلغاء
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={!templateName.trim()}
            className="h-8 text-xs font-semibold gap-1.5 px-4"
          >
            <Check className="h-3.5 w-3.5" />
            حفظ وتطبيق القالب
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
