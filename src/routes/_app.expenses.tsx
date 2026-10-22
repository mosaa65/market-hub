/**
 * Expenses — the module's page.
 *
 * All state that shapes the query lives here in one `filters` object, so the
 * cache key, the toolbar and the summary can never disagree about what is being
 * shown. The page owns no data of its own: it composes the register, the form
 * and the detail drawer and hands them the same hooks.
 *
 * Why a dedicated route instead of replacing `/finance` outright: the finance
 * screen also renders debtors and creditors, and rewriting it in one step would
 * put the register and two unrelated reports at risk together. This page is the
 * new home for expenses; `/finance` keeps working and links here, so nothing
 * breaks for anyone mid-task when this ships.
 */

import { useCallback, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ModuleGuard } from "@/lib/modules";
import { ExpenseRegister } from "@/components/expenses/expense-register";
import { ExpenseFormDialog } from "@/components/expenses/expense-form";
import { ExpenseDetailDrawer } from "@/components/expenses/expense-detail-drawer";
import {
  useExpenseList,
  useExpenseLookups,
  useExpenseRealtime,
  useExpenseSummary,
} from "@/hooks/use-expenses";
import { EMPTY_EXPENSE_FILTERS, type ExpenseListFilters } from "@/lib/expenses/query-keys";
import type { ExpenseDetail, ExpenseListRow } from "@/lib/expenses/types";

export const Route = createFileRoute("/_app/expenses")({
  head: () => ({ meta: [{ title: "المصروفات — Vortex ERP" }] }),
  component: () => (
    <ModuleGuard moduleId="expenses">
      <ExpensesPage />
    </ModuleGuard>
  ),
});

function ExpensesPage() {
  /*
   * The default window is the current month. It is not imposed on the user —
   * the filter sheet can widen it — but starting unbounded would make the first
   * paint wait on a scan of the whole register for no benefit, since almost
   * every visit is about "this month".
   */
  const [filters, setFilters] = useState<ExpenseListFilters>(() => ({
    ...EMPTY_EXPENSE_FILTERS,
    dateFrom: startOfMonthSafe(),
    dateTo: todaySafe(),
  }));

  const [formOpen, setFormOpen] = useState(false);
  const [editingDetail, setEditingDetail] = useState<ExpenseDetail | null>(null);
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const lookups = useExpenseLookups();
  const list = useExpenseList(filters);
  const summary = useExpenseSummary(filters.dateFrom, filters.dateTo, filters.warehouseId);
  const realtime = useExpenseRealtime();

  /* -------------------------------------------------- handlers */
  const handleCreate = useCallback(() => {
    setEditingDetail(null);
    setFormOpen(true);
  }, []);

  const handleOpen = useCallback((row: ExpenseListRow) => {
    setOpenEntryId(row.id);
    setDetailOpen(true);
  }, []);

  /*
   * Editing from the list routes through the drawer, not straight into the
   * form: the form needs the full document (lines, version, tax mode), and
   * opening an empty form that populates a moment later would let an impatient
   * user save a blank draft over their own record.
   */
  const handleEditRow = handleOpen;
  const handlePayRow = handleOpen;

  return (
    <>
      <ExpenseRegister
        rows={list.rows}
        summary={summary.data}
        lookups={lookups.data}
        filters={filters}
        onFiltersChange={setFilters}
        onRefresh={() => {
          void list.refetch();
          void summary.refetch();
          realtime.refresh();
        }}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        isFetchingNextPage={list.isFetchingNextPage}
        hasNextPage={Boolean(list.hasNextPage)}
        onLoadMore={() => void list.fetchNextPage()}
        error={list.error}
        onCreate={handleCreate}
        onOpen={handleOpen}
        onEdit={handleEditRow}
        onPay={handlePayRow}
      />
      <ExpenseFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingDetail(null);
        }}
        lookups={lookups.data}
        editing={editingDetail}
        onSaved={(entryId) => {
          if (entryId) {
            setOpenEntryId(entryId);
            setDetailOpen(true);
          }
        }}
      />

      <ExpenseDetailDrawer
        entryId={openEntryId}
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) setOpenEntryId(null);
        }}
        onEdit={(detail) => {
          setEditingDetail(detail);
          setFormOpen(true);
        }}
      />
    </>
  );
}

/* The page module is evaluated during route generation, so these wrappers keep
   `new Date()` at render time instead of freezing it into a module-level
   constant that would go stale at midnight on a long-lived tab. */
function startOfMonthSafe(): string | null {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}-01`;
}

function todaySafe(): string | null {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
