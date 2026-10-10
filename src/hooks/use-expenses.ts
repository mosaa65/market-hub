/**
 * Expense module — data access hooks.
 *
 * Every read goes through a server-side function from
 * `..._expense_module_read_layer.sql`; nothing here ever selects a whole table.
 * Every write goes through a workflow RPC from `..._workflow_rpc.sql`; nothing
 * here attempts `insert()` or `update()` on a document table, because the
 * database does not grant that to `authenticated` and the status machine would
 * be bypassed if it did.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { toLegacyPaymentValue } from "@/lib/payments/payment-methods";
import { toast } from "sonner";
import {
  EMPTY_EXPENSE_FILTERS,
  expenseKeys,
  startOfMonth,
  today,
  type ExpenseListFilters,
} from "@/lib/expenses/query-keys";
import type {
  ExpenseDetail,
  ExpenseEntryType,
  ExpenseEntry,
  ExpenseLookups,
  ExpensePage,
  ExpensePaymentState,
  ExpensePayeeType,
  ExpenseReportGroupBy,
  ExpenseReportRow,
  ExpenseStatus,
  ExpenseSummary,
  ExpenseTaxMode,
} from "@/lib/expenses/types";

const PAGE_SIZE = 50;

/* ------------------------------------------------------------------ */
/*  Error normalisation                                                */
/* ------------------------------------------------------------------ */

/**
 * Turns whatever the RPC raised into something an operator can act on.
 *
 * A raw Postgres message is useless in a toast ("violates check constraint
 * expense_entries_paid_within_total"). The workflow functions already raise
 * human sentences, so those pass through untouched; anything that looks like a
 * database error is replaced with a calm generic message, and the real text is
 * logged so it still reaches the developer console.
 */
export function describeExpenseError(error: unknown, lang: "ar" | "en"): string {
  /*
   * Supabase/PostgREST failures are plain objects (`{ message, details, code }`),
   * not Error instances. Reading `.message` explicitly — with a type guard,
   * because `message` may itself be undefined — is what stops a toast from
   * printing "[object Object]".
   */
  const rawString =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ((error as { message?: unknown } | null)?.message ?? "");
  const raw = typeof rawString === "string" ? rawString : "";

  const looksInternal =
    /constraint|relation|column .* does not exist|permission denied|syntax error|violates|pg_|postgrest/i.test(
      raw,
    );

  if (raw && !looksInternal) {
    // Already a readable sentence from RAISE EXCEPTION. Still stripped of the
    // "ERROR:" prefix PostgREST sometimes prepends.
    return raw.replace(/^ERROR:\s*/i, "").trim();
  }

  if (raw) console.error("Expense operation failed", error);

  return lang === "ar"
    ? "تعذّر إتمام العملية. حاول مرة أخرى، وإن تكرر الخطأ راجع سجل الأخطاء."
    : "The operation could not be completed. Try again, and check the error log if it repeats.";
}

/* ------------------------------------------------------------------ */
/*  Reads                                                              */
/* ------------------------------------------------------------------ */

/** Reference data for the form and the filter sheet. Cached for 10 minutes. */
export function useExpenseLookups(enabled = true) {
  return useQuery({
    queryKey: expenseKeys.lookups(),
    queryFn: async (): Promise<ExpenseLookups> => {
      const { data, error } = await (supabase as any).rpc("expense_lookups", {
        p_include_archived: false,
      });
      if (error) throw error;
      return (data ?? {
        categories: [],
        warehouses: [],
        cost_centers: [],
        projects: [],
        suppliers: [],
        employees: [],
      }) as ExpenseLookups;
    },
    enabled,
    // Reference data changes rarely; refetching it on every drawer open would be
    // pure noise, so it is held far longer than the default.
    staleTime: 10 * 60 * 1000,
  });
}

/** The four summary cards. Computed in SQL over the filtered window. */
export function useExpenseSummary(
  dateFrom: string | null,
  dateTo: string | null,
  warehouseId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: expenseKeys.summary(dateFrom, dateTo, warehouseId),
    queryFn: async (): Promise<ExpenseSummary> => {
      const { data, error } = await (supabase as any).rpc("expense_summary", {
        p_date_from: dateFrom,
        p_date_to: dateTo,
        p_warehouse_id: warehouseId,
      });
      if (error) throw error;
      return data as ExpenseSummary;
    },
    enabled,
    staleTime: 30_000,
  });
}

