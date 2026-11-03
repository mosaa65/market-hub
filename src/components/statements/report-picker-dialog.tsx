import { Check, CircleHelp, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { REPORT_DEFINITIONS, type ReportType } from "@/lib/statements/report-registry";

interface ReportPickerDialogProps {
  open: boolean;
  selected: ReportType;
  onOpenChange: (open: boolean) => void;
  onSelect: (type: ReportType) => void;
  ar: boolean;
}

export function ReportPickerDialog({
  open,
  selected,
  onOpenChange,
  onSelect,
  ar,
}: ReportPickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90vh,720px)] max-w-3xl overflow-y-auto">
        <DialogHeader className="text-start">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="h-5 w-5 text-primary" />
            {ar ? "فتح كشف آخر" : "Open another report"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {ar
              ? "اختر نوع الكشف لعرض البيانات من مصدرها التشغيلي المناسب. الكشوف قيد التجهيز ستظهر داخل نفس المركز لاحقًا."
              : "Choose a report type and its operational data source. Reports marked as planned will be added to this center next."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-2">
          {REPORT_DEFINITIONS.map((report) => {
            const Icon = report.icon;
            const isSelected = selected === report.type;
            return (
              <Button
                key={`${report.type}-${report.title.ar}`}
                type="button"
                variant="outline"
                onClick={() => {
                  onSelect(report.type);
                  onOpenChange(false);
                }}
                className={`h-auto min-h-20 justify-start gap-3 whitespace-normal p-3 text-start ${
                  isSelected ? "border-primary bg-primary/10" : ""
                }`}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-xs font-semibold">
                    {ar ? report.title.ar : report.title.en}
                    {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                  </span>
                  <span className="mt-1 block text-[10px] font-normal leading-4 text-muted-foreground">
                    {ar ? report.description.ar : report.description.en}
                  </span>
                  {!report.implemented && (
                    <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-normal text-amber-600">
                      <CircleHelp className="h-3 w-3" />
                      {ar
                        ? "سيتم استكمال هذا الكشف في المرحلة التالية"
                        : "Planned for the next phase"}
                    </span>
                  )}
                </span>
              </Button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
