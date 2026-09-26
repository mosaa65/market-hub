# HANDOFF — Products page sticky header + mobile table

> Written to be picked up by another agent with no prior context.
> Project: `market-hup` (TanStack Start + React + Tailwind + Supabase).
> Scope of this work: **the Products page only.** No other page was modified.

---

## 1. Task origin

The Products page (`src/routes/_app.products.tsx`) was migrated to a new in-house design system.
Two visual defects were reported by the user and are the entire subject of this document:

1. **The search/filter/action toolbar and the table header did not stick** while scrolling the
   product list — they scrolled away with the content.
2. **On a small screen, the records fell out of the table** — columns were clipped past the
   right/left edge of the panel with no way to reach them.

A previous agent had attempted fix #1 four times (fixed `top-16`, `useEffect` measurement,
`useLayoutEffect`, `ResizeObserver`) and stalled, correctly reporting that the value was measured
but never applied.

---

## 2. Root cause of #1 — the sticky chain was broken by `overflow`

The app shell (`src/components/app-shell.tsx`) is:

```
<div class="flex h-screen overflow-hidden">          ← page frame
  <aside> sidebar </aside>
  <div class="flex flex-1 flex-col overflow-hidden">  ← content column
    <header class="sticky top-0 h-16">…</header>      ← NOT the scroll container
    <main class="flex-1 overflow-y-auto">             ← THE scroll container
      <div class="mx-auto max-w-[1400px] p-4"> {children} </div>
    </main>
  </div>
</div>
```

Key facts that had been missed:

* `<header>` is a **flex sibling** of `<main>`, not a parent. It never moves; it is pinned by
  flex layout, not by `position: sticky`. Therefore the correct sticky offset for anything inside
  `<main>` is **`0`**, *not* the header height (`4rem`). The previous agent's measurement of
  `toolbarTop: 0px` was **the browser correctly reporting the computed value** — the offset was
  right; the element simply could not stick.
