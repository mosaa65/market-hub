/**
 * useDebtsOverview — مصدر واحد لأرصدة الديون في كل الشاشات
 *
 * يُستخدم في: شاشة الديون · كشف الديون · بطاقة العميل · لوحة المالية
 * بدل كل `reduce(... balance ...)` المكرر.
 *
 * المصدر: customer_ledger / purchase_invoices + purchase_returns
 * (لا الأعمدة المخزَّنة customers.balance و suppliers.balance).
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { loadDebtsOverview } from "@/lib/statements/debts";
import { statementKeys } from "./use-statement";
import type { StatementEntityType } from "@/lib/statements/types";
import { useI18n } from "@/lib/i18n";

export interface UseDebtsOverviewOptions {
  entityType?: StatementEntityType;
  enabled?: boolean;
}

export function useDebtsOverview(options: UseDebtsOverviewOptions = {}) {
  const { entityType = "customer", enabled = true } = options;
  const { lang } = useI18n();

  const query = useQuery({
    queryKey: [...statementKeys.debts(entityType), lang],
    queryFn: () => loadDebtsOverview(entityType, lang),
    enabled,
    staleTime: 30_000,
  });

  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);

  return {
    rows,
    totals: query.data?.totals ?? {
      totalReceivable: 0,
      totalPayable: 0,
      debtors: 0,
      creditors: 0,
      overLimit: 0,
      withGap: 0,
    },
    agingByCustomer: query.data?.agingByCustomer ?? new Map(),
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}

/**
 * فهرس سريع: معرّف الجهة → صف الدين.
 * يُستخدم في بطاقة العميل وشاشة المدفوعات لجلب رصيد مؤكَّد بلا نداء إضافي.
 */
export function useDebtIndex(entityType: StatementEntityType = "customer", enabled = true) {
  const { rows, isLoading, refetch } = useDebtsOverview({ entityType, enabled });
  const index = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  return { index, rows, isLoading, refetch };
}
