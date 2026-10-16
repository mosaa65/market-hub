/**
 * Vortex ERP — فحص واختبار محركات التصدير والطباعة (Phases 6 & 7)
 * REP-022 .. REP-030
 */

import { REPORT_SALES_PRODUCT, REPORT_INVENTORY_ITEM_CARD } from '../registry';
import {
  generateReportCSV,
  generateReportExcelXml,
  generateReportPrintHtml,
  generateThermalSlipHtml,
  generateReportCSVChunked,
  ExportAbortedError,
  runChunkedExport,
  type ReportExportPayload,
} from '../export';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ فشل الاختبار: ${message}`);
    process.exit(1);
  } else {
    console.log(`  ✓ ${message}`);
  }
}

console.log('\n════════════════════════════════════════════════════════');
console.log('  Vortex ERP — فحص محركات التصدير والطباعة (Phases 6 & 7)');
console.log('════════════════════════════════════════════════════════\n');

const mockSalesPayload: ReportExportPayload = {
  definition: REPORT_SALES_PRODUCT,
  rows: [
    { sku: 'FG-WHEAT-50', item_name_ar: 'دقيق فاخر 50 كجم', quantity: 50, gross_sales: 7500, discounts: 100, net_sales: 7400, total_cost: 5500, gross_margin: 1900, margin_percentage: 25.68 },
    { sku: 'FG-BRAN-40', item_name_ar: 'نخالة قمح 40 كجم', quantity: 20, gross_sales: 1300, discounts: 50, net_sales: 1250, total_cost: 900, gross_margin: 350, margin_percentage: 28.00 },
  ],
  metrics: {
    totalQuantity: 70,
    grossSales: 8800,
    itemDiscounts: 150,
    netSales: 8650,
    totalCost: 6400,
    grossMargin: 2250,
    marginPercentage: 26.01,
  },
  appliedFilters: {
    startDate: '2026-10-01',
    endDate: '2026-10-31',
  },
  currencySymbol: 'ر.س',
};

const mockMovementPayload: ReportExportPayload = {
  definition: REPORT_INVENTORY_ITEM_CARD,
  rows: [
    { created_at: '2026-10-01T08:00:00Z', movement_type: 'شراء', reference: 'PO-100', inbound_quantity: 500, outbound_quantity: 0, running_balance: 750, warehouse_name: 'المستودع الرئيسي' },
    { created_at: '2026-10-02T10:00:00Z', movement_type: 'بيع', reference: 'INV-200', inbound_quantity: 0, outbound_quantity: 150, running_balance: 600, warehouse_name: 'المستودع الرئيسي' },
  ],
  metrics: {
    openingBalance: 250,
    totalInbound: 500,
    totalOutbound: 150,
    closingBalance: 600,
    totalRowCount: 2,
  },
  appliedFilters: {
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    productId: 'prod-wheat-50',
  },
  currencySymbol: 'ر.س',
};

// 1. اختبار محرك CSV الآمن (REP-027)
console.log('▶ [REP-027] اختبارات محرك CSV الآمن وتوافق Excel:');
{
  const csv = generateReportCSV(mockSalesPayload);

  assert(csv.startsWith('\uFEFF'), 'يبدأ الملف بـ UTF-8 BOM لمنع تشوه العربية');
  assert(csv.includes('تقرير المبيعات حسب المنتج'), 'تضمين عنوان التقرير في الترويسة');
  assert(csv.includes('FG-WHEAT-50'), 'تضمين رمز الصنف في البيانات');
  assert(csv.includes('7400'), 'تضمين القيمة الرقمية لصافي المبيعات');
  assert(csv.includes('ملخص ومؤشرات الأداء'), 'تضمين قسم ملخص المؤشرات');
  assert(csv.includes('الإجمالي العام'), 'تضمين سطر الإجماليات الختامي');
  const dangerousPayload = generateReportCSV({
    ...mockSalesPayload,
    rows: [
      { ...mockSalesPayload.rows[0], item_name_ar: '=HYPERLINK("https://unsafe.example")' },
    ],
  });
  assert(
    dangerousPayload.includes("'=HYPERLINK"),
    'تعطيل صيغ Excel الضارة في الحقول النصية (CSV Injection)',
  );
}

// 2. اختبار محرك Excel المتعدد المصنفات (REP-028, REP-029)
console.log('\n▶ [REP-028..029] اختبارات محرك Excel متعدد المصنفات (XML Spreadsheet):');
{
  const xml = generateReportExcelXml(mockSalesPayload);

  assert(xml.includes('<?xml version="1.0" encoding="UTF-8"?>'), 'رأس XML صالح');
  assert(xml.includes('ss:Name="ملخص ومؤشرات الأداء"'), 'الورقة الأولى: ملخص ومؤشرات الأداء');
  assert(xml.includes('ss:Name="سجل البيانات التفصيلي"'), 'الورقة الثانية: سجل البيانات التفصيلي');
  assert(xml.includes('<DisplayRightToLeft/>'), 'دعم اتجاه RTL الأصلي في Excel');
  assert(xml.includes('ss:Type="Number">7400</Data>'), 'الخلايا المالية تخرج كأرقام قابلة للحساب');
  assert(xml.includes('ss:StyleID="HeaderStyle"'), 'تطبيق أنماط الترويسة المميزة');
}

// 3. اختبار محرك الطباعة و PDF المعتمد (REP-022..025)
console.log('\n▶ [REP-022..025] اختبارات محرك الطباعة الرسمي (Cairo/Amiri):');
{
  const htmlDetailed = generateReportPrintHtml(mockSalesPayload, 'detailed');
  assert(htmlDetailed.includes('dir="rtl"'), 'اتجاه الصفحة عربي RTL');
  assert(htmlDetailed.includes('Cairo'), 'تضمين خط Cairo العربي');
  assert(htmlDetailed.includes('Amiri'), 'تضمين خط Amiri العربي');
  assert(htmlDetailed.includes('thead {'), 'تكرار الترويسة في الطباعة متعددة الصفحات');
  assert(htmlDetailed.includes('المراجع والمدقق الداخلي'), 'تضمين مساحات التوقيع والاعتماد');

  const htmlMovement = generateReportPrintHtml(mockMovementPayload, 'movement');
  assert(htmlMovement.includes('movement-balance-box'), 'تضمين مربع كشف الرصيد للحركات');
  assert(htmlMovement.includes('الرصيد الافتتاحي'), 'إبراز الرصيد الافتتاحي');
  assert(htmlMovement.includes('الرصيد الختامي'), 'إبراز الرصيد الختامي');
}

// 4. اختبار محرك الطباعة الحرارية (REP-026)
console.log('\n▶ [REP-026] اختبارات الطباعة الحرارية السريعة (80mm):');
{
  const slip = generateThermalSlipHtml(mockSalesPayload);
  assert(slip.includes('size: 80mm auto'), 'ضبط حجم الصفحة على 80mm');
  assert(slip.includes('width: 74mm'), 'عرض منطقة الطباعة ملائم للإيصال');
  assert(slip.includes('المؤشرات الرئيسية'), 'تضمين ملخص المؤشرات المدمج');
  assert(slip.includes('شكراً لتعاملكم معنا'), 'تضمين تذييل الإيصال');
}

console.log('\n════════════════════════════════════════════════════════');
console.log('  🎉 نجاح جميع اختبارات محركات التصدير والطباعة 100%!');
console.log('════════════════════════════════════════════════════════\n');

async function testChunkedExport() {
  console.log('▶ [REP-030] اختبارات التصدير الآمن على دفعات:');
  let completedChunks = 0;
  const csv = await generateReportCSVChunked(
    {
      ...mockSalesPayload,
      rows: [
        { ...mockSalesPayload.rows[0], item_name_ar: '=HYPERLINK("https://unsafe.example")' },
        mockSalesPayload.rows[1],
      ],
    },
    {
      chunkSize: 1,
      onProgress: (progress, processedRows, totalRows) => {
        completedChunks += 1;
        assert(progress === processedRows / totalRows, 'نسبة التقدم تطابق عدد الصفوف المعالجة');
      },
    },
  );
  assert(csv.startsWith('\uFEFF'), 'التصدير المجزأ يتضمن UTF-8 BOM');
  assert(csv.includes("'=HYPERLINK"), 'التصدير المجزأ يحمي CSV Injection');
  assert(csv.includes('الإجمالي العام'), 'التصدير المجزأ يحافظ على صف الإجماليات');
  assert(completedChunks === 2, 'معالجة الصفوف على دفعات بالحجم المحدد');

  const controller = new AbortController();
  controller.abort();
  let aborted = false;
  try {
    await runChunkedExport([1, 2], () => undefined, { signal: controller.signal });
  } catch (error) {
    aborted = error instanceof ExportAbortedError;
  }
  assert(aborted, 'إلغاء عملية التصدير يوقف الدفعة ويعيد خطأ الإلغاء المتوقع');
}

void testChunkedExport().catch((error) => {
  console.error('❌ فشل اختبار التصدير المجزأ:', error);
  process.exitCode = 1;
});
