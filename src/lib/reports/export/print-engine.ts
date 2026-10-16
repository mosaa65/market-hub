/**
 * Vortex ERP — محرك قوالب الطباعة و PDF المعتمد (Unified Report Print Engine)
 * المرحلة 6: REP-022, REP-023, REP-024, REP-025
 *
 * يوفر 3 قوالب طباعة رسمية بنظام الخطوط العربية (Cairo و Amiri):
 * 1. summary: قالب الملخص التنفيذي والمؤشرات
 * 2. detailed: قالب الجداول التفصيلية متعدد الصفحات مع تكرار الترويسات
 * 3. movement: كشف الحركات المتسلسلة مع الرصيد الافتتاحي واللحظي ومساحات التوقيع
 */

import { getCachedCompanyProfile } from '@/lib/printing/company-profile';
import type { ReportExportPayload } from './types';
import type { ReportColumnDefinition } from '../types';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function generateReportPrintHtml(
  payload: ReportExportPayload,
  templateType: 'summary' | 'detailed' | 'movement' = 'detailed'
): string {
  const { definition, rows, metrics, appliedFilters, currencySymbol = 'ر.س' } = payload;
  const company = getCachedCompanyProfile();

  const exportableCols: ReportColumnDefinition[] = definition.columns.filter(
    (c) => c.exportable !== false
  );

  // تنسيق قيم الخلايا في الطباعة
  const formatPrintCell = (val: any, col: ReportColumnDefinition): string => {
    if (val === undefined || val === null || val === '') return '—';
    if (col.dataType === 'money') {
      return `${Number(val || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} <small class="unit">${col.unit || currencySymbol}</small>`;
    }
    if (col.dataType === 'quantity') {
      return Number(val || 0).toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 3,
      });
    }
    if (col.dataType === 'percentage') {
      return `${Number(val || 0).toFixed(2)}%`;
    }
    return esc(val);
  };

  // توليد صفوف الجدول
  const tableRowsHtml = rows
    .map(
      (row, idx) => `
    <tr class="${idx % 2 === 1 ? 'even' : ''}">
      ${exportableCols
        .map((col) => {
          const align = col.align === 'left' ? 'text-left mono' : col.align === 'center' ? 'text-center' : 'text-right';
          return `<td class="${align}">${formatPrintCell(row[col.key], col)}</td>`;
        })
        .join('')}
    </tr>`
    )
    .join('');

  // سطر الإجماليات
  const hasAggregates = exportableCols.some((c) => c.aggregate && c.aggregate !== 'none');
  let totalsRowHtml = '';
  if (hasAggregates && rows.length > 0) {
    totalsRowHtml = `
    <tr class="totals-row">
      ${exportableCols
        .map((col, idx) => {
          const align = col.align === 'left' ? 'text-left mono' : col.align === 'center' ? 'text-center' : 'text-right';
          if (col.aggregate === 'sum') {
            const sum = rows.reduce((acc, r) => acc + (Number(r[col.key]) || 0), 0);
            return `<td class="${align}">${Number(sum.toFixed(2)).toLocaleString('en-US')} <small class="unit">${col.unit || currencySymbol}</small></td>`;
          }
          if (col.aggregate === 'count') {
            return `<td class="${align}">${rows.length}</td>`;
          }
          if (idx === 0) {
            return `<td class="text-right bold">الإجمالي العام</td>`;
          }
          return `<td></td>`;
        })
        .join('')}
    </tr>`;
  }

  // بطاقات المؤشرات (Metrics Cards)
  let metricsDeckHtml = '';
  if (definition.metrics.length > 0) {
    metricsDeckHtml = `
    <div class="metrics-deck">
      ${definition.metrics
        .map((m) => {
          const val = metrics[m.key];
          let formattedVal = '—';
          if (val !== undefined && val !== null) {
            if (m.format === 'money') {
              formattedVal = `${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencySymbol}`;
            } else if (m.format === 'quantity') {
              formattedVal = Number(val).toLocaleString('en-US', { maximumFractionDigits: 3 });
            } else if (m.format === 'percentage') {
              formattedVal = `${Number(val).toFixed(2)}%`;
            } else {
              formattedVal = Number(val).toLocaleString('en-US');
            }
          }
          return `
          <div class="metric-card">
            <div class="metric-label">${esc(m.labelAr)}</div>
            <div class="metric-value mono">${formattedVal}</div>
          </div>`;
        })
        .join('')}
    </div>`;
  }

  // مربع الرصيد الافتتاحي والختامي لكشف الحركات (Movement Template)
  let movementHeaderHtml = '';
  if (templateType === 'movement') {
    movementHeaderHtml = `
    <div class="movement-balance-box">
      <div class="balance-item">
        <span class="label">الرصيد الافتتاحي:</span>
        <span class="val mono">${Number(metrics.openingBalance || 0).toLocaleString('en-US', { maximumFractionDigits: 3 })}</span>
      </div>
      <div class="balance-item in">
        <span class="label">إجمالي الوارد (+):</span>
        <span class="val mono">${Number(metrics.totalInbound || 0).toLocaleString('en-US', { maximumFractionDigits: 3 })}</span>
      </div>
      <div class="balance-item out">
        <span class="label">إجمالي الصادر (-):</span>
        <span class="val mono">${Number(metrics.totalOutbound || 0).toLocaleString('en-US', { maximumFractionDigits: 3 })}</span>
      </div>
      <div class="balance-item closing">
        <span class="label">الرصيد الختامي:</span>
        <span class="val mono bold">${Number(metrics.closingBalance || 0).toLocaleString('en-US', { maximumFractionDigits: 3 })}</span>
      </div>
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>${esc(definition.titleAr)} - ${esc(company.name || 'Vortex ERP')}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Cairo:wght@400;600;700;800&family=IBM+Plex+Mono:wght@500;700&display=swap');

    @page {
      size: A4 portrait;
      margin: 12mm 10mm 15mm 10mm;
    }

    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    body {
      font-family: 'Cairo', 'Amiri', -apple-system, BlinkMacSystemFont, sans-serif;
      margin: 0;
      padding: 0;
      color: #0f172a;
      background: #ffffff;
      font-size: 11px;
      line-height: 1.4;
      direction: rtl;
    }

    .mono {
      font-family: 'IBM Plex Mono', monospace;
    }

    .report-sheet {
      width: 100%;
      max-width: 210mm;
      margin: 0 auto;
    }

    /* ── ترويسة المنشأة والتقرير ────────────────────────── */
    .company-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #0f766e;
      padding-bottom: 10px;
      margin-bottom: 12px;
    }

    .company-info h1 {
      margin: 0 0 2px 0;
      font-size: 16px;
      font-weight: 800;
      color: #0f766e;
    }

    .company-info .meta {
      font-size: 9.5px;
      color: #475569;
    }

    .report-title-box {
      text-align: left;
    }

    .report-title-box h2 {
      margin: 0 0 2px 0;
      font-size: 15px;
      font-weight: 800;
      color: #1e293b;
    }

    .report-title-box .period {
      font-size: 9.5px;
      color: #0f766e;
      font-weight: 700;
    }

    /* ── بطاقات المؤشرات ────────────────────────────── */
    .metrics-deck {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
      margin-bottom: 12px;
    }

    .metric-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      padding: 6px 8px;
      text-align: right;
    }

    .metric-label {
      font-size: 8.5px;
      color: #64748b;
      margin-bottom: 2px;
    }

    .metric-value {
      font-size: 12px;
      font-weight: 700;
      color: #0f766e;
    }

    /* ── كشف رصيد الحركات ───────────────────────────── */
    .movement-balance-box {
      display: flex;
      justify-content: space-between;
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      padding: 6px 12px;
      margin-bottom: 12px;
    }

    .balance-item .label {
      font-size: 9px;
      color: #475569;
      margin-left: 4px;
    }

    .balance-item.in .val { color: #059669; }
    .balance-item.out .val { color: #e11d48; }
    .balance-item.closing .val { color: #0f766e; font-size: 12px; }

    /* ── جدول البيانات ─────────────────────────────── */
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 4px;
      page-break-inside: auto;
    }

    thead {
      display: table-header-group;
    }

    tr {
      page-break-inside: avoid;
      page-break-after: auto;
    }

    th {
      background: #0f766e;
      color: #ffffff;
      font-size: 9.5px;
      font-weight: 700;
      padding: 6px 5px;
      border: 1px solid #0d655e;
      text-align: right;
    }

    td {
      padding: 4px 5px;
      border: 1px solid #e2e8f0;
      font-size: 9px;
    }

    tr.even {
      background: #f8fafc;
    }

    .totals-row td {
      background: #f1f5f9;
      border-top: 2px solid #0f766e;
      border-bottom: 2px solid #0f766e;
      font-weight: 700;
      font-size: 9.5px;
      color: #0f766e;
    }

    .text-left { text-align: left; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .bold { font-weight: 700; }
    .unit { font-size: 7.5px; color: #64748b; font-weight: normal; }

    /* ── التوقيعات والختام ──────────────────────────── */
    .signatures-block {
      display: flex;
      justify-content: space-between;
      margin-top: 25px;
      page-break-inside: avoid;
    }

    .sig-line {
      width: 28%;
      text-align: center;
    }

    .sig-space {
      height: 35px;
      border-bottom: 1px dashed #94a3b8;
      margin-bottom: 4px;
    }

    .sig-title {
      font-size: 9px;
      color: #475569;
      font-weight: 600;
    }

    .report-footer {
      margin-top: 20px;
      padding-top: 8px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      font-size: 8px;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="report-sheet">
    <!-- ترويسة المنشأة -->
    <div class="company-header">
      <div class="company-info">
        <h1>${esc(company.name || 'Vortex ERP')}</h1>
        <div class="meta">${esc(company.taxNumber ? `الرقم الضريبي: ${company.taxNumber}` : '')} ${esc(company.phone ? `· هاتف: ${company.phone}` : '')}</div>
        <div class="meta">${esc(company.address || '')}</div>
      </div>
      <div class="report-title-box">
        <h2>${esc(definition.titleAr)}</h2>
        <div class="period">الفترة: ${esc(appliedFilters.startDate || 'البداية')} إلى ${esc(appliedFilters.endDate || 'الآن')}</div>
        <div style="font-size:8px;color:#94a3b8;margin-top:2px;">تاريخ الطباعة: ${esc(new Date().toLocaleString('ar-SA'))}</div>
      </div>
    </div>

    ${movementHeaderHtml}
    ${metricsDeckHtml}

    <!-- جدول التقرير -->
    <table>
      <thead>
        <tr>
          ${exportableCols.map((c) => `<th class="${c.align === 'left' ? 'text-left' : c.align === 'center' ? 'text-center' : 'text-right'}">${esc(c.labelAr)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${tableRowsHtml}
        ${totalsRowHtml}
      </tbody>
    </table>

    <!-- التوقيعات الرسمية -->
    <div class="signatures-block">
      <div class="sig-line">
        <div class="sig-space"></div>
        <div class="sig-title">المحاسب المسؤول</div>
      </div>
      <div class="sig-line">
        <div class="sig-space"></div>
        <div class="sig-title">المراجع والمدقق الداخلي</div>
      </div>
      <div class="sig-line">
        <div class="sig-space"></div>
        <div class="sig-title">اعتماد المدير العام</div>
      </div>
    </div>

    <!-- الفوتر الختامي -->
    <div class="report-footer">
      <div>طُبع بواسطة نظام Vortex ERP المحاسبي الموحد · جميع الحقوق محفوظة</div>
      <div>صفحة 1 من 1</div>
    </div>
  </div>

  <script>
    window.onload = function() {
      window.print();
    };
  </script>
</body>
</html>`;
}

export function printReportDocument(
  payload: ReportExportPayload,
  templateType: 'summary' | 'detailed' | 'movement' = 'detailed'
): void {
  const html = generateReportPrintHtml(payload, templateType);
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  }
}
