# DESIGN AUDIT — Market Hub (Vortex ERP)

> Scope: **UI / UX / Frontend architecture / Design System only.**
> No database, API contract, business logic, or stored-data changes were made or are proposed here.
> Date of audit: current working tree at `c:\Users\mousa\Desktop\project\market-hup`.

---

## 1. Current UI — Stack & Structure

| Layer | Technology |
| --- | --- |
| Rendering | React 19 + Vite 8 + TanStack Start / Router (file-based routes) |
| Data | Supabase JS client (direct from components) + TanStack Query |
| Styling | Tailwind CSS v4 (`@import "tailwindcss" source(none)` + `@theme inline`) |
| Primitives | Radix UI (`@radix-ui/react-*`) wrapped shadcn-style in `src/components/ui/*` (46 files) |
| Icons | `lucide-react` |
| Forms | `react-hook-form` + `zod` + `@hookform/resolvers` (installed, **barely used**) |
| Toasts | `sonner` |
| Sources of truth | `src/styles.css` (tokens, dark default + `.light`), `src/lib/i18n.tsx` (EN/AR dict), `src/lib/format.ts` (`money`, `num`), `src/lib/modules.tsx`, `src/lib/auth.tsx`, `src/lib/catalog-modules.ts` |

**Route inventory — 38 `_app.*` routes**, grouped by the sidebar (`src/components/app-shell.tsx`):

- **Overview**: dashboard, analytics, plans
- **Operations**: pos, products, catalog, inventory, settlements, warehouses, batches, sales, sales-returns, purchases, purchase-returns, transfers, barcodes
- **Relations**: customers, suppliers, loyalty
- **Accounting**: payments, debts, account-statement, daily-journal, trial-balance, income-statement, balance-sheet, finance, reports
- **Admin**: users, audit, notifications, settings, platform-admin
- Plus `auth`, `returns` (legacy), `coming-soon`.

**Layout**: `AppShell` = fixed sidebar (collapsible, `localStorage` persisted, RTL-aware side) + sticky header (menu / collapse / command palette trigger / theme toggle / notifications) + `<main class="max-w-[1400px] p-4 sm:p-6">`. Mobile sidebar = `Sheet`. Command palette = `cmdk` with ⌘K.

**Design language today**: a deliberately *Linear/Vercel-ish*, dense, dark-first, "electric blue on near-black" aesthetic with a soft radial ambient glow and glassy panels. This is a genuine, coherent visual identity — **it is worth preserving, not replacing.**

---

## 2. Existing Good Patterns (Preserve)

These are real strengths and are treated as **non-negotiable** in the migration:

1. **Token foundation already exists.** `src/styles.css` defines `--background`, `--surface`, `--surface-elevated`, `--primary/-foreground`, `--success`, `--warning`, `--destructive`, `--border`, `--input`, `--ring`, chart colors, sidebar colors, `--radius-sm…2xl`, `--shadow-elegant`, `--shadow-glow`. Semantic naming is already correct.
2. **Dark/light theming** via `.dark` (default) / `.light` on `<html>`, persisted in `localStorage`, toggled from the header. Semantic vars work in both.
3. **Bilingual + RTL is real, not bolted on.** `useI18n()` gives `t`, `lang`, `dir`; `html[dir=rtl]` swaps to IBM Plex Sans Arabic; `ps/pe/ms/me/start/end` logical utilities are used in many places; `rtl:` / `ltr:` variants are used where logical utilities don't exist (dialog close button, sidebar tooltip arrows, drawer side).
4. **`panel` / `panel-elevated` / `glass` utilities** — a lightweight surface abstraction already applied across pages.
5. **Command palette (⌘K)** — a genuinely premium touch, keyboard-first.
6. **Collapsible icon-rail sidebar** with hand-built hover tooltips and persisted state.
7. **Skeleton loading is already attempted** (`shimmer` keyframe + `.shimmer` class) on products.
8. **Role/permission-aware UI** (`useAuth().hasRole`, `isPlatformAdmin`, `allowedRoles` in nav) and **module-aware UI** (`useModules().isModuleEnabled`, `useCatalogModules().config`) — the UI already adapts to plan/profile. Any design system must stay compatible with this.
9. **`money()` / `num()` formatters** already centralize currency and number display.
10. **`StatusBadge`-like pill patterns** already exist ad hoc (`bg-success/10 text-success`, `bg-muted text-muted-foreground`) — a good instinct, just not centralized.

---

## 3. Existing Problems

### 3.1 Duplicated components & styles (highest-impact)

| Duplicated thing | Where | Count |
| --- | --- | --- |
| `inputCls` string constant | `_app.products.tsx:870`, `_app.catalog.tsx:455`, `_app.warehouses.tsx:241` | 3 files, **3 different definitions** |
| `Field` wrapper component (label + children) | re-declared per page (e.g. `_app.products.tsx:873`) | ≥3 |
| Raw `<input>` with the same long class string inlined | `_app.pos.tsx` alone (lines 2008, 2014, 2027, 2088, 2096, 2102) | 6+ inline copies |
| Hand-rolled modal shell `fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4` + `panel-elevated … p-6` | batches, catalog, customers, inventory, debts, purchases ×2, warehouses, sales, products, pos ×3, suppliers | **15 occurrences across 11 route files** |
| Confirm deletion via native `confirm()` | `_app.products.tsx:449` (and similar) | many |
| Search bar markup (`div.flex.h-10 … rounded-full` + `<Search/>` + bare `<input>`) | products, customers, suppliers, sales, purchases, inventory, catalog, batches… | ~12 |
| `<select>` with `inputCls` and a `—` empty option | all forms | dozens |
| Status pill markup | products, customers, suppliers, purchases, sales, warehouses, batches | ~8 |

Consequence: **there is no single place to change input height, radius, focus ring, or modal animation.** Each page carries its own copy.

### 3.2 Inconsistent tokens in practice

Even though tokens exist, pages **bypass them with hard-coded values**:

- Radius drift: `rounded-md` (button.tsx, input.tsx, select.tsx) vs `rounded-xl` (`_app.products.tsx:972`, `1035`) vs `rounded-2xl` (`inputCls`, `_app.pos.tsx`) vs `rounded-3xl` (product dialog, POS dialog, panel wrappers) vs `rounded-full` (search bar, action buttons, filter chips). **Five radius scales in the same screen.**
- Height drift: `h-8` / `h-9` / `h-10` / `h-11` controls without a documented size scale.
- Focus treatment drift: some inputs use `focus:border-primary focus:ring-2 focus:ring-primary/20`, some `focus-visible:ring-1 focus-visible:ring-ring` (shadcn), some nothing, `ring-focus` utility exists but is unused.
- Shadow drift: `shadow-sm`, `shadow-2xs`, `shadow-xs`, `shadow-md`, `shadow-2xl`, `shadow-primary/20`, `shadow-elegant`, `shadow-glow` — no semantic shadow scale.
- Hard-coded palette colors bypass semantic tokens: `emerald-500/10`, `sky-500/10`, `violet-500/10`, `amber-500/15`, `rose-500/15`, `pink-500`, `lime-500`, `indigo-400`, `slate-400`... (products table micro-badges, nav item colors, customers balance strip). This breaks in light mode and breaks theming entirely.
- Raw `oklch(...)` values inline in `styles.css` scrollbar/glow instead of semantic aliases.
- Spacing drift: `p-3.5`, `p-4`, `p-6`, `px-4 py-2.5`, `px-3 py-2`, `px-4 py-3.5`, `gap-1.5`, `gap-2`, `gap-3.5` — no spacing scale in use.

### 3.3 Layout/real-world contradictions

