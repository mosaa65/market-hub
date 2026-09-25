# Market Hub Design System — Developer Guide

> Read this before touching UI code. It explains the rules that make a central change
> propagate to the whole app.

---

## 1. The three layers

```
Layer 0  Tokens      src/styles.css  ·  src/design/tokens.ts
Layer 1  Primitives  src/components/ui/*        (Button, Input, Modal, DataTable…)
Layer 2  Patterns    src/components/ui/list-page.tsx, form-layout.tsx, form-field.tsx
Layer 3  Pages       src/routes/_app.*.tsx      (data + copy only)
```

**Rule:** a page (Layer 3) may not contain a long Tailwind class string for a control.
If it needs one, a primitive is missing — add it to Layer 1/2 instead.

---

## 2. Where to change what

| To change… | Edit |
| --- | --- |
| Control height / radius / focus ring | `src/design/styles.ts` → `fieldSize`, `fieldSurface` |
| Button size or variant | `src/components/ui/button.tsx` → `buttonVariants` |
| Colour, radius scale, shadow, motion, z-index | `src/styles.css` → `@theme inline` |
| Status pill (any colour, any page) | `src/styles.css` → `--tone-*` (both themes) |
| Empty / loading / error appearance | `src/components/ui/feedback.tsx` |
| Table density, sticky header, pagination | `src/components/ui/data-table.tsx` |
| Toolbar / filter / sort responsive layout | `src/components/ui/table-toolbar.tsx` |
| Modal desktop↔mobile behaviour | `src/components/ui/modal.tsx` |
| Number / Arabic-digit parsing | `src/design/number.ts` |

Changing a value in the left column changes **every** page. That is the point.

---

## 3. Tokens

Tokens live in two places for two audiences:

- **`src/styles.css`** — the source of truth for anything CSS can read.
  Exposed to Tailwind via `@theme inline`, so `bg-surface`, `text-muted-foreground`,
  `border-border`, `text-caption` all resolve to variables.
- **`src/design/tokens.ts`** — a mirror of only what JavaScript needs
  (control heights, durations, breakpoints, z-index, chart series).

### Available semantic families

```
Colors      background · surface · surface-2 · surface-3 · surface-elevated ·
            foreground · muted-foreground · primary · secondary · accent ·
            border · input · ring · success · warning · destructive
Tones       tone-neutral · tone-info · tone-success · tone-warning ·
            tone-danger · tone-primary   (+ -fg foreground variants)
Radius      --radius-control (10px) · --radius-panel (16px) · --radius-chip ·
            --radius-sheet (24px)
Elevation   --shadow-control · --shadow-panel · --shadow-popover · --shadow-overlay
Motion      --duration-fast/normal/slow · --ease-standard/emphasized/exit
Layers      --z-header · --z-dropdown · --z-overlay · --z-modal · --z-toast
Type        .text-title · .text-section · .text-label · .text-caption · .text-cell-num
```

**Never** write a literal palette colour (`bg-emerald-500/10`, `text-sky-700`,
`bg-violet-500/15`) — it breaks in light mode and bypasses theming. Use a tone.

---

## 4. Component recipes

### Button

```tsx
<Button>Primary</Button>
<Button variant="outline" size="sm" icon={<Plus />}>New</Button>
<Button variant="danger" loading={deleting} onClick={remove}>Delete</Button>
<IconButton ariaLabel={t("common.edit")} icon={<Pencil />} tooltip />

// Link styled as a button
<Button asChild variant="outline"><Link to="/products">Products</Link></Button>
```

- `ariaLabel` is **required** on `IconButton`. `title` alone is not an accessible name.
- `size="md"` (h-9) matches `FieldInput` size `md`, so a button and an input on one row line up.
- If a button's text is `hidden sm:inline`, pass `aria-label` — otherwise it is nameless on mobile.

### Field

