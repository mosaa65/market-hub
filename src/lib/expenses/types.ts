/**
 * Expense module — shared types.
 *
 * These mirror the SQL contracts in
 * `supabase/migrations/20261001090000_expense_module_foundation.sql` and
 * `..._read_layer.sql` exactly. They are hand-written rather than generated
 * because the project does not commit a generated Supabase type file, and a
 * hand-written type that drifts from the database is worse than none.
 *
 * The rule this file follows: a type is only asserted here if a migration
 * enforces it. `status` is a real Postgres enum, so it is a union here.
 * Anything the database does not actually constrain stays `string | null`.
 */

export type ExpenseStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "POSTED"
  | "PARTIALLY_PAID"
  | "PAID"
  | "CLOSED"
  | "CANCELLED"
  | "REVERSED";

export type ExpenseEntryType = "DIRECT" | "EMPLOYEE" | "SUPPLIER" | "RECURRING" | "ADVANCE";

export type ExpensePayeeType = "NONE" | "SUPPLIER" | "EMPLOYEE" | "OTHER";

export type ExpenseTaxMode = "NONE" | "INCLUSIVE" | "EXCLUSIVE";

export type ExpenseSourceKind = "MANUAL" | "LEGACY" | "RECURRING" | "IMPORT";

/** The three settlement buckets the list can filter by. Derived, never stored. */
export type ExpensePaymentState = "unpaid" | "partial" | "paid";

/** Row shape returned by `public.list_expenses`. */
export interface ExpenseListRow {
  id: string;
  reference: string;
  status: ExpenseStatus;
  entry_type: ExpenseEntryType;
  payee_type: ExpensePayeeType;
  payee_name: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  employee_id: string | null;
  employee_name: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  cost_center_id: string | null;
  cost_center_name: string | null;
  project_id: string | null;
  project_name: string | null;
  expense_date: string;
  due_date: string | null;
  posting_date: string | null;
  description: string | null;
  note: string | null;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  line_count: number;
  primary_category: string | null;
  primary_category_ar: string | null;
  version: number;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  approved_at: string | null;
  posted_at: string | null;
  total_count: number;
  /**
   * Keyset cursor for the next page. Present on every row of the page; the
   * caller reads them from the LAST row. `total_count` is the matching count
   * for the current filters, not the whole register.
   */
  next_cursor_date: string;
  next_cursor_id: string;
}

/** One page plus the cursor needed to ask for the next one. */
export interface ExpensePage {
  rows: ExpenseListRow[];
  /** Cursor to pass back for the following page; null when the register ends. */
  nextCursor: { date: string; id: string } | null;
  totalCount: number;
  /** True when the server returned fewer rows than the page size. */
  isLastPage: boolean;
}

export interface ExpenseLine {
  id: string;
  entry_id: string;
  line_no: number;
  description: string | null;
  category_id: string | null;
  category_name: string | null;
  category_name_ar: string | null;
  quantity: number;
  unit_price: number;
  net_amount: number;
  tax_rate: number;
  tax_amount: number;
  gross_amount: number;
  cost_center_id: string | null;
  cost_center_name: string | null;
  project_id: string | null;
  project_name: string | null;
  note: string | null;
}

export interface ExpensePayment {
  id: string;
  entry_id: string;
  amount: number;
  payment_date: string;
  payment_method: string;
  account_id?: string | null;
  account_label: string | null;
  reference_no: string | null;
  note: string | null;
  idempotency_key: string | null;
  reversed_by: string | null;
  reversal_of: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface ExpenseApproval {
  id: string;
  entry_id: string;
  sequence: number;
  action: string;
  from_status: ExpenseStatus | null;
  to_status: ExpenseStatus;
  actor_id: string | null;
  actor_name: string | null;
  reason: string | null;
  created_at: string;
}

export interface ExpenseAttachment {
  id: string;
  entry_id: string;
  line_id: string | null;
  bucket_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: string;
}

/**
 * Document header as returned inside `expense_detail`.
 *
 * The `can_*` flags are computed by the database, not by this client. That is
 * deliberate: the role matrix lives in `public.expense_can`, and re-deriving it
 * in TypeScript would create a second source of truth that drifts the moment a
 * threshold changes.
 */
export interface ExpenseEntry {
  id: string;
  reference: string;
  entry_type: ExpenseEntryType;
  status: ExpenseStatus;
  source_kind: ExpenseSourceKind;
  payee_type: ExpensePayeeType;
  payee_name: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  employee_id: string | null;
  employee_name: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  cost_center_id: string | null;
  cost_center_name: string | null;
  project_id: string | null;
  project_name: string | null;
  expense_date: string;
  due_date: string | null;
  posting_date: string | null;
  description: string | null;
  note: string | null;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  tax_mode: ExpenseTaxMode;
  currency: string;
  currency_symbol: string;
  line_count: number;
  version: number;
  created_by: string | null;
  created_by_name: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  posted_by: string | null;
  posted_by_name: string | null;
  posted_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  reversal_of: string | null;
  reversed_by_id: string | null;
  legacy_expense_id: string | null;
  created_at: string;
  updated_at: string;