/**
 * The register, one page at a time, keyset-paginated.
 *
 * `useInfiniteQuery` keeps every loaded page in cache and hands `getNextPageParam`
 * the last row of the previous page to build the cursor from — which is exactly
 * the contract `list_expenses` was written for.
 */
export function useExpenseList(filters: ExpenseListFilters, enabled = true) {
  const query = useInfiniteQuery({
    queryKey: expenseKeys.list(filters),
    initialPageParam: null as { date: string; id: string } | null,
    queryFn: async ({ pageParam }): Promise<ExpensePage> => {
      const { data, error } = await (supabase as any).rpc("list_expenses", {
        p_search: filters.search.trim() || null,
        p_status: filters.status.length ? filters.status : null,
        p_category_id: filters.categoryId,
        p_warehouse_id: filters.warehouseId,
        p_cost_center_id: filters.costCenterId,
        p_project_id: filters.projectId,
        p_supplier_id: filters.supplierId,
        p_employee_id: filters.employeeId,
        p_payment_state: filters.paymentState,
        p_date_from: filters.dateFrom,
        p_date_to: filters.dateTo,
        p_amount_min: filters.amountMin,
        p_amount_max: filters.amountMax,
        p_limit: PAGE_SIZE,
        p_cursor_date: pageParam?.date ?? null,
        p_cursor_id: pageParam?.id ?? null,
      });
      if (error) throw error;

      const rows = (data ?? []) as any[];
      const last = rows[rows.length - 1];

      return {
        rows: rows as ExpensePage["rows"],
        nextCursor:
          rows.length === PAGE_SIZE && last
            ? { date: last.next_cursor_date, id: last.next_cursor_id }
            : null,
        totalCount: Number(rows[0]?.total_count ?? 0),
        isLastPage: rows.length < PAGE_SIZE,
      };
    },
    // Returning `null` is what tells TanStack there is nothing further; a falsy
    // value ends the sequence cleanly rather than firing a request with a null
    // cursor that would return page one again.
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? null,
    enabled,
    staleTime: 20_000,
  });

  const rows = useMemo(() => (query.data?.pages ?? []).flatMap((page) => page.rows), [query.data]);

  return {
    rows,
    totalCount: query.data?.pages?.[0]?.totalCount ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}

/** One document with its lines, payments, approvals and attachments. */
export function useExpenseDetail(entryId: string | null) {
  return useQuery({
    queryKey: expenseKeys.detail(entryId ?? ""),
    queryFn: async (): Promise<ExpenseDetail | null> => {
      const { data, error } = await (supabase as any).rpc("expense_detail", {
        p_entry_id: entryId,
      });
      if (error) throw error;
      return (data ?? null) as ExpenseDetail | null;
    },
    enabled: Boolean(entryId),
    staleTime: 15_000,
  });
}

/** A grouped report. The grouping column is validated server-side. */
export function useExpenseReport(
  groupBy: ExpenseReportGroupBy,
  dateFrom: string | null,
  dateTo: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: [...expenseKeys.report(groupBy, dateFrom, dateTo), groupBy] as const,
    queryFn: async (): Promise<ExpenseReportRow[]> => {
      const { data, error } = await (supabase as any).rpc("expense_report", {
        p_group_by: groupBy,
        p_date_from: dateFrom,
        p_date_to: dateTo,
        p_limit: 200,
      });
      if (error) throw error;
      return (data ?? []) as ExpenseReportRow[];
    },
    enabled,
    staleTime: 60_000,
  });
}

/* ------------------------------------------------------------------ */
/*  Cache invalidation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Refreshes everything a document change can affect.
 *
 * The list, the detail and the summary are all invalidated together because a
 * single transition can change all three: posting moves a card total, paying
 * moves another, and both change the row the user is looking at. Invalidating
 * the whole `expenses` prefix is deliberate — the register is a few hundred
 * rows per page, so a refetch is cheap, and a missed invalidation is a wrong
 * number on screen, which is far more expensive.
 */
