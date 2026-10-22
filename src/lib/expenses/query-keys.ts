/**
 * Expense module — query keys, status metadata, and pure helpers.
 *
 * Kept separate from the hooks so a test (or a report screen) can import the
 * key builder and the labels without pulling React or Supabase into scope.
 */

import type {
  ExpenseEntryType,
  ExpensePaymentState,
  ExpenseReportGroupBy,
  ExpenseStatus,
  ExpenseTaxMode,
} from "./types";

/* ------------------------------------------------------------------ */
/*  Cache keys                                                         */
/* ------------------------------------------------------------------ */

/** Filters that participate in the list cache key. */
export interface ExpenseListFilters {
  search: string;
  status: ExpenseStatus[];
  categoryId: string | null;
  warehouseId: string | null;
  costCenterId: string | null;
  projectId: string | null;
  supplierId: string | null;
  employeeId: string | null;
  paymentState: ExpensePaymentState | null;
  dateFrom: string | null;
  dateTo: string | null;
  amountMin: number | null;
  amountMax: number | null;
}

export const EMPTY_EXPENSE_FILTERS: ExpenseListFilters = {
  search: "",
  status: [],
  categoryId: null,
  warehouseId: null,
  costCenterId: null,
  projectId: null,
  supplierId: null,
  employeeId: null,
  paymentState: null,
  dateFrom: null,
  dateTo: null,
  amountMin: null,
  amountMax: null,
};

/**
 * Counts how many filters are actually narrowing the result. The filter button
 * shows this number, and it must not count the defaults — otherwise the badge
 * would read "1" on a freshly opened screen and look broken.
 */
export function activeExpenseFilterCount(filters: ExpenseListFilters): number {
  let count = 0;
  if (filters.search.trim()) count += 1;
  if (filters.status.length) count += 1;
  if (filters.categoryId) count += 1;
  if (filters.warehouseId) count += 1;
  if (filters.costCenterId) count += 1;
  if (filters.projectId) count += 1;
  if (filters.supplierId) count += 1;
  if (filters.employeeId) count += 1;
  if (filters.paymentState) count += 1;
  if (filters.dateFrom) count += 1;
  if (filters.dateTo) count += 1;
  if (filters.amountMin != null) count += 1;
  if (filters.amountMax != null) count += 1;
  return count;
}

/**
 * The list key includes the filters object, so TanStack caches each distinct
 * filter combination separately. `expenses.all` is the prefix used for
 * invalidation after a mutation — one key to invalidate, and every filtered
 * page under it is refreshed.
 */
export const expenseKeys = {
  all: ["expenses"] as const,
  list: (filters: ExpenseListFilters) => ["expenses", "list", filters] as const,
  detail: (id: string) => ["expenses", "detail", id] as const,
  summary: (from: string | null, to: string | null, warehouseId: string | null) =>
    ["expenses", "summary", from, to, warehouseId] as const,
  report: (groupBy: ExpenseReportGroupBy, from: string | null, to: string | null) =>
    ["expenses", "report", groupBy, from, to] as const,
  lookups: () => ["expenses", "lookups"] as const,
  realtime: ["expenses", "realtime"] as const,
};

/* ------------------------------------------------------------------ */
/*  Status metadata                                                    */
/* ------------------------------------------------------------------ */

/** Which tone each status paints with. Drives the badge, not the meaning. */
export type ExpenseStatusTone = "neutral" | "info" | "success" | "warning" | "danger" | "primary";

interface ExpenseStatusMeta {
  tone: ExpenseStatusTone;
  /** Whether the document is financially frozen. Mirrors the SQL guard trigger. */
  immutable: boolean;
  /** i18n key for the label. */
  labelKey: string;
}

export const EXPENSE_STATUS_META: Record<ExpenseStatus, ExpenseStatusMeta> = {
  DRAFT: { tone: "neutral", immutable: false, labelKey: "expenses.status.draft" },
  SUBMITTED: { tone: "info", immutable: false, labelKey: "expenses.status.submitted" },
  APPROVED: { tone: "primary", immutable: false, labelKey: "expenses.status.approved" },
  REJECTED: { tone: "danger", immutable: false, labelKey: "expenses.status.rejected" },
  POSTED: { tone: "warning", immutable: true, labelKey: "expenses.status.posted" },
  PARTIALLY_PAID: { tone: "warning", immutable: true, labelKey: "expenses.status.partially_paid" },
  PAID: { tone: "success", immutable: true, labelKey: "expenses.status.paid" },
  CLOSED: { tone: "success", immutable: true, labelKey: "expenses.status.closed" },
  CANCELLED: { tone: "neutral", immutable: false, labelKey: "expenses.status.cancelled" },
  REVERSED: { tone: "danger", immutable: true, labelKey: "expenses.status.reversed" },
};

