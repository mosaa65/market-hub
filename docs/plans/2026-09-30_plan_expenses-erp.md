# Expense Management Module — ERP Implementation Plan
> **Status:** Planning only. No application code, migration, RPC, or UI has been modified by this plan.
>
> **Repository examined:** `h:\em\market-hub` (Market-Hub / Vortex ERP)
>
> **Evidence convention:** `Existing` is verified in the repository; `Proposed` is the target design; `Needs Investigation` requires confirmation before implementation; `Needs Migration` requires an additive database migration and backfill strategy.

## 1. Executive Summary
Market-Hub currently has a small operational expense feature, not an ERP Expense Management module. The verified implementation is centered on `public.expenses` and `public.expense_categories`, rendered inside `src/routes/_app.finance.tsx`. A row stores one amount, category, payment method, date, note, creator, and timestamps. Authenticated staff can directly insert, update, and delete rows. There is no expense status, approval, posting, independent payment ledger, attachment, employee/payee, recurring rule, cost-center, branch, tax-line, GL account, or immutable accounting document.

The current accounting screens derive figures in the browser from operational tables. `src/routes/_app.daily-journal.tsx`, `_app.trial-balance.tsx`, `_app.income-statement.tsx`, `_app.balance-sheet.tsx`, `_app.dashboard.tsx`, and `_app.analytics.tsx` load rows and aggregate in JavaScript. `src/lib/statements/adapters/cash.ts` treats every expense amount as a cash credit regardless of payment account. The repository explicitly documents that there are no `chart_of_accounts`, `journal_entries`, or `general_ledger` tables (`docs/plans/enterprise-erp-roadmap.md`).

The safe target is an additive, native module: retain legacy data and route compatibility; introduce a normalized expense document model, controlled lifecycle, separate payments, accounting mappings, server-side queries/aggregations, database-enforced authorization, and a staged compatibility bridge. Do not change the framework or replace the existing design system.

### Decisions and boundaries
- **Existing:** React 19 + TypeScript, TanStack Router/Query, Supabase/PostgreSQL, Radix-based UI, RTL/i18n, module guards, audit log table, generic realtime helpers.
- **Existing but partial:** finance page, expense category master, cash statement adapter, basic reports, roles, audit trail.
- **Not present:** true company/tenant key on the operational expense rows; branch/cost-center/department/project master; HR/payroll; GL tables; expense-specific RPCs; storage attachment policies; expense realtime subscription; approval model.
- **Proposed:** evolve expenses additively into a document/line/payment workflow and integrate with accounting only after the accounting foundation is explicit.
- **Needs Investigation:** actual deployed schema versus the checked-in reference, Supabase Realtime publication settings, Storage buckets, tenant isolation model, and whether external consumers depend on direct `expenses` writes.

## 2. Current Architecture Analysis
### Application and data flow
- `src/router.tsx` creates the TanStack Query client with retry/cache defaults; `src/routes/__root.tsx` provides it.
- `src/routes/_app.tsx` gates authenticated application layout; `src/components/app-shell.tsx` supplies navigation and role-aware menu entries.
- `src/lib/modules.tsx` defines `expenses` at `/finance`, and `advanced_accounting` depends on `expenses`; `ModuleGuard` is a UI feature gate, not a database security boundary.
- Supabase is accessed directly from route components through `src/integrations/supabase/client`. Existing patterns are mixed: some screens use TanStack Query (`_app.products.tsx`, `_app.warehouses.tsx`, `_app.analytics.tsx`), while finance and several reports use `useEffect` plus local state.
- `src/lib/realtime.ts` provides `useRealtimeTable` and cache update helpers, but no current expense caller was found. The helper subscribes by table without an explicit tenant/branch filter; this must not be reused unchanged for sensitive multi-tenant expense data.
- Shared UI is in `src/components/ui/*`, `src/components/vortex-ui/*`, `PageHeader`, `DataTable`, `VortexStreamingTable`, `VortexFilterSheet`, `VortexDrawerDialog`, and statement/report shells. Reuse these components.

### Relevant operational domains
| Domain | Verified implementation | Expense impact |
|---|---|---|
| Users/roles | `profiles`, `user_roles`, enum `app_role` (`owner`, `manager`, `accountant`, `cashier`, `warehouse`); `is_staff` and `has_role` functions | Approval/post/payment capabilities need explicit server-side role matrix. |
| Company | `company_settings`, plus newer `company_items`/`company_id` concepts for inventory policies | Expense tenant key is not verified on legacy expenses; do not assume `company_id=1` is a safe tenant model. |
| Locations | `warehouses` with `name`, `code`, `address`, active/default flags | Branch/warehouse can be proposed as an optional scope only after business meaning is confirmed. |
| Suppliers | `suppliers` with balance; purchase invoices store supplier/warehouse and a bundled `paid` amount | Supplier expense and invoice payment must remain distinct until a payable model exists. |
| Employees | `profiles` only; no HR/payroll/employee master detected | Employee reimbursement must use a future-compatible nullable profile/payee reference, not pretend payroll exists. |
| Payments | `customer_payments`; purchase invoices embed `paid`; enum `payment_method` | No generic outgoing-payment table or account ledger exists. Expense payment requires a new normalized model. |
| Accounting | Four report pages synthesize fixed accounts in browser | A real GL foundation must precede authoritative posting and reports. |
| Audit | `audit_logs` (`actor_id`, action, entity type/id, JSON payload) with staff insert and owner/manager read policies | Use it for transitions and security events, but avoid client-authored audit facts for financial posting. |
| Notifications | `src/routes/_app.notifications.tsx`; no verified expense workflow notification pipeline | Approval notifications are a later integration, not a prerequisite for transactional correctness. |
| Inventory | purchase/stock RPC engines and `stock_movements`; non-stock services are explicitly supported | Expense documents must not create inventory movement unless an explicit future asset/inventory integration is designed. |