function invalidateExpenses(client: QueryClient, entryId?: string) {
  void client.invalidateQueries({ queryKey: expenseKeys.all });
  if (entryId) void client.invalidateQueries({ queryKey: expenseKeys.detail(entryId) });
}

/* ------------------------------------------------------------------ */
/*  Writes                                                             */
/* ------------------------------------------------------------------ */

export interface ExpenseLineInput {
  description?: string | null;
  category_id?: string | null;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  cost_center_id?: string | null;
  project_id?: string | null;
  note?: string | null;
}

export interface CreateExpenseInput {
  lines: ExpenseLineInput[];
  expense_date: string;
  due_date?: string | null;
  entry_type?: ExpenseEntryType;
  payee_type?: ExpensePayeeType;
  payee_name?: string | null;
  supplier_id?: string | null;
  employee_id?: string | null;
  warehouse_id?: string | null;
  cost_center_id?: string | null;
  project_id?: string | null;
  description?: string | null;
  note?: string | null;
  tax_mode?: ExpenseTaxMode;
  reference?: string | null;
  submit?: boolean;
}

/** Every write in the module, in one hook, sharing one invalidation policy. */
export function useExpenseMutations() {
  const client = useQueryClient();
  const { lang } = useI18n();
  const ar = lang === "ar";

  /** A stable per-attempt key so a retried payment cannot double-apply. */
  const makeIdempotencyKey = useCallback(
    (scope: string) =>
      `${scope}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`,
    [],
  );

  const create = useMutation({
    mutationFn: async (input: CreateExpenseInput): Promise<ExpenseEntry> => {
      const { data, error } = await (supabase as any).rpc("create_expense", {
        p_lines: input.lines,
        p_expense_date: input.expense_date,
        p_due_date: input.due_date || null,
        p_entry_type: input.entry_type ?? "DIRECT",
        p_payee_type: input.payee_type ?? "NONE",
        p_payee_name: input.payee_name || null,
        p_supplier_id: input.supplier_id || null,
        p_employee_id: input.employee_id || null,
        p_warehouse_id: input.warehouse_id || null,
        p_cost_center_id: input.cost_center_id || null,
        p_project_id: input.project_id || null,
        p_description: input.description || null,
        p_note: input.note || null,
        p_tax_mode: input.tax_mode ?? "NONE",
        p_reference: input.reference || null,
        p_submit: input.submit ?? false,
      });
      if (error) throw error;
      return data as ExpenseEntry;
    },
    onSuccess: (entry) => {
      invalidateExpenses(client, entry?.id);
      toast.success(
        entry?.status === "SUBMITTED"
          ? ar
            ? `تم حفظ المصروف ${entry.reference} وإرساله للاعتماد`
            : `Expense ${entry.reference} saved and sent for approval`
          : ar
            ? `تم حفظ المسودة ${entry?.reference ?? ""}`
            : `Draft ${entry?.reference ?? ""} saved`,
      );
    },
    onError: (error) => toast.error(describeExpenseError(error, lang)),
  });

  const update = useMutation({
    mutationFn: async (input: {
      id: string;
      version: number;
      lines: ExpenseLineInput[];
      header: Partial<CreateExpenseInput>;
    }): Promise<ExpenseEntry> => {
      const h = input.header;
      const { data, error } = await (supabase as any).rpc("update_expense", {
        p_entry_id: input.id,
        p_expected_version: input.version,
        p_lines: input.lines,
        p_expense_date: h.expense_date ?? null,
        p_due_date: h.due_date || null,
        p_entry_type: h.entry_type ?? null,
        p_payee_type: h.payee_type ?? null,
        p_payee_name: h.payee_name || null,
        p_supplier_id: h.supplier_id || null,
        p_employee_id: h.employee_id || null,
        p_warehouse_id: h.warehouse_id || null,
        p_cost_center_id: h.cost_center_id || null,
        p_project_id: h.project_id || null,
        p_description: h.description || null,
        p_note: h.note || null,
        p_tax_mode: h.tax_mode ?? null,
      });
      if (error) throw error;
      return data as ExpenseEntry;
    },
    onSuccess: (entry) => {
      invalidateExpenses(client, entry?.id);
      toast.success(ar ? "تم تحديث المسودة" : "Draft updated");
    },
    onError: (error) => toast.error(describeExpenseError(error, lang)),
  });

  const submit = useMutation({
    mutationFn: async (input: { id: string; version: number }): Promise<ExpenseEntry> => {
      const { data, error } = await (supabase as any).rpc("submit_expense", {
        p_entry_id: input.id,
        p_expected_version: input.version,
      });
      if (error) throw error;
      return data as ExpenseEntry;
    },
    onSuccess: (entry) => {
      invalidateExpenses(client, entry?.id);
      toast.success(ar ? "تم إرسال المصروف للاعتماد" : "Expense sent for approval");
    },
    onError: (error) => toast.error(describeExpenseError(error, lang)),
  });

  const decide = useMutation({
    mutationFn: async (input: {
      id: string;
      approve: boolean;
      reason?: string;
      version: number;
    }): Promise<ExpenseEntry> => {
      const { data, error } = await (supabase as any).rpc("decide_expense", {
        p_entry_id: input.id,
        p_approve: input.approve,
        p_reason: input.reason || null,
        p_expected_version: input.version,
      });
      if (error) throw error;
      return data as ExpenseEntry;
    },
    onSuccess: (entry, variables) => {
      invalidateExpenses(client, entry?.id);
      toast.success(
        variables.approve
          ? ar
            ? "تم اعتماد المصروف"
            : "Expense approved"
          : ar
            ? "تم إرجاع المصروف برفض مع السبب"
            : "Expense rejected with a reason",
      );
    },
    onError: (error) => toast.error(describeExpenseError(error, lang)),
  });

  const post = useMutation({
    mutationFn: async (input: {
      id: string;
      version: number;
      payNow: boolean;
      paymentMethod?: string;
      accountId?: string | null;
      accountLabel?: string | null;
      paymentDate?: string | null;
    }): Promise<ExpenseEntry> => {
      const { data, error } = await (supabase as any).rpc("post_expense", {
        p_entry_id: input.id,
        p_expected_version: input.version,
        p_pay_now: input.payNow,
        // `post_expense` and `record_expense_payment` take a
        // `public.payment_method`, not a catalogue id, and are NOT among the
        // functions the unified migration redefined — so unlike create_sale
        // they cannot resolve 'kuraimi_bank' themselves and would fail on the
        // cast. Converting here is what makes a new Yemeni method usable in
        // the expense screens at all.
        p_payment_method: toLegacyPaymentValue(input.paymentMethod ?? "cash"),
        p_account_label: input.accountLabel || null,
        p_payment_date: input.paymentDate || null,
        p_idempotency_key: input.payNow ? makeIdempotencyKey(`post:${input.id}`) : null,
        p_account_id: input.accountId || null,
      });
      if (error) throw error;
      return data as ExpenseEntry;
    },
    onSuccess: (entry, variables) => {
      invalidateExpenses(client, entry?.id);
      toast.success(
        variables.payNow
          ? ar
            ? "تم الترحيل والسداد معًا"
            : "Posted and settled in one step"
          : ar
            ? "تم ترحيل المصروف وتثبيت بياناته"
            : "Expense posted and recognized in register",
      );
    },
    onError: (error) => toast.error(describeExpenseError(error, lang)),
  });

  const pay = useMutation({
    mutationFn: async (input: {
      id: string;
      amount: number;
      paymentDate?: string;
      paymentMethod?: string;
      accountId?: string | null;
      accountLabel?: string | null;
      referenceNo?: string | null;
      note?: string | null;
    }): Promise<ExpenseEntry> => {
      const { data, error } = await (supabase as any).rpc("record_expense_payment", {
        p_entry_id: input.id,
        p_amount: input.amount,
        p_payment_date: input.paymentDate || null,
        // Same conversion, same reason as `post_expense` above.
        p_payment_method: toLegacyPaymentValue(input.paymentMethod ?? "cash"),
        p_account_label: input.accountLabel || null,
        p_reference_no: input.referenceNo || null,
        p_note: input.note || null,
        p_idempotency_key: makeIdempotencyKey(`pay:${input.id}`),
        p_account_id: input.accountId || null,
      });
      if (error) throw error;
      return data as ExpenseEntry;
    },
    onSuccess: (entry) => {
      invalidateExpenses(client, entry?.id);
      toast.success(
        entry?.status === "PAID"
          ? ar
            ? "تم سداد المصروف بالكامل"
            : "Expense fully settled"
          : ar
            ? "تم تسجيل الدفعة الجزئية"
            : "Partial payment recorded",
      );
    },
    onError: (error) => toast.error(describeExpenseError(error, lang)),
  });

  const cancel = useMutation({
    mutationFn: async (input: { id: string; reason: string; version: number }) => {
      const { data, error } = await (supabase as any).rpc("cancel_expense", {
        p_entry_id: input.id,
        p_reason: input.reason,
        p_expected_version: input.version,
      });
      if (error) throw error;
      return data as ExpenseEntry;
    },
    onSuccess: (entry) => {
      invalidateExpenses(client, entry?.id);
      toast.success(ar ? "تم إلغاء المصروف" : "Expense cancelled");
    },
    onError: (error) => toast.error(describeExpenseError(error, lang)),
  });

  const reverse = useMutation({
    mutationFn: async (input: { id: string; reason?: string }) => {
      const { data, error } = await (supabase as any).rpc("reverse_expense", {
        p_entry_id: input.id,
        p_reason: input.reason || null,
      });
      if (error) throw error;
      return data as ExpenseEntry;
    },
    onSuccess: (entry) => {
      invalidateExpenses(client, entry?.id);
      toast.success(ar ? "تم إنشاء قيد عكسي للمصروف" : "A reversing entry was created");
    },
    onError: (error) => toast.error(describeExpenseError(error, lang)),
  });

  const reversePayment = useMutation({
    mutationFn: async (input: { paymentId: string; entryId: string; reason?: string }) => {
      const { data, error } = await (supabase as any).rpc("reverse_expense_payment", {
        p_payment_id: input.paymentId,
        p_reason: input.reason || null,
      });
      if (error) throw error;
      return data as ExpenseEntry;
    },
    onSuccess: (entry) => {
      invalidateExpenses(client, entry?.id);
      toast.success(ar ? "تم عكس الدفعة" : "Payment reversed");
    },
    onError: (error) => toast.error(describeExpenseError(error, lang)),
  });

  const close = useMutation({
    mutationFn: async (input: { id: string }) => {
      const { data, error } = await (supabase as any).rpc("close_expense", {
        p_entry_id: input.id,
      });
      if (error) throw error;
      return data as ExpenseEntry;
    },
    onSuccess: (entry) => {
      invalidateExpenses(client, entry?.id);
      toast.success(ar ? "تم إقفال المصروف" : "Expense closed");
    },
    onError: (error) => toast.error(describeExpenseError(error, lang)),
  });

  return {
    create,
    update,
    submit,
    decide,
    post,
    pay,
    cancel,
    reverse,
    reversePayment,
    close,
    /** True while any write is in flight — used to lock the action bar. */
    isBusy:
      create.isPending ||
      update.isPending ||
      submit.isPending ||
      decide.isPending ||
      post.isPending ||
      pay.isPending ||
      cancel.isPending ||
      reverse.isPending ||
      reversePayment.isPending ||
      close.isPending,
  };
}

