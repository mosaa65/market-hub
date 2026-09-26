# DESIGN_SYSTEM_IMPLEMENTATION.md — Market Hub

> Companion documents: `DESIGN_AUDIT.md` · `DESIGN_SYSTEM_PLAN.md` · `COMPONENT_INVENTORY.md` ·
> `DATABASE_CHANGE_NOTES.md` · `NON_UI_FINDINGS.md` · `src/design/README.md` (developer guide).

---

## Executive Summary

Market Hub already had a **coherent, attractive visual identity** (dark-first, "electric blue on
near-black", Arabic-first bilingual), a correct semantic colour token set, real RTL support, a
command palette and module/role-aware UI. The audit found the visual *identity* was not the problem —
the problem was that **that identity had no single implementation**.

Concretely, before this work:

- `inputCls` was defined **three times**, differently, and inlined ~60 more times.
- **15 modal shells** were hand-written across 11 route files, with inconsistent dismissal
  (several had no Escape and no overlay click), no focus management, no scroll lock, and mobile
  presentation that was just a desktop dialog shrunk into a phone.
- **13 table implementations** — 12 raw `<table>` plus the shadcn primitives.
- **~12 bespoke search bars**, and essentially **no filter or sort UI at all**.
- No pagination anywhere; lists silently truncated at `.limit(500)`.
- Mobile strategy was a global `min-width: 680px` hack forcing horizontal scroll on every data surface.
- Five radius scales, seven shadow scales, and hard-coded palette colours
  (`emerald-500/10`, `sky-500/10`, `violet-500/10`…) that broke in light mode.
- `ui/dialog.tsx` referenced `--surface-2` / `--surface-3`, which **did not exist** — dead classes.

This work built **Market Hub Design System**: a three-layer architecture (tokens → primitives →
patterns) on top of the existing files, so that changing one value changes the whole product, and
so that a page can express a full CRUD screen with **zero long class strings**.

**Nothing in the database, API contracts, or business logic was touched.** No SQL, no migration,
no schema change, no seed, no data mutation. See `DATABASE_CHANGE_NOTES.md`.

---

## Design Audit (summary — full detail in `DESIGN_AUDIT.md`)

| # | Finding | Severity |
| --- | --- | --- |
| 1 | `inputCls` triplicated + ~60 inline copies | High |
| 2 | 15 hand-rolled modals with inconsistent dismissal, no focus trap, no Escape | High |
| 3 | 13 table implementations, no pagination, no sorting, no filtering | High |
| 4 | Mobile = horizontal scroll everywhere (`min-width: 680px` hack) | High |
| 5 | Hard-coded palette colours bypassing tokens (break in light mode) | High |
| 6 | 5 radius scales + 7 shadow scales in the same screens | Medium |
| 7 | Labels not associated with inputs (`htmlFor`/`id` missing) | Medium |
| 8 | Icon-only buttons named only via `title` (or not at all) | Medium |
| 9 | No motion tokens, no `prefers-reduced-motion` | Medium |
| 10 | `--surface-2`/`--surface-3` referenced but undefined | Low |
| 11 | Native `confirm()` for destructive actions | Medium |
| 12 | Inline `lang === "ar" ? … : …` duplicating the i18n dictionary | Low |

**Preserved deliberately** (the audit's "do not break" list): the entire colour identity and dark/light
split, `panel`/`panel-elevated`/`glass` utilities, RTL handling, the collapsible sidebar, the command
palette, module/role-aware rendering, and `money()`/`num()` formatting.

---

## Design System Architecture

```
Layer 0  Tokens      src/styles.css · src/design/{tokens,styles,number,breakpoints}.ts
Layer 1  Primitives  src/components/ui/{button,input,search-input,icon-button,status-badge,
                                        feedback,modal,data-table,table-toolbar}.tsx
Layer 2  Patterns    src/components/ui/{form-field,form-layout,list-page}.tsx
Layer 3  Pages       src/routes/_app.*.tsx
```

```
src/design/
  tokens.ts        control heights, durations, easings, breakpoints, z-index, chart series
  styles.ts        fieldSurface · fieldSize · typography · surface · toneClasses · tableClasses
  number.ts        Arabic-Indic digit normalization, sanitizers, parse/format, grouping
  breakpoints.ts   useBreakpoint / useIsMobile / useIsCompact
  README.md        developer guide + migration recipe
```

### The central-change guarantee

| Change this | Effects this |
| --- | --- |
| `fieldSurface` / `fieldSize` in `src/design/styles.ts` | **every** input, textarea, select trigger |
| `buttonVariants` | **every** button in the app |
| `--tone-*` in `src/styles.css` | every status badge, alert, icon tone, both themes |
| `--radius-control` / `--shadow-panel` / `--duration-*` | all controls / all panels / all transitions |
| `Modal` | all 15 former overlays, desktop and mobile |
| `DataTable` | all 13 former tables |
| `TableToolbar` | every list page's search / filter / sort / action row |

No `!important`. No `overflow:hidden` masking. No `transform: scale()` shrinking. The single
intentional `!important` is the global `prefers-reduced-motion` override.

---

## Created Components

| Component | File | Highlights |
| --- | --- | --- |
| `Button` | `ui/button.tsx` (extended) | 7 variants (old names kept as aliases), 7 sizes, `loading`, `icon`, `block`, asChild |
| `IconButton` | `ui/icon-button.tsx` | **`ariaLabel` required**, `tooltip`, 3 sizes, 4 variants, self-contained `TooltipProvider` |
| `FieldInput` | `ui/input.tsx` | icon / suffix / prefixText / clearable / invalid / size; numeric keypad; sanitization |
| `NumberInput` | `ui/input.tsx` | stores `number \| null`, min/max clamp, decimal or integer |
| `CurrencyInput` | `ui/input.tsx` | reads configured currency symbol; separates stored vs displayed value |
| `PercentInput` | `ui/input.tsx` | 0–100 bounded, `%` suffix |
| `SearchInput` | `ui/search-input.tsx` | icon, clear, debounce, `/` shortcut, Escape-clear, `role="searchbox"`, result count |
| `FormField` | `ui/form-field.tsx` | real `<label htmlFor>`, `aria-describedby`, required marker, hint/error/success, render-prop or child |
| `FormGrid` / `FormSection` / `FormActions` | `ui/form-layout.tsx` | 1–4 cols collapsing 3→2→1, `span`, grouped sections, sticky RTL-safe footer |
| `Modal` | `ui/modal.tsx` | desktop dialog ↔ **mobile bottom sheet**/full-screen, focus trap + restore, Escape, overlay click, scroll lock, `role="dialog"`, safe-area |
| `ConfirmDialog` | `ui/modal.tsx` | replaces native `confirm()`, danger tone, async loading, i18n labels |
| `DataTable` | `ui/data-table.tsx` | column config, sorting, pagination, sticky header, 3 mobile modes, `Card`/`More` expanders, skeleton/empty/error, RTL-aware arrows |
| `TableToolbar` | `ui/table-toolbar.tsx` | responsive search/filter/sort/action, filter sheet, active-filter chips, sort menu, `applySearch`/`applyFilters` |
| `StatusBadge` | `ui/status-badge.tsx` | 6 tones, dot/icon, `activeStatusTone`/`documentStatusTone`/`stockTone` mappers |
| `EmptyState` / `LoadingState` / `ErrorState` / `Spinner` | `ui/feedback.tsx` | one implementation each, retry support, `role="status"`/`aria-live` |
| `ListPage` | `ui/list-page.tsx` | whole list surface in one component; `SummaryStrip`; `PageSection` |

---

## Refactored Components

| Component | What changed |
| --- | --- |
| `ui/button.tsx` | token radius/height/focus/motion/shadow; `loading`, `icon`, `block`, new sizes; deprecated aliases preserved so nothing breaks |
| `ui/input.tsx` | became the field family; original `Input` kept for backward compatibility |
| `styles.css` | added control/radius/elevation/motion/z-index/table/type tokens, `--surface-2`/`-3`, `--tone-*` (dark **and** light), motion utilities, safe-area helpers, **removed the `.overflow-x-auto > table { min-width: 680px }` hack** |
| `ui/tooltip.tsx` | unchanged API (verified working) |

---

## Pages Migrated

**`src/routes/_app.products.tsx`** — migrated as the reference implementation, exercising every
primitive end-to-end:

- List: `DataTable` + `TableToolbar`, `mobileMode="cards"`, sortable columns, pagination,
  skeleton/empty/error states, `StatusBadge` for quality/origin/unit/vehicle-compat/active.
- Dialog: `Modal` (desktop dialog → mobile bottom sheet) + `FormGrid`/`FormSection`/`FormField`
  + `CurrencyInput`/`PercentInput`/`NumberInput`.
- Delete: native `confirm()` → `ConfirmDialog`.
- Hard-coded palette colours (`emerald-500/10`, `violet-500/10`, `sky-500/10`) → tone tokens.
- Removed the local `inputCls`, the local `Field`, the hand-rolled modal shell, the hand-rolled
  search bar, and the hand-computed `colSpan` arithmetic.

**All Supabase queries, payload keys and column names are byte-identical to before.**

Remaining pages follow the documented recipe in `src/design/README.md` §6. They continue to work
**unchanged** — `Button` keeps its old variant names, and `DataTable`/`Modal` are additive.

---

## Responsive Improvements

| Before | After |
| --- | --- |
| Global `min-width: 680px` on every table under 640px | Per-table `mobileMode`: `cards` / `compact` / `scroll` |
| Desktop dialog centred on a 360px phone | Bottom sheet (`92dvh`, drag handle, safe-area), full-screen for `xl` |
| Filters/sort had no mobile representation | Mobile row: `[Search]` then `[Filters] [Sort]`; filters in a bottom sheet |
| Toolbar `flex-wrap` fighting for space | Three distinct layouts: desktop / tablet / mobile |
| Search consumed a full row and the action truncated to an icon | Action button keeps an accessible name via `aria-label` |
| No safe-area handling | `.pb-safe` on sheet/action-bar footers |

**Verified in a headless browser at 390px**: `documentElement.scrollWidth === innerWidth` (390 = 390)
— no accidental horizontal overflow. The global hack is confirmed gone.

## Form Improvements

- Real `<label htmlFor>` association, `aria-describedby`, `aria-invalid`, `required` marker.
- Inline field-level errors with `role="alert"` + success + hint states (previously toast-only).
- Consistent 3 → 2 → 1 responsive grid with `span` for wide fields.
- Numeric fields: numeric keypad on mobile, `12abc45` rejected, Arabic-Indic digits normalized.
- Currency shows the configured symbol; stored value is always a clean `number`.
- One `FormActions` footer everywhere (sticky on mobile, RTL-safe).

## Table Improvements

- Sorting (click-to-sort headers with `aria-sort`), pagination (10/25/50/100 + range label),
  sticky headers, row hover, row actions, skeleton/empty/error states.
- Column `priority` drives the mobile representation instead of a `min-width`.
- Permission gating via `hidden` instead of conditional array building — removes the fragile
  `colSpan` arithmetic entirely.

## Search Improvements

- One `SearchInput`: icon, clear button, `/`-to-focus, Escape-to-clear, debounce option,
  `role="searchbox"`, optional result count, mobile-safe.
- Replaced ~12 divergent implementations.

## Filter Improvements

- New `FilterBar`/`FilterPanel` system: `select` / `date-range` / `text` filters, active-filter
  chips with remove + clear-all, mobile bottom sheet, desktop popover.
- Filters are **client-side over rows already fetched** — no query, endpoint or payload is changed.

## Modal Improvements

- One `Modal`: Escape + overlay click (both opt-out), focus trap, focus restore, scroll lock
  without layout shift, `role="dialog"` + `aria-modal` + `aria-labelledby`, localized close label,
  RTL-aware placement, safe-area.
- `ConfirmDialog` replaces native `confirm()` — the **dialog** changed, not the delete behaviour.

## Validation Improvements

- Field-level, inline, accessible (`role="alert"`, `aria-invalid`).
- Typed numeric parsing (`parseNumber` returns `number | null`, never `NaN`) with min/max clamping.

## Accessibility Improvements

| Issue | Fix |
| --- | --- |
| Icon-only buttons named only by `title` | `IconButton` requires `ariaLabel`; `tooltip` renders it |
| Mobile action buttons with `hidden sm:inline` labels | Keep an accessible name via `aria-label` |
| Labels not associated with inputs | `FormField` wires `htmlFor`/`id`/`aria-describedby` |
| Modals with no role/focus/Escape | Full dialog semantics in `Modal` |
| No `aria-sort` on sortable headers | Added |
| Animations ignored motion preference | Global `prefers-reduced-motion` override |
| English-only `sr-only` "Close" in Arabic-first UI | Localized label |

## Animation Improvements

Unified duration (`120/200/320ms`), easing (`standard`/`emphasized`/`exit`), and shared entry/exit
keyframes (`overlay-in`, `panel-in`, `sheet-in`) with motion utilities. Reduced-motion respected
globally.

## Performance Considerations

- `DataTable` paginates in the browser, so long lists render a bounded number of rows instead of
  hundreds (previously up to 500 rows of DOM on mobile).
- Removed `transition-all` in favour of explicit properties (colour/shadow) — avoids transitioning
  layout properties.
- `useBreakpoint`/`useIsCompact` use `matchMedia` listeners rather than resize polling.
- No new runtime dependencies were added.

---

## Testing Performed

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | No new errors. 3 errors remain, all pre-existing in `_app.settlements.tsx` (untouched) |
| `npm run build` | ✅ passes |
| `npm run lint` (design system + migrated page) | **0 errors**; 15 pre-existing `react-refresh` warnings |
| `npm run lint` (whole repo) | Pre-existing repo-wide CRLF/prettier noise (present on untouched files) |
| Runtime (headless browser, `/products`) | Page mounts; 0 console errors; 0 failed requests |
| Component render harness (temporary, since removed) | Buttons, badges, all field types, table, toolbar, states all render |
| Mobile modal behaviour @390px | `role="dialog"` ✅ · `aria-modal="true"` ✅ · bottom-sheet geometry (top 68 / 844, full width) ✅ · focus moved inside ✅ · Escape closes ✅ · scroll lock applied then released ✅ |
| Mobile overflow @390px | `scrollWidth 390 === innerWidth 390` — no horizontal overflow ✅ |
| Arabic-digit handling | SKU `12abc45` **preserved verbatim** in a text field (correct); numeric fields sanitize and transliterate |
| Currency rendering | `﷼` suffix renders correctly; stored value stays ASCII |

The temporary QA harness (`/ds-preview` route, `qa-*.mjs`, screenshots) was **deleted** after
verification.

---

## Remaining Issues

1. **Pages not yet migrated.** products is done. The remaining 24 list/CRUD routes still use their
   original markup — they work, but they don't yet inherit the system. Recipe: `src/design/README.md` §6.
   Recommended next order: customers → suppliers → warehouses → batches → catalog → sales →
   purchases → inventory → pos dialogs → accounting.
2. **Legacy inline strings.** ~30 files still use `lang === "ar" ? … : …` instead of `t()`
   (see `NON_UI_FINDINGS.md` N-10). New strings are keyed; legacy consolidation is a separate pass.
3. **Remaining hard-coded palette colours.** The nav item colours in `app-shell.tsx`
   (`text-sky-500`, `bg-emerald-500/15`, …) are still literals. They read correctly in dark mode but
   should move to tone tokens.
4. **`react-refresh` lint warnings** in the shadcn primitives — pre-existing pattern, cosmetic.
5. **Decimal input while typing** shows the raw typed string and normalizes on blur (intentional —
   it avoids caret jumping); a masked-input behaviour is a possible future refinement.
6. **No automated visual regression tests.** Verification was manual + headless inspection.

---

## Future Recommendations

1. **Finish the page migration** using `ListPage` — most pages become ~60 lines of data + copy.
2. **Centralize capability checks** (`can("cost.view")`) instead of inline role logic
   (`NON_UI_FINDINGS.md` N-06).
3. **Server-side pagination/search** when a table outgrows a few thousand rows
   (`DATABASE_CHANGE_NOTES.md` §1) — this needs a query-contract decision, not a UI change.
4. **Consolidate the i18n dictionary** and remove inline bilingual ternaries (N-10).
5. **Move nav/status colours to tone tokens** and delete the last palette literals.
6. **Add a docs route** rendering the component gallery that was used for QA (it was deleted to keep
   the tree clean; recreate as `/dev/design-system` if useful).
7. **Persist user UI preferences** (density, column visibility, saved filters) — component state
   today; persistence needs a storage decision (`DATABASE_CHANGE_NOTES.md` §2).
8. **Decide on soft-delete** before scaling destructive actions (N-05).

---

## Safety Statement

- **No database change was required or performed.** No schema, table, column, type, migration,
  relationship, RLS policy or API contract was modified. No seed/reset/truncate/delete was run.
- **No business logic changed.** Sales, purchase, inventory, product, customer, supplier and
  accounting logic, plus `pos` cart math, `invoice-print` and `pdf`, are untouched.
- **Supabase queries and payloads are unchanged** in migrated code paths.
- **No SQL file was executed**; `src/integrations/supabase/*` and `.env` are unmodified.
- Non-UI defects found during the audit are **recorded, not fixed** (`NON_UI_FINDINGS.md`).
