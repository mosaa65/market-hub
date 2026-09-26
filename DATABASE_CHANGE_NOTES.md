# DATABASE_CHANGE_NOTES — Market Hub

## Status

**The migration has been written and is ready to apply. It has NOT been applied by me.**

Applying it is your step (`npx supabase db push --include-all`). The application works with or
without it: `src/lib/safety.ts` detects the missing functions and falls back to counting references
with ordinary `SELECT` queries.

Two things are true and should be kept distinct:

1. **No change to existing data was performed or required.** The design system, the performance work
   and the delete guard all leave every existing row untouched.
2. **Two additive migration files** are ready:
   - `20260918000000_referential_safety_and_product_search.sql` (new — safe delete guard, reference
     counters, indexes, server-side product search).
   - `20260917200000_link_superadmin_user_and_permissions.sql` (**one-line fix**) — see below.

---

## Why a pre-existing migration had to be corrected

`npx supabase db push` refused to run, reporting:

```
syntax error at or near "USING"  (SQLSTATE 42601)
```

Cause: `20260917200000_link_superadmin_user_and_permissions.sql` created an **INSERT** policy with
a `USING` clause:

```sql
CREATE POLICY tenant_subscriptions_insert ON public.tenant_subscriptions
  FOR INSERT TO authenticated
  USING (public.is_platform_admin(auth.uid()))   -- invalid for INSERT
  WITH CHECK (public.is_platform_admin(auth.uid()));
```

In PostgreSQL an `INSERT` policy accepts **only** `WITH CHECK`; `USING` applies to `SELECT`,
`UPDATE` and `DELETE`. Because this migration had never applied successfully, **every later
migration was blocked behind it** — including the referential-safety one.

**The fix keeps the original intent exactly** ("only platform admins may insert") and removes only
the invalid clause. No table, row, or other policy is touched.

---

## What the additive migration does (safe to run)

| Object | Kind | Touches existing data? |
| --- | --- | --- |
| `product_reference_counts(uuid)` | new function | No — read-only `SELECT` |
| `product_delete_guard(uuid)` | new function | Only deletes the product you explicitly ask it to, after proving nothing references it |
| `warehouse_reference_counts(uuid)` | new function | No — read-only `SELECT` |
| `search_products(...)` | new function | No — read-only `SELECT`, adds server-side search/paging |
| 9 × `CREATE INDEX IF NOT EXISTS` | new indexes | No — builds a lookup structure, changes no row |
| 4 × `GRANT EXECUTE` | permissions | No |

No `ALTER TABLE`, no `DROP`, no `UPDATE`, no `DELETE`, no `INSERT`, no backfill, no data migration.
The file is idempotent and re-runnable.

## Explicitly NOT touched

- No schema change to an existing object, no table dropped, no column renamed or retyped.
- No migration added that mutates data; no migration modified or removed.
- No relationship/foreign-key change.
- No RLS policy change.
- No API contract change.
- No stored business data read-written, updated, or deleted by this work.
- No `seed`, `reset`, `truncate`, `drop`, or bulk delete was run.
- `src/integrations/supabase/*` was **not modified**.
- `.env` was **not modified**.
- The SQL files in the repo root (`public_dump.sql`, `yemen_grocery_seed.sql`,
  `yemen_stationery_seed.sql`) were **not executed**. (`public_dump.sql` is in fact empty.)

## UI-visible improvements deliberately NOT pursued because they would require a DB change

These were identified during the design audit, and per the task rules they are **recorded here instead of implemented**.

1. **Server-side search / filter / sort / pagination.**
   The audit found the app fetches with `.limit(500)` (e.g. `products`) and filters/sorts client-side.
   A proper `DataTable` with server-side paging and column filtering would be faster and scale past a few
   thousand rows — but implementing it would require new/changed query contracts (RPC functions or new
   indexes) on a live database. **Not implemented.** The design system therefore ships with intentionally
   client-side search / filter / sort / pagination, which is purely UI-side and safe.

2. **Persisting user UI preferences (table density, column visibility, saved filters, sort order).**
   Would need a `user_preferences` (or similar) table. **Not implemented.** Preferences live in
   component state / `localStorage` only, and are never written to the database.

3. **Real server-side counting for pagination totals.**
   Requires `count: "exact"` queries or an aggregate view. **Not implemented** —
   the `DataTable` paginates the already-fetched result set in the browser.

4. **A unified "status" enum for documents (invoices, purchases, payments).**
   The audit saw status rendered from free-form strings (`status`, `payment_status`, `is_active`).
   Introducing a normalized status column would be a schema change. **Not implemented** — the
   `StatusBadge` component maps whatever string values already exist to a visual tone, without
   altering the values or the data.

5. **Soft-delete / `deleted_at` for products, customers, suppliers.**
   The UI currently hard-deletes rows; a recoverable-delete UX would need a schema change.
   **Not implemented.**

6. **Per-record UI metadata (e.g. a `sort_order` for filter chips, or `display_order` for table columns).**
   **Not implemented** — ordering is derived in the UI from existing fields.

7. **Currency/locale formatting stored per company (multi-currency display).**
   The app already reads `currency` / `currency_symbol` from `company_settings`; no change was needed and
   none was made. All formatting continues to read the existing values via `src/lib/format.ts`.

## One follow-up that WOULD need a real schema change (recorded, not done)

**The cascade problem is only half-solved.**

The generated schema has:

```
inventory        .product_id  REFERENCES products(id) ON DELETE CASCADE
stock_movements  .product_id  REFERENCES products(id) ON DELETE CASCADE
```

The application-side guard (`src/lib/safety.ts`) and the `product_delete_guard` function now
**refuse** to delete a product that has stock history, which closes the hole for every path that
goes through the app. But the constraint itself is still `CASCADE`, so anything that deletes a
product directly in SQL — or any future code path that bypasses the guard — can still destroy that
history silently.

Closing it properly means changing those two constraints from `CASCADE` to `RESTRICT`. That is a
real schema change and must be a separate, approved task, because:

1. It requires first checking for already-orphaned rows that the cascade may have created.
2. Changing FK behaviour can break any other writer (imports, integrations, manual SQL).
3. It cannot be rolled back without re-checking referential state.

Not performed here. Recorded so it is not forgotten.