- `src/components/ui/dialog.tsx` uses `bg-surface-2/90` and `hover:bg-surface-3` in the close button — **`--surface-2` and `--surface-3` are not defined anywhere** in `styles.css`. Those classes are dead; the close button has no background.
- `components.json` + 46 shadcn primitives exist but most pages **don't use them** — pages hand-roll tables, modals, and inputs while `Card`, `Dialog`, `Table`, `Badge`, `Alert` sit unused or half-used. Two parallel design systems coexist.
- Two table implementations: raw `<table>` (12 routes) vs the `ui/table.tsx` primitives (account-statement, daily-journal, trial-balance, users).
- `t("...")` keys and inline `lang === "ar" ? … : …` ternaries are interleaved unpredictably — the same string may be translated in one page and hard-coded in another.

---

## 4. Duplicate Components — Explicit List

| Concept | Implementations found | Verdict |
| --- | --- | --- |
| Text input | `ui/input.tsx`, `inputCls` ×3, inline classNames in pos | **Unify** |
| Number/money input | raw `<input type="number">` everywhere; no Arabic-digit handling; no `inputMode` | **Build** |
| Field/Label wrapper | `ui/label.tsx`, `ui/form.tsx` (`FormItem/FormLabel`), page-local `Field` ×≥3 | **Unify** |
| Modal/Dialog | `ui/dialog.tsx`, `ui/alert-dialog.tsx`, `ui/drawer.tsx`, `ui/sheet.tsx`, **+15 hand-rolled overlays** | **Unify** |
| Confirm | native `confirm()`, `ui/alert-dialog.tsx` | **Unify** |
| Button | `ui/button.tsx` + ~40 raw `<button>` with bespoke classes per page | **Unify** |
| Search | ~12 bespoke search bars; `ui/command.tsx` for palette | **Build `SearchInput`** |
| Table | `ui/table.tsx` + 12 raw `<table>` | **Build `DataTable`** |
| Pagination | `ui/pagination.tsx` (unused?) — no page has pagination at all | **Build** |
| Empty state | per-table `<td colSpan>` blocks with icon + two lines (products, customers…) | **Extract** |
| Loading | `.shimmer` (products) + `Loader2 animate-spin` + raw text `…` | **Extract** |
| Status badge | ~8 hand-rolled pills | **Extract** |
| Page header | `components/page-header.tsx` (used widely — good) | **Extend** |
| Toolbar (search/filter/sort/add) | bespoke per page | **Build** |

---

## 5. Responsive Problems

