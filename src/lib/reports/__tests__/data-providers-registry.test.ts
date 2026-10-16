/**
 * Vortex ERP — فحص طبقة مزودات البيانات وسجل التقارير (Phases 2 & 3)
 * اختبارات التحقق من صحة العقود والمخططات والربط مع نظام الأعمدة
 */

import {
  DateRangeFilterSchema,
  SalesRegisterFilterSchema,
  InventoryMovementsFilterSchema,
  PurchaseRegisterFilterSchema,
} from '../data-providers/filter-schemas';
import { SalesRegisterDataProvider } from '../data-providers/sales-register';
import { InventoryMovementsDataProvider } from '../data-providers/inventory-movements';
import { PurchaseRegisterDataProvider } from '../data-providers/purchase-register';
import {
  ReportRegistry,
  REPORT_SALES_PRODUCT,
  REPORT_INVENTORY_ITEM_CARD,
} from '../registry';
import { createReportColumnRegistry } from '../registry/column-bridge';
import { defaultVisibility, resolveVisibility } from '@/lib/records/column-registry';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ فشل الاختبار: ${message}`);
    process.exit(1);
  } else {
    console.log(`  ✓ ${message}`);
  }
}

console.log('\n════════════════════════════════════════════════════════');
console.log('  Vortex ERP — فحص مزودات البيانات والسجل المركزي (Phases 2 & 3)');
console.log('════════════════════════════════════════════════════════\n');

// 1. اختبار مخططات Zod للفلاتر (REP-011)
console.log('▶ [REP-011] اختبارات مخططات التحقق من الفلاتر (Zod):');
{
  const validSalesFilter = SalesRegisterFilterSchema.parse({
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    status: 'completed',
    paymentMethod: 'cash',
    search: 'INV-100',
  });
  assert(validSalesFilter.startDate === '2026-10-01', 'قبول فلتر المبيعات السليم');
  assert(validSalesFilter.status === 'completed', 'التقاط حالة الفاتورة');

  const validInvFilter = InventoryMovementsFilterSchema.parse({
    startDate: '2026-10-01',
    endDate: '2026-10-31',
  });
  assert(validInvFilter.endDate === '2026-10-31', 'قبول فلتر كشف المخزون');

  const validPurchFilter = PurchaseRegisterFilterSchema.parse({
    startDate: '2026-10-01',
    status: 'received',
  });
  assert(validPurchFilter.status === 'received', 'قبول فلتر سجل المشتريات');
}

// 2. اختبار جاهزية مزودات البيانات (REP-008, REP-009, REP-010)
console.log('\n▶ [REP-008..010] اختبارات تعريفات مزودات البيانات:');
{
  const sdp = new SalesRegisterDataProvider();
  assert(sdp.id === 'dp-sales-register', 'معرف مزود سجل المبيعات سليم');
  assert(sdp.dataSourceName === 'sales_register', 'اسم مصدر البيانات هو sales_register');

  const idp = new InventoryMovementsDataProvider();
  assert(idp.id === 'dp-inventory-movements', 'معرف مزود كشف المخزون سليم');
  assert(idp.dataSourceName === 'stock_movements', 'اسم مصدر البيانات هو stock_movements');

  const pdp = new PurchaseRegisterDataProvider();
  assert(pdp.id === 'dp-purchase-register', 'معرف مزود سجل المشتريات سليم');
  assert(pdp.dataSourceName === 'purchase_register', 'اسم مصدر البيانات هو purchase_register');
}

// 3. اختبار جسر تكامل الأعمدة وحفظ التفضيلات (REP-014)
console.log('\n▶ [REP-014] اختبارات جسر سجل الأعمدة وإدارة التفضيلات:');
{
  const columnReg = createReportColumnRegistry('rep-sales-product', REPORT_SALES_PRODUCT.columns);
  assert(columnReg.id === 'report:rep-sales-product', 'معرف سجل الأعمدة يحمل بادئة report:');
  assert(columnReg.columns.length === REPORT_SALES_PRODUCT.columns.length, 'مطابقة عدد الأعمدة المسجلة');

  const defaults = defaultVisibility(columnReg);
  assert(defaults.sku === true, 'العمود الأساسي sku مرئي افتراضياً');
  assert(defaults.net_sales === true, 'صافي المبيعات مرئي افتراضياً');

  // محاولة إخفاء عمود أساسي يجب أن تفشل بحكم قواعد الحماية
  const maliciousStored = { sku: false, net_sales: false, gross_sales: false };
  const resolved = resolveVisibility(columnReg, maliciousStored);
  assert(resolved.sku === true, 'العمود الأساسي sku يرفض الإخفاء حتى لو طلب المستخدم ذلك');
  assert(resolved.net_sales === true, 'العمود الأساسي net_sales يرفض الإخفاء');
  assert(resolved.gross_sales === false, 'العمود غير الأساسي gross_sales يقبل الإخفاء');
}

// 4. اختبار السجل المركزي للتقارير التجريبية (REP-015)
console.log('\n▶ [REP-015] اختبارات السجل المركزي للتقارير (Pilot Reports):');
{
  const repSales = ReportRegistry.get('rep-sales-product');
  assert(repSales !== undefined, 'استرجاع تقرير مبيعات المنتجات من السجل');
  assert(repSales?.domain === 'sales', 'نطاق التقرير هو sales');
  assert(repSales?.viewTemplate === 'grouped_ranking', 'قالب العرض هو grouped_ranking');
  assert(repSales?.columns.length! > 5, 'الأعمدة مسجلة بالكامل');
  assert(repSales?.metrics.length! > 0, 'المقاييس مسجلة بالكامل');

  const repInv = ReportRegistry.get('rep-inventory-item-card');
  assert(repInv !== undefined, 'استرجاع كشف بطاقة الصنف من السجل');
  assert(repInv?.domain === 'inventory', 'نطاق التقرير هو inventory');
  assert(repInv?.viewTemplate === 'movement_statement', 'قالب العرض هو movement_statement');

  const salesReports = ReportRegistry.getByDomain('sales');
  assert(salesReports.length >= 1, 'البحث بالمجال يسترجع تقارير المبيعات');

  const allReports = ReportRegistry.getAll();
  assert(allReports.length >= 2, 'السجل المركزي يحتوي على التقريرين التجريبيين');
}

console.log('\n════════════════════════════════════════════════════════');
console.log('  🎉 نجاح جميع اختبارات مزودات البيانات والسجل المركزي 100%!');
console.log('════════════════════════════════════════════════════════\n');