/** The order statuses appear in the filter sheet: workflow order, not alphabetical. */
export const EXPENSE_STATUS_ORDER: ExpenseStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "POSTED",
  "PARTIALLY_PAID",
  "PAID",
  "CLOSED",
  "CANCELLED",
  "REVERSED",
];

/** Statuses that mean "still needs someone to do something" — used for the queue tab. */
export const EXPENSE_OPEN_STATUSES: ExpenseStatus[] = ["SUBMITTED", "APPROVED"];

export const EXPENSE_ENTRY_TYPES: ExpenseEntryType[] = [
  "DIRECT",
  "SUPPLIER",
  "EMPLOYEE",
  "RECURRING",
  "ADVANCE",
];

/** Active entry types with verified complete workflows in UI */
export const ACTIVE_EXPENSE_ENTRY_TYPES: ExpenseEntryType[] = ["DIRECT", "SUPPLIER", "EMPLOYEE"];

export const EXPENSE_TAX_MODES: ExpenseTaxMode[] = ["NONE", "INCLUSIVE", "EXCLUSIVE"];

/* ------------------------------------------------------------------ */
/*  Money helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * Rounds to two decimals the same way `public.expense_round` does.
 *
 * Implemented with `Math.round` on a scaled integer rather than
 * `toFixed`, because `(1.005).toFixed(2)` is `"1.00"` in IEEE-754 and an
 * accountant will notice. Guarded against the half-way case by nudging with an
 * epsilon proportional to the value, which is the standard fix.
 */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const scaled = value * 100;
  const epsilon = Math.sign(scaled) * Math.abs(scaled) * Number.EPSILON;
  return Math.round(scaled + epsilon) / 100;
}

/**
 * Parses an amount typed by an operator.
 *
 * Accepts the separators people actually type — `1,250.50`, `1250,50`,
 * Arabic-Indic digits — and rejects anything it cannot read unambiguously
 * rather than silently producing `NaN` (which would post a zero expense).
 */
export function parseAmount(
  raw: string,
): { ok: true; value: number } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "empty" };

  const normalized = toAsciiDigits(trimmed)
    // A comma is a thousands separator when a dot is also present, otherwise it
    // is the decimal mark — the two conventions in common use here.
    .replace(/,/g, trimmed.includes(".") ? "" : ".")
    .replace(/\s/g, "");

  if (!/^-?\d*\.?\d*$/.test(normalized) || normalized === "." || normalized === "-") {
    return { ok: false, reason: "not_a_number" };
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return { ok: false, reason: "not_a_number" };
  if (value < 0) return { ok: false, reason: "negative" };

  return { ok: true, value: roundMoney(value) };
}

/** Arabic-Indic and Extended Arabic-Indic digits → ASCII. */
export function toAsciiDigits(input: string): string {
  return input
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/* ------------------------------------------------------------------ */
/*  Settlement                                                         */
/* ------------------------------------------------------------------ */

/**
 * Mirrors `public.expense_settlement_status`. Used only for optimistic previews
 * and the quick-expense counter — the authoritative value always comes back
 * from the database, and is never written by this function.
 */
export function settlementBucket(paid: number, total: number): ExpensePaymentState {
  if (paid <= 0) return "unpaid";
  if (total > 0 && paid >= total - 0.005) return "paid";
  return "partial";
}

/**
 * Progress of a payment, clamped to 0–100.
 *
 * Clamped because a legacy row or a rounding remainder can make the raw ratio
 * exceed 1, and a progress bar rendered at 103% overflows its track and looks
 * like a bug in the layout rather than the data.
 */
export function paymentProgress(paid: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((paid / total) * 100)));
}

/** True when a posted, unsettled document is past its due date. */
export function isOverdue(
  dueDate: string | null,
  remaining: number,
  status: ExpenseStatus,
): boolean {
  if (!dueDate || remaining <= 0.005) return false;
  if (status !== "POSTED" && status !== "PARTIALLY_PAID") return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${dueDate}T00:00:00`) < today;
}

/* ------------------------------------------------------------------ */
/*  Date helpers                                                       */
/* ------------------------------------------------------------------ */

/** Local `YYYY-MM-DD`. `toISOString()` would shift the day in a positive offset. */
export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function today(): string {
  return toDateInputValue(new Date());
}

/** The first day of the current month — the default reporting window. */
export function startOfMonth(): string {
  const now = new Date();
  return toDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1));
}

export function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}