1. **Mobile is an afterthought, not a design target.** Tables rely on `overflow-x-auto` (22 occurrences). `styles.css` forces `.overflow-x-auto > table { min-width: 680px }` under 640px — i.e. **horizontal scrolling is the mobile strategy for every data surface**, including the accounting tables where amounts scroll off-screen.
2. Products table sets `min-w-[850px]`; settlements `min-w-[980px]` — on a 360px phone that is 2.4–2.7 screens of horizontal panning.
3. **Modals are desktop dialogs on mobile.** All 15 hand-rolled overlays are `grid place-items-center` + `max-w-*` + `p-4`. On a 360×640 phone a product form with a vehicle-compatibility picker and ~15 fields becomes a tiny scroll box inside a scroll box. No bottom sheet, no full-screen dialog.
4. Toolbars are `flex flex-wrap` — on mobile the search collapses and the action button shrinks to an icon (products hides the "New" label with `hidden sm:inline`), which is acceptable, but filters/sort have **no mobile representation at all** (they simply don't exist).
5. Sidebar is `hidden md:flex` + `Sheet` — this part is actually correct.
6. `AppShell` header hides the ⌘K hint under `sm` (correct) but the search trigger keeps `flex-1 max-w-xl` and competes with 3 icon buttons on small screens.
7. No mobile-specific row density; cells stay `px-4 py-2.5` and rows never become cards/lists.
8. Dashboard/analytics charts (`recharts`) have no documented narrow-viewport treatment.

---

## 6. Forms Problems

- **No form system in use.** `react-hook-form` + `zod` + `ui/form.tsx` are installed but pages use `useState({...})` + manual `submit` handlers + `toast.error` for validation. Validation is therefore **inconsistent and non-field-level** (`_app.products.tsx:562` → toast only, no inline error, no `aria-invalid`).
- Labels are `<span>` inside a page-local `<Field>` — **not associated with the input** (`htmlFor`/`id` missing) → screen readers announce nothing; clicking the label does focus only because the input is nested inside `<label>` (works, but not consistent — `pos.tsx` uses bare `<input>` siblings).
- No `helperText`, no `error` prop, no `success` state, no `required` marker convention (`label + " *"` string concatenation), no `readOnly`/`loading` states.
- **Numeric fields**: `<input type="number">` with `step="0.01"`. No `inputMode="decimal"`, no Arab-Indic digit normalization, no rejection of `12abc45` other than the browser's silent empty-value behaviour, no currency affordance, no thousands separators. RTL + `type=number` also produces known caret/LTR artifacts.
- Grid is `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` — a decent instinct (products, catalog) but duplicated per page and fights the `sm:col-span-2 lg:col-span-3` special cases.
- No `FormActions` convention: every dialog re-implements its own footer with its own button classes.
- Modal footer buttons: `h-9` in products, `h-11` in the School ERP reference — no size scale.

---

## 7. Table Problems

- No sorting anywhere except implicit DB `order()`; **no click-to-sort headers**.
- **No pagination.** Products fetches `.limit(500)` and renders all of them. Sales/inventory/purchases fetch everything. Long lists = long DOM + slow paint on mobile.
- Filtering is client-side `useMemo` string matching on 2–4 fields; no column filters, no date-range filter, no numeric range filter, even though sales/purchases/inventory obviously need them.
- Row actions are always-visible buttons (`grid h-8 w-8 rounded-full border` ×2). On mobile they consume the widest column and cause the horizontal scroll above.
- Numeric cells are right-aligned with `font-mono` in some tables and left-aligned in others; currency is sometimes `toFixed(2)` and sometimes `money()`.
- Empty and loading states are inline `<tr><td colSpan>` — the `colSpan` is hand-computed and already drifting (`(config.enableBrands ? 10 : 9) - (canViewCost ? 0 : 1)`).
- No column-visibility, density, or selection support (selection exists visually in `users`/`payments` only via ad-hoc markup).
- Micro-badge cluster inside the product name cell (quality / origin / unit / vehicle compat) makes rows tall and dense on desktop and unreadable on mobile.

---

## 8. Search Problems

- ~12 bespoke search bars, each with different: height (`h-8`/`h-10`), radius (`rounded-full`/`rounded-xl`/`rounded-2xl`), icon placement, whether a result count is shown, whether there is a clear (×) button, and placeholder styling.
- No debounce (not strictly needed for client-side filtering, but there's no decision recorded).
- No keyboard shortcut per page, no `/`-to-focus, no `Escape`-to-clear.
- No `aria-label`, no `role="searchbox"`, no `type="search"` semantics.
- On mobile the search takes a full row and the action button truncates to an icon; there's no "search expands into a full-width overlay" pattern.

## 9. Filter Problems

- **There is essentially no filter system.** Only products has chips (the vehicle-make strip) and that's domain-specific, not a generic filter primitive.
- Nothing offers: date range (sales/purchases/audit/account-statement), status filter (active/inactive, paid/unpaid, draft/completed), warehouse filter, category filter, amount range.
- Users therefore scan/search manually, or don't filter at all.
- No "active filters" summary, no clear-all, no URL persistence of filter state (so a filtered view can't be shared or returned to).

## 10. Sort Problems

- Nonexistent as a UI concept. DB `order()` only (`created_at desc`, `name asc`).
- The vehicle picker has a `sort_order` concept in data but no user-facing sort control.

## 11. Modal / Dialog Problems

- 15 hand-rolled overlays, each with subtly different: overlay opacity (`bg-background/80` vs `bg-black/60`), blur, padding, max-width, radius, padding, header/footer styling, and close-button styling.
- Inconsistent dismissal: some close on overlay click, some (`batches:293`, `customers:627`, `purchases:287`) **do not** — so users get trapped. No `Escape` handling in the hand-rolled ones.
- No focus trap, no `aria-modal`, no focus restore on close, no scroll-lock management in hand-rolled versions (background scrolls behind the modal on mobile).
- `ui/dialog.tsx`'s own close button references undefined `bg-surface-2`/`bg-surface-3` (see §3.3).
- Header close button hides the real `X` semantics behind an English-only `<span className="sr-only">Close</span>` while the app is Arabic-first.
- Mobile: desktop-shaped dialogs, no bottom sheet / full-screen behaviour, no safe-area insets.
- Nested-modal behaviour (e.g. POS → new customer) is accidental, not designed: `pos.tsx:1981` and `:2059` stack overlays with hand-rolled shells.

## 12. Animation Problems

- Animation is ad hoc: `animate-in fade-in duration-150`, `duration-200`, `transition`, `active:scale-95`, `hover:scale-105`, `group-hover:rotate-90` (reference), `shimmer 1.6s`.
- No duration scale, no easing tokens, no reduced-motion handling (`prefers-reduced-motion` is never respected).
- Three different modal entry animations coexist (zoom, fade-only, none).
- No shared language for dropdown/tooltip/toast/drawer/page transitions.
- `transition-colors` on buttons vs `transition-all` in sidebar — inconsistent and `transition-all` is a perf smell on large subtrees.

## 13. Accessibility Problems

1. Labels not programmatically associated with inputs (see §6).
2. Hand-rolled modals: no `role="dialog"`, no `aria-modal`, no focus trap/restore, no Escape.
3. Icon-only buttons frequently use only `title=` (hover-only) — `title` is not a reliable accessible name for screen readers; several have no `aria-label` at all (`_app.products.tsx:436` edit button uses `title` only).
4. Destructive actions via `confirm()` — native dialog (technically accessible) but unstyled, English "OK/Cancel" mismatch, and blocking on mobile.
5. Tables have no `<caption>`/`scope`/`aria-sort`; headers are `<th>` without `scope="col"`.
6. Contrast risk: `text-muted-foreground` on `bg-surface` at `text-[10px]`/`text-[11px]` (micro-badges, sidebar tooltips, keyboard hint pills) is likely below 4.5:1; `text-muted-foreground/70` and `/60` compound it.
7. Focus visibility is inconsistent: `ring-focus` exists but is unused; several raw `<button>`s have no `focus-visible` style at all.
8. `sr-only` strings are English-only in an Arabic-first product.
9. No skip-to-content link; `main` has no landmark label.
10. Animations ignore `prefers-reduced-motion`.

---

## 14. Recommended Design System

A **three-layer architecture** layered *on top of* the existing files — no big-bang rewrite:

```
Layer 0  Tokens        src/styles.css  (+ src/design/tokens.ts for JS consumers)
Layer 1  Primitives    src/components/ui/*        (extend existing shadcn files)
Layer 2  Patterns      src/components/ds/*        (Field, FormSection, Modal shell,
                                                   DataTable, Toolbar, EmptyState,
                                                   StatusBadge, CurrencyInput, …)
Layer 3  Pages         src/routes/_app.*.tsx      (consume Layers 1–2 only)
```

Rules that make central change work (requirement #5):

- All visual values come from CSS variables exposed as Tailwind theme tokens. A change to `--radius-control`, `--control-h`, `--shadow-panel`, `--duration-normal` propagates to every surface because components never hard-code the value.
- Layer 2 components own all *composition* (label + control + helper + error; table + toolbar + empty + pagination).
- Pages own only *data and copy*. A page may not contain a long Tailwind class string for a control; if it needs one, that's a missing primitive.

**Component set actually needed by this product** (derived from the audit, not copied from a template):

| Group | Components |
| --- | --- |
| Action | `Button` (primary/secondary/outline/ghost/danger/success, sizes sm/md/lg/icon, `loading`, `disabled`), `IconButton`, `ButtonGroup` (toolbar), `LinkButton` |
| Input | `Input` (text/email/tel/password/search/number/date), `Textarea`, `NumberInput`, `CurrencyInput`, `PercentInput`, `SearchInput`, `Select` (native + rich), `Combobox` (async, for products/customers in POS), `DatePicker`, `DateRangePicker`, `Checkbox`, `Switch`, `RadioGroup` |
| Form | `Form` (rhf bridge), `FormSection`, `FormGrid`, `FormField` (label/required/helper/error/success), `FormActions`, `FormErrorSummary` |
| Overlay | `Modal` (responsive: desktop dialog → mobile bottom-sheet/full-screen), `ConfirmDialog`, `Drawer`/`Sheet`, `AlertDialog` |
| Data | `DataTable` (columns config, sorting, pagination, sticky header, density, mobile card mode), `TableToolbar`, `FilterBar`, `FilterSheet` (mobile), `SortMenu`, `Pagination`, `ColumnVisibility`, `RowActions` |
| Display | `Card`/`Panel` (semantic `panel-elevated`), `StatCard`, `Badge`, `StatusBadge`, `KeyValueList`, `DescriptionList` |
| Feedback | `EmptyState`, `LoadingState`, `ErrorState`, `Skeleton`, `Spinner`, `ProgressBar`, `Toast` (sonner wrapper), `InlineAlert` |
| Nav/Layout | `PageHeader` (extend: breadcrumbs, actions, sticky mobile action bar), `Section`, `ResponsiveContainer`, `PageActions` |
| Domain | `InvoicePreview` (shared preview/print surface), `VehicleFitmentPicker` (extracted from products) |

**Not needed** (avoid speculative abstraction): carousel, resizable panels, menubar, context menu, navigation-menu, aspect-ratio, input-otp — present as shadcn boilerplate but unused by the product.

---

## 15. Migration Plan (summary — full detail in `DESIGN_SYSTEM_PLAN.md`)

```
Tokens (additive, zero-risk)
  ↓
Button + IconButton   (P0 — used everywhere, lowest risk to migrate)
  ↓
Input + NumberInput + CurrencyInput + Field/Form  (P0/P1)
  ↓
Modal + ConfirmDialog  (P0/P1 — collapses 15 overlays)
  ↓
SearchInput + Toolbar + Filter/Sort  (P1)
  ↓
DataTable (+ mobile card mode, pagination)  (P1)
  ↓
Page migration, page by page, verified after each  (P1/P2)
  ↓
Polish: animations, a11y, contrast, reduced-motion  (P3)
```

**Verification gate after every phase**: `npm run lint` clean, `npm run build` clean, affected routes opened in the dev server and checked at 360 / 768 / 1280 / 1536 px.

**Safety guarantees**
- No file under `src/integrations/supabase/`, no SQL, no migration, no `.env` touched.
- Supabase queries, payload shapes, and column names are preserved byte-for-byte during UI refactors.
- Business logic (`pos` cart math, `invoice-print`, `pdf`, `modules`, `auth`) untouched; any finding is logged in `NON_UI_FINDINGS.md` instead of fixed.
- Old components are never deleted until `grep` proves zero remaining usages (Refactor → Migrate → Verify → Remove).
- No `!important`, no `overflow:hidden` to hide layout bugs, no `transform: scale()` resizing hacks.