/* ------------------------------------------------------------------ */
/*  Category management                                                */
/* ------------------------------------------------------------------ */

export function useExpenseCategoryMutations() {
  const client = useQueryClient();
  const { lang } = useI18n();
  const ar = lang === "ar";

  const save = useMutation({
    mutationFn: async (input: {
      id?: string | null;
      name?: string;
      name_ar?: string | null;
      sort_order?: number;
      notes?: string | null;
      is_active?: boolean;
    }) => {
      const { data, error } = await (supabase as any).rpc("save_expense_category", {
        p_id: input.id ?? null,
        p_name: input.name ?? null,
        p_name_ar: input.name_ar ?? null,
        p_sort_order: input.sort_order ?? null,
        p_notes: input.notes ?? null,
        p_is_active: input.is_active ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      void client.invalidateQueries({ queryKey: expenseKeys.lookups() });
      void client.invalidateQueries({ queryKey: expenseKeys.all });
      toast.success(
        variables.id
          ? ar
            ? "تم تحديث التصنيف"
            : "Category updated"
          : ar
            ? "تم إنشاء التصنيف"
            : "Category created",
      );
    },
    onError: (error) => toast.error(describeExpenseError(error, lang)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await (supabase as any).rpc("delete_expense_category", {
        p_id: id,
      });
      if (error) throw error;
      return data as { is_active: boolean; name: string };
    },
    onSuccess: (row) => {
      void client.invalidateQueries({ queryKey: expenseKeys.lookups() });
      // The server archives instead of deleting when the category is in use;
      // saying so is the difference between "why is it still there?" and a
      // message that explains the rule.
      toast.success(
        row?.is_active === false
          ? ar
            ? "التصنيف مستخدم في مصروفات، فتمت أرشفته بدل حذفه"
            : "The category is used by expenses, so it was archived instead of deleted"
          : ar
            ? "تم حذف التصنيف"
            : "Category deleted",
      );
    },
    onError: (error) => toast.error(describeExpenseError(error, lang)),
  });

  return { save, remove, isBusy: save.isPending || remove.isPending };
}
/* ------------------------------------------------------------------ */
/*  Realtime                                                           */
/* ------------------------------------------------------------------ */

/**
 * Live updates for the expense register.
 *
 * Deliberately narrow, for three reasons the plan calls out (§19):
 *
 *  1. `postgres_changes` on `expense_entries` sends the whole row. A document
 *     row is a few hundred bytes, so a busy register would waste bandwidth, and
 *     Postgres Realtime has no way to send a filtered projection. The listener
 *     therefore does NOT merge the payload into the list.
 *
 *  2. The list rows carry joined display names (`supplier_name`,
 *     `primary_category`) that the realtime payload does not contain. Merging a
 *     bare row into a page would blank those columns until the next refetch —
 *     the classic "the row went grey after someone else edited it" bug.
 *
 *  3. Instead, an event invalidates the list and the summary and lets TanStack
 *     refetch the affected keys. That costs one request per burst of changes
 *     and is always correct.
 *
 * The invalidations are coalesced over a short window: approving twelve
 * documents in a row should produce one refetch, not twelve.
 */
export function useExpenseRealtime(enabled = true) {
  const client = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against a reconnect delivering the events that arrived while the
  // socket was down. Without it, a flaky connection means repeated refetches.
  const lastFlush = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;

    // A per-mount channel name. Supabase rejects two subscriptions with the same
    // topic, so a fixed name would break the second component that mounts a
    // list (e.g. a drawer opened over the register).
    const channel = supabase
      .channel(`expense-register-${Math.random().toString(36).slice(2, 9)}`)
      .on(
        "postgres_changes" as never,
        { event: "*", schema: "public", table: "expense_entries" } as never,
        () => {
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            lastFlush.current = Date.now();
            void client.invalidateQueries({ queryKey: expenseKeys.all });
          }, 400);
        },
      )
      .subscribe();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [client, enabled]);

  /**
   * Force a refresh after a reconnect. TanStack's own refetch-on-reconnect
   * covers the query data, but a change that happened while the socket was down
   * produces no event at all, so the register can be stale for as long as the
   * user stares at it.
   */
  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: expenseKeys.all });
  }, [client]);

  return { refresh, lastFlushedAt: lastFlush };
}

/* ------------------------------------------------------------------ */
/*  Defaults                                                           */
/* ------------------------------------------------------------------ */

/** The default window for the register: the current month, which is the period
 *  an operator almost always wants, and which keeps the first load cheap. */
export function useDefaultExpenseWindow() {
  return useMemo(() => ({ from: startOfMonth(), to: today() }), []);
}

export { EMPTY_EXPENSE_FILTERS };
export type { ExpenseListFilters };
export type {
  ExpenseDetail,
  ExpenseEntry,
  ExpenseLookups,
  ExpensePaymentState,
  ExpenseReportGroupBy,
  ExpenseReportRow,
  ExpenseStatus,
  ExpenseSummary,
};
