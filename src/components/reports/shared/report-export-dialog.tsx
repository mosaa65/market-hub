import React, { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, FileText, Printer, Receipt } from "lucide-react";
import type { ReportExportPayload } from "@/lib/reports/export/types";
import {
  downloadReportCSVChunked,
  downloadReportExcel,
  printReportDocument,
  printThermalSlipDocument,
} from "@/lib/reports/export";

interface ReportExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload: ReportExportPayload;
  defaultMode?: "print" | "export";
}

export function ReportExportDialog({
  open,
  onOpenChange,
  payload,
  defaultMode = "print",
}: ReportExportDialogProps) {
  const [csvProgress, setCsvProgress] = useState<number | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const csvAbortController = useRef<AbortController | null>(null);
  const { definition } = payload;
  const caps = definition.exportCapabilities;

  const handlePrintA4 = () => {
    printReportDocument(payload, caps.pdfTemplate);
    onOpenChange(false);
  };

  const handlePrintSlip = () => {
    printThermalSlipDocument(payload);
    onOpenChange(false);
  };

  const handleExportExcel = () => {
    downloadReportExcel(payload);
    onOpenChange(false);
  };

  const handleExportCSV = async () => {
    const controller = new AbortController();
    csvAbortController.current = controller;
    setCsvError(null);
    setCsvProgress(0);
    try {
      await downloadReportCSVChunked(payload, undefined, {
        signal: controller.signal,
        onProgress: (progress) => setCsvProgress(progress),
      });
      onOpenChange(false);
    } catch (error) {
      if (!(error instanceof Error && error.name === "ExportAbortedError")) {
        setCsvError(error instanceof Error ? error.message : "تعذر إنشاء ملف CSV");
      }
    } finally {
      csvAbortController.current = null;
      setCsvProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-foreground">
            {defaultMode === "print" ? "خيارات الطباعة الرسمية" : "خيارات تصدير التقرير"}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            اختر صيغة الإخراج المناسبة لتقرير &quot;{definition.titleAr}&quot;.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-2.5 py-3 sm:grid-cols-2">
          {/* خيار 1: طباعة A4 */}
          <Button
            variant="outline"
            onClick={handlePrintA4}
            className="flex h-auto flex-col items-start gap-1 p-3 text-right hover:border-primary/50 hover:bg-primary/5"
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <Printer className="h-4 w-4 text-primary" />
              <span>طباعة ورقية رسمية (A4)</span>
            </div>
            <span className="text-[10px] text-muted-foreground">
              تنسيق كشف رسمي مع ترويسة المنشأة ومساحات التوقيع
            </span>
          </Button>

          {/* خيار 2: طباعة حرارية 80mm */}
          {caps.directPrintSlip && (
            <Button
              variant="outline"
              onClick={handlePrintSlip}
              className="flex h-auto flex-col items-start gap-1 p-3 text-right hover:border-primary/50 hover:bg-primary/5"
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <Receipt className="h-4 w-4 text-emerald-600" />
                <span>إيصال حراري (80mm)</span>
              </div>
              <span className="text-[10px] text-muted-foreground">
                ملخص سريع لطابعات الفواتير ونقاط البيع
              </span>
            </Button>
          )}

          {/* خيار 3: إكسل متعدد الصفحات */}
          <Button
            variant="outline"
            onClick={handleExportExcel}
            className="flex h-auto flex-col items-start gap-1 p-3 text-right hover:border-emerald-500/50 hover:bg-emerald-500/5"
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              <span>مصنف Excel منسق</span>
            </div>
            <span className="text-[10px] text-muted-foreground">
              ورقة ملخص المؤشرات + ورقة البيانات بصيغة XML
            </span>
          </Button>

          {/* خيار 4: CSV آمن */}
          <Button
            variant="outline"
            onClick={handleExportCSV}
            disabled={csvProgress !== null}
            className="flex h-auto flex-col items-start gap-1 p-3 text-right hover:border-blue-500/50 hover:bg-blue-500/5"
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <FileText className="h-4 w-4 text-blue-600" />
              <span>
                {csvProgress === null ? "ملف CSV آمن (UTF-8 BOM)" : "جارٍ تجهيز ملف CSV..."}
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground">
              تصدير السجلات المحمّلة حاليًا على دفعات، مع حماية صيغ Excel
            </span>
          </Button>
        </div>
        {csvProgress !== null && (
          <div className="flex items-center gap-2 border-t border-border pt-3">
            <progress className="h-2 flex-1 accent-primary" max={1} value={csvProgress} />
            <span className="min-w-10 text-left text-xs tabular-nums">
              {Math.round(csvProgress * 100)}%
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => csvAbortController.current?.abort()}
              className="h-7 text-xs"
            >
              إلغاء
            </Button>
          </div>
        )}
        {csvError && (
          <p role="alert" className="text-xs text-destructive">
            {csvError}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
