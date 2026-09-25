# COMPONENT INVENTORY — Market Hub

Legend:
**Existing** = already in the repo. **Duplicate** = more than one implementation of the same concept.
**Needs Refactor** = exists but must be re-based on tokens / given states.
**New** = does not exist and must be created.
**Used By** = current or planned consumers.

Status: ✅ keep as-is · 🟡 refactor · 🆕 new · ⚠️ unused/dead

---

## A. Primitives (`src/components/ui/*`)

| Component | Existing | Duplicate | Needs Refactor | New | Used By |
| --- | --- | --- | --- | --- | --- |
| `Button` | ✅ `ui/button.tsx` | Duplicate of ~40 raw `<button>` with bespoke classes | 🟡 add sizes `xs/sm/md/lg/icon`, `loading`, `success`/`danger`/`subtle` variants, token radius/height/shadow, `focus-visible` ring | — | every page |
| `IconButton` | — | raw `<button class="grid h-8 w-8 place-items-center rounded-full border …">` | — | 🆕 | products, customers, suppliers, tables, sidebar, header |
| `Input` | ✅ `ui/input.tsx` (shadcn, unused by pages) | `inputCls` ×3, 6 inline copies in `pos.tsx` | 🟡 token-based size scale, prefix/suffix/icon/clear, `error`/`success` states, numeric `inputMode`, Arab-Indic digit normalization | — | all forms |
| `Textarea` | ✅ `ui/textarea.tsx` | — | 🟡 same token treatment | — | notes/descriptions |
| `NumberInput` | — | raw `<input type="number" step="0.01">` | — | 🆕 (`inputMode="decimal"`, sanitize `12abc45`, min/max, step buttons optional) | products (cost/price/tax/min_stock), POS, purchases, payments, inventory adjust |
| `CurrencyInput` | — | raw `<input type="number">` | — | 🆕 (formats with `money()` on blur, stores raw number, currency suffix from `company_settings`) | products, POS, purchases, payments, finance, settlements |
| `PercentInput` | — | raw number | — | 🆕 (tax rate, discount %) | products, POS, purchases |
| `SearchInput` | — | ~12 bespoke search bars | — | 🆕 (icon, clear, debounce, `/` shortcut, `role="searchbox"`, mobile collapse) | products, customers, suppliers, sales, purchases, inventory, catalog, batches, users, audit |
| `Select` | ✅ `ui/select.tsx` (radix) | page `<select className={inputCls}>` | 🟡 align trigger height/radius/focus with `Input`; add `error` state | — | all forms |
| `Combobox` | ⚠️ `ui/command.tsx` exists | — | — | 🆕 (async, for POS product/customer lookup) | POS, payments, transfers |
| `DatePicker` | ⚠️ `ui/calendar.tsx` + `react-day-picker` exist | raw `<input type="date">` | — | 🆕 (localized, RTL aware, range variant) | sales, purchases, audit, account-statement, reports, batches |
| `Checkbox` | ✅ `ui/checkbox.tsx` | inline `<input type="checkbox" className="rounded border-border">` | 🟡 token alignment | — | products (is_active), modules, roles, POS |
| `Switch` | ✅ `ui/switch.tsx` | — | 🟡 token alignment | — | settings, modules |
| `RadioGroup` | ✅ `ui/radio-group.tsx` | — | 🟡 token alignment | — | payment method |
| `Label` | ✅ `ui/label.tsx` | page-local `<span>` labels | 🟡 wire `htmlFor` | — | all forms |
| `Badge` | ✅ `ui/badge.tsx` | ad-hoc pills | 🟡 add tone variants (neutral/success/warning/danger/info/primary) | — | tables, headers |
| `StatusBadge` | — | ~8 hand-rolled status pills | — | 🆕 (maps `is_active`, invoice `status`, payment `status` → tone + label, i18n aware) | products, customers, suppliers, sales, purchases, warehouses, batches, payments |
| `Card` / `Panel` | ✅ `ui/card.tsx` + `.panel` / `.panel-elevated` utilities | both patterns in use simultaneously | 🟡 converge on `Panel` API (`tone`, `padding`, `elevated`) | — | dashboard, all list pages |
| `Skeleton` | ✅ `ui/skeleton.tsx` + `.shimmer` | `.shimmer` divs inline, `Loader2` spinners | 🟡 one component, token duration | — | all data surfaces |
| `Spinner` | — | `Loader2 animate-spin` inline | — | 🆕 | buttons, loading states |
| `Separator` | ✅ `ui/separator.tsx` | `h-px bg-border/60` divs | — | — | footers, toolbars |
| `Tooltip` | ✅ `ui/tooltip.tsx` | hand-built hover tooltips in sidebar + `title=` attributes | 🟡 use for icon-only buttons and truncated cells | — | sidebar rail, table actions |
| `Toast` | ✅ `sonner` via `ui/sonner.tsx` | direct `toast.*` calls (fine) | 🟡 standard `success/error/info` helpers, RTL positioning | — | everywhere |
| `Alert` | ✅ `ui/alert.tsx` | — | 🟡 token tones + i18n | — | forms, module warnings |
| `Progress` | ✅ `ui/progress.tsx` | ad-hoc quota bars | 🟡 token tones | — | plans, uploads |
| Accordion | ✅ `ui/accordion.tsx` | — | — | — | settings sections |
| `ScrollArea` | ✅ `ui/scroll-area.tsx` | `overflow-y-auto custom-scrollbar` | 🟡 one scrollbar language | — | dialogs, pickers |
| Carousel / Resizable / Menubar / ContextMenu / NavigationMenu / AspectRatio / InputOTP / HoverCard / Toggle / ToggleGroup / Breadcrumb / Avatar | ✅ present | — | ⚠️ unused — leave in place, do not delete | — | — |
| `chart.tsx` | ✅ | recharts used directly on dashboard | 🟡 token chart colors | — | dashboard, analytics, reports |

