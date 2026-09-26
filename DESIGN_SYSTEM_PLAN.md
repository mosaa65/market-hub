# DESIGN SYSTEM PLAN — Market Hub

Derived from `DESIGN_AUDIT.md`. Phases are ordered by **risk × leverage**, not by the template order,
because the audit found that Market Hub's highest-value, lowest-risk win is collapsing the
15 hand-rolled overlays and the 3 duplicated `inputCls` definitions — not restyling colors.

**Standing rules for every phase**
1. `npm run lint` + `npm run build` must be clean before moving on.
2. Affected routes inspected at 360 / 768 / 1280 / 1536 px.
3. No Supabase query, payload key, column name, or business-logic file changes.
4. No `!important`, no layout-hiding `overflow:hidden`, no `scale()` resize hacks.
5. Nothing deleted until `grep` shows zero usages.

---

## Phase 1 — Tokens (P0, additive, zero-risk)

**Goal:** every visual value in the app resolves to a named token, so changing one value changes the system.

**Deliverables**
- `src/styles.css`
  - Keep the existing semantic color set and dark/light split **exactly as-is** (it is good).
  - Add a **control size scale**: `--control-h-sm/md/lg` (32/36/40 → unified to 36/40/44 for touch).
  - Add a **radius scale tied to roles**: `--radius-control`, `--radius-panel`, `--radius-chip`, `--radius-sheet` — mapped from the existing `--radius-sm…2xl` so there is one place to retune.
  - Add **elevation tokens**: `--shadow-control`, `--shadow-panel`, `--shadow-overlay`, `--shadow-popover` (replacing `shadow-sm/xs/2xs/2xl` scatter).
  - Add **motion tokens**: `--duration-fast/normal/slow`, `--ease-standard/emphasized/exit` + `[data-motion="reduce"]` / `prefers-reduced-motion` handling.
  - Add **z-index scale**: `--z-header/dropdown/overlay/modal/toast`.
  - Add **spacing aliases** used by components (`--space-control-x`, `--space-cell-x/y`).
  - Define the missing `--surface-2`, `--surface-3`, `--surface-4` (currently referenced but undefined in `ui/dialog.tsx` → dead classes).
  - Add **tone tokens** for the hard-coded palettes currently scattered in pages (`--tone-info`, `--tone-success`, `--tone-warning`, `--tone-danger`, `--tone-neutral`) in both themes, replacing `emerald-500/10`, `sky-500/10`, `violet-500/10`, `amber-500/15`, `rose-500/15` etc.
  - Add **typography scale** (display/title/section/body/label/caption/mono) with Arabic-aware line heights.
- `src/design/tokens.ts` — JS mirror of the values the JS side needs (durations, control heights, breakpoints, `chartSeries`).
- `src/design/breakpoints.ts` — the 6 documented target widths and a `useBreakpoint()` hook.

**Definition of done:** tokens exist; nothing in the app looks different yet; `styles.css` has no orphan
variable and every variable is consumed.

---

## Phase 2 — Primitive components (P0)

**Order inside the phase:** `Button` → `IconButton` → `Spinner` → `Badge`/`StatusBadge` →
`Input`/`Textarea`/`NumberInput`/`CurrencyInput`/`PercentInput`/`SearchInput` → `Select`/`Checkbox`/`Switch`.

- `Button`: variants `primary | secondary | outline | ghost | danger | success | link`; sizes `xs | sm | md | lg | icon`; `loading` (spinner + `aria-busy`); `asChild`; RTL-safe icon gap; token radius/height/shadow/focus. **Keeps the current variant names** (`default`, `destructive`, …) as aliases so no existing call site breaks.
- `IconButton`: `ariaLabel` **required**, `title` derived, sizes, tones, `Tooltip` wrapper option.
- `Input`: `label`-less primitive + `prefix`/`suffix`/`icon`/`clearable`; `error`/`success`/`hint` props are owned by `FormField`, so `Input` a control; `inputMode` inference for numeric types; **Arab-Indic digit normalization** (`٠١٢٣٤٥٦٧٨٩` and `۰۱۲۳۴۵۶۷۸۹` → ASCII) applied **only** for `number`/`decimal`/`currency`/`percent` and **never** for `text`, `sku`, `barcode`, `phone`, `email`, per audit §6.
- `CurrencyInput`: stores a raw `number`, displays formatted on blur, parses on change, suffix = currency symbol from the existing `company_settings` cache via `money()`. Never mixes stored/displayed values.
- `SearchInput`: icon, clear button, `role="searchbox"`, `aria-label`, debounce prop, `/`-to-focus, `Escape`-to-clear, mobile collapse.
- `StatusBadge`: value→tone map for `is_active`, invoice `status`, payment `status`, stock levels; localized via `useI18n()`.