```tsx
<FormField label="Product name" required hint="Shown on invoices" error={errors.name}>
  {(p) => <FieldInput {...p} value={name} onValueChange={setName} />}
</FormField>
```

`FormField` supplies `id`, `aria-describedby`, `aria-invalid`, and renders the label as a real
`<label htmlFor>`. A plain child also works (`<FormField label="X"><FieldInput /></FormField>`).

### Numeric / money

```tsx
<NumberInput value={qty} onValueChange={setQty} min={0} decimal={false} />
<CurrencyInput value={price} onValueChange={setPrice} />        // suffix = company currency
<PercentInput value={tax} onValueChange={setTax} max={100} />   // suffix = %
```

Numeric fields reject `12abc45`, use a numeric keypad on mobile, and transliterate `١٢٣` → `123`.

### Arabic digits — the rule

| Field kind | Digits normalized? | Why |
| --- | --- | --- |
| `number`, `decimal`, `currency`, `percent`, `integer` | **Yes** | Quantities and amounts |
| `phone`, `tel` | **Yes** | Users legitimately type `٠٧…` |
| `text`, `email`, `password`, `url`, `search`, dates | **No** | Normalizing identifiers corrupts data |
| SKU / barcode / product code (typed as `text`) | **No** | Must stay byte-identical |

If you need normalization on a text-like identifier, do it in the business layer, not the UI.

### Form layout & actions

```tsx
<FormGrid cols={3}>
  <FormField ... /><FormField ... /><FormField span="full" ... />
</FormGrid>

<FormActions
  cancel={<Button variant="outline" onClick={onClose} block>Cancel</Button>}
  submit={<Button type="submit" loading={saving} block>Save</Button>}
/>
```

`FormGrid` collapses 3 → 2 → 1. Use `span="full"` for wide fields (vehicle fitment picker).

### Modal

```tsx
<Modal
  open={open}
  onClose={onClose}
  size="lg"                                  // sm | md | lg | xl | full
  title="New product"
  eyebrow="Create"
  footer={<FormActions … />}
>
  …
</Modal>
```

Behaviour, all in one place: desktop centred dialog → **mobile bottom sheet** (`xl`/`full` become
full-screen), Escape to close, overlay click, focus trap, focus restore, scroll lock without layout
shift, `role="dialog"` + `aria-modal`, RTL-aware close button, safe-area padding on the footer.

- `dismissible={false}` for unsaved-data confirmations.
- `ConfirmDialog` replaces native `confirm()`. Note: it changes the *dialog*, **not** the delete.

### List page

```tsx
<ListPage
  columns={columns}
  rows={filtered}
  rowKey={(r) => r.id}
  loading={isLoading}
  error={error}
  onRetry={refetch}
  mobileMode="cards"                          // cards | compact | scroll
  search={{ value: q, onValueChange: setQ, placeholder: t("products.search") }}
  filters={{ definitions, values, onValueChange: setFilters }}
  toolbarSort={{ options, value: sortKey, onValueChange: setSortKey }}
  action={<Button icon={<Plus />} aria-label={t("common.new")} onClick={openNew}>…</Button>}
  empty={{ icon: <Package />, title: t("products.no_products") }}
  summary={<SummaryStrip items={[…] />}
/>
```

### Column definition

```tsx
const columns: DataTableColumn<ProductRow>[] = [
  { key: "name",  header: t("products.product"), sortable: true, priority: "primary",
    sortValue: (p) => p.name, cell: (p) => <span>{p.name}</span> },
  { key: "price", header: t("common.price"), align: "end", sortable: true, priority: "primary",
    sortValue: (p) => Number(p.sale_price), cell: (p) => <span className="font-mono">{…}</span> },
  { key: "cost",  header: t("common.cost"), align: "end", priority: "secondary",
    hidden: !canViewCost, cell: (p) => … },
];
```

`priority` decides the mobile representation:

| value | cards mode | compact mode |
| --- | --- | --- |
| `primary` | title + key/value rows | always shown |
| `secondary` | behind a **More** expander | behind a row expander |
| `hidden-mobile` | never | never |

`hidden` removes a column entirely (permission gating) — preferable to conditional array
building, and it removes the fragile `colSpan` arithmetic the old tables used.

### Mobile strategy — pick per data type

| Table type | `mobileMode` | Why |
| --- | --- | --- |
| Record lists (products, customers, suppliers, sales, purchases, batches, payments) | `cards` | Each row is an independent record |
| Comparative grids (inventory, catalog, users, audit, settlements) | `compact` | Keeping columns aligned matters more than cards |
| Financial matrices (trial balance, journal, statement, P&L, balance sheet) | `scroll` | Debit/credit column relationship must survive |

Never shrink a desktop table with `min-width` and call it responsive. The old global
`.overflow-x-auto > table { min-width: 680px }` hack has been removed.

### Status

```tsx
<StatusBadge tone={c.is_active ? "success" : "neutral"} dot>…</StatusBadge>
<StatusBadge tone={documentStatusTone(invoice.status)}>…</StatusBadge>
<StatusBadge tone={stockTone(qty, min)}>{qty}</StatusBadge>
```

`documentStatusTone` **reads existing status strings and maps them to a colour** — it never
normalizes, persists or changes a value.

### Loading / empty / error

```tsx
<EmptyState icon={<Package />} title="…" description="…" action={<Button />} />
<LoadingState label="Loading…" />
<ErrorState description={error.message} onRetry={refetch} />
<Spinner />
```

`DataTable` renders these automatically from `loading` / `error` / `empty` — don't hand-write
`<tr><td colSpan>` blocks.

---

## 5. Accessibility rules (non-negotiable)

1. Every icon-only control needs `ariaLabel` (`IconButton` enforces it at the type level).
2. Every input needs a label associated via `FormField` (`htmlFor` + `id`), not a visual `<span>`.
3. Errors are inline and `role="alert"` — not a toast-only notification.
4. Overlays use `Modal`; never hand-roll a `fixed inset-0` shell (you will lose focus trap,
   Escape, `aria-modal` and scroll lock).
5. The first column of a table is `<th scope="col">`; sortable headers set `aria-sort`.
6. Motion honours `prefers-reduced-motion` (global rule in `styles.css`).
7. Tap targets ≥ 40px on mobile (`size="md"` or larger).

---

## 6. Adding a new page — checklist

1. `PageHeader` (title, subtitle, actions).
2. Build `columns: DataTableColumn<T>[]` with `priority` on every column.
3. Render `<ListPage …>`; choose `mobileMode` from the table above.
4. Free-text search via `search={…}`; structured filters via `filters={{ definitions, values, onValueChange }}`.
5. Filtering helpers: `applySearch(rows, query, (r) => [r.a, r.b])` and
   `applyFilters(rows, values, accessors, { dateAccessors })` — **client-side over the rows already fetched**.
6. Add/edit in a `<Modal>` with `FormGrid` + `FormField`.
7. Delete via `<ConfirmDialog>`.
8. Run `npm run lint` and `npm run build`.
9. Check the page at **390 / 768 / 1280 / 1536 px** and verify
   `document.documentElement.scrollWidth <= window.innerWidth` (no accidental horizontal scroll).

---

## 7. What you must NOT do

- Do not add colour literals — use tone tokens.
- Do not use `!important` (the only intentional `!important` is the global
  `prefers-reduced-motion` override in `styles.css`).
- Do not use `overflow: hidden` to hide a layout bug, or `transform: scale()` to shrink the UI on mobile.
- Do not add a page-local `inputCls` / `Field` / search bar / modal shell — reuse the primitives.
- Do not touch Supabase queries, payload keys, table or column names while refactoring UI.
- Do not delete an old component until `grep` proves zero remaining usages.
- Do not change business logic. Log findings in `NON_UI_FINDINGS.md` instead.