  can_edit: boolean;
  can_submit: boolean;
  can_approve: boolean;
  can_post: boolean;
  can_pay: boolean;
  can_cancel: boolean;
  can_reverse: boolean;
}

export interface ExpenseDetail {
  entry: ExpenseEntry;
  lines: ExpenseLine[];
  payments: ExpensePayment[];
  approvals: ExpenseApproval[];
  attachments: ExpenseAttachment[];
}

/** Shape returned by `public.expense_summary`. */
export interface ExpenseSummary {
  period_total: number;
  posted_total: number;
  paid_total: number;
  outstanding_total: number;
  pending_total: number;
  draft_total: number;
  total_count: number;
  pending_count: number;
  unpaid_count: number;
  partial_count: number;
  paid_count: number;
  draft_count: number;
  overdue_count: number;
  overdue_total: number;
}

export type ExpenseReportGroupBy =
  "category" | "month" | "warehouse" | "cost_center" | "project" | "payee" | "status";

export interface ExpenseReportRow {
  group_key: string;
  label: string;
  label_ar: string;
  entry_count: number;
  total_amount: number;
  paid_amount: number;
  outstanding: number;
}

export interface ExpenseLookupCategory {
  id: string;
  name: string;
  name_ar: string | null;
  is_active: boolean;
  sort_order: number;
  usage_count: number;
}

export interface ExpenseLookups {
  categories: ExpenseLookupCategory[];
  warehouses: { id: string; name: string; name_ar: string | null; is_default: boolean }[];
  cost_centers: { id: string; code: string | null; name: string; name_ar: string | null }[];
  projects: { id: string; code: string | null; name: string; name_ar: string | null }[];
  suppliers: { id: string; name: string }[];
  employees: { id: string; name: string | null }[];
  financial_accounts?: {
    id: string;
    code: string;
    name_ar: string;
    account_type: string;
    requires_reconciliation?: boolean;
  }[];
}

/* ------------------------------------------------------------------ */
/*  Form-side shapes                                                   */
/* ------------------------------------------------------------------ */

/**
 * A line being edited in the form.
 *
 * `quantity` and `unit_price` are held as STRINGS because they are bound to
 * text inputs; the operator types "12." on the way to "12.5" and a number field
 * would swallow the intermediate state. They are parsed once, at submit.
 * `gross` is therefore also a string — it is displayed, not computed.
 */
export interface ExpenseLineDraft {
  /** Stable key for React lists; never sent to the server. */
  key: string;
  description: string;
  category_id: string;
  quantity: string;
  unit_price: string;
  tax_rate: string;
  cost_center_id: string;
  project_id: string;
  note: string;
}

/** The create/update payload's non-line fields. */
export interface ExpenseFormHeader {
  expense_date: string;
  due_date: string;
  entry_type: ExpenseEntryType;
  payee_type: ExpensePayeeType;
  payee_name: string;
  supplier_id: string;
  employee_id: string;
  warehouse_id: string;
  cost_center_id: string;
  project_id: string;
  description: string;
  note: string;
  tax_mode: ExpenseTaxMode;
}

/** A fully populated form. */
export interface ExpenseFormState {
  header: ExpenseFormHeader;
  lines: ExpenseLineDraft[];
}

/** Result of parsing a string amount typed by an operator. */
export type ParsedAmount = { ok: true; value: number } | { ok: false; reason: string };
