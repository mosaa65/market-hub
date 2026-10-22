/**
 * Debts Overview — تجميع الديون من الدفتر لا من العمود المخزَّن
 *
 * هذا الملف يستبدل كل منطق `customers.reduce(... balance ...)` المكرر في:
 *   _app.debts.tsx · _app.customers.tsx · _app.finance.tsx · _app.dashboard.tsx
 *
 * المصدر: customer_ledger (دفتر حقيقي) + suppliers (اشتقاق للموردين).
 * قراءة فقط — صفر تغيير في قاعدة البيانات.
 */

import { balanceAsOf, buildAging, type AgingResult } from "./engine";
import { loadAllCustomerLedgerEntries } from "./adapters/customer";
import { loadAllSupplierEntries } from "./adapters/supplier";
import { supabase } from "@/integrations/supabase/client";
import type { LedgerEntry, StatementEntityType } from "./types";
import { EPSILON } from "./engine";

export interface DebtRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  entityType: StatementEntityType;
  /** الرصيد المحسوب من الحركات (مصدر الحقيقة) */
  ledgerBalance: number;
  /** الرصيد المخزَّن في الجدول — للتحقق فقط */
  cachedBalance: number | null;
  /** الفرق بين الاثنين */
  difference: number | null;
  /** هل يوجد فرق يستدعي تحذيرًا؟ */
  hasGap: boolean;
  creditLimit: number | null;
  isActive: boolean;
  /** تاريخ آخر حركة */
  lastMovementAt: string | null;
  /** عمر الدين بالأيام (من أقدم فاتورة غير مسدَّدة) */
  oldestDebtDays: number | null;
  /** متأخر عن الحد الائتماني؟ */
  overLimit: boolean;
}

export interface DebtsOverview {
  rows: DebtRow[];
  totals: {
    totalReceivable: number;
    totalPayable: number;
    debtors: number;
    creditors: number;
    overLimit: number;
    withGap: number;
  };
  /** أعمار الديون المخصّصة FIFO لكل عميل — لحسابها نستخدم الـ aging على حركات العميل */
  agingByCustomer: Map<string, AgingResult>;
  loadedAt: string;
}

interface RawCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  balance: number | null;
  credit_limit: number | null;
  is_active: boolean | null;
}

interface RawSupplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  balance: number | null;
  is_active: boolean | null;
}

/** حساب عمر أقدم دين غير مسدَّد من الحركات */
function oldestOutstandingDays(entries: LedgerEntry[], asOfKey: string): number | null {
  const aging = buildAging(entries, { asOf: asOfKey });
  if (aging.rows.length === 0) return null;
  return aging.rows.reduce((max, r) => Math.max(max, r.ageDays), 0);
}

function lastMovement(entries: LedgerEntry[]): string | null {
  if (entries.length === 0) return null;
  let latest: string | null = null;
  for (const e of entries) {
    if (!latest || e.occurredAt > latest) latest = e.occurredAt;
  }
  return latest;
}

/**
 * تحميل نظرة شاملة على الديون.
 * @param entityType "customer" للذمم المدينة · "supplier" للذمم الدائنة
 */
export async function loadDebtsOverview(
  entityType: StatementEntityType,
  lang: "ar" | "en" = "ar",
): Promise<DebtsOverview> {
  const asOfKey = new Date().toISOString().slice(0, 10);

  if (entityType === "supplier") {
    return loadSupplierOverview(asOfKey, lang);
  }

  // 1) نداءان متوازيان فقط
  const [customersRes, ledgerMap] = await Promise.all([
    supabase
      .from("customers")
      .select("id, name, phone, email, balance, credit_limit, is_active")
      .order("name"),
    loadAllCustomerLedgerEntries(),
  ]);

  const customers = (customersRes.data ?? []) as RawCustomer[];
  const rows: DebtRow[] = [];
  const agingByCustomer = new Map<string, AgingResult>();

  for (const customer of customers) {
    const entries = ledgerMap.get(customer.id) ?? [];
    const ledgerBalance = entries.length > 0 ? balanceAsOf(entries, null) : 0;
    const cachedBalance = customer.balance === null ? null : Number(customer.balance);
    const difference =
      cachedBalance === null
        ? null
        : Math.round((ledgerBalance - cachedBalance + Number.EPSILON) * 100) / 100;
    const aging = buildAging(entries, { asOf: asOfKey });
    agingByCustomer.set(customer.id, aging);

    const creditLimit = Number(customer.credit_limit ?? 0);

    rows.push({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      entityType: "customer",
      ledgerBalance,
      cachedBalance,
      difference,
      hasGap: difference !== null && Math.abs(difference) > EPSILON,
      creditLimit,
      isActive: customer.is_active !== false,
      lastMovementAt: lastMovement(entries),
      oldestDebtDays: oldestOutstandingDays(entries, asOfKey),
      overLimit: creditLimit > 0 && ledgerBalance > creditLimit + EPSILON,
    });
  }

  return finalize(rows, agingByCustomer);
}

