# NON-UI FINDINGS — Market Hub

> Per the task rules, **these were NOT fixed.** They are recorded only.
> Fixing them would touch business logic, query contracts, or data — outside the scope of a
> design-system task, and potentially risky against a live production database.

---

## N-01 · Client-side truncation is presented as a complete dataset (data-integrity risk to the user)

Every list page fetches a **capped** window and renders it as "the list", with no indication that more
rows exist and no pagination:

| Page | Fetch |
| --- | --- |
| `products` | `.limit(500)` |
| `sales` | `.limit(200)` |
| `purchases` | `.limit(200)` |
| `settlements` | `.limit(200)` |
| `payments` (customers) | `.limit(200)` |
| `audit` | `.limit(500)` |
| `batches` | `.limit(500)` |
| `transfers` / `finance` / `loyalty` / `purchase-returns` / `sales-returns` / `barcodes` | `.limit(100)` … `.limit(1000)` |
| `notifications`, `platform-admin`, `finance` (top balances) | `.limit(50)` … `.limit(20)` |

**Impact:** a shop with >500 products (very plausible for this ERP) sees a silently truncated catalog;
worse, a supervisor auditing >500 entries may believe the list is complete. Search only searches the
fetched window, so a real product can appear "not found".

**Why not fixed here:** the correct fix is server-side pagination/search — a query-contract change.
The design system implements client-side pagination over what is already fetched, and `DataTable` shows
a row-range label so the user at least sees the window size. Nothing else was changed.

**Recommended follow-up (separate task):** paginate with `range()` + `count: "exact"`, or move to RPC.

---

## N-02 · Product edit loads vehicle compatibility with a race condition and no error handling

`src/routes/_app.products.tsx` (~547–557): the edit dialog fires a second query for
`product_compatibilities` in a `useEffect` and calls `.then(({ data }) => setCompatibleModels(...))`
with no `error` branch and no cancellation — an out-of-order or failed response silently leaves the
fitment list empty, and on save the code **deletes all existing `product_compatibilities` rows and
reinserts only what is currently in state** (lines ~593–602).

**Impact:** if that secondary fetch fails or resolves late, saving an untouched product can wipe its
vehicle-compatibility links. **This is a real data-loss path.**

**Why not fixed here:** it is business/storage logic. Not touched.

**Recommended follow-up:** load compatibility together with the product in the primary query, handle the
error explicitly, and abort the save (or the delete) when the load failed.

---

## N-03 · Inventory / stock mutation paths read-then-write without transactions

Several flows (`pos`, `purchases`, `inventory` adjustments, `transfers`, `sales-returns`,
`purchase-returns`) perform sequential client-side `select` → compute → `update`/`insert` calls against
`inventory` / `stock_movements` rather than a single database transaction or RPC.

**Impact:** two concurrent operations (two POS terminals, or POS + a purchase receipt) can interleave and
produce wrong stock quantities or lost movements. There is no optimistic-concurrency guard.

**Why not fixed here:** correctness of stock math is backend/business logic.

**Recommended follow-up:** move each stock mutation into a single Postgres function with row locking.

---

## N-04 · Native `confirm()` used for destructive actions (also an a11y/UX issue)

`grep` finds 9 call sites: `batches:95`, `catalog:416`, `customers:131`, `finance:170`,
`warehouses:209`, `users:143`, `users:152`, `products:449`, `suppliers:79`.

**Impact:** unstyled, blocking, English-labelled (`OK`/`Cancel`) in an Arabic-first UI, and it cannot show
*what* is being deleted or the consequences (e.g. "this product has stock movements").
It is also the only delete-affordance on some pages, so a mis-tap + `Enter` deletes a record.

