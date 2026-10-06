import React, { useState } from "react";
import { Printer, X, CheckCircle2, Scale, FileText, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface UnifiedTicketPrintData {
  ticketNumber: string;
  customerName: string;
  customerPhone?: string;
  grainType: string;
  millingTypeLabel: string;
  bagCount: number;
  bagSizeKg: number;
  totalWeightKg: number;
  bagsSourceLabel: string;
  millingFeeTotal: number;
  packagingTotal: number;
  discount?: number;
  grandTotal: number;
  paidAmount: number;
  remainingAmount: number;
  paymentMethodLabel?: string;
  createdAt: string;
  notes?: string;
  companyName?: string;
  companyPhone?: string;
  companyAddress?: string;
}

interface UnifiedPrintModalProps {
  open: boolean;
  onClose: () => void;
  data: UnifiedTicketPrintData | null;
}

export function UnifiedPrintModal({ open, onClose, data }: UnifiedPrintModalProps) {
  const [paperFormat, setPaperFormat] = useState<"thermal" | "a4">("thermal");

  if (!open || !data) return null;

  const handlePrint = () => {
    printUnifiedTicket(data, paperFormat);
  };

  const isPaid = data.remainingAmount <= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-3xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/80 px-6 py-4 bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-amber-500/15 text-amber-500">
              <Scale className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">
                فاتورة وإيصال الطحن الموحد
              </h3>
              <p className="text-xs text-muted-foreground font-mono">
                {data.ticketNumber}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-xl bg-muted p-1 border border-border">
              <button
                type="button"
                onClick={() => setPaperFormat("thermal")}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  paperFormat === "thermal"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                طابعة حرارية (80 مم)
              </button>
              <button
                type="button"
                onClick={() => setPaperFormat("a4")}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  paperFormat === "a4"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                صفحة رسمية (A4/A5)
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Preview */}
        <div className="flex-1 overflow-y-auto p-6 bg-muted/20 flex justify-center">
          {paperFormat === "thermal" ? (
            /* Thermal 80mm preview */
            <div className="w-[340px] bg-white text-slate-900 rounded-2xl p-5 shadow-lg border border-slate-200 font-sans text-xs space-y-4">
              <div className="text-center space-y-1 border-b border-dashed border-slate-300 pb-3">
                <div className="text-base font-black tracking-tight">
                  {data.companyName || "مطحنة الحبوب الحديثة"}
                </div>
                <div className="text-[11px] text-slate-600">
                  {data.companyAddress || "المركز الرئيسي"}
                </div>
                {data.companyPhone && (
                  <div className="text-[11px] font-mono text-slate-600">
                    هاتف: {data.companyPhone}
                  </div>
                )}
                <div className="mt-2 inline-block rounded-full bg-slate-900 text-white px-3 py-0.5 text-[10px] font-bold">
                  فاتورة وإيصال طحن فوري
                </div>
              </div>

              <div className="space-y-1.5 text-[11px] border-b border-dashed border-slate-300 pb-3">
                <div className="flex justify-between">
                  <span className="text-slate-500">رقم الفاتورة:</span>
                  <span className="font-bold font-mono">{data.ticketNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">التاريخ:</span>
                  <span>{new Date(data.createdAt).toLocaleDateString("ar-EG")} {new Date(data.createdAt).toLocaleTimeString("ar-EG", { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">العميل:</span>
                  <span className="font-bold">{data.customerName}</span>
                </div>
                {data.customerPhone && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">الهاتف:</span>
                    <span className="font-mono">{data.customerPhone}</span>
                  </div>
                )}
              </div>

              {/* Grain & Milling Details */}
              <div className="space-y-2 border-b border-dashed border-slate-300 pb-3">
                <div className="font-bold text-slate-800 text-[11px]">تفاصيل عملية الطحن:</div>
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 space-y-1 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-slate-600">نوع الحبوب:</span>
                    <span className="font-bold text-slate-900">{data.grainType}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">درجة الطحن:</span>
                    <span className="font-bold text-amber-700">{data.millingTypeLabel}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">الكمية والأكياس:</span>
                    <span className="font-bold">{data.bagCount} كيس × {data.bagSizeKg} كجم</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">الوزن الصافي:</span>
                    <span className="font-bold text-slate-900 font-mono">{data.totalWeightKg.toLocaleString()} كجم</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">مصدر الأكياس:</span>
                    <span className="font-semibold">{data.bagsSourceLabel}</span>
                  </div>
                </div>
              </div>

              {/* Financial Breakdown */}
              <div className="space-y-1.5 text-[11px] border-b border-dashed border-slate-300 pb-3">
                <div className="flex justify-between text-slate-600">
                  <span>أجرة خدمة الطحن:</span>
                  <span className="font-mono font-bold text-slate-800">{data.millingFeeTotal.toLocaleString()} ر.ي</span>
                </div>
                {data.packagingTotal > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>مستلزمات تعبئة وأكياس:</span>
                    <span className="font-mono font-bold text-slate-800">{data.packagingTotal.toLocaleString()} ر.ي</span>
                  </div>
                )}
                {(data.discount || 0) > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <span>الخصم الممنوح:</span>
                    <span className="font-mono">-{data.discount?.toLocaleString()} ر.ي</span>
                  </div>
                )}
                <div className="flex justify-between pt-1 border-t border-slate-200 text-sm font-black text-slate-950">
                  <span>الإجمالي المستحق:</span>
                  <span className="font-mono text-base">{data.grandTotal.toLocaleString()} ر.ي</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>المدفوع ({data.paymentMethodLabel || "نقداً"}):</span>
                  <span className="font-mono font-bold text-emerald-700">{data.paidAmount.toLocaleString()} ر.ي</span>
                </div>
                {data.remainingAmount > 0 && (
                  <div className="flex justify-between text-rose-600 font-bold">
                    <span>المتبقي ذمة:</span>
                    <span className="font-mono">{data.remainingAmount.toLocaleString()} ر.ي</span>
                  </div>
                )}
              </div>

              <div className="text-center pt-1 text-[10px] text-slate-500 space-y-1">
                <p>تم استلام الحبوب وطحنها وتسليم النواتج بحالة ممتازة.</p>
                <p className="font-bold text-slate-700">شكرًا لتعاملكم معنا — نسعد بخدمتكم دائماً</p>
              </div>
            </div>
          ) : (
            /* A4 / A5 Official Sheet Preview */
            <div className="w-full bg-white text-slate-900 rounded-2xl p-8 shadow-lg border border-slate-200 font-sans space-y-6">
              <div className="flex justify-between items-start border-b border-slate-200 pb-5">
                <div>
                  <h2 className="text-xl font-black text-slate-900">
                    {data.companyName || "مطحنة الحبوب المتقدمة"}
                  </h2>
                  <p className="text-xs text-slate-600 mt-1">
                    {data.companyAddress || "صنعاء — المركز الرئيسي"}
                  </p>
                  {data.companyPhone && (
                    <p className="text-xs text-slate-600 font-mono">
                      هاتف: {data.companyPhone}
                    </p>
                  )}
                </div>
                <div className="text-left space-y-1">
                  <div className="inline-block rounded-xl bg-amber-500/15 text-amber-700 border border-amber-200 px-3 py-1 text-xs font-bold">
                    فاتورة وسند طحن فوري
                  </div>
                  <p className="text-xs font-mono font-bold text-slate-800">
                    {data.ticketNumber}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {new Date(data.createdAt).toLocaleDateString("ar-EG")}
                  </p>
                </div>
              </div>

              {/* Customer Box */}
              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100 text-xs">
                <div>
                  <span className="text-slate-500">اسم العميل:</span>
                  <span className="font-bold text-slate-900 ms-2">{data.customerName}</span>
                </div>
                <div>
                  <span className="text-slate-500">رقم الهاتف:</span>
                  <span className="font-mono text-slate-900 ms-2">{data.customerPhone || "—"}</span>
                </div>
              </div>

              {/* Operations Table */}
              <table className="w-full text-xs text-right border border-slate-200 rounded-xl overflow-hidden">
                <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3">نوع الحبوب</th>
                    <th className="p-3">درجة ونوع الطحن</th>
                    <th className="p-3 text-center">الأكياس</th>
                    <th className="p-3 text-center">الوزن الصافي</th>
                    <th className="p-3">الأكياس المستخدمة</th>
                    <th className="p-3 text-left">المبلغ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="p-3 font-bold text-slate-900">{data.grainType}</td>
                    <td className="p-3 text-amber-700 font-semibold">{data.millingTypeLabel}</td>
                    <td className="p-3 text-center font-mono">{data.bagCount} كيس ({data.bagSizeKg} كجم)</td>
                    <td className="p-3 text-center font-mono font-bold">{data.totalWeightKg.toLocaleString()} كجم</td>
                    <td className="p-3">{data.bagsSourceLabel}</td>
                    <td className="p-3 text-left font-mono font-bold">{data.millingFeeTotal.toLocaleString()} ر.ي</td>
                  </tr>
                  {data.packagingTotal > 0 && (
                    <tr>
                      <td colSpan={5} className="p-3 text-slate-600">
                        مستلزمات تعبئة وأكياس المطحنة
                      </td>
                      <td className="p-3 text-left font-mono font-bold">
                        {data.packagingTotal.toLocaleString()} ر.ي
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Totals Summary */}
              <div className="flex justify-end">
                <div className="w-64 space-y-2 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>المجموع الإجمالي:</span>
                    <span className="font-mono font-bold text-slate-800">
                      {(data.millingFeeTotal + data.packagingTotal).toLocaleString()} ر.ي
                    </span>
                  </div>
                  {(data.discount || 0) > 0 && (
                    <div className="flex justify-between text-emerald-600">
                      <span>الخصم:</span>
                      <span className="font-mono">-{data.discount?.toLocaleString()} ر.ي</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-black text-slate-950 border-t border-slate-200 pt-2">
                    <span>الصافي المطلوب:</span>
                    <span className="font-mono text-base">{data.grandTotal.toLocaleString()} ر.ي</span>
                  </div>
                  <div className="flex justify-between text-emerald-700 font-semibold">
                    <span>المدفوع:</span>
                    <span className="font-mono">{data.paidAmount.toLocaleString()} ر.ي</span>
                  </div>
                  {data.remainingAmount > 0 && (
                    <div className="flex justify-between text-rose-600 font-bold">
                      <span>المتبقي:</span>
                      <span className="font-mono">{data.remainingAmount.toLocaleString()} ر.ي</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Signatures */}
              <div className="grid grid-cols-2 gap-8 pt-8 border-t border-slate-200 text-xs text-center text-slate-500">
                <div className="space-y-8">
                  <p>توقيع مستلم الحبوب المطحونة</p>
                  <p className="border-b border-dashed border-slate-300 w-48 mx-auto"></p>
                </div>
                <div className="space-y-8">
                  <p>مشرف صالة المطحنة / الكاشير</p>
                  <p className="border-b border-dashed border-slate-300 w-48 mx-auto"></p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-border/80 px-6 py-4 bg-muted/40">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span>تم تسجيل العملية وإصدار الفاتورة وتحديث الإيرادات بنجاح</span>
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="rounded-full px-5"
            >
              إغلاق
            </Button>
            <Button
              type="button"
              onClick={handlePrint}
              className="rounded-full px-6 gap-2 bg-primary text-primary-foreground font-bold shadow-md hover:bg-primary/90"
            >
              <Printer className="h-4 w-4" />
              طباعة فورية ({paperFormat === "thermal" ? "80 مم" : "A4"})
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

import { printDocument, renderDocumentHTML, getPrintSettings, type UnifiedDocumentData } from "@/lib/templates";

export function ticketToUnifiedDoc(d: UnifiedTicketPrintData): UnifiedDocumentData {
  return {
    docType: "customer_invoice",
    title: "فاتورة وإيصال طحن",
    number: d.ticketNumber,
    date: new Date(d.createdAt).toLocaleDateString("ar-EG"),
    partyName: d.customerName,
    partyPhone: d.customerPhone,
    subtotal: d.millingFeeTotal + d.packagingTotal,
    discount: d.discount || 0,
    total: d.grandTotal,
    paid: d.paidAmount,
    amountTendered: d.paidAmount,
    change: Math.max(0, d.paidAmount - d.grandTotal),
    balance: d.remainingAmount,
    payment: d.paymentMethodLabel || "نقداً",
    notes: `تفاصيل الطحن: ${d.grainType} (${d.millingTypeLabel}) - عدد الأكياس: ${d.bagCount} كيس (${d.bagSizeKg}كجم) - الوزن الصافي: ${d.totalWeightKg}كجم - الأكياس: ${d.bagsSourceLabel}` + (d.notes ? ` — ${d.notes}` : ""),
    lines: [
      {
        product: `أجرة طحن: ${d.grainType} (${d.millingTypeLabel})`,
        qty: d.totalWeightKg,
        unit: "كجم",
        price: d.millingFeeTotal / (d.totalWeightKg || 1),
        total: d.millingFeeTotal,
      },
      ...(d.packagingTotal > 0
        ? [
            {
              product: `مستلزمات تعبئة وأكياس المطحنة (${d.bagsSourceLabel})`,
              qty: d.bagCount,
              unit: "كيس",
              price: d.packagingTotal / (d.bagCount || 1),
              total: d.packagingTotal,
            },
          ]
        : []),
    ],
    company: d.companyName
      ? {
          name: d.companyName,
          address: d.companyAddress,
          phone: d.companyPhone,
        }
      : undefined,
  };
}

/**
 * Native, non-blocking hidden iframe printer for the unified milling ticket.
 */
export function printUnifiedTicket(data: UnifiedTicketPrintData, paper: "thermal" | "a4"): void {
  const settings = getPrintSettings();
  const templateId = paper === "thermal" ? settings.defaultCustomerTemplate || "thermal" : "standard";

  // Use central unified printing system for seamless template enforcement
  const unifiedDoc = ticketToUnifiedDoc(data);
  printDocument(unifiedDoc, templateId);
}

function renderThermalHtml(d: UnifiedTicketPrintData): string {
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8" />
  <title>فاتورة طحن ${d.ticketNumber}</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; width: 72mm; margin: 0 auto; padding: 10px 4px; font-size: 12px; color: #000; }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .dashed { border-bottom: 1px dashed rgba(0,0,0,0.2); margin: 8px 0; }
    .hairline-row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid rgba(0, 0, 0, 0.08); }
    .hairline-row:last-child { border-bottom: none; }
    .badge { display: inline-block; border: 1px solid #000; padding: 2px 8px; border-radius: 99px; font-weight: bold; font-size: 11px; margin: 4px 0; }
    .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 8px; margin: 6px 0; }
    .inama-footer { text-align: center; margin-top: 12px; padding-top: 6px; border-top: 1px solid rgba(0, 0, 0, 0.1); font-size: 10px; font-weight: 700; color: #334155; }
  </style>
</head>
<body>
  <div class="center">
    <div style="font-size: 16px; font-weight: 900;">${d.companyName || "المطحنة الحديثة"}</div>
    <div>${d.companyAddress || "المركز الرئيسي"}</div>
    ${d.companyPhone ? `<div>هاتف: ${d.companyPhone}</div>` : ""}
    <div class="badge">فاتورة وإيصال طحن فوري</div>
  </div>
  <div class="dashed"></div>
  <div class="hairline-row"><span>رقم الفاتورة:</span><span class="bold">${d.ticketNumber}</span></div>
  <div class="hairline-row"><span>التاريخ:</span><span>${new Date(d.createdAt).toLocaleDateString("ar-EG")} ${new Date(d.createdAt).toLocaleTimeString("ar-EG", { hour: '2-digit', minute: '2-digit' })}</span></div>
  <div class="hairline-row"><span>العميل:</span><span class="bold">${d.customerName}</span></div>
  ${d.customerPhone ? `<div class="hairline-row"><span>الهاتف:</span><span>${d.customerPhone}</span></div>` : ""}
  <div class="dashed"></div>
  <div class="bold" style="margin-bottom: 4px;">تفاصيل الطحن:</div>
  <div class="box">
    <div class="hairline-row"><span>نوع الحبوب:</span><span class="bold">${d.grainType}</span></div>
    <div class="hairline-row"><span>درجة الطحن:</span><span class="bold">${d.millingTypeLabel}</span></div>
    <div class="hairline-row"><span>عدد الأكياس:</span><span class="bold">${d.bagCount} كيس (${d.bagSizeKg} كجم)</span></div>
    <div class="hairline-row"><span>الوزن الصافي:</span><span class="bold">${d.totalWeightKg} كجم</span></div>
    <div class="hairline-row"><span>أكياس التعبئة:</span><span>${d.bagsSourceLabel}</span></div>
  </div>
  <div class="dashed"></div>
  <div class="hairline-row"><span>أجرة الطحن:</span><span class="bold">${d.millingFeeTotal.toLocaleString()} ر.ي</span></div>
  ${d.packagingTotal > 0 ? `<div class="hairline-row"><span>قيمة الأكياس:</span><span class="bold">${d.packagingTotal.toLocaleString()} ر.ي</span></div>` : ""}
  ${(d.discount || 0) > 0 ? `<div class="hairline-row"><span>الخصم:</span><span>-${d.discount?.toLocaleString()} ر.ي</span></div>` : ""}
  <div class="dashed"></div>
  <div class="hairline-row" style="font-size: 14px; font-weight: 900;"><span>الإجمالي المطلوب:</span><span>${d.grandTotal.toLocaleString()} ر.ي</span></div>
  <div class="hairline-row"><span>المدفوع:</span><span class="bold">${d.paidAmount.toLocaleString()} ر.ي</span></div>
  ${d.remainingAmount > 0 ? `<div class="hairline-row" style="color: red; font-weight: bold;"><span>المتبقي:</span><span>${d.remainingAmount.toLocaleString()} ر.ي</span></div>` : ""}
  <div class="dashed"></div>
  <div class="center" style="font-size: 10px; margin-top: 8px;">
    <div>تم استلام وطحن وتسليم الحبوب بنجاح.</div>
    <div style="font-weight: bold; margin-top: 4px;">شكرًا لتعاملكم معنا</div>
  </div>
  <div class="inama-footer">
    عمل بواسطة شركة إنما سوفت - 772217218
  </div>
</body>
</html>`;
}

function renderA4Html(d: UnifiedTicketPrintData): string {
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8" />
  <title>فاتورة وسند طحن ${d.ticketNumber}</title>
  <style>
    @page { size: A4 portrait; margin: 15mm; }
    body { font-family: system-ui, -apple-system, sans-serif; font-size: 13px; color: #1e293b; padding: 10px; background: #fff; }
    .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 15px; }
    .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; margin: 15px 0; }
    .hairline-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(0, 0, 0, 0.08); }
    .hairline-row:last-child { border-bottom: none; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th { background: #f1f5f9; text-align: right; padding: 10px 8px; border-bottom: 1px solid #cbd5e1; font-weight: bold; }
    td { padding: 10px 8px; border-bottom: 1px solid rgba(0, 0, 0, 0.08); }
    .inama-footer {
      margin-top: 30px;
      padding-top: 10px;
      border-top: 1px solid rgba(0, 0, 0, 0.1);
      text-align: center;
      font-size: 11px;
      font-weight: 700;
      color: #475569;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1 style="margin: 0; font-size: 22px;">${d.companyName || "المطحنة المتقدمة"}</h1>
      <p style="margin: 4px 0 0 0; color: #64748b;">${d.companyAddress || "صنعاء — المركز الرئيسي"}</p>
      ${d.companyPhone ? `<p style="margin: 2px 0 0 0; color: #64748b;">هاتف: ${d.companyPhone}</p>` : ""}
    </div>
    <div style="text-align: left;">
      <h3 style="margin: 0; color: #b45309;">فاتورة وسند طحن وتسليم</h3>
      <p style="margin: 4px 0; font-weight: bold; font-family: monospace;">${d.ticketNumber}</p>
      <p style="margin: 0; color: #64748b;">${new Date(d.createdAt).toLocaleDateString("ar-EG")}</p>
    </div>
  </div>

  <div class="box">
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
      <div class="hairline-row"><strong>العميل:</strong> <span>${d.customerName}</span></div>
      <div class="hairline-row"><strong>الهاتف:</strong> <span>${d.customerPhone || "—"}</span></div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>نوع الحبوب</th>
        <th>درجة الطحن</th>
        <th style="text-align: center;">الأكياس</th>
        <th style="text-align: center;">الوزن الصافي</th>
        <th>مصدر الأكياس</th>
        <th style="text-align: left;">المبلغ</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>${d.grainType}</strong></td>
        <td>${d.millingTypeLabel}</td>
        <td style="text-align: center;">${d.bagCount} كيس (${d.bagSizeKg} كجم)</td>
        <td style="text-align: center;"><strong>${d.totalWeightKg} كجم</strong></td>
        <td>${d.bagsSourceLabel}</td>
        <td style="text-align: left;">${d.millingFeeTotal.toLocaleString()} ر.ي</td>
      </tr>
      ${d.packagingTotal > 0 ? `
      <tr>
        <td colspan="5">مستلزمات تعبئة وأكياس المطحنة</td>
        <td style="text-align: left;">${d.packagingTotal.toLocaleString()} ر.ي</td>
      </tr>` : ""}
    </tbody>
  </table>

  <div style="display: flex; justify-content: flex-end; margin-top: 15px;">
    <div style="width: 260px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px;">
      <div class="hairline-row"><span>المجموع:</span><span>${(d.millingFeeTotal + d.packagingTotal).toLocaleString()} ر.ي</span></div>
      ${(d.discount || 0) > 0 ? `<div class="hairline-row" style="color: green;"><span>الخصم:</span><span>-${d.discount?.toLocaleString()} ر.ي</span></div>` : ""}
      <div class="hairline-row" style="font-size: 15px; font-weight: bold; border-top: 2px solid #0f172a; padding-top: 6px; margin-top: 6px;">
        <span>الصافي:</span><span>${d.grandTotal.toLocaleString()} ر.ي</span>
      </div>
      <div class="hairline-row" style="color: #0284c7;"><span>المدفوع:</span><span>${d.paidAmount.toLocaleString()} ر.ي</span></div>
      ${d.remainingAmount > 0 ? `<div class="hairline-row" style="color: red; font-weight: bold;"><span>المتبقي:</span><span>${d.remainingAmount.toLocaleString()} ر.ي</span></div>` : ""}
    </div>
  </div>

  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 50px; text-align: center; color: #64748b;">
    <div>
      <p style="margin: 0; font-weight: 600;">توقيع المستلم</p>
      <div style="border-bottom: 1px dashed #cbd5e1; width: 180px; margin: 28px auto 0;"></div>
    </div>
    <div>
      <p style="margin: 0; font-weight: 600;">مشرف صالة المطحنة</p>
      <div style="border-bottom: 1px dashed #cbd5e1; width: 180px; margin: 28px auto 0;"></div>
    </div>
  </div>

  <div class="inama-footer">
    عمل بواسطة شركة إنما سوفت - 772217218
  </div>
</body>
</html>`;
}
