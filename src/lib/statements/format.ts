/**
 * Statement Formatting — عرض فقط، لا حساب
 *
 * يُعيد استخدام money() الموجودة في src/lib/format.ts بدل تكرارها.
 */

import { money } from "@/lib/format";
import { kindLabel } from "./engine";
import type {
  StatementColumn,
  StatementDirection,
  StatementEntityType,
  StatementTransaction,
} from "./types";

/** تهيئة HTML — تُستخدم في كل قوالب الطباعة */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** تنسيق مبلغ مع رمز العملة */
export function fmtMoney(value: number, symbol?: string): string {
  if (symbol) {
    const base = new Intl.NumberFormat("ar-YE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
    return `${base} ${symbol}`;
  }
  return money(Number(value || 0));
}

/** مبلغ بلا رمز — للأعمدة المالية داخل الجداول */
export function fmtAmount(value: number): string {
  return new Intl.NumberFormat("ar-YE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

/** تاريخ للعرض */
export function fmtDate(iso: string | null | undefined, lang: "ar" | "en" = "ar"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(lang === "ar" ? "ar-YE" : "en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/** تاريخ ووقت */
export function fmtDateTime(iso: string | null | undefined, lang: "ar" | "en" = "ar"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(lang === "ar" ? "ar-YE" : "en-GB");
}

/** يظهر المبلغ فقط إن كان > 0 — يمنع صفوف «0.00» المشوّشة */
export function fmtOrDash(value: number): string {
  return Math.abs(value) < 0.005 ? "—" : fmtAmount(value);
}

/** قيمة خلية واحدة بحسب وصف العمود */
export function cellValue(
  row: StatementTransaction,
  column: StatementColumn,
  entityType: StatementEntityType,
  lang: "ar" | "en",
): string {
  switch (column.key) {
    case "index":
      return String(row.index);
    case "date":
      return fmtDate(row.occurredAt, lang);
    case "reference":
      return row.reference ?? "—";
    case "kind":
      return kindLabel(row.kind, entityType, lang);
    case "description":
      return row.description ?? "—";
    case "debit":
      return fmtOrDash(row.debit);
    case "credit":
      return fmtOrDash(row.credit);
    case "balance":
      return fmtAmount(row.runningBalance);
    case "paymentMethod":
      return paymentMethodLabel(row.meta?.paymentMethod as string | undefined, lang);
    default:
      return "—";
  }
}

/** طريقة الدفع — تُقرأ من meta وهي بيانات موجودة أصلًا */
export function paymentMethodLabel(method: string | undefined | null, lang: "ar" | "en"): string {
  if (!method) return "—";
  const ar: Record<string, string> = {
    cash: "نقدي",
    card: "بطاقة",
    bank_transfer: "تحويل بنكي",
    mobile_money: "محفظة إلكترونية",
    credit: "آجل",
  };
  const en: Record<string, string> = {
    cash: "Cash",
    card: "Card",
    bank_transfer: "Bank transfer",
    mobile_money: "Mobile money",
    credit: "Credit",
  };
  return (lang === "ar" ? ar : en)[method] ?? method;
}

/**
 * دلالة الرصيد النهائي بلغة المستخدم.
 * ⚠️ لا نفرض debit/credit على كل الأنواع:
 *   عميل   → debit موجب = «مدين لنا» (له علينا)
 *   مورد   → debit موجب = «دائن لنا» (علينا له) — لأن الإشارة معكوسة في الاشتقاق
 *   صندوق  → debit موجب = «رصيد متاح»
 */
export function directionLabel(
  direction: StatementDirection,
  entityType: StatementEntityType,
  lang: "ar" | "en",
): string {
  const ar = lang === "ar";
  if (direction === "zero") return ar ? "رصيد صافٍ (صفر)" : "Settled (zero)";

  if (entityType === "customer") {
    return direction === "debit"
      ? ar
        ? "مدين — له علينا"
        : "Debit — receivable"
      : ar
        ? "دائن — عليه لنا (دفعة مقدمة)"
        : "Credit — advance payment";
  }

  if (entityType === "supplier") {
    return direction === "debit"
      ? ar
        ? "دائن — علينا له"
        : "Credit — payable"
      : ar
        ? "مدين — لنا عنده (رصيد مقدم)"
        : "Debit — advance to supplier";
  }

  return direction === "debit"
    ? ar
      ? "رصيد متاح"
      : "Available balance"
    : ar
      ? "عجز في الصندوق"
      : "Cash deficit";
}

/** لون دلالي للرصيد — يستخدمه العرض والطباعة */
export function directionTone(direction: StatementDirection): "positive" | "negative" | "neutral" {
  if (direction === "zero") return "neutral";
  return direction === "debit" ? "positive" : "negative";
}

/** حجم الكشف نصيًا */
export function rowCountLabel(count: number, lang: "ar" | "en"): string {
  if (lang === "ar") return `${count} حركة`;
  return count === 1 ? "1 entry" : `${count} entries`;
}