async function loadSupplierOverview(asOfKey: string, lang: "ar" | "en"): Promise<DebtsOverview> {
  const [suppliersRes, supplierMap] = await Promise.all([
    supabase.from("suppliers").select("id, name, phone, email, balance, is_active").order("name"),
    loadAllSupplierEntries(lang),
  ]);

  const suppliers = (suppliersRes.data ?? []) as RawSupplier[];
  const rows: DebtRow[] = [];
  const agingByCustomer = new Map<string, AgingResult>();

  for (const supplier of suppliers) {
    const entries = supplierMap.get(supplier.id) ?? [];

    // اتجاه المورد: ما علينا له = Σ(credit) - Σ(debit)
    let supplierBalance = 0;
    for (const e of entries) supplierBalance += e.credit - e.debit;
    supplierBalance = Math.round((supplierBalance + Number.EPSILON) * 100) / 100;

    const cachedBalance = supplier.balance === null ? null : Number(supplier.balance);
    const difference =
      cachedBalance === null
        ? null
        : Math.round((supplierBalance - cachedBalance + Number.EPSILON) * 100) / 100;

    // أعمار الديون للمورد: تُبنى على "توريد غير مسدَّد"
    // نُعيد استخدام buildAging لأنها تخصّص FIFO للمدفوعات على الأقدم
    const agingEntries: LedgerEntry[] = entries.map((e) => ({
      ...e,
      // في اتجاه المورد التوريد هو "المدين غير المسدَّد" للتحليل
      debit: e.kind === "sale" ? e.credit : 0,
      credit: e.kind === "sale" ? 0 : e.debit,
    }));
    const aging = buildAging(agingEntries, { asOf: asOfKey });
    agingByCustomer.set(supplier.id, aging);

    rows.push({
      id: supplier.id,
      name: supplier.name,
      phone: supplier.phone,
      email: supplier.email,
      entityType: "supplier",
      ledgerBalance: supplierBalance,
      cachedBalance,
      difference,
      hasGap: difference !== null && Math.abs(difference) > EPSILON,
      creditLimit: null,
      isActive: supplier.is_active !== false,
      lastMovementAt: lastMovement(entries),
      oldestDebtDays: oldestOutstandingDays(agingEntries, asOfKey),
      overLimit: false,
    });
  }

  return finalize(rows, agingByCustomer);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function finalize(rows: DebtRow[], agingByCustomer: Map<string, AgingResult>): DebtsOverview {
  const active = rows.filter((r) => r.isActive);
  const totalReceivable = round2(
    active
      .filter((r) => r.entityType === "customer")
      .reduce((a, r) => a + Math.max(r.ledgerBalance, 0), 0),
  );
  const totalPayable = round2(
    active
      .filter((r) => r.entityType === "supplier")
      .reduce((a, r) => a + Math.max(r.ledgerBalance, 0), 0),
  );

  return {
    rows: active,
    totals: {
      totalReceivable,
      totalPayable,
      debtors: active.filter((r) => r.entityType === "customer" && r.ledgerBalance > EPSILON)
        .length,
      creditors: active.filter((r) => r.entityType === "supplier" && r.ledgerBalance > EPSILON)
        .length,
      overLimit: active.filter((r) => r.overLimit).length,
      withGap: active.filter((r) => r.hasGap).length,
    },
    agingByCustomer,
    loadedAt: new Date().toISOString(),
  };
}
