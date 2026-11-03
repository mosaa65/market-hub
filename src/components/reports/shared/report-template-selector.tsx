import { useMemo } from "react";
import {
  ChevronDown,
  LayoutTemplate,
  Check,
  Package,
  Users,
  Building2,
  Warehouse,
  BarChart3,
  ArrowLeftRight,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ReportDefinition, ReportDomain } from "@/lib/reports/types";
import { ReportRegistry } from "@/lib/reports/registry";
import {
  getCustomTemplates,
  deleteCustomTemplate,
  type CustomReportTemplate,
} from "@/lib/reports/custom-templates-store";

interface ReportTemplateSelectorProps {
  currentDomain: ReportDomain;
  activeReportId?: string;
  onSelectReport: (reportId: string) => void;
  className?: string;
  customTemplates?: CustomReportTemplate[];
  onCustomTemplatesChange?: () => void;
}

const TEMPLATE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "rep-sales-product": Package,
  "rep-sales-customer": Users,
  "rep-sales-branch": Building2,
  "rep-sales-warehouse": Warehouse,
  "rep-sales-daily-summary": BarChart3,
  "rep-sales-period-comparison": ArrowLeftRight,
  "rep-inventory-item-card": Package,
  "rep-inventory-low-stock": Warehouse,
  "rep-inventory-slow-moving": BarChart3,
  "rep-customers-sales-turnover": Users,
  "rep-suppliers-payables": Building2,
};

export function ReportTemplateSelector({
  currentDomain,
  activeReportId,
  onSelectReport,
  className,
  customTemplates: passedCustomTemplates,
  onCustomTemplatesChange,
}: ReportTemplateSelectorProps) {
  const domainReports = useMemo(() => ReportRegistry.getByDomain(currentDomain), [currentDomain]);

  const customTemplates = useMemo(
    () => passedCustomTemplates ?? getCustomTemplates(currentDomain),
    [passedCustomTemplates, currentDomain],
  );

  const activeTemplate = useMemo(() => {
    // Check in standard reports
    const std = domainReports.find((r) => r.id === activeReportId);
    if (std) return { id: std.id, titleAr: std.titleAr, isCustom: false };

    // Check in custom templates
    const cst = customTemplates.find((t) => t.id === activeReportId);
    if (cst) return { id: cst.id, titleAr: cst.name, isCustom: true };

    return domainReports[0]
      ? { id: domainReports[0].id, titleAr: domainReports[0].titleAr, isCustom: false }
      : { id: "", titleAr: "اختر القالب", isCustom: false };
  }, [domainReports, customTemplates, activeReportId]);

  function handleDeleteCustom(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    deleteCustomTemplate(id);
    if (activeReportId === id && domainReports[0]) {
      onSelectReport(domainReports[0].id);
    }
    onCustomTemplatesChange?.();
  }

  const ActiveIcon = TEMPLATE_ICONS[activeTemplate.id] || LayoutTemplate;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`h-8 gap-2 border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-muted shadow-xs ${className || ""}`}
        >
          <ActiveIcon className="h-4 w-4 text-primary" />
          <span className="text-muted-foreground font-normal">نوع القالب:</span>
          <span className="font-bold text-foreground">{activeTemplate.titleAr}</span>
          {activeTemplate.isCustom && (
            <Badge variant="secondary" className="h-4 px-1 text-[9px] bg-primary/10 text-primary">
              مخصص
            </Badge>
          )}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground opacity-70" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64 p-1.5 text-xs">
        <DropdownMenuLabel className="text-[11px] font-semibold text-muted-foreground px-2 py-1">
          قوالب تقارير {currentDomain === "sales" ? "المبيعات" : "المجال"} المعتمدة
        </DropdownMenuLabel>
        <DropdownMenuGroup>
          {domainReports.map((report: ReportDefinition) => {
            const isSelected = activeTemplate.id === report.id;
            const Icon = TEMPLATE_ICONS[report.id] || LayoutTemplate;

            return (
              <DropdownMenuItem
                key={report.id}
                onClick={() => onSelectReport(report.id)}
                className={`flex items-center justify-between px-2.5 py-1.5 text-xs cursor-pointer rounded-md ${
                  isSelected ? "bg-primary/10 font-bold text-primary" : "text-foreground"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon
                    className={`h-3.5 w-3.5 ${isSelected ? "text-primary" : "text-muted-foreground"}`}
                  />
                  <span>{report.titleAr}</span>
                </div>
                {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>

        {customTemplates.length > 0 && (
          <>
            <DropdownMenuSeparator className="my-1.5" />
            <DropdownMenuLabel className="text-[11px] font-semibold text-muted-foreground px-2 py-1 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-amber-500" />
                قوالب المستخدم المخصصة
              </span>
              <span className="text-[10px] font-normal">{customTemplates.length}</span>
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              {customTemplates.map((cst) => {
                const isSelected = activeTemplate.id === cst.id;
                return (
                  <DropdownMenuItem
                    key={cst.id}
                    onClick={() => onSelectReport(cst.id)}
                    className={`flex items-center justify-between px-2.5 py-1.5 text-xs cursor-pointer rounded-md group ${
                      isSelected ? "bg-primary/10 font-bold text-primary" : "text-foreground"
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Sparkles className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      <span className="truncate">{cst.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                      <button
                        type="button"
                        onClick={(e) => handleDeleteCustom(e, cst.id)}
                        className="opacity-0 group-hover:opacity-100 hover:text-destructive p-0.5 rounded transition-opacity"
                        title="حذف القالب المخصص"
                      >
                        <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