**Why not fixed here:** replacing it is in scope (it's UI), and the design system ships a
`ConfirmDialog`; **but** the underlying delete behaviour (hard delete via
`supabase.from(...).delete()`) is **not** changed. See N-05.

---

## N-05 · All deletes are hard deletes with no recovery

`products`, `customers`, `suppliers`, `warehouses`, `product_batches`, `expenses`, `user_roles` are deleted
with `.delete()` — no soft-delete, no undo, no archive, and no pre-delete guard for referential usage
(e.g. deleting a product that appears on historical invoices, or a supplier with purchase history).

**Impact:** irreversible loss of business records; historical documents can lose their referenced names.

**Why not fixed here:** requires schema change (`deleted_at` / archive tables) and FK policy decisions.
Recorded in `DATABASE_CHANGE_NOTES.md` as a deliberate non-goal.

---

## N-06 · Products list effectively hides cost price from most roles

`canViewCost` in `_app.products.tsx` allows only `platform admin`, `platform superadmin`, `owner`,
`manager`, `accountant`. `warehouse` and `cashier` therefore cannot see cost — reasonable — but the
**column is also removed entirely**, changing the table's column count and its hand-computed `colSpan`
arithmetic. Any future column addition must update three interdependent expressions.

**Impact:** latent layout bug risk; also, the policy is defined inline in a page rather than centrally,
so it cannot be audited or reused (e.g. POS purchase price, purchases list).

**Why not fixed here:** the permission policy itself is a product decision.

**Recommended follow-up:** centralize capability checks (e.g. `can("cost.view")`) in `src/lib/auth.tsx`
— this is a *non-UI* refactor, so it was left alone.

---

## N-07 · `product_compatibilities`, `countries_of_origin`, `quality_grades`, `vehicle_*` are accessed with `(supabase as any)`

Multiple places cast the client to `any` because these tables are not in the generated
`src/integrations/supabase/types.ts`. This defeats type safety on catalog columns and is a likely source
of silent typos (column renames would fail only at runtime).

**Impact:** no compile-time protection; runtime errors surface as empty lists (see N-02).

**Why not fixed here:** regenerating types is a backend/tooling task against the live schema.

---

## N-08 · `settings` writes and `company_settings` reads are untyped and last-write-wins

`company_settings` is read with `select("*")` + `.limit(1).maybeSingle()` in several pages
(`sales:56`, `pos:227`, `pos:327`, `settings:77`, `auth:55`, `barcodes:107`) and cached in
`localStorage` (`format.ts`). There is no single source of truth for company settings in the frontend, so
different pages can hold different cached copies.

**Impact:** stale currency symbol / company name can be rendered or printed until a reload.

**Why not fixed here:** caching/state architecture, not design.

---

## N-09 · Notification badge is hard-coded

`app-shell.tsx` renders the notification dot unconditionally
(`<span className="absolute top-2 end-2 h-1.5 w-1.5 rounded-full bg-primary …" />`), with no unread count
query. Users either ignore it permanently (trained to) or are permanently told they have notifications.

**Impact:** a real UX problem, but the fix is a data query + read-state model — outside UI scope.

---

## N-10 · Inline bilingual ternaries duplicate the i18n dictionary

Many pages write `lang === "ar" ? "…" : "…"` inline instead of using `t()`, while the same concept already
has a key in `src/lib/i18n.tsx` (e.g. `common.confirm_delete`, `products.deleted`). Consequences:
strings drift, some UI is Arabic-only, some is English-only, and translation review is impossible.

**Impact:** maintainability + consistency, not runtime.

**Why not fixed here:** extracting all inline strings into `i18n.tsx` would be a very large,
review-heavy change that touches 30+ files and could introduce wrong translations in a production UI.
The design system adds the *new* strings it needs as keyed entries (`ds.*`) and leaves existing copy
in place; consolidating the legacy strings is a recommended follow-up in `DESIGN_SYSTEM_IMPLEMENTATION.md`.

---

## Summary

| ID | Area | Severity | Touches |
| --- | --- | --- | --- |
| N-01 | Silent truncation / fake completeness | **High** | Query contract |
| N-02 | Vehicle compatibility can be wiped on save | **High (data loss)** | Business logic |
| N-03 | Non-transactional stock mutations | **High** | Business logic / DB |
| N-04 | Native `confirm()` | Medium | UI (partially addressed: `ConfirmDialog` shipped) |
| N-05 | Hard deletes, no recovery | Medium | Schema |
| N-06 | Inline permission policy + fragile colSpan | Medium | Auth policy |
| N-07 | `as any` on catalog tables | Medium | Types |
| N-08 | `company_settings` caching | Low/Medium | State |
| N-09 | Hard-coded notification dot | Low | Data |
| N-10 | Inline bilingual strings | Low | i18n |

**None of the above were fixed in this task.**