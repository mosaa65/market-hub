/**
 * Unified Financial Bridge for Expense Accounting
 *
 * Provides a single source of truth for all modules, dashboards, and financial
 * statements calculating expense metrics. Enforces the strict GAAP/ERP boundary:
 *
 * 1. Accrual Expenses (Income Statement / P&L) = `postedTotal`
 *    All recognized expenses incurred in the period regardless of cash settlement.
 *
 * 2. Cash Outflow (Cash Statement / Cash-on-hand) = `paidCashOut`
 *    Actual money paid out from treasury/bank during the period.
 *
 * 3. Accrued Liabilities (Balance Sheet / Payables) = `outstandingTotal`
 *    Unpaid balance remaining on posted expenses.
 *
 * 4. Delinquent Payables = `overdueTotal`
 *    Expenses past their due date with remaining unpaid balance.
 */

import { supabase } from "@/integrations/supabase/client";

export interface UnifiedExpenseStats {
  postedTotal: number;
  paidCashOut: number;
  outstandingTotal: number;
  overdueTotal: number;
}

export async function fetchUnifiedExpenseStats(options?: {
  dateFrom?: string | null;
  dateTo?: string | null;
  warehouseId?: string | null;
}): Promise<UnifiedExpenseStats> {
  try {
    const { data, error } = await (supabase as any).rpc("expense_summary", {
      p_date_from: options?.dateFrom || null,
      p_date_to: options?.dateTo || null,
      p_warehouse_id: options?.warehouseId || null,
    });

    if (!error && data) {
      return {
        postedTotal: Number(data.posted_total ?? 0),
        paidCashOut: Number(data.paid_total ?? 0),
        outstandingTotal: Number(data.outstanding_total ?? 0),
        overdueTotal: Number(data.overdue_total ?? 0),
      };
    }
  } catch {
    // Proceed to direct query fallback
  }

  // Safe fallback querying expense_entries directly
  let query = (supabase as any)
    .from("expense_entries")
    .select("total_amount, paid_amount, remaining_amount, status, due_date")
    .in("status", ["POSTED", "PARTIALLY_PAID", "PAID", "CLOSED"]);

  if (options?.dateFrom) query = query.gte("expense_date", options.dateFrom);
  if (options?.dateTo) query = query.lte("expense_date", options.dateTo);
  if (options?.warehouseId) query = query.eq("warehouse_id", options.warehouseId);

  const { data: rows } = await query;
  if (!rows || !rows.length) {
    return { postedTotal: 0, paidCashOut: 0, outstandingTotal: 0, overdueTotal: 0 };
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  let posted = 0;
  let paid = 0;
  let outstanding = 0;
  let overdue = 0;

  for (const r of rows) {
    posted += Number(r.total_amount || 0);
    paid += Number(r.paid_amount || 0);
    const rem = Number(r.remaining_amount || 0);
    if (rem > 0.005) {
      outstanding += rem;
      if (r.due_date && r.due_date < todayStr) {
        overdue += rem;
      }
    }
  }

  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

  return {
    postedTotal: round2(posted),
    paidCashOut: round2(paid),
    outstandingTotal: round2(outstanding),
    overdueTotal: round2(overdue),
  };
}