**Definition of done:** primitives render correctly in dark + light, RTL + LTR, keyboard focus visible,
disabled and loading states present. No page migrated yet.

---

## Phase 3 — Form system (P0)

- `FormField` (label, `required` asterisk from tokens, hint, error, success, `htmlFor`/`aria-describedby`/`aria-invalid` wiring).
- `FormGrid` (`cols`, responsive collapse rules from the audit's actual needs: 3 → 2 → 1, with explicit `span` for wide fields like the fitment picker).
- `FormSection` (identity / pricing / stock / catalog grouping for the product dialog).
- `FormActions` (Cancel + Submit, sticky footer on mobile with safe-area inset, `loading`, RTL order).
- Optional `react-hook-form` bridge — **additive**, so pages using `useState` object forms keep working.

**Definition of done:** a page can express a full dialog with zero long class strings.

---

## Phase 4 — Overlay system (P0) — collapses 15 hand-rolled modals

- `Modal`: one shell with `size` (`sm/md/lg/xl/full`), `title`, `description`, `footer`, `onClose`.
  - **Desktop:** centered dialog, overlay + backdrop blur, zoom-fade entry.
  - **Mobile (`< md`):** bottom sheet (drag handle, `92dvh`, `rounded-t-3xl`) or full-screen when `size="xl"`; safe-area bottom padding.
  - Escape, overlay click, focus trap, focus restore, scroll lock, `role="dialog"`, `aria-modal`, localized `sr-only` close label (Arabic-first).
- `ConfirmDialog`: `tone="danger" | "default"`, i18n copy, async confirm with loading; **replaces every native `confirm()`**.
- `FilterSheet` for mobile filters (Phase 5 consumer).
- Rebase existing dialogs on it: `CatalogModulesDialog`, `RolePermissionsDialog`, `PlanComparisonDialog`, `subscription-settings-card`.

**Definition of done:** `grep -c "fixed inset-0 z-50"` returns 0 in `src/routes/`.

---

## Phase 5 — Search / Filter / Sort (P1)

- `TableToolbar`: `search` + `filters` + `sort` + `primaryAction`, one responsive layout:
  - Desktop: `[Search] [Filter ▾] [Sort ▾] … [Add]`
  - Tablet: same, filter/sort collapse to icon buttons with labels hidden
  - Mobile: `[Search]` full row, then `[Filters] [Sort]` chips; filters open `FilterSheet`.
- `FilterBar` + `ActiveFilters` (removable chips, clear-all, result count).
- `SortMenu` (single-column sort, ↑/↓ indicator, `aria-sort` on the matching header).
- Filters are **client-side and additive** — they never change what is fetched, so no API/DB impact.

**Definition of done:** products / sales / purchases / inventory / customers share one toolbar API.

---

## Phase 6 — DataTable (P1)

- Column-config API: `{ key, header, cell, align, width, sortable, hideBelow, priority, mobile }`.
- Features: sorting, pagination (page size 10/25/50/100 + range label), sticky header, row hover, selection (opt-in), `RowActions` (inline on desktop, overflow menu on mobile), density (`comfortable` default), column visibility (opt-in).
- States: `empty` (`EmptyState`), `loading` (`DataTableSkeleton`), `error` (`ErrorState` with retry).
- **Mobile strategy per data type — not one blanket rule (audit §5, §7, requirement #15):**

| Table | Desktop | Mobile |
| --- | --- | --- |
| Products | Full grid incl. cost (permission-gated) | **Card list**: name + badges, price/stock as key-values, actions in a row menu |
| Customers | Full grid + balance | **Card list**: name + phone + balance badge (balance is the reason users open the page) |
| Suppliers | Full grid | **Card list** |
| Sales (invoices) | Full grid | **Card list**: invoice #, customer, total, status, date |
| Purchases | Full grid | **Card list** |
| Inventory | Full grid | **Primary columns + expand** (product, qty, warehouse) — quantities are comparative, so keeping rows aligned matters more than cards |
| Catalog (makes/models) | Full grid | **Primary columns + expand** |
| Batches | Full grid | **Card list** (expiry is the critical field) |
| Payments / Debts | Full grid | **Card list** |
| Accounting (trial balance, journal, account statement, income statement, balance sheet) | Full grid | **Optimized horizontal scroll** with frozen first column + right-aligned amounts (cards would destroy the debit/credit column relationship) |
| Users / Audit / Settlements | Full grid | **Primary columns + expand** |

This replaces `styles.css`'s global `.overflow-x-auto > table { min-width: 680px }` hack with per-table intent.

**Definition of done:** `grep -c "<table"` in `src/routes/` drops from 13 to 1 (the accounting exception, or 0 if migrated).

---

## Phase 7 — Cards / Lists / Display (P2)

- `Panel` (`tone`, `padding`, `elevated`) converging `.panel` / `.panel-elevated` / `Card`.
- `StatCard` for dashboard KPI + customers balance strip + finance/reports summary rows.
- `DescriptionList` for customer/supplier/invoice/batch detail.
- `Section` (title + description + actions + content) for settings/dashboard/reports.
- Apply the audit's rule: table for tabular, list for lists, card for hierarchy, form for input, dialog for short context, drawer for side context, full-screen for large mobile content.

---

## Phase 8 — Page layouts & domain surfaces (P1/P2)

- `PageHeader` extension: eyebrow, title, subtitle, breadcrumbs, actions; on mobile the primary action becomes a sticky bottom action bar where the page is action-heavy (POS, products, customers).
- `InvoicePreview`: single on-screen preview component for sales/purchases/POS that matches `lib/invoice-print.ts` output; print + PDF paths receive the same data as today (**no logic change**).
- `VehicleFitmentPicker` extracted to `src/components/ds/` and reused by products + catalog.

---

## Phase 9 — Migration (P1, incremental, one page per commit)

Order (= blast radius, smallest first):

1. **products** (the template page — proves every primitive: table, toolbar, dialog, numeric inputs, badges, mobile cards)
2. customers, suppliers (simple CRUD)
3. warehouses, batches, catalog
4. sales, purchases, sales-returns, purchase-returns
5. inventory, transfers, settlements
6. pos dialogs (new customer / service item / post-sale) — **UI shell only, cart logic untouched**
7. payments, debts, account-statement
8. users, audit, notifications, settings
9. accounting tables (scroll-optimized, lowest visual churn)
10. dashboard, analytics, reports (charts + stat cards)

After each page: `grep` the deleted local helpers (`inputCls`, local `Field`, local modal markup) to prove zero usages, then remove them.

---

## Phase 10 — Responsive & motion validation (P2)

- Walk every migrated route at 360 / 390 / 768 / 1024 / 1280 / 1536 / 1920.
- Verify: no unintended horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`), tap targets ≥ 40px on mobile, sticky footers respect safe-area, RTL mirrors correctly.
- Verify motion tokens apply and `prefers-reduced-motion: reduce` disables non-essential transitions.

---

## Phase 11 — Polish (P3)

- Contrast pass on `text-[10px]`/`text-[11px]` micro-badges and muted helper text (target ≥ 4.5:1 for body, ≥ 3:1 for large).
- Unify the 5 radius scales and the 7 shadow scales that remain after migration.
- Replace remaining hard-coded palette colors (`text-sky-500`, `bg-emerald-500/15`, …) with tone tokens — including `app-shell.tsx` nav colors.
- Remove the `.overflow-x-auto > table { min-width: 680px }` global hack.
- Document the system in `src/design/README.md` (tokens, component API, "how to add a page").

---

## Priority summary

| Priority | Items |
| --- | --- |
| **P0** | Tokens, Button, IconButton, Input family, FormField/FormGrid/FormActions, Modal, ConfirmDialog |
| **P1** | SearchInput, Toolbar, DataTable + states + pagination, StatusBadge, EmptyState/LoadingState/ErrorState, page migration of products/customers/suppliers/sales/purchases/inventory |
| **P2** | Filter/Sort, StatCard, DescriptionList, Section, Panel convergence, InvoicePreview, VehicleFitmentPicker, remaining pages |
| **P3** | Contrast, animation language, radius/shadow unification, docs, dead-primitive cleanup |

## Risk register

| Risk | Mitigation |
| --- | --- |
| A page breaks because a Supabase payload key changed | UI refactors are **presentation-only**; payload objects are copied verbatim and reviewed with a diff per page |
| Numeric input normalization corrupts a SKU/barcode/phone | Normalization is opt-in per input type; text-like fields never normalize |
| Modal migration loses a dismissal path users rely on | The unified `Modal` enables *more* paths (Escape + overlay click) and is verified per dialog |
| Two design systems coexist mid-migration | Migration is per page and the lint gate catches leftover local helpers |
| Mobile card mode hides a column a user needs | Every table's mobile mode is specified in Phase 6 and reviewed against the workflow (e.g. inventory keeps row alignment rather than becoming cards) |
| Production data at risk | **No SQL, no migration, no seed, no Supabase client change. See `DATABASE_CHANGE_NOTES.md`.** |