* A `position: sticky` element resolves against its **nearest scrolling-ancestor**. A measured
  walk up from `<thead>` showed **two** ancestors with non-`visible` overflow that broke the chain:

  | Ancestor | Overflow | Consequence |
  | --- | --- | --- |
  | `div.overflow-x-auto` (the table's scroll wrapper) | `auto` on both axes (`overflow-x: auto` forces `overflow-y: auto`) | became the sticky containing block — a box that never scrolls vertically, so the header scrolled off the page with it |
  | `div.panel-elevated.overflow-hidden` (on the Products page) | `hidden` | clipped sticky descendants |

  Measured after scrolling `<main>` by 900px, in the broken state:
  `toolbarTop: -731`, `theadTop: -617` (both effectively gone).

### The fix for #1 (two files)

* `src/components/ui/data-table.tsx`
  * Removed `overflow-x-auto` from the table's scroll wrapper, so it no longer forms a scroll
    container and stops hijacking the sticky containing block. The wrapper is now
    `w-full overscroll-x-contain`.
  * Changed the default sticky offset from `4rem` to `0px` and renamed the prop
    `stickyOffset` → `stickyTop`, with a doc comment explaining why `0` is correct.
  * The toolbar height is **not** guessed. A `ResizeObserver` writes the toolbar's real
    `offsetHeight` into the `--ds-toolbar-h` CSS custom property **directly on the DOM node**
    (no React state, so no render loop and no stale frame). The table header pins at
    `calc(var(--ds-sticky-top,0px) + var(--ds-toolbar-h,0px))`. This tolerates the toolbar
    changing height when filter chips appear.
* `src/routes/_app.products.tsx`
  * `className="panel-elevated overflow-hidden"` → `className="panel-elevated"` so nothing clips
    the sticky regions.

Verified by measurement (headless Chromium, logged in as the real account, real Supabase data,
343 product rows):

```
headerBottom: 64
toolbarTop: 64      → toolbarStuckUnderHeader: true
theadTop: 121
toolbarBottom: 121  → theadStuckUnderToolbar: true
theadVisible: true
```

---

## 3. Root cause of #2 — `table-layout: auto` grew the table past its container

On a 390px phone the four remaining visible columns summed to **384px inside a 344px container**,
pushing the table 17px off-screen and clipping the row-action buttons. Measured:

```
TABLE   width: 384   parentWidth: 344   childWiderThanParent: true
```

`w-full` + `table-layout: auto` lets the browser expand a table beyond its container when cell
content needs more room.

### The fix for #2 (two files)

* `src/components/ui/data-table.tsx`
  * The `<table>` now uses `table-fixed` (which makes the declared width authoritative, so cells
    wrap instead of expanding the table) unless a `minWidth` is requested, in which case it stays
    `table-auto` so intentionally-wide accounting tables still scroll.
  * Added a `hideBelow?: "sm" | "md" | "lg"` column option, implemented purely as Tailwind
    responsive classes (`hidden sm:table-cell` etc.) on both `<th>` and `<td>` — CSS-only, no
    measurement, no effect on sticky.
  * Cells now wrap on phones and keep the single-line ERP look from `sm` up:
    `whitespace-normal sm:whitespace-nowrap` on both `<th>` and `<td>` (previously unconditional
    `whitespace-nowrap`, which is what forced the minimum width).
* `src/routes/_app.products.tsx` — `hideBelow` applied to the low-priority columns:
  * `category` → `sm` (hidden under 640px)
  * `brand` → `md` (hidden under 768px)
  * `shelf_location` → `lg` (hidden under 1024px)
  * `cost_price` → `md`
  * `min_stock` → `sm`
  * Explicit widths on the columns that must stay narrow under `table-fixed`:
    `sale_price` `w-[84px] sm:w-[110px]`, `is_active` `w-[76px] sm:w-[110px]`,
    `actions` `w-[92px] sm:w-[104px]`.
  * Result on a phone: **4 columns** (المنتج، السعر، الحالة، الإجراءات) instead of 9.

Verified by measurement (390px):

```
tableWidth: 344   parentWidth: 344   childWiderThanParent: false
tableInsideViewport: true
firstRowInsideViewport: true
docHorizontalOverflow: false
visibleColumns: ["المنتج", "السعر", "الحالة", "الإجراءات"]
tableLayout: "fixed"
```

---

## 4. What was tried and REJECTED (do not retry)

These were measured, not assumed:

| Attempt | Result |
| --- | --- |
| `overflow-x-auto` on the table wrapper (original state) | Breaks sticky — computed `overflow-y: auto` makes the wrapper the containing block. `theadTop: -617` after scroll. |
| `overflow-x-auto overflow-y-clip` on the wrapper | **Worse.** `clip` does not create a scroll container (good) but it *clips* the pinned header, so the header is positioned yet invisible (`theadVisible: false`), and the wrapper would not scroll horizontally either (`scrollLeft` stayed at 0). |
| Fixed `top-16` / measured `top` in state | The offset was never the problem; the containing block was. |
| `table-fixed` with no per-column widths | Removes overflow, but splits all columns evenly and squeezes the product name. Fixed by adding the explicit widths listed above. |

---

## 5. Current state — verified

All of the following were measured against the live app, logged in as a real superadmin, with real
Supabase data (343 rows):

| Requirement | 1440px desktop | 390px phone |
| --- | --- | --- |
| Toolbar pins under the app header on scroll | ✅ `true` | — |
| Table header pins under the toolbar (no gap, no overlap) | ✅ `true` (`121 = 121`) | — |
| Table header visible while scrolled | ✅ `true` | — |
| Table and rows inside the viewport | ✅ | ✅ `true` |
| Page-level horizontal overflow | none | none |
| Columns | all 9 | 4 essentials |
| `npx tsc --noEmit` | clean (only 3 pre-existing errors in the untouched `_app.settlements.tsx`) | |
| Console errors / failed requests | 0 | 0 |

Temporary QA harnesses and screenshots (`qa-*.mjs`, `qa-*.png`, `dev*.log`) were **deleted**;
the tree is clean.

---

## 6. Remaining tasks for the next agent

### A. Create a branch and commit this work (user-requested, not yet done)
The user asked for a new branch with **organised commits** so the work can be pulled from `main`.
Working tree currently contains, in addition to this fix:

* Modified: many `src/components/ui/*.tsx`, `src/styles.css`, `src/components/app-shell.tsx`,
  `src/routes/_app.products.tsx`, several `src/lib/*` files, `src/routeTree.gen.ts`,
  `src/router.tsx`, plus new `src/components/ui/{connection,data-table,feedback,field-icons,
  form-field,form-layout,icon-button,list-page,modal,search-input,status-badge,table-toolbar}.tsx`
  and the whole `src/design/` directory.
* New docs in the repo root: `COMPONENT_INVENTORY.md`, `DATABASE_CHANGE_NOTES.md`, `DB.md`,
  `DESIGN_AUDIT.md`, `DESIGN_SYSTEM_IMPLEMENTATION.md`, `DESIGN_SYSTEM_PLAN.md`,
  `NON_UI_FINDINGS.md`.
* **Migrations (important):**
  * `supabase/migrations/20260917200000_link_superadmin_user_and_permissions.sql` — **modified**.
    A one-line fix: an `INSERT` policy had an invalid `USING` clause (Postgres allows only
    `WITH CHECK` for `INSERT`). That migration had never applied, which blocked **every later
    migration**. No data was touched.
  * `supabase/migrations/20260918000000_referential_safety_and_product_search.sql` — **new**,
    purely additive (new functions, `CREATE INDEX IF NOT EXISTS`, grants). No `ALTER`, `DROP`,
    `UPDATE`, `DELETE`, `INSERT` or backfill.
* Deleted: `ui-ux-pro-max-skill` (a tracked entry, shows as `D` in `git status`). **Confirm with the
  user before committing this deletion.**

Suggested commit split: (1) design system foundation, (2) products page migration, (3)
products sticky + mobile fixes, (4) migrations, (5) docs. Keep the branch in a working state —
Lovable syncs pushed commits back into the editor.

### B. Database migration is NOT applied
`npx supabase db push --include-all` requires the database password, which the agent does not have.
The app runs without it — `src/lib/safety.ts` detects the missing functions and falls back to
counting references with plain `SELECT`s.

### C. Known, deliberately unfixed items (documented, not bugs introduced here)
* `NON_UI_FINDINGS.md` — 10 items (silent `.limit(500)` truncation, a real data-loss path in
  product vehicle-compatibility on save, non-transactional stock math, hard deletes, etc.).
* `DATABASE_CHANGE_NOTES.md` — the `ON DELETE CASCADE` on `inventory`/`stock_movements` is still
  `CASCADE`; closing it properly is a separate approved task.
* The design system's docs claim `DataTable` supports `mobileMode="cards" | "compact" | "scroll"`.
  **That prop does not exist in the code.** The table is always a real table. The mobile strategy
  actually shipped is the responsive `hideBelow` + wrapping described above. Either implement
  `mobileMode` or correct the docs.

### D. Environment notes for whoever runs QA next
* Login for QA: the user supplied a superadmin account. Use **`page.type`**, not `page.fill` —
  the auth form is React-controlled and `fill` does not fire `onChange`, so submit is silently
  blocked and no network request is made.
* Supabase auth intermittently returns **HTTP 400** on `/auth/v1/token?grant_type=password` after
  repeated logins (rate limiting), and the auth page can take 20–130s to load on this machine.
  Retry rather than concluding the fix failed.
* `git` is not on `PATH`; use `C:\Program Files\Git\cmd\git.exe`.
* Fonts load from `fonts.googleapis.com`; that request has been seen to fail
  (`ERR_CONNECTION_RESET`) on this machine. Cosmetic, unrelated to this work, but worth knowing for
  an environment with weak connectivity.

---

## 7. Files changed by THIS work (and nothing else)

| File | Change |
| --- | --- |
| `src/components/ui/data-table.tsx` | sticky geometry (remove wrapper `overflow-x-auto`, `stickyTop` default `0px`, ResizeObserver → `--ds-toolbar-h`, thead `top: calc(...)`); `hideBelow` column option; responsive whitespace; `table-fixed` unless `minWidth`. |
| `src/routes/_app.products.tsx` | dropped `overflow-hidden` from the panel; `hideBelow` + explicit widths on columns. |