---

## B. Form system (`src/components/forms/*`)

| Component | Existing | Duplicate | Needs Refactor | New | Used By |
| --- | --- | --- | --- | --- | --- |
| `Form` (rhf bridge) | ✅ `ui/form.tsx` (unused) | `useState` object forms ×12 | 🟡 optional adoption — bridge must not force rhf | — | products, customers, suppliers, warehouses, batches, users, settings |
| `FormGrid` | — | `grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3` repeated | — | 🆕 (`cols={1\|2\|3}`, `span` support) | all dialogs |
| `FormSection` | — | `Field className="sm:col-span-2 lg:col-span-3"` | — | 🆕 (title, description, dividers) | products (identity/pricing/stock/catalog), settings |
| `FormField` | 🟡 page-local `Field` ×≥3, `ui/form.tsx` `FormItem` | Yes | 🟡 unify into one `FormField` with `label`, `required`, `hint`, `error`, `success`, `htmlFor`, `aria-describedby` | — | all forms |
| `FormActions` | — | bespoke footer in every dialog | — | 🆕 (Cancel + Submit, sticky on mobile, `loading`, RTL order) | all dialogs |
| Validation messages | — | `toast.error` only | 🟡 inline field errors + summary + i18n keys | — | all forms |
| `FieldHint` / `FieldError` | — | — | — | 🆕 | all forms |

---

## C. Overlay system (`src/components/ui/*` + `ds/*`)

| Component | Existing | Duplicate | Needs Refactor | New | Used By |
| --- | --- | --- | --- | --- | --- |
| `Modal` (responsive shell) | ✅ `ui/dialog.tsx` (+ broken `surface-2` refs) | **15 hand-rolled overlays** in 11 route files | 🟡 one responsive shell: desktop centered dialog, mobile bottom sheet / full-screen; header + scroll body + sticky footer; Escape, overlay click, focus trap, focus restore, scroll lock, safe-area | — | products, pos ×3, purchases ×2, sales, customers ×2, suppliers, warehouses, inventory, batches, catalog, debts, role-permissions |
| `ConfirmDialog` | ✅ `ui/alert-dialog.tsx` | native `confirm()` | 🟡 destructive/normal tones, i18n copy, async `onConfirm` + loading | — | products delete, customers delete, suppliers delete, warehouses, users |
| `Drawer` / `Sheet` | ✅ `ui/sheet.tsx`, `ui/drawer.tsx` (vaul) | — | 🟡 unify with Modal's mobile path; RTL side | — | mobile sidebar, mobile filters |
| `FilterSheet` | — | — | — | 🆕 (filters in a bottom sheet on mobile) | all list pages |
| `PreviewSurface` | — | bespoke invoice/preview overlays | — | 🆕 (print-safe container) | sales, purchases, pos, invoice-print |

---

## D. Data display (`src/components/ds/*`)

| Component | Existing | Duplicate | Needs Refactor | New | Used By |
| --- | --- | --- | --- | --- | --- |
| `DataTable` | ✅ `ui/table.tsx` (primitives) + 12 raw `<table>` | Yes — 13 implementations | — | 🆕 (column config API: `key`, `header`, `cell`, `align`, `width`, `sortable`, `hideBelow`, `priority`, `mobileRole`) | products, customers, suppliers, sales, purchases, inventory, catalog, warehouses, batches, payments, debts, users, audit, settlements |
| Table states | — | inline `<tr><td colSpan>` | — | 🆕 (`DataTableEmpty`, `DataTableSkeleton`, `DataTableError`) | all tables |
| `Pagination` | ✅ `ui/pagination.tsx` (unused) | none | — | 🆕 usable `DataTablePagination` (page size, range label, RTL arrows) | all tables |
| `TableToolbar` | — | bespoke toolbars | — | 🆕 (search + filter + sort + primary action, responsive collapse) | all list pages |
| `SortMenu` | — | none | — | 🆕 | all tables |
| `FilterBar` / `ActiveFilters` | — | vehicle make chips (products only) | — | 🆕 (chip filters + clear-all) | all list pages |
| `RowActions` | — | inline icon buttons per row | — | 🆕 (inline actions + overflow menu on mobile) | all tables |
| `StatCard` | — | dashboard KPI cards, customers balance strip | 🟡 token-based | — | dashboard, analytics, customers, reports, finance |
| `DescriptionList` | — | detail panels | — | 🆕 | customer detail, invoice detail, batch detail |
| `VehicleFitmentPicker` | ✅ inline in `_app.products.tsx` (make strip + model grid + selected tags) | — | 🟡 extract to `ds/`, token-ize, reuse in catalog | — | products, catalog |

---

## E. Feedback (`src/components/ds/*`)

| Component | Existing | Duplicate | Needs Refactor | New | Used By |
| --- | --- | --- | --- | --- | --- |
| `EmptyState` | — | 8 inline blocks (icon + title + hint) | — | 🆕 | every table, dashboard, reports |
| `LoadingState` | — | `.shimmer` rows, spinners, raw text | — | 🆕 | every data surface |
| `ErrorState` | — | none (errors only via toast) | — | 🆕 (retry action) | every query surface |
| `InlineAlert` | ✅ `ui/alert.tsx` | — | 🟡 tones + i18n | — | forms, module warnings, quota |
| `Toast` helpers | ✅ sonner | `toast.success/error` direct | 🟡 `notify.success/error/info` with RTL + dedupe | — | everywhere |

---

## F. Layout & navigation

| Component | Existing | Duplicate | Needs Refactor | New | Used By |
| --- | --- | --- | --- | --- | --- |
| `PageHeader` | ✅ `components/page-header.tsx` | — | 🟡 add `breadcrumbs`, `eyebrow`, responsive action row, mobile sticky action bar | — | all pages |
| `Section` | — | `panel-elevated` wrappers | — | 🆕 (title + description + actions + content) | settings, dashboard, reports |
| `ResponsiveContainer` | — | `max-w-[1400px] p-4 sm:p-6` in shell | 🟡 breakpoint tokens | — | shell, print preview |
| `AppShell` | ✅ | — | 🟡 token-ize nav colors (currently hard-coded `text-sky-500` etc.), a11y on icon buttons | — | app |
| `CommandPalette` | ✅ | — | 🟡 token-ize | — | app |
| `MobileNavSheet` | ✅ (Sheet in shell) | — | — | — | app |

---

## G. Domain components

| Component | Existing | Duplicate | Needs Refactor | New | Used By |
| --- | --- | --- | --- | --- | --- |
| `InvoicePreview` | partially (`lib/invoice-print.ts`, `lib/pdf.ts`, bespoke preview overlays) | 2 preview paths (print + PDF) | 🟡 shared on-screen preview component matching print output; **no logic change** | — | sales, purchases, pos |
| `BarcodeLabel` | ✅ `_app.barcodes.tsx` inline | — | 🟡 extract + token-ize | — | barcodes |
| `CommandPalette` | ✅ | — | — | — | app |
| `RolePermissionsDialog` | ✅ | — | 🟡 re-base on `Modal` | — | users |
| `CatalogModulesDialog` | ✅ | — | 🟡 re-base on `Modal` | — | products, catalog |
| `PlanComparisonDialog` | ✅ | — | 🟡 re-base on `Modal` | — | plans |
| `SubscriptionSettingsCard` | ✅ | — | 🟡 re-base on `Panel` | — | settings |
| `BarcodeScanner` | ✅ | — | — | — | pos, products |
| `ComingSoon` | ✅ | — | — | — | disabled modules |

---

## Summary counts

| Bucket | Count |
| --- | --- |
| Existing primitives reused as-is | 22 |
| Existing primitives needing refactor | 16 |
| Dead/unused primitives to leave untouched | 14 |
| Duplicated concepts to consolidate | 14 |
| New components to build | 32 |
| Route files to migrate | 14 (P0/P1) + 24 (P2/P3, incremental) |
| Hand-rolled modals to collapse into `Modal` | 15 |
| Raw `<table>`s to migrate to `DataTable` | 12 |
| `inputCls` definitions to delete | 3 |
| Inline input class copies to delete | ~60 |