## 3. Current Expense System Analysis
### Database: existing
Created in `supabase/migrations/20260622160803_dab210bc-01da-4e25-9dd9-a572bfd9a606.sql`:

- `expense_categories`: `id uuid PK`, `name text NOT NULL UNIQUE`, `name_ar text`, `created_at timestamptz`.
- `expenses`: `id uuid PK`, nullable `category_id` FK to categories `ON DELETE SET NULL`, `amount numeric NOT NULL CHECK (amount >= 0)`, `payment_method payment_method NOT NULL DEFAULT 'cash'`, `expense_date date NOT NULL DEFAULT CURRENT_DATE`, nullable `note`, nullable `created_by` FK `auth.users` with `ON DELETE SET NULL`, timestamps.
- Grants give authenticated direct `SELECT/INSERT/UPDATE/DELETE`; service role gets all.
- RLS policies ``staff read expenses`, `staff write expenses`, and corresponding category policies use `is_staff(auth.uid())` for both read/write. There is no expense-specific owner/accountant approval policy, tenant predicate, branch predicate, amount limit, status check, duplicate prevention, or posting lock. Trigger `tg_expenses_updated` calls `tg_set_updated_at()`.
- The same migration seeds only `Rent`, `Salaries`, `Utilities`, `Transport`, `Marketing`, `Other`; categories are data, not hard-coded in the UI.
- The checked-in `docs/database/schema-reference.md` documents the same columns and lists 39 tables; it is useful evidence but must be reconciled with the deployed schema before migration.
- `payment_method` is currently `cash`, `card`, `bank_transfer`, `credit` in the original enum; later migrations/seeds reference `mobile_money` and split tender work. The final deployed enum must be confirmed before using values.
- No expense index beyond primary key, category unique constraint, and implicit FK/index behavior was found in the expense creation migration. Date/status/report indexes are therefore missing.

### Frontend: existing
`src/routes/_app.finance.tsx` is the only dedicated expense UI found:
- route `/finance`, title “Finance — Vortex ERP”, wrapped in `ModuleGuard moduleId="expenses"`;
- loads all sales, all purchase invoices, the latest 100 expenses, all categories, and limited customer/supplier balances in `load()` using `Promise.all`; only expenses have `.limit(100)`, and summary totals are computed client-side;
- creates expenses with a direct `.from("expenses").insert()` payload; validates only category and amount in the browser;
- deletes directly with `.from("expenses").delete().eq("id", id)` after a browser `confirm()`;
- no edit flow, view/detail route, server pagination, search, filter, status, approval, payment history, attachment, form schema, field-level errors, or permission-aware action policy;
- has loading only at initial state implicitly (no expense skeleton/error state), an empty table state, toast success/error, RTL labels through i18n, and responsive grid/table classes;
- uses shared `PageHeader`, Radix `Card`, `Tabs`, `Dialog`, `Select`, `Input`, `Textarea`, `Table`, `Badge`, and Lucide icons.

### Business logic and indirect consumers
- `src/lib/statements/adapters/cash.ts` reads `expenses` and converts each amount into a cash credit. It does not distinguish unpaid, partial, bank, card, or reversal and loads the complete source set.
- `_app.daily-journal.tsx` builds a synthetic expense debit to “Expense” and credit to “Cash Fund” from `created_at`, not a persisted journal entry and not the user-selected `expense_date` for filtering (it filters `created_at`).
- `_app.income-statement.tsx` sums every `expenses.amount` by `created_at`; it has no status/posting/account/date semantics.
- `_app.trial-balance.tsx` loads all expense amounts and inserts fixed account `5020`; the report is not a database trial balance and its balancing is a derived calculation.
- `_app.balance-sheet.tsx`, `_app.dashboard.tsx`, `_app.analytics.tsx`, and `_app.reports.tsx` also derive totals in JavaScript. `analytics` groups rows by day/category in the browser.
- `src/lib/statements/` has operational report/adaptor architecture and explicitly describes cash as derived from `customer_payments`, `purchase_invoices.paid`, and `expenses`; `src/lib/statements/adapters/index.ts` is the registry. A dedicated expenses adapter is **not present** (the earlier plan mentions one but no file exists).
- Seeds `docs/seed/yemen_stationery_seed.sql` and `docs/seed/yemen_grocery_seed.sql` insert legacy categories/expenses directly. Migration `20260912111000_reset_for_meters_shop.sql` truncates expenses/categories in a reset scenario; this is not a production migration strategy.

## 4. Existing Files / Tables / RPCs / Policies
### Direct expense evidence
| Kind | Source | Finding |
|---|---|---|
| Migration | `supabase/migrations/20260622160803_dab210bc-01da-4e25-9dd9-a572bfd9a606.sql` | Tables, grants, RLS, trigger, seed categories. |
| Route | `src/routes/_app.finance.tsx` | CRUD-like direct insert/delete, summary, table/dialog. |
| Route tree | `src/routeTree.gen.ts` | Generated `/finance` route; regenerate only if routing changes. |
| Module | `src/lib/modules.tsx` | `expenses` module and `/finance`; advanced accounting depends on it. |
| Navigation | `src/components/app-shell.tsx`, `src/components/command-palette.tsx` | Existing Finance navigation and role/menu integration. |
| Cash | `src/lib/statements/adapters/cash.ts` | Expense included as outgoing cash. |
| Reports | `_app.daily-journal.tsx`, `_app.trial-balance.tsx`, `_app.income-statement.tsx`, `_app.balance-sheet.tsx`, `_app.dashboard.tsx`, `_app.analytics.tsx`, `_app.reports.tsx` | Direct reads and client aggregation. |
| Audit | `supabase/migrations/20260623200000_c0894987-2870-4b25-9dd9-a572bfd9a606.sql` and `src/routes/_app.audit.tsx` | Generic audit infrastructure exists. |
| RPC | Expense-specific RPC search across `supabase/migrations/*.sql` | **Not present currently.** Existing transactional RPC style is visible in `create_sale`, `create_purchase`, return/transfer engines. |
| Realtime | `src/lib/realtime.ts` | Generic helper exists; no expense subscription found. Database publication/storage configuration not found in migrations. |

### Related current schema and capabilities
`profiles`, `user_roles`, `company_settings`, `warehouses`, `customers`, `suppliers`, `sales_invoices`, `purchase_invoices`, `customer_payments`, `inventory`, `stock_movements`, `audit_logs`, `platform_modules`, `platform_plans`, and `tenant_subscriptions` exist per the schema reference/migrations. There are no verified `branches`, `departments`, `cost_centers`, `projects`, `employees`, `payroll`, `chart_of_accounts`, `journal_entries`, `journal_lines`, `cash_accounts`, `bank_accounts`, `expense_payments`, `expense_approvals`, `expense_attachments`, or `recurring_expense_rules` tables.

## 5. Problems & Gaps
1. **Financial state is conflated:** one row means expense recognition and payment, even for `credit`; payment method is not an independent event.
2. **No lifecycle:** direct writes permit changing/deleting a posted financial fact; no draft/submitted/approved/posted/paid/reversed state.
3. **No accounting source of truth:** reports synthesize fixed accounts in React; no balanced persisted journal and no idempotent posting key.
4. **No tenant/branch isolation proven:** `is_staff` is broad. Tenant subscriptions use `tenant_id = 'default'` in client code, while newer inventory has company concepts. This is a critical security investigation.
5. **Unbounded reads:** finance summaries, dashboard, reports, cash statements, and accounting screens load rows to the browser; this cannot scale to 100K–1M records.
6. **Incorrect cash semantics:** all expenses reduce cash even when credit, bank, card, unpaid, partially paid, or reversed.
7. **Date semantics are inconsistent:** `expense_date` versus `created_at` is not defined as occurrence/posting/payment date.
8. **No line allocation:** a single amount cannot allocate multiple categories, taxes, or cost centers.
9. **No attachments, approval history, recurring generation, employee reimbursement, supplier payable relation, or tax abstraction.
10. **Realtime is incomplete:** generic subscription has no row-level scope and current finance uses manual reload.
11. **Error and concurrency gaps:** direct insert/delete and browser confirmation permit races, retries, duplicate actions, and stale state.
12. **Audit is not guaranteed:** client direct writes do not atomically write an audit event.

## 6. Target Expense Architecture
Adopt a layered design without replacing the app:
1. **Master data:** categories with accounting defaults and active/archive semantics; optional payees and future dimensions.
2. **Expense document:** header plus lines; status and dates; immutable snapshot values at posting.
3. **Workflow:** server-owned transition RPCs with role/amount/policy checks and approval history.
4. **Payments:** separate outgoing payment records, allocation, account/source, and idempotency key.
5. **Accounting:** explicit chart of accounts and journal tables, or a formally approved integration with an existing future ledger. Expense posting is one balanced transaction; payment is a separate balanced transaction.
6. **Read model/reporting:** SQL/RPC summaries with keyset/offset pagination and narrow projections; frontend never fetches all rows.
7. **Events:** audit rows and narrowly scoped Realtime invalidation; no client trust for financial state.

### Recommended document model
Use `expense_entries` + `expense_lines`, not a single expanded `expenses` row. A header supports supplier/payee, document number, notes, dates, workflow and totals; lines support multiple allocations and category/account/cost center/tax snapshots. Retain `expenses` as a legacy compatibility source during migration; do not rename/drop it initially. A view or adapter can expose legacy rows as a simple one-line document.

## 7. Functional Requirements
### MVP (must be implemented first)
- tenant-safe category master with active/archive, bilingual names, default expense account, default tax policy/dimension references;
- create draft, edit draft, submit, approve/reject, post, cancel; direct destructive delete disabled after submission;
- one or many lines, exact decimal totals, validation, expense date, posting date, due date;
- separate unpaid/partial/paid calculation from payment allocations;
- payment account abstraction (cash/bank/other) only where an account is configured;
- server-side list, count, summary, filters, search, sorting and report aggregation;
- audit history, role matrix, database policies, idempotency and concurrency checks;
- compatibility view/adapter so existing cash/report screens can transition without breaking data.

### Later capability (explicitly phased)
- employee reimbursement after HR/payee ownership is confirmed;
- recurring rules that generate drafts by default;
- attachments using Storage policies;
- multi-step/amount-based approvals;
- tax engine integration; cost centers/projects/department dimensions;
- full GL and financial statements based on persisted journal lines.

## 8. Expense Lifecycle
Proposed states: `draft → submitted → approved → posted → partially_paid → paid → closed`; side states `rejected`, `cancelled`, `reversed`. `posted` means accounting recognition and is immutable in financial fields. `approved` is authorization, not GL recognition. `paid` is derived from allocations, not manually trusted.

| Transition | Actor (proposed) | Preconditions | Effect |
|---|---|---|---|
| Create/update draft | staff permitted to submit | valid lines, positive total, tenant scope | draft only; no GL/cash effect |
| Submit | creator/manager/accountant | complete payee, category/account mapping, evidence rules | freeze ordinary edits; approval event |
| Approve | manager/owner or configured approver | submitted, no self-approval where policy forbids | approved event |
| Reject | approver | submitted | reason required; editable back to draft or terminal policy |
| Post | accountant/owner | approved, balanced mapping, open period, not already posted | one idempotent journal; immutable financial snapshot |
| Record payment | cashier/accountant/owner | posted, amount <= remaining, valid account, unique idempotency key | payment journal, remaining balance recalculated |
| Cancel | authorized manager before post; restricted after post | reason required | no deletion; audit event |
| Reverse | accountant/owner | posted, no unsafe dependent state | compensating journal; original remains immutable |
| Close | system/authorized accountant | posted and fully paid or approved write-off | terminal operational state |

The exact role matrix and approval thresholds are `Needs Investigation`; existing roles do not include a dedicated approver/poster/payment role. Do not rely on UI hiding.

## 9. Database Design
### Proposed tables (additive; exact names/types to be finalized after schema/tenant validation)
| Table | Purpose and key fields | Constraints/indexes/RLS |
|---|---|---|
| `expense_categories` (extend) | Existing id/name_ar; add active/archive, parent if needed, default account, default tax/dimension, tenant scope | unique name per tenant; no hard delete when referenced; tenant + active index; manager/owner manage, staff read. |
| `expense_entries` | `id`, tenant/company scope, reference/number, type, status, expense_date, posting_date, due_date, payee/supplier/profile refs, subtotal/tax/total, paid/remaining derived/cache, note, created/submitted/posted/reversed metadata, version | positive totals; status transition constraints enforced by RPC; unique `(tenant, reference)`; indexes `(tenant,status,expense_date desc)`, `(tenant,created_at desc,id)`, payee/category dimensions. |
| `expense_lines` | entry id, line no, description, category id, account id, quantity, unit price, net/tax/gross, tax reference, branch/warehouse/cost-center/project refs, snapshots | positive/valid numeric checks; unique `(entry_id,line_no)`; FK restrict/reference policy; entry tenant consistency. |
| `expense_payments` | entry id, payment reference, amount, payment_date, account/source, method, note, idempotency key, actor, reversal link | amount > 0; unique `(tenant,idempotency_key)`; no sum over total; index entry/date/account; payment transition only through atomic RPC. |
| `expense_approvals` | entry, sequence, approver, action, from/to status, reason, timestamp | append-only; unique transition token; tenant-safe read; no client update/delete. |
| `expense_attachments` | entry/line, storage path, original name, MIME, size, hash, uploader, timestamps | FK; unique path/hash policy; private bucket and signed URLs; tenant path prefix; size/MIME checks in app and server. |
| `recurring_expense_rules` | template lines, frequency, next run, end, default status, active, last generated entry | unique run key `(rule_id,period)`; service/cron authorization; generate draft by default. |
| `expense_account_mappings` (or category columns) | tenant/category/type/tax/dimension to GL account defaults with effective dates | unique scoped mapping; never infer GL account from display category alone. |
| `chart_of_accounts`, `journal_entries`, `journal_lines` | only if approved as the canonical ledger foundation | account normal balance/type; journal balanced constraint via RPC; unique source key `(source_type,source_id,entry_kind)`; tenant/date indexes. |

**Not recommended in MVP:** separate `expense_types` table if a controlled enum/reference table is sufficient; a generic dimensions framework before branch/cost-center ownership is confirmed; a full tax engine. Use nullable references and a small tax abstraction.

### Legacy migration shape
Add `legacy_expense_id` to the new header or a mapping table, create one line per legacy row, map `payment_method` to an opening payment only where business confirmation says every existing row was paid, preserve original dates/amount/notes/creator, and mark migrated records with audit metadata. Never silently interpret `credit` as paid cash. Keep legacy reads until reconciliation passes.

## 10. Accounting Integration
Current state: **no persisted Chart of Accounts/GL/Journal tables**; fixed labels `1010`, `1020`, `1030`, `2010`, `4010`, `5010`, `5020` are assembled in `_app.trial-balance.tsx` and `_app.daily-journal.tsx`. Therefore the target must not claim current GL integration.

Proposed posting rules:
- At **Posting**: debit each expense line's mapped expense/asset/prepaid account for net/tax treatment; credit an accrued payable or selected payment account for the payable/paid portion. If immediately paid, credit cash/bank/card liability. Tax input account is a separate debit/credit according to the approved tax policy.
- At **Payment**: debit payable/employee liability and credit the selected cash/bank/other account. For an expense already paid at posting, this second entry is not duplicated.
- `expense_date` = economic occurrence; `posting_date` = ledger period; `due_date` = payable due date; `payment_date` = settlement date. Period locks must govern posting/reversal.
- Use source idempotency keys, a unique journal source constraint, a database transaction, and debit=credit validation. Reversal creates compensating lines and never mutates the original journal.
- P&L includes posted expense accounts only; cash/bank changes only on payment; unpaid expenses affect liabilities; cancelled drafts have no impact; reversed postings negate through the reversal journal.
- Category is a user-facing classification; it maps to an account, but must not be the GL account unless an explicit design review approves that simplification.

Until GL tables exist, keep legacy reports clearly labeled operational/derived and do not mix newly posted journals into old browser-calculated totals without a reconciliation layer.

## 11. Payment Design
Separate payment from expense. Support `unpaid`, `partially_paid`, `paid` as derived states. A payment has its own date, method, source account, amount, reference, actor, reversal/idempotency metadata. `payment_method` alone is insufficient for the account balance.

The repository has no generic cash/bank account master. **Proposed:** introduce a minimal `financial_accounts`/`payment_accounts` abstraction only after confirming whether future accounting tables will own those accounts. Seed Cash and Bank only as configured tenant accounts, not global assumptions. `credit` should create a payable, not cash outflow. Do not use `expenses.amount` in the cash adapter after migration except for legacy rows explicitly reconciled.

## 12. Employee Expenses
HR/payroll/employee master is **not present**; only `profiles` exists. Phase 1 should allow a nullable `payee_type` and `payee_profile_id` only if a profile can legitimately represent an employee. Employee reimbursement flow is proposed for a later phase: employee submits → approval → post debit expense / credit employee liability → payment debits liability / credits cash. Do not update payroll balances or create employee liabilities until HR ownership and RLS are defined.

## 13. Recurring Expenses
`recurring_expense_rules` is **not present**. Add in a later phase with frequency/time zone, template, next-run and unique period key. A scheduled server-side job/Edge Function should generate **draft** expenses by default, audit the run, and let normal approval/posting occur. Auto-post only after explicit policy, account mapping, period-lock, notification and failure-retry controls exist. Never generate directly from a browser mount.

## 14. Taxes
Current evidence is a global `company_settings.tax_rate` and tax fields on sales/purchase data; no expense tax table/engine was found. MVP: nullable tax rate/code and line-level computed tax with a snapshot, plus a clear “tax not configured” path. Later map tax code to input tax accounts and jurisdiction rules. Do not build a complete tax engine in this module.

## 15. Cost Centers
`branch`, `department`, `cost_centers`, and `projects` are **not verified**. `warehouses` exist but are inventory locations, not automatically departments/cost centers. Add nullable dimensions only with tenant-safe FK ownership and line/header allocation rules. A default may be suggested from warehouse/category, but posting must preserve the selected snapshot. Do not overload warehouse as branch without business confirmation.

## 16. Attachments
No expense attachment table or Storage policy was found. Proposed private Supabase Storage bucket with path `{tenant}/{expense_id}/{uuid}`, DB metadata, signed read URLs, server checks for MIME/size/count, randomized names, and no public URLs. Storage object policies must validate tenant ownership through metadata/path or an RPC. Upload after draft creation, delete only while editable, retain immutable attachments for posted records according to retention policy. Virus scanning/content inspection is `Needs Investigation` if required by deployment.

## 17. Approval Workflow
Start with one approval step: submitter cannot approve own expense (unless owner policy explicitly permits), manager/owner approves, accountant posts. Add amount/category/branch rules later in a versioned policy table. Every action requires expected status/version and writes `expense_approvals` plus `audit_logs` atomically. Rejection requires reason. Notifications can be added after transactional workflow; they must not determine authorization.

## 18. Security & RLS
Current RLS is staff-wide (`is_staff`) and does not provide proven company/branch isolation. This is a release blocker for an ERP module. Before implementation:
1. reconcile deployed tenant model and all FK scopes;
2. add a non-null tenant/company key through a safe backfill if multi-tenant operation is required;
3. make every expense child row inherit/check the same scope;
4. define policies for read, create draft, transition, post, pay, category manage, attachment read/write;
5. enforce role/capability checks inside SECURITY DEFINER RPCs with fixed `search_path`, explicit `GRANT EXECUTE`, and no broad direct DML for sensitive tables;
6. keep UI `ModuleGuard`, navigation `allowedRoles`, and `isModuleEnabled` as UX only;
7. ensure audit readers cannot alter audit records; use server-side actor identity.

Proposed capabilities: `expense.view`, `expense.create`, `expense.submit`, `expense.approve`, `expense.post`, `expense.pay`, `expense.reverse`, `expense.category.manage`, `expense.report`. Map existing roles initially, then migrate to explicit permissions if the existing permissions model supports it.

## 19. Realtime Architecture
Enable Realtime only for `expense_entries` and (where needed) approvals/payments after publication and RLS behavior are verified. Subscribe only for the current authenticated tenant and permitted workflow scope; never a global table stream. Payloads should be minimal; sensitive attachment data is not broadcast.

Use `useRealtimeTable` only after adding a filter-capable, tenant-safe variant. For a mutation response, update/invalidate the specific detail/list/summary keys; for a Realtime event, invalidate list and aggregate queries rather than blindly inserting a joined row into a filtered page. Use optimistic updates only for safe draft UI, not approval/post/payment. Handle event-before-response with idempotent cache merge, event-after-response with duplicate suppression, reconnect with targeted refetch, and stale version/status conflict with a detail refetch. Counters and summaries should invalidate/refetch from SQL, not be incremented heuristically.

## 20. Performance Architecture
For 100K/500K/1M rows:
- list query returns a narrow projection and page size 25–100; server-side filters for status, category, date, payee, branch, cost center, payment state and search;
- use keyset pagination `(expense_date,id)` for deep/infinite lists; offset may be acceptable for small numbered pages with a count RPC;
- indexes should match tenant-first predicates, e.g. `(tenant_id, expense_date DESC, id DESC)`, `(tenant_id,status,expense_date DESC)`, `(tenant_id,category_id,expense_date DESC)`, and carefully selected trigram/FTS search index after profiling;
- summary/report RPCs use PostgreSQL `SUM`, `COUNT`, `GROUP BY`, filtered aggregates and date buckets; return aggregates, not source rows;
- TanStack Query keys include tenant, filters, page/cursor and report period; debounce search 250–400ms, cancel stale requests, cache reference data, invalidate targeted keys;
- use virtualization only when a large rendered page is necessary; lazy-load detail/attachments and split the expense route if bundle profiling justifies it;
- run `EXPLAIN (ANALYZE, BUFFERS)` on representative data and define p95 targets before release.

Known current scalability defects: `_app.finance.tsx` loads all sales/purchases, reports and dashboard aggregate arrays in the browser; `cash.ts` loads all three movement sources; `_app.income-statement.tsx` may issue one `sales_line_cost` RPC per line. Replace these with server aggregation in the expense/report migration phases, without claiming the old screens are scalable.

## 21. Frontend Architecture
Keep `/finance` as the compatibility entry point initially, but split the large component into existing-style modules only when backend contracts exist:
- `src/routes/_app.finance.tsx`: route shell, guard, query composition;
- `src/components/expenses/*`: list, summary, filters, form sections, detail drawer, status actions;
- `src/hooks/use-expenses.ts`: TanStack queries/mutations and invalidation;
- `src/lib/expenses/*`: types, query keys, validation, status/capability helpers;
- `src/services/*` only if this repository’s service convention is established during implementation; do not add an unnecessary service layer;
- Supabase generated types (if used by current project) must be regenerated after migrations, not hand-widened with `any`.

## 22. UX/UI Design
Reuse `PageHeader`, `Card`, `Table`/`DataTable`, `Badge`, `Dialog`/`Drawer`, `VortexFilterSheet`, existing field and toast patterns, `money`, `useI18n`, and RTL styles. Proposed pages/states:
- **Expenses list:** summary cards (posted period total, awaiting approval, unpaid, paid), debounced search, status/date/category/branch/payee/cost-center/payment filters, server pagination, row actions by capability, skeleton/error/empty/offline states, CSV/export through server query.
- **New expense:** Basic Information, Details/lines, Payment, Accounting (advanced/collapsed), Attachments; category smart defaults; quick expense is a compact draft form that never bypasses policy.
- **Detail drawer/page:** timeline, lines, approval history, payment allocations, audit and attachments; conflict banner when version changed.
- keyboard focus/order, accessible labels, inline validation, clear Arabic/English errors, mobile cards or horizontal scrolling, no raw DB errors, safe confirmation for post/pay/reverse.

## 23. Reporting
Required server-backed reports: summary, by category, branch/warehouse (only if defined), cost center, employee/payee, unpaid, partial, monthly trend, expense versus revenue/profit, and P&L impact. Each report needs tenant/date filters, timezone/date semantics, RLS, bounded export and SQL aggregation. Expose `get_expense_summary` and `get_expense_report` only when they deliver a stable performance/security boundary; otherwise use parameterized views/queries through the data layer. Existing pages must be migrated one at a time and label legacy derived results until reconciled.

## 24. Migration Strategy
1. Snapshot and reconcile production schema, row counts, null categories, enum values, payment meanings, and tenant ownership. No destructive reset migration is acceptable for production.
2. Add new tables/enums/indexes/policies with nullable legacy mapping; deploy backward compatible.
3. Backfill categories and headers/lines in batches; preserve UUID/reference/date/amount/note/creator; record mapping and errors.
4. Reconcile row count, amount by day/category, orphan categories, and payment interpretation. Obtain business sign-off for whether legacy rows are posted/paid.
5. Introduce compatibility read view/adapter and switch reports behind a feature flag.
6. Route all new writes through RPC; temporarily keep legacy writes only in a controlled compatibility path with audit and deprecation telemetry.
7. Cut over finance UI, then reports/cash; keep old columns/table readable during observation. Do not drop legacy structures until all code/seeds/integrations are migrated and rollback window closes.
8. Rollback means disable feature flag and stop new target writes; do not reverse already valid historical data by destructive deletion. Use compensating migrations for data corrections.

## 25. Testing Strategy
- **Unit:** totals, decimal rounding, status transition matrix, payment remaining amount, tax, date semantics, category defaults, idempotency key generation.
- **Integration:** each RPC transaction, FK/constraints, journal balance, posting/payment/reversal, legacy backfill, report aggregate correctness.
- **RLS:** cross-tenant and cross-branch read/write, role matrix, direct table DML denial, Storage object access, inactive user denial.
- **E2E:** create draft, edit, submit, reject, resubmit, approve, post, unpaid/partial/full pay, cancel, reverse, attachment, filters, RTL/mobile, reconnect.
- **Concurrency:** two approvals, edit while pay, duplicate retries, post twice, pay twice, event before response, reconnect duplicate events; assert one valid transition/payment/journal.
- **Financial integrity:** debit=credit, one source journal, no cash reduction for unpaid, no duplicate P&L, reversal net zero, legacy reconciliation.
- **Performance:** seeded 100K/500K/1M rows, realistic selectivity, p95 list/summary/report, index plans, payload size, memory/rendering; test exports separately.

## 26. Rollout Strategy
Use feature flags/configuration per tenant and a read-only shadow comparison first. Roll out database foundation, then target reads, then draft creation, then workflow/posting/payment, then reports/realtime. Keep legacy `/finance` available as fallback until reconciliation and monitoring pass. Define metrics: RPC errors, transition rejection, duplicate/idempotency conflict, report latency, realtime reconnects, RLS denials, reconciliation difference, and attachment failures. Provide an operational runbook for stuck drafts, failed recurring generation, reversal and rollback.

## 27. Risks & Mitigations
| Risk | Mitigation |
|---|---|
| Wrong tenant scope | Block release until scope is proven; tenant-first RLS tests and backfill. |
| Historical `credit` misread as paid | Business reconciliation; preserve unknown state; do not auto-cash. |
| Duplicate posting/payment | unique source/idempotency keys + atomic RPC + locks/version checks. |
| Breaking old reports | compatibility adapter, feature flag, parallel totals and reconciliation. |
| Overbuilding GL/tax/HR | phase gates and explicit non-goals; no speculative frameworks. |
| Realtime leakage/stale joins | filtered subscriptions, RLS validation, targeted invalidation/refetch. |
| Slow reports | SQL aggregate RPCs, indexes, EXPLAIN/performance fixtures. |
| Attachments expose documents | private bucket, scoped Storage policies, signed URLs, metadata validation. |
| Direct legacy DML remains | revoke sensitive direct grants after cutover; monitor and document migration. |
| Reset migration/data loss | never use `20260912111000_reset_for_meters_shop.sql` pattern in production. |

## 28. File-by-File Change Plan
This is a plan, not executed changes.

### Existing files to modify
| File | Change | Dependencies/risk |
|---|---|---|
| `src/routes/_app.finance.tsx` | Replace local direct CRUD/aggregation with query hooks, paginated list, workflow actions; preserve route/module guard. | Target schema/RPC contracts; high UX regression risk. |
| `src/lib/modules.tsx` | Only update module labels/routes if the final UI adds routes; retain `expenses` dependency model. | Subscription compatibility. |
| `src/components/app-shell.tsx` | Add/rename expense navigation only if approved; retain `/finance` fallback. | Generated route/nav consistency. |
| `src/components/command-palette.tsx` | Add detail/new expense commands only after routes exist. | i18n/route tree. |
| `src/lib/statements/adapters/cash.ts` | Read target payments/posted legacy adapter with correct account/date semantics; stop treating all expense rows as cash. | Must preserve statement tests and legacy reconciliation. |
| `src/lib/statements/adapters/index.ts` | Register expense adapter if a dedicated report is implemented. | Existing report registry behavior. |
| `_app.dashboard.tsx`, `_app.analytics.tsx`, `_app.reports.tsx` | Replace expense client aggregation with summary/report queries. | Requires SQL contracts and response compatibility. |
| `_app.daily-journal.tsx`, `_app.trial-balance.tsx`, `_app.income-statement.tsx`, `_app.balance-sheet.tsx` | Consume persisted journal/report RPCs; retain legacy mode during cutover. | GL dependency; financial correctness risk. |
| `src/lib/realtime.ts` | Add safe filtered/scoped subscription or a dedicated expense hook; do not weaken generic behavior. | Reconnect/cache race tests. |
| `src/lib/query-keys.ts` | Add stable expense list/detail/summary/report keys if this project’s conventions are used. | Invalidation correctness. |
| `src/routes/README.md` / `docs/database/schema-reference.md` | Document final routes/schema/policies after implementation. | Documentation drift. |

### Files to create (proposed, not existing)
`src/components/expenses/expense-list.tsx`, `expense-filters.tsx`, `expense-form.tsx`, `expense-detail.tsx`, `expense-status-badge.tsx`, `src/hooks/use-expenses.ts`, `src/lib/expenses/types.ts`, `query-keys.ts`, `validation.ts`, and tests under the repository’s established test convention. Exact names must be confirmed against implementation conventions before creation; these are proposed only and are not existing files.

### Database files to create (proposed)
Versioned additive migrations under `supabase/migrations/`: foundation/schema; RLS/capabilities; RPC transitions; accounting/payment; backfill; report indexes/RPCs; realtime publication/storage policies. Do not name or apply migrations until deployed-schema inspection and ordering review is complete. No Edge Function is currently required for the MVP; recurring generation may later use `supabase/functions/` after operational scheduling is confirmed.

## 29. Database Migration Plan
- Migration A: enums/reference values and additive tables, checks, FK, tenant placeholders only where validated.
- Migration B: category extensions and mappings; no hard delete; indexes concurrently where deployment process allows.
- Migration C: RLS, helper authorization functions, revoke direct sensitive DML, scoped grants.
- Migration D: transition/payment/posting RPCs and audit/approval append-only constraints.
- Migration E: GL tables and mappings only after accounting design approval.
- Migration F: batched legacy backfill with mapping/audit and validation queries.
- Migration G: report/summary functions, indexes, publication/Storage policies.

Each migration must have preflight queries, postflight checks, transaction/lock assessment, rollback/forward-fix notes, and a staging rehearsal. Avoid dropping/renaming existing columns in the first rollout.

## 30. RPC Plan
Only create RPCs where atomic authorization, transactionality or aggregation justifies them:
- `create_expense_draft`: validates scope, lines/totals, creator, idempotency; returns header/detail.
- `update_expense_draft`: locks/version-checks draft and replaces lines atomically.
- `submit_expense`: validates completeness and appends approval/audit event.
- `approve_expense` / `reject_expense`: checks capability, expected status/version, reason, and self-approval policy.
- `post_expense`: locks document/period, maps accounts, creates exactly one source journal, marks posted, audits.
- `record_expense_payment`: locks entry/account, validates remaining amount and idempotency, inserts payment and journal, derives status.
- `cancel_expense`: atomic pre/post policy and audit; post-cancel uses reversal policy.
- `reverse_expense`: creates compensating journal and immutable reversal link.
- `get_expense_summary`: SQL filtered aggregates for cards.
- `get_expense_report`: parameterized grouped/paginated report contract.

Do not create a separate RPC for ordinary reference reads or category CRUD unless RLS/transactional behavior requires it. All SECURITY DEFINER functions must set a safe search path, derive actor from `auth.uid()`, validate tenant scope, and have least-privilege execute grants.

## 31. Task Breakdown
### Phase 0 — discovery and decisions
0.1 Inspect deployed schema/enums/RLS/publication/Storage and tenant model.
0.2 Confirm legacy payment meaning and accounting acceptance criteria.
0.3 Approve lifecycle, roles, dates, dimensions, tax scope and GL boundary.
0.4 Capture baseline row counts/totals/report outputs and add migration rehearsal fixtures.

### Phase 1 — database foundation
1.1 Add category extensions/mappings.
1.2 Add expense headers/lines/payments/approvals and constraints.
1.3 Add tenant/dimension references only after scope decision.
1.4 Add indexes and safe RLS/grants.
1.5 Add audit transition schema and validation queries.

### Phase 2 — atomic backend
2.1 Implement draft create/update.
2.2 Implement submit/approve/reject/cancel.
2.3 Implement posting and idempotent journal integration.
2.4 Implement payment/partial payment/reversal.
2.5 Add summary/report queries and concurrency tests.

### Phase 3 — migration and compatibility
3.1 Backfill categories and legacy documents/lines.
3.2 Reconcile counts, amounts, dates and payment interpretation.
3.3 Add compatibility adapter/view and feature flag.
3.4 Cut over new writes; monitor legacy reads.

### Phase 4 — frontend/data layer
4.1 Add typed expense query keys/hooks/validation.
4.2 Build list/filter/summary with server pagination.
4.3 Build simple new-expense/quick-expense draft UX.
4.4 Build detail/timeline/action controls and error/conflict states.
4.5 Add category management through existing settings patterns.

### Phase 5 — accounting/payments/reports
5.1 Migrate cash statement semantics.
5.2 Migrate daily journal/trial balance/P&L only after persisted GL/reconciliation.
5.3 Replace dashboard/analytics expense aggregation with SQL summaries.
5.4 Add exports with bounded server queries.

### Phase 6 — realtime and attachments
6.1 Configure publication and scoped subscriptions.
6.2 Integrate cache invalidation/reconnect tests.
6.3 Add private attachments and signed access.

### Phase 7 — optional capabilities
7.1 Employee reimbursement after HR decision.
7.2 Recurring draft generation.
7.3 Cost centers/projects/approval rules/tax mappings.

### Phase 8 — hardening and rollout
8.1 Unit/integration/RLS/E2E/concurrency/financial tests.
8.2 Load test 100K/500K/1M and tune plans.
8.3 Staged rollout, monitoring, reconciliation and legacy deprecation.

## 32. Implementation Order
Dependency graph:
`deployed-schema/tenant decision → lifecycle/accounting decisions → additive DB model → RLS/capabilities → atomic RPCs → backfill/reconciliation → typed data hooks → list/form/detail UI → payment/accounting integration → SQL reports → scoped Realtime → attachments/recurring/employee extensions → load/security/E2E tests → staged rollout`.

Frontend must not depend on unapproved table/RPC names. Reporting must not be switched to “posted” semantics until historical backfill and GL reconciliation are signed off. Realtime must follow RLS and query-key contracts, not precede them.

## 33. Definition of Done
- A user with the correct capability creates and edits a draft; ordinary users cannot bypass the workflow with direct DML.
- Submission, approval, rejection, posting, cancellation and reversal enforce status/version/role rules in PostgreSQL.
- Posted financial fields are immutable; reversal is compensating and audited.
- Payments are separate, support unpaid/partial/paid, are allocated atomically, and cannot double-apply.
- Category defaults/account mappings are configurable and category is not silently treated as a GL account.
- Journal entries, when enabled, are balanced, source-idempotent and correctly affect P&L and cash/bank.
- Legacy data is preserved, backfilled/reconciled, and rollback does not delete valid history.
- RLS proves company/tenant and optional branch isolation; Storage is private and scoped; UI permissions are not the only control.
- List, filters, summaries and reports are server-side and tested at 100K+; no expense screen loads the full table.
- Realtime updates only permitted users, handles reconnect/races/duplicates, and does not full-reload the page.
- RTL/responsive/accessibility/loading/error/empty/conflict UX is complete and uses existing Market-Hub design components.
- Audit history exists for create/submit/approve/reject/post/pay/cancel/reverse and cannot be tampered with by ordinary clients.
- Existing sales, purchases, inventory, customers, suppliers, dashboard, reports, permissions and RLS regression suites pass.
- Monitoring, reconciliation, support runbook and staged rollout gates are in place.

# Recommended Implementation Sequence
1. **Freeze planning decisions and inspect deployed reality** — especially tenant/company isolation, enum values, payment meaning, Storage and Realtime configuration.
2. **Specify lifecycle, role/capability matrix, date semantics and accounting boundary**; obtain finance-owner approval.
3. **Ship additive schema and RLS foundation** for categories, entries, lines, approvals, payments and audit, with indexes and no UI cutover.
4. **Ship atomic transition/payment RPCs** with concurrency, idempotency and financial-integrity tests.
5. **Backfill legacy rows and reconcile** counts, amounts, dates, categories and paid/unpaid interpretation; keep compatibility reads.
6. **Build typed TanStack data layer and server-side list/summary/report contracts.**
7. **Replace the finance UI** with list, filters, simple/quick form, detail timeline and capability-aware lifecycle actions, reusing current UI/i18n/RTL components.
8. **Integrate payments and, only after GL approval, persisted accounting posting**; migrate cash and financial reports behind a feature flag.
9. **Add scoped Realtime** for entries/approvals/payments and targeted TanStack invalidation/refetch.
10. **Add attachments, employee reimbursement, recurring drafts and dimensions** as separately gated phases, not as MVP coupling.
11. **Run full security, RLS, concurrency, financial, E2E and 100K/500K/1M performance suites.**
12. **Roll out per tenant/feature flag, monitor and reconcile; deprecate legacy direct writes only after a documented observation window.**

> **Planning stop condition:** This document is the implementation plan only. No application code, migration, RPC, table, policy, route, or UI was created or modified as part of the planning task.
