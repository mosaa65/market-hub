/**
 * Vortex ERP — محرك الطباعة الحرارية السريعة (Thermal Slip Print 80mm)
 * المرحلة 6: REP-026
 *
 * مصمم خصيصاً لطابعات الإيصالات الحرارية (80mm) لطباعة ملخصات المبيعات
 * اليومية والورديات وإجمالي مبيعات الأصناف بسرعة وكفاءة عالية.
 */

import { getCachedCompanyProfile } from "@/lib/printing/company-profile";
import type { ReportExportPayload } from "./types";

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function generateThermalSlipHtml(payload: ReportExportPayload): string {
  const { definition, rows, metrics, appliedFilters, currencySymbol = "ر.س" } = payload;
  const company = getCachedCompanyProfile();

  const from = appliedFilters.startDate || "اليوم";
  const to = appliedFilters.endDate || from;

  // سطور الأصناف المختصرة
  const topRows = rows.slice(0, 30); // أول 30 صنف في الإيصال

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>إيصال حراري - ${esc(definition.titleAr)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@600;700;800&family=IBM+Plex+Mono:wght@500;700&display=swap');

    @page {
      size: 80mm auto;
      margin: 2mm 3mm;
    }

    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
    }

    body {
      font-family: 'Cairo', monospace, sans-serif;
      width: 74mm;
      margin: 0 auto;
      padding: 2mm 0;
      color: #000000;
      background: #ffffff;
      font-size: 10px;
      line-height: 1.3;
      direction: rtl;
    }

    .mono { font-family: 'IBM Plex Mono', monospace; }
    .center { text-align: center; }
    .bold { font-weight: 700; }
    .divider {
      border-top: 1px dashed #000000;
      margin: 4px 0;
    }
    .double-divider {
      border-top: 2px solid #000000;
      margin: 5px 0;
    }

    .title { font-size: 13px; font-weight: 800; }
    .subtitle { font-size: 11px; font-weight: 700; }
    .meta { font-size: 9px; }

    .flex-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2px;
    }

    .items-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9px;
      margin: 4px 0;
    }

    .items-table th {
      border-bottom: 1px solid #000;
      padding: 2px 0;
      text-align: right;
    }

    .items-table td {
      padding: 2px 0;
    }

    .text-left { text-align: left; }
    .text-right { text-align: right; }
    .text-center { text-align: center; }
  </style>
</head>
<body>
  <div class="center">
    <div class="title">${esc(company.name || "Vortex ERP")}</div>
    ${company.taxNumber ? `<div class="meta">الرقم الضريبي: ${esc(company.taxNumber)}</div>` : ""}
    <div class="divider"></div>
    <div class="subtitle">${esc(definition.titleAr)}</div>
    <div class="meta">الفترة: ${esc(from)} إلى ${esc(to)}</div>
    <div class="meta">تاريخ الطباعة: ${esc(new Date().toLocaleString("ar-SA"))}</div>
  </div>

  <div class="double-divider"></div>

  <!-- ملخص المؤشرات -->
  <div class="bold" style="margin-bottom: 3px;">المؤشرات الرئيسية:</div>
  ${definition.metrics
    .map((m) => {
      const val = metrics[m.key];
      if (val === undefined || val === null) return "";
      let formatted = String(val);
      if (m.format === "money") {
        formatted = `${Number(val).toLocaleString("en-US", { minimumFractionDigits: 2 })} ${currencySymbol}`;
      } else if (m.format === "quantity") {
        formatted = Number(val).toLocaleString("en-US");
      }
      return `
      <div class="flex-row">
        <span>${esc(m.labelAr)}:</span>
        <span class="mono bold">${formatted}</span>
      </div>`;
    })
    .join("")}

  <div class="divider"></div>

  <!-- تفاصيل الأصناف أو الحركات -->
  <table class="items-table">
    <thead>
      <tr>
        <th class="text-right">البيان</th>
        <th class="text-center">الكمية</th>
        <th class="text-left">الإجمالي</th>
      </tr>
    </thead>
    <tbody>
      ${topRows
        .map((r) => {
          const name = r.item_name_ar || r.reference || r.name || "—";
          const qty = r.quantity || r.inbound_quantity || 0;
          const total = r.net_sales || r.total || r.running_balance || 0;
          return `
          <tr>
            <td class="text-right">${esc(name)}</td>
            <td class="text-center mono">${qty}</td>
            <td class="text-left mono">${Number(total).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          </tr>`;
        })
        .join("")}
    </tbody>
  </table>

  <div class="double-divider"></div>

  <div class="center meta">
    <div>نظام Vortex ERP المحاسبي</div>
    <div>شكراً لتعاملكم معنا</div>
  </div>

  <script>
    window.onload = function() {
      window.print();
    };
  </script>
</body>
</html>`;
}

export function printThermalSlipDocument(payload: ReportExportPayload): void {
  const html = generateThermalSlipHtml(payload);
  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  }
}
