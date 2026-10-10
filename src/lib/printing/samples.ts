/**
 * Sample documents for print preview.
 *
 * A single source of preview samples so the settings screen and any other
 * preview entry point render the same example. These are examples only —
 * they are never printed as real business data.
 */

import type { UnifiedDocumentData } from "@/lib/templates";

export const SAMPLE_CUSTOMER_INVOICE: UnifiedDocumentData = {
  docType: "customer_invoice",
  title: "فاتورة مبيعات نقدية",
  number: "INV-2026-0042",
  date: new Date().toLocaleDateString("ar-YE"),
  partyLabel: "العميل",
  partyName: "شركة الأمل للتجارة والخدمات",
  partyPhone: "771234567",
  partyVat: "300123456700003",
  warehouse: "المستودع الرئيسي",
  payment: "نقداً (Cash)",
  status: "مدفوعة بالكامل",
  lines: [
    {
      product: "دقيق بر ممتاز درجة أولى",
      qty: 2,
      unit: "كيس 50 كجم",
      price: 18500,
      total: 37000,
      code: "FLOUR-50KG",
    },
    {
      product: "أكياس تعبئة خيش مقوى 50 كجم",
      qty: 10,
      unit: "شوال",
      price: 450,
      total: 4500,
      code: "BAG-JUTE-50",
    },
    {
      product: "أجرة خدمة طحن حبوب قمح أحمر",
      qty: 1,
      unit: "طن",
      price: 8500,
      total: 8500,
      code: "SRV-MILL-RED",
    },
  ],
  subtotal: 50000,
  tax: 0,
  discount: 2000,
  total: 48000,
  paid: 48000,
  balance: 0,
  currency: "ر.ي",
  notes: "شكراً لتعاملكم مع مؤسستنا — البضاعة المباعة ترد وتستبدل وفق الشروط خلال 3 أيام.",
};

export const SAMPLE_PURCHASE_INVOICE: UnifiedDocumentData = {
  docType: "purchase_invoice",
  title: "فاتورة مشتريات وتوريد",
  number: "PUR-2026-0118",
  date: new Date().toLocaleDateString("ar-YE"),
  partyLabel: "المورد",
  partyName: "مؤسسة الحبوب الدولية للتوريدات الزراعية",
  partyPhone: "770987654",
  partyVat: "300998877600001",
  warehouse: "صوامع ومستودع الحبوب الخام",
  payment: "آجل (Credit)",
  status: "مسددة جزئياً",
  lines: [
    {
      product: "قمح بلدي حبوب صلبة درجة أ",
      qty: 5,
      unit: "طن",
      price: 180000,
      total: 900000,
      code: "WHEAT-LOCAL-A",
    },
    {
      product: "أكياس تعبئة بولي بروبلين جديدة",
      qty: 500,
      unit: "حبة",
      price: 320,
      total: 160000,
      code: "BAG-PP-NEW",
    },
  ],
  subtotal: 1060000,
  tax: 0,
  discount: 10000,
  total: 1050000,
  paid: 500000,
  balance: 550000,
  currency: "ر.ي",
  notes: "تم فحص نقاوة وجودة الحبوب بالمختبر واعتماد التوريد إلى الصوامع.",
};

export const SAMPLE_INVENTORY_DOC: UnifiedDocumentData = {
  docType: "inventory_document",
  title: "إذن صرف مبيعات مخزني",
  number: "STK-2026-0089",
  relatedRef: "INV-2026-0042",
  date: new Date().toLocaleDateString("ar-YE"),
  movementType: "صرف مبيعات (Sales Issue)",
  warehouse: "المستودع الرئيسي - قسم الصوامع",
  operatorName: "أحمد يونس (أمناء المخازن)",
  notes: "تم تجهيز وتسليم الأصناف بحالة ممتازة وبحضور العميل / السائق.",
  lines: [
    {
      product: "دقيق بر ممتاز درجة أولى",
      qty: 2,
      unit: "كيس 50 كجم",
      code: "FLOUR-50KG",
      note: "صومعة B-04",
    },
    {
      product: "أكياس تعبئة خيش مقوى 50 كجم",
      qty: 10,
      unit: "شوال",
      code: "BAG-JUTE-50",
      note: "عنبر التعبئة 2",
    },
  ],
};

export const SAMPLE_DELIVERY_NOTE: UnifiedDocumentData = {
  docType: "delivery_note",
  title: "إذن وسند تسليم نواتج طحن",
  number: "DEL-2026-0054",
  relatedRef: "JOB-2026-0031",
  date: new Date().toLocaleDateString("ar-YE"),
  partyLabel: "العميل المستلم",
  partyName: "مطاعم الشيباني الحديثة",
  partyPhone: "774433221",
  warehouse: "بوابة خروج وتسليم المطحنة",
  movementType: "تسليم أمانات عينية للعميل",
  operatorName: "كاشير صالة المطحنة",
  lines: [
    {
      product: "دقيق نمرة 1 فاخر (ناتج طحن أمانات)",
      qty: 20,
      unit: "كيس 50 كجم",
      code: "OUT-FLOUR-1",
    },
    { product: "نخالة خشنة (ردة نقية)", qty: 4, unit: "كيس 40 كجم", code: "OUT-BRAN" },
  ],
  notes: "رقم الشاحنة: أ ب ج 5432 · اسم السائق: محمد علي السلمي",
};

export const SAMPLE_RETURN_DOC: UnifiedDocumentData = {
  docType: "sales_return",
  title: "إشعار دائن — مرتجع مبيعات",
  number: "RET-2026-0015",
  relatedRef: "INV-2026-0042",
  date: new Date().toLocaleDateString("ar-YE"),
  partyLabel: "العميل",
  partyName: "شركة الأمل للتجارة والخدمات",
  partyPhone: "771234567",
  warehouse: "المستودع الرئيسي",
  payment: "استرداد نقدي فوري",
  status: "معتمد ومسترد",
  lines: [
    {
      product: "أكياس تعبئة خيش مقوى 50 كجم",
      qty: 2,
      unit: "شوال",
      price: 450,
      total: 900,
      code: "BAG-JUTE-50",
      note: "مرتجع فائض لم يستخدم",
    },
  ],
  subtotal: 900,
  tax: 0,
  discount: 0,
  total: 900,
  paid: 900,
  balance: 0,
  currency: "ر.ي",
  notes: "تم فحص حالة الأكياس وإعادتها لرف المخزن وتسليم القيمة نقداً.",
};

/** يعيد مستند معاينة مناسبًا لنوع المستند المطلوب. */
export function sampleDocumentFor(docType?: string): UnifiedDocumentData {
  switch (docType) {
    case "inventory_document":
    case "stock_transfer":
    case "stock_issue":
      return SAMPLE_INVENTORY_DOC;
    case "purchase_invoice":
      return SAMPLE_PURCHASE_INVOICE;
    case "delivery_note":
      return SAMPLE_DELIVERY_NOTE;
    case "sales_return":
    case "purchase_return":
      return SAMPLE_RETURN_DOC;
    case "customer_invoice":
    default:
      return SAMPLE_CUSTOMER_INVOICE;
  }
}
