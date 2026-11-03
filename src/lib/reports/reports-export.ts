/**
 * Reports export + print dataset builders.
 *
 * One place that turns the already-computed report data into:
 *  - CSV columns/rows (translated headers, numeric money & quantities)
 *  - Print sections (same figures, same labels)
 *
 * It never recomputes business logic: the caller passes the same aggregates it
 * renders on screen, so what is exported is exactly what is displayed.
 */

import type { ExportColumn } from "@/lib/excel-export";
import type { PrintSection } from "@/lib/print/report-print";
import { fmtDate, paymentMethodLabel, stripArabicLetterMark } from "@/lib/statements/format";

export type Lang = "ar" | "en";

export interface TopProductRow {
  name: string;
  qty: number;
  total: number;
}

export interface SalesRow {
  invoice: string;
  date: string;
  total: number;
  paid: number;
  paymentMethod: string;
  status: string;
}

export interface LowStockRow {
  name: string;
  stock: number;
  min: number;
}

export interface PaymentMixRow {
  method: string;
  amount: number;
  pct: number;
}

const statusLabel = (status: string, lang: Lang) => {
  const ar: Record<string, string> = {
    paid: "مدفوعة",
    partial: "مدفوعة جزئيًا",
    unpaid: "غير مدفوعة",
    open: "مفتوحة",
    draft: "مسودة",
    cancelled: "ملغاة",
  };
  const en: Record<string, string> = {
    paid: "Paid",
    partial: "Partial",
    unpaid: "Unpaid",
    open: "Open",
    draft: "Draft",
    cancelled: "Cancelled",
  };
  return (lang === "ar" ? ar : en)[status] ?? status;
};

const t = (ar: string, en: string, lang: Lang) => (lang === "ar" ? ar : en);

/**
 * One digit style for every printed figure.
 *
 * `fmtAmount` already renders Arabic-Indic digits for Arabic statements, so
 * quantities and percentages must use the same convention — otherwise a printed
 * report mixes 1250 and ١٢٬٥٠٠ on the same page.
 */
function fmtNum(value: number, lang: Lang, maxFractionDigits = 2): string {
  const locale = lang === "ar" ? "ar-YE" : "en-US";
  return stripArabicLetterMark(
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxFractionDigits,
    }).format(Number(value || 0)),
  );
}

// ---------------------------------------------------------------------------
// Top products
// ---------------------------------------------------------------------------

export function topProductRows(rows: TopProductRow[]) {
  return rows.map((r) => ({ name: r.name, qty: r.qty, revenue: r.total }));
}

export function topProductColumns(lang: Lang): ExportColumn[] {
  return [
    { key: "name", header: t("المنتج", "Product", lang), format: "text" },
    { key: "qty", header: t("الكمية", "Quantity", lang), format: "number" },
    { key: "revenue", header: t("الإيراد", "Revenue", lang), format: "money" },
  ];
}

export function topProductPrintSection(rows: TopProductRow[], lang: Lang): PrintSection {
  return {
    title: t("أعلى 10 منتجات", "Top 10 products", lang),
    columns: [
      { key: "name", label: t("المنتج", "Product", lang), align: "start" },
      { key: "qty", label: t("الكمية", "Quantity", lang), align: "end", numeric: true },
      { key: "revenue", label: t("الإيراد", "Revenue", lang), align: "end", numeric: true },
    ],
    rows: rows.map((r) => ({
      name: r.name,
      qty: fmtNum(r.qty, lang, 3),
      revenue: fmtNum(r.total, lang, 2),
    })),
    totals: {
      revenue: fmtNum(
        rows.reduce((a, r) => a + Number(r.total || 0), 0),
        lang,
        2,
      ),
    },
    totalsSpan: 2,
    totalsLabel: t("الإجمالي", "Total", lang),
    emptyLabel: t("لا توجد بيانات", "No data", lang),
  };
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export function salesRows(rows: SalesRow[]) {
  return rows.map((r) => ({
    invoice: r.invoice,
    date: r.date,
    total: r.total,
    paid: r.paid,
    paymentMethod: r.paymentMethod,
    status: r.status,
  }));
}

export function salesColumns(lang: Lang): ExportColumn[] {
  return [
    { key: "invoice", header: t("رقم الفاتورة", "Invoice", lang), format: "text" },
    { key: "date", header: t("التاريخ", "Date", lang), format: "text" },
    { key: "total", header: t("الإجمالي", "Total", lang), format: "money" },
    { key: "paid", header: t("المدفوع", "Paid", lang), format: "money" },
    {
      key: "paymentMethod",
      header: t("طريقة الدفع", "Payment method", lang),
      format: "text",
    },
    { key: "status", header: t("الحالة", "Status", lang), format: "text" },
  ];
}

export function salesPrintSection(rows: SalesRow[], lang: Lang): PrintSection {
  return {
    title: t("سجل المبيعات", "Sales log", lang),
    columns: [
      { key: "invoice", label: t("رقم الفاتورة", "Invoice", lang), align: "start", numeric: true },
      { key: "date", label: t("التاريخ", "Date", lang), align: "start", numeric: true },
      {
        key: "paymentMethod",
        label: t("طريقة الدفع", "Payment method", lang),
        align: "start",
      },
      { key: "status", label: t("الحالة", "Status", lang), align: "center" },
      { key: "total", label: t("الإجمالي", "Total", lang), align: "end", numeric: true },
    ],
    rows: rows.map((r) => ({
      invoice: r.invoice,
      date: fmtDate(r.date, lang),
      paymentMethod: r.paymentMethod,
      status: r.status,
      total: fmtNum(r.total, lang, 2),
    })),
    totals: {
      total: fmtNum(
        rows.reduce((a, r) => a + Number(r.total || 0), 0),
        lang,
        2,
      ),
    },
    totalsSpan: 4,
    totalsLabel: t("الإجمالي", "Total", lang),
    emptyLabel: t("لا توجد بيانات", "No data", lang),
  };
}

// ---------------------------------------------------------------------------
// Payment mix
// ---------------------------------------------------------------------------

export function paymentMixRows(rows: PaymentMixRow[]) {
  return rows.map((r) => ({ method: r.method, amount: r.amount, percentage: r.pct }));
}

export function paymentMixColumns(lang: Lang): ExportColumn[] {
  return [
    { key: "method", header: t("طريقة الدفع", "Payment method", lang), format: "text" },
    { key: "amount", header: t("المبلغ", "Amount", lang), format: "money" },
    { key: "percentage", header: t("النسبة", "Percentage", lang), format: "number" },
  ];
}

export function paymentMixPrintSection(rows: PaymentMixRow[], lang: Lang): PrintSection {
  return {
    title: t("توزيع طرق الدفع", "Payment method distribution", lang),
    columns: [
      { key: "method", label: t("طريقة الدفع", "Payment method", lang), align: "start" },
      { key: "amount", label: t("المبلغ", "Amount", lang), align: "end", numeric: true },
      { key: "percentage", label: t("النسبة", "Percentage", lang), align: "end", numeric: true },
    ],
    rows: rows.map((r) => ({
      method: r.method,
      amount: fmtNum(r.amount, lang, 2),
      percentage: `${fmtNum(r.pct, lang, 1)}%`,
    })),
    totals: {
      amount: fmtNum(
        rows.reduce((a, r) => a + Number(r.amount || 0), 0),
        lang,
        2,
      ),
    },
    totalsSpan: 1,
    totalsLabel: t("الإجمالي", "Total", lang),
    emptyLabel: t("لا توجد بيانات", "No data", lang),
  };
}

// ---------------------------------------------------------------------------
// Low stock
// ---------------------------------------------------------------------------

export function lowStockRows(rows: LowStockRow[]) {
  return rows.map((r) => ({ name: r.name, onHand: r.stock, minimum: r.min }));
}

export function lowStockColumns(lang: Lang): ExportColumn[] {
  return [
    { key: "name", header: t("المنتج", "Product", lang), format: "text" },
    { key: "onHand", header: t("المتاح", "On hand", lang), format: "number" },
    { key: "minimum", header: t("الحد الأدنى", "Minimum", lang), format: "number" },
  ];
}

export function lowStockPrintSection(rows: LowStockRow[], lang: Lang): PrintSection {
  return {
    title: t("منتجات تحت الحد الأدنى", "Below minimum stock", lang),
    columns: [
      { key: "name", label: t("المنتج", "Product", lang), align: "start" },
      { key: "onHand", label: t("المتاح", "On hand", lang), align: "end", numeric: true },
      { key: "minimum", label: t("الحد الأدنى", "Minimum", lang), align: "end", numeric: true },
    ],
    rows: rows.map((r) => ({
      name: r.name,
      onHand: fmtNum(r.stock, lang, 3),
      minimum: fmtNum(r.min ?? 0, lang, 3),
    })),
    emptyLabel: t("كل المخزون بحالة جيدة", "All stock above minimum", lang),
  };
}

export { statusLabel, stripArabicLetterMark, paymentMethodLabel };
