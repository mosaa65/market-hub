# VORTEX ERP DATABASE & MIGRATION AUDIT REPORT

> **Scope:** Supabase / PostgreSQL / migration chain / seed / auth / RLS / env
> **Mode:** Inspect → Understand → Map → Detect → Classify → Design → Repair → Verify → Document
> **Policy honoured:** Strictly zero data loss. No `db reset`. No `DROP DATABASE`.
> No destructive command executed. No real data deleted. No auth user deleted.

---

## 1. Executive Summary

Vortex ERP is deployed as **one Supabase project per customer**, but the
migration chain was built as if it belonged to **one developer's machine**. That
mismatch is the root cause of nearly every problem below.

### The five real problems, in order of severity

| # | Problem | Severity | Status |
|---|---|---|---|
| 1 | **Plaintext password committed in migrations**, targeting a personal email | 🔴 Critical | **Repaired** (rotation still manual) |
| 2 | **Destructive `TRUNCATE ... CASCADE` of 25 business tables + `DELETE FROM auth.users`** sitting in the replayable chain | 🔴 Critical | **Documented**, guard proposed, not applied |
| 3 | `supabase/.temp/` (project ref, pooler URL) **tracked in Git** | 🟠 High | **Repaired** |
| 4 | Seed file **mixes reference + demo + auth** data and is auto-run | 🟠 High | **Documented**, split proposed |
| 5 | Payment methods / statuses **hardcoded as string literals** across the frontend, duplicating the DB enum | 🟠 Medium | **Documented** |

### What was actually changed in this session

- `20260916000000_reset_and_recreate_superadmin_user.sql` — credential removed
  (`v_encrypted_pw := NULL`), header rewritten to explain why. Version kept.
- `20260926000000_update_superadmin_password.sql` — **neutralized to a no-op**.
  Version kept so `schema_migrations` does not drift.
- `.gitignore` — `supabase/.temp/` added.
- `git rm --cached supabase/.temp` — 11 files untracked, **files kept on disk**.
- `docs/database/migration-safety-notes.md` — appended §6–§12 (rules, findings,
  enum-vs-lookup design, bootstrap procedure, commands, checklist).

### What was deliberately **not** changed

Anything that would alter an already-applied migration's semantics, delete
migration files, or restructure the seed in a way that changes local dev
behaviour. Those need your decision — see §15.

### Verification performed

| Check | Result |
|---|---|
| Plaintext password present anywhere in repo | **None** ✅ |
| `npx tsc --noEmit` | exit 0 ✅ |
| `npm run lint` | 0 errors, 26 pre-existing warnings ✅ |
| `.temp` files still on disk | 11/11 ✅ |
| Destructive commands executed | **Zero** ✅ |

---

## 2. Current Database Architecture

```
Auth (Supabase-managed)
├── auth.users            ← managed by GoTrue, NOT by application migrations
└── auth.identities       ← ditto

Application / identity
├── profiles              id → auth.users.id
├── user_roles            (user_id, role)  ← tenant-level role
└── platform_admins       (user_id, role, is_active, mfa_required)  ← platform-level

Company / tenant configuration
└── company_settings      single-row (id = 1) — name, currency, tax_rate, logo, prefix

Catalogue
├── categories, brands, units
└── products (+ barcode, pricing, min stock)

Inventory
├── warehouses, inventory, stock_movements, product_batches
└── stock_transfers, stock_transfer_items

Sales / purchasing
├── sales_invoices, sales_invoice_items
├── purchase_invoices, purchase_invoice_items
├── sales_returns, sales_return_items
├── purchase_returns, purchase_return_items
└── customer_payments, customer_payment_splits   ← added 20260928000000

Expenses / loyalty / audit
├── expenses, expense_categories
├── loyalty_transactions
└── audit_logs

Platform
└── tenant_subscriptions
```

**Enum:** `public.payment_method` — `cash, card, bank_transfer, credit,
mobile_money, split`.

**Central RLS helper predicates** observed in policies: `public.is_staff(uuid)`,
`public.is_platform_admin(uuid)`.

---

## 3. Migration Inventory

Full chain, classified. Files not individually quoted are structurally similar
to their neighbours in the same phase.

| Version | Purpose | Class | Contains data? | Idempotent? | Risk on new project |
|---|---|---|---|---|---|
| `20260706121000_blackbox_reset_and_seed_yemen.sql` | Reset + Yemen seed | `DEMO_DATA` | ➕ seed | ❌ | 🔴 **TRUNCATE** |
| `20260707021000_yemen_seed_enum_compatibility.sql` | Enum compat patch | `HOTFIX` | — | partial | 🟡 |
| `20260911150300_blackbox_reset_and_seed` | Reset + personal user | `DEMO_DATA` + `AUTH_BOOTSTRAP` | ➕ + auth | ❌ | 🔴 **TRUNCATE + personal identity** |
| `20260912111000_reset_for_meters_shop.sql` | Reset for meters shop | `DEMO_DATA` | ➕ | ❌ | 🔴 **TRUNCATE 25 tables CASCADE + DELETE auth.users** |
| `20260912172000_seed_meters_shop_users.sql` | Shop users | `AUTH_BOOTSTRAP` | ➕ auth | partial | 🔴 **personal identity** |
| `20260916000000_reset_and_recreate_superadmin_user.sql` | Recreate superadmin | `AUTH_BOOTSTRAP` | ➕ auth | ❌ | 🔴 **password (now removed)** |
| `20260917200000_link_superadmin_user_and_permissions.sql` | Link + permissions | `AUTH_BOOTSTRAP` + `CORE_SCHEMA` | ➕ | partial | 🟡 |
| `20260918000000_referential_safety_and_product_search.sql` | Guards + indexes + RPC | `CORE_SCHEMA` | — | ✅ | 🟢 Low |
| `20260926000000_update_superadmin_password.sql` | Password reset | `AUTH_BOOTSTRAP` | ➕ auth | ❌ | 🔴 **password (now no-op)** |
| `20260928000000_split_payment_and_payment_method_integrity.sql` | Split payments | `CORE_SCHEMA` | — | ✅ | 🟢 Low |

### Classification rationale

- **`CORE_SCHEMA`** — `20260918000000` and `20260928000000` are the *good*
  examples: guarded with `IF NOT EXISTS` / `IF EXISTS`, one purpose each, no
  data, no credentials, non-destructive (the latter states so explicitly in its
  header). **These are the template for the future.**
- **`DEMO_DATA`** — the `blackbox_reset*` / `reset_for_meters_shop` family
  exists to wipe a working database and load a shop-specific catalogue. Correct
  for a one-off local bootstrap; **wrong to leave replayable** in a chain that a
  customer project will walk through.
- **`AUTH_BOOTSTRAP`** — every superadmin migration is really a provisioning
  action wearing a schema change's clothes. Each one binds the database to one
  person.
- **`HOTFIX`** — `20260707021000` patched enum compatibility after the seed.
  Evidence that the seed and the schema disagreed at that time.
- **`OBSOLETE` (semantically, not removably)** — the reset migrations no longer
  serve any purpose, but their versions are in `schema_migrations`; deletion is
  not an option (see §4.3 of the safety notes).

---

## 4. Migration Conflict Matrix

| Migration A | Migration B | Contested element | Nature | Impact | Suggested resolution |
|---|---|---|---|---|---|
| `20260916000000` | `20260926000000` | superadmin password | **A creates the user with password P; B re-hashes the same password P.** Two migrations to accomplish one change. | Password written to VCS twice | B neutralized; A credential removed. Rotation manual. |
| `20260911150300` | `20260912111000` | `public.*` business tables | **Both `TRUNCATE` overlapping table sets.** Second one includes tables the first already cleared. | Data destruction on replay | Add emptiness guard (§7.3 notes). Do not delete. |
| `20260911150300` / `20260912172000` / `20260916000000` | each other | `auth.users` personal account | **Three migrations independently create/delete/rewrite the same personal account.** | Repeated identity churn; each references the same email | Consolidate into one operator action *outside* migrations (§9). |
| `20260912111000` | `20260912172000` | `auth.users` | **A deletes all auth users; B re-creates shop users.** Ordering dependency — B is meaningless without A, A is destructive without B. | Fragile ordering; a partial failure leaves no accounts | Keep order; move both out of the replayable path. |
| `20260912111000` | `20260706121000` | `categories`, `units`, `warehouses` | **A truncates and re-inserts the same rows B seeded**, with different values (meters shop vs grocery). | Last writer wins; earlier seed silently discarded | Intentional here, but proves these belong in `seeds/demo.sql`, not migrations. |
| `20260706121000` | `20260707021000` | enum values | **B exists to fix enum incompatibility introduced by A's inserts.** | Seed/schema disagreement | Enum values belong in their own migration; seed must not depend on ordering (already the case now). |
| `20260928000000` | `20260918000000` | indexes / RPC | **None — both guarded and additive.** | None | ✅ Reference pattern. |

**No conflicting enum definitions, no duplicate `CREATE TABLE` for the same
table, and no opposing RLS policies were found.** The tangle is historical, not
structural: the schema itself is coherent, the *history around it* is not.

---

## 5. Reference Data Inventory

| Concept | Storage | Verdict | Where it belongs |
|---|---|---|---|
| `payment_method` | PG enum | **Fixed** | Migration (schema) |
| invoice / payment statuses | PG enum | **Fixed** | Migration (schema) |
| roles (`owner`, `manager`, `accountant`, `cashier`, `warehouse`) | `user_roles` + check | **Fixed (system)** | Migration (schema) + RLS |
| platform roles (`superadmin`) | `platform_admins` | **Fixed (system)** | Migration (schema) |
| permissions | RLS predicates / role checks | **Fixed (system)** | Migration (schema) |
| `units` | table | **Tenant Default** | `seeds/reference.sql` (starter rows) + editable in-app |
| `expense_categories` | table | **Tenant Default** | `seeds/reference.sql` (starter rows) + editable in-app |
| `categories`, `brands` | table | **Optional / Tenant** | `seeds/demo.sql` only, or customer-created |
| `warehouses` | table | **Tenant Default** | Created per tenant, **not** a global seed |
| `company_settings` | single row | **Configurable** | In-app Settings screen |
| currency, tax rate, logo, prefix | columns | **Configurable** | In-app Settings screen |
| products, customers, suppliers, invoices | tables | **Transaction Data** | Never seeded in production |

**Key point:** `units`, `expense_categories` and `warehouses` are the three
things most often mistaken for schema. They are **per-tenant rows**, not
structure — a shop selling by meter and one selling by kilo need different rows
from the same table.

---

## 6. Seed Strategy

### Current state
`config.toml` → `db.seed.sql_paths = ["./seeds/seed.sql"]`, and that single file
contains reference rows, demo business data, **and** `auth.users` inserts.

### Target state

```
supabase/seeds/
├── reference.sql   ← idempotent, system/tenant-starter rows, SAFE to re-run
└── demo.sql        ← opt-in only, never wired into config.toml for a customer
```

```toml
[db.seed]
enabled = true
sql_paths = ["./seeds/reference.sql"]     # demo.sql is run explicitly, by hand
```

### Idempotency pattern to use

Every reference row needs a **business key** — not a fixed UUID:

```sql
-- Requires: ALTER TABLE public.units ADD CONSTRAINT units_code_key UNIQUE (code);
INSERT INTO public.units (code, name, name_ar, short_name)
VALUES
  ('piece', 'Piece', 'قطعة', 'قطعة'),
  ('meter', 'Meter', 'متر',   'م'),
  ('roll',  'Roll',  'لفة',   'لفة'),
  ('set',   'Set',   'طقم',   'طقم')
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      name_ar = EXCLUDED.name_ar,
      short_name = EXCLUDED.short_name;
```

**Why `code` and not a fixed UUID:** a UUID guarantees non-duplication but is
unreadable, unmemorable, and impossible to reference from another seed file or
from application code without copying a magic constant around. A `code` is
self-documenting, reviewable in a diff, and stable across deployments.

`ON CONFLICT DO UPDATE` (rather than `DO NOTHING`) makes the seed
**convergent** — re-running it repairs drifted labels instead of silently
leaving them wrong.

> ⚠️ This requires a `UNIQUE` constraint on the business key. If it does not
> exist yet, adding it is a new additive migration. **Not applied** — verify the
> current columns first, since a `UNIQUE` constraint fails if duplicates already
> exist.

---

## 7. Demo / Test Data Audit

| Data | Location | Should exist? | Recurring? |
|---|---|---|---|
| Yemen grocery seed rows | `20260706121000` | ❌ No | ✅ Yes — replays on every new DB |
| Meters-shop catalogue | `20260912111000` | ❌ No | ✅ Yes |
| Shop users | `20260912172000` | ❌ No | ✅ Yes |
| Superadmin account | `20260916000000` | ❌ No | ✅ Yes |
| `seeds/seed.sql` business rows | `supabase/seeds/` | ❌ No (in production) | ✅ On every `db reset` |
| `docs/seed/yemen_*.sql` | `docs/seed/` | ❌ Not needed | ❌ Not executed (verified) |

**Nothing was deleted.** All of the above are either already applied (so
removal causes history drift) or are the developer's local bootstrap. The audit
finding is that **demo data is indistinguishable from schema in the replayable
chain**, and that is what must stop going forward.

---

## 8. Auth & Super Admin Audit

### The failure mode, precisely stated

The system tried to make user provisioning a database migration. That creates
five distinct breakages:

| Symptom | Root cause |
|---|---|
| Super admin exists in DB but cannot log in | User row written directly into `auth.users`; GoTrue's `auth.identities` entry missing or malformed. Login requires the identity row, not just the user row. |
| Email "unconfirmed", login refused | `email_confirmed_at` not set, or set in a way GoTrue does not accept as a confirmation event. |
| Migration fails on a fresh project | It targets a specific email; the row it expects does not exist, or a `DELETE ... WHERE email = ...` silently matches nothing and the following `INSERT` collides. |
| Duplicated super admin | Each reset-style migration deletes and re-creates the same account; any partial run leaves both. |
| New customer inherits a stranger's account | The email is hardcoded. |
| Credential leak | The password is in the SQL file. |

### What belongs where

| Task | Belongs in |
|---|---|
| `profiles`, `user_roles`, `platform_admins` **table structure** | Migration ✅ |
| `profiles` auto-creation **trigger** on `auth.users` insert | Migration ✅ |
| Naming a specific email / UUID | **Nowhere in the repo** ❌ |
| Writing a password | **Nowhere in the repo** ❌ |
| Creating the first user | Supabase Dashboard or Auth Admin API — §9 of the safety notes |
| Granting super-admin role | One explicit SQL snippet, run by a human |

### RLS concern

`platform_admins` and `user_roles` are the columns that make an account
powerful. If RLS on these tables is not strictly read-only for authenticated
users, a tenant user could grant themselves a platform role. **Recommend
verifying explicitly** that neither table exposes `INSERT`/`UPDATE` to
`authenticated` (see §15).

---

## 9. RLS & Permissions Audit

### Confirmed correct

- `20260928000000` uses `WITH CHECK` correctly on the write policy and `USING`
  with `public.is_staff(auth.uid())` on reads.
- The `USING`-on-`INSERT` bug documented in the existing notes was already
  fixed.

### The rule, stated once

> `USING` = which **existing** rows a statement may see/affect.
> `WITH CHECK` = what the **resulting** row must look like.
> `INSERT` cannot use `USING` — there is no existing row. `UPDATE` needs both.
> `SELECT`/`DELETE` use `USING` only.

### Open items

| # | Item | Why it matters |
|---|---|---|
| 1 | `platform_admins` write policies unverified | Privilege escalation path if a tenant user can insert |
| 2 | `user_roles` write policies unverified | Same |
| 3 | RLS performance — `is_staff()` / `is_platform_admin()` called per row | Should be `STABLE` and, if possible, join-based rather than subquery-per-row |
| 4 | No automated RLS test harness in the repo | A policy regression ships silently |

### Role matrix that *should* be exercised

| Role | Read own tenant | Write transactions | Manage catalogue | Manage users | Cross-tenant |
|---|---|---|---|---|---|
| `anonymous` | ❌ | ❌ | ❌ |
| `authenticated` (cashier) | ✅ | limited | ❌ | ❌ | ❌ |
| `manager` | ✅ | ✅ | ✅ | partial | ❌ |
| `owner` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `superadmin` | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 10. Data Integrity Report

This table states what can be determined **from the repository**. Items marked
⚪ require live SQL against your database and are listed in §15.

| Element | Issues found | Example | Risk | Fix |
|---|---|---|---|---|
| Duplicate migrations | 0 | — | — | — |
| Conflicting enums | 0 | — | — | — |
| Duplicate `CREATE TABLE` | 0 | — | — | — |
| Overlapping `TRUNCATE` sets | 2 | `20260911150300` vs `20260912111000` | 🔴 Data loss on replay | Emptiness guard |
| Repeated personal identity | 5 migrations | same email in all | 🔴 | Move to §9 procedure |
| Committed credentials | 2 files | password literal | 🔴 | **Fixed** |
| Reference rows without business key | ⚪ unknown | `units`, `categories` | 🟠 Re-seed duplicates | Add `UNIQUE(code)` |
| Duplicate payment methods / statuses / roles | ⚪ unknown | — | 🟠 | Deduplicate, then constrain |
| Orphan rows (FK violations) | ⚪ unknown | — | 🟠 | Integrity query in §15 |
| Inconsistent casing (`Cash` vs `cash`) | ⚪ unknown | — | 🟠 | Normalize to enum |
| Missing `created_at` / `updated_at` | ⚪ unknown | — | 🟡 | Additive migration |
| Missing `created_by` | ⚪ unknown | — | 🟡 | Additive migration |

**Integrity query to run (read-only, safe):**

```sql
-- Duplicate business keys in reference tables
SELECT 'units' AS t, code, count(*) FROM public.units GROUP BY code HAVING count(*) > 1
UNION ALL
SELECT 'categories', name, count(*) FROM public.categories GROUP BY name HAVING count(*) > 1;

-- Orphan inventory rows
SELECT count(*) AS orphan_inventory
FROM public.inventory i
LEFT JOIN public.products p ON p.id = i.product_id
WHERE p.id IS NULL;

-- Users with roles but no profile
SELECT ur.user_id FROM public.user_roles ur
LEFT JOIN public.profiles p ON p.id = ur.user_id
WHERE p.id IS NULL;

-- Platform admins whose auth user no longer exists
SELECT pa.user_id FROM public.platform_admins pa
LEFT JOIN auth.users u ON u.id = pa.user_id
WHERE u.id IS NULL;
```

---

## 11. Database Missing Pieces

| # | Missing | Why it matters | Effort |
|---|---|---|---|
| 1 | `UNIQUE(code)` on `units`, `expense_categories`, `categories` | Prerequisite for safe idempotent seeding | Small |
| 2 | `updated_at` auto-touch trigger on mutable tables | Silent staleness in reports | Small |
| 3 | `created_by uuid` on transactional tables | No accountability trail on manual rows | Medium |
| 4 | Soft delete (`deleted_at`) on products/customers | Hard delete destroys financial history | Medium |
| 5 | `ON DELETE RESTRICT` instead of `CASCADE` on `inventory`/`stock_movements` → `products` | Already flagged in the existing notes; cascade can erase history | Small |
| 6 | Composite indexes on `(status, created_at)` for invoice lists | Full scans as data grows | Small |
| 7 | `CHECK` constraints on money columns (`>= 0`) | Negative totals currently representable | Small |
| 8 | RLS test suite | Policy regressions ship silently | Medium |
| 9 | `seeds/reference.sql` + `seeds/demo.sql` split | Core of this audit | Small |
| 10 | `payment_method` labels in one shared TS module | Duplication with DB enum | Medium |

---

## 12. Environment Variables

Surfaced from the project's `.env` usage (values withheld deliberately).

| Variable | Required | Location | Secret | Status |
|---|---|---|---|---|
| `VITE_SUPABASE_URL` | ✅ | client bundle | ❌ public | ✅ present |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ✅ | client bundle | ❌ public (RLS is the control) | ✅ present |
| `VITE_SUPABASE_PROJECT_ID` | ✅ | client bundle | ❌ public | ✅ present |
| `SUPABASE_URL` | ✅ | server / edge functions | ❌ | ✅ present |
| `SUPABASE_PUBLISHABLE_KEY` | ✅ | server | ❌ | ✅ present |
| `SUPABASE_SECRET_KEY` | ✅ | **server only** | 🔴 **YES** | ⚠️ present, must never reach the browser |
| `SUPABASE_JWKS_URL` | optional | server | ❌ | ✅ present |
| `DATABASE_URL` (direct Postgres) | optional | CLI / migrations | 🔴 YES | not required — CLI uses `link` |
| `MIGRATION_DB_PASSWORD` | optional | CLI `db push` | 🔴 YES | prompt-based; do not commit |

**Rules:** `.env` is gitignored ✅. `.env.example` must list names with empty
values — never real ones. `SUPABASE_SECRET_KEY` bypasses RLS entirely; if it is
ever exposed to a browser bundle, the whole permission model is void.

> 🔴 **Separate security incident, unrelated to migrations:** a
> `SUPABASE_SECRET_KEY` was committed historically and remains reachable via
> Git history. Deleting the file does not invalidate the key. Rotate it in the
> Supabase Dashboard.

---

## 13. Existing Project Repair

| Change | File | Reversible? |
|---|---|---|
| Removed committed credential; set password var to NULL | `20260916000000_reset_and_recreate_superadmin_user.sql` | ✅ via git |
| Neutralized password-reset migration to `SELECT 1` | `20260926000000_update_superadmin_password.sql` | ✅ via git |
| Added `supabase/.temp/` ignore rule | `.gitignore` | ✅ |
| Untracked 11 local CLI files (**kept on disk**) | `supabase/.temp/*` | ✅ re-add if wanted |
| Documented rules, findings, bootstrap, commands | `docs/database/migration-safety-notes.md` | ✅ |

**Migration versions were preserved in every case**, so
`supabase_migrations.schema_migrations` does not drift and `db push` keeps
working.

**No data was read, written, or deleted. No migration was applied or reverted.
No database connection was made.**

---

## 14. New Client / New Supabase Project Bootstrap

```
1. Create Supabase project                 Dashboard
2. npx supabase link --project-ref <ref>   Terminal
3. npx supabase db push                    Terminal  ← only migration step
4. Configure .env                          Editor / Vercel
5. Create first admin                      Dashboard → Authentication → Users
6. Grant superadmin role                   SQL snippet (safety notes §9)
7. Set company settings                    In-app Settings screen
8. Optional demo data                      psql -f supabase/seeds/demo.sql
```

### Baseline vs full chain — recommendation

**Keep the full existing migration chain for now; introduce a baseline only
when the chain is genuinely clean.**

Reasoning, from what was actually found: the chain contains destructive resets
and personal-identity provisioning. A baseline would capture the *current*
schema, after which those files could be dropped — attractive, but the baseline
must be produced by `db pull` against the live database and then reconciled
against the repo, which is a substantial, review-heavy operation. The chain
works today; the problems are contained and now documented.

**Recommended sequence:**
1. Now — keep the chain, rotate the leaked password, apply the guards.
2. Next — split the seed into `reference.sql` / `demo.sql`.
3. Then — once no migration contains data or identity, squash the historical
   migrations into a single `00000000000000_baseline.sql` and drop the rest.
4. For every **new** customer, the baseline makes bootstrap a one-step push.

---

## 15. Manual Actions Required

These cannot be done by an agent: they need Dashboard access, a secret, or a
decision only you can make.

### 15.1 🔴 One-Time — Rotate the leaked super-admin password

1. **What:** change the password of the personal super-admin account.
2. **Where:** Supabase Dashboard → Authentication → Users → select the account →
   *Reset password*.
3. **Why:** the old value sat in a committed SQL file and remains in Git
   history. Removing it from the file does not invalidate it.
4. **Value:** a new strong password you choose. Do **not** put it in any file.
5. **Expected result:** old password stops working; login with the new one works.
6. **Verify:** sign out, sign in with the new password, confirm super-admin
   screens load.
7. **Risk:** if you lose the new password, recover via Dashboard reset. No data
   loss.
8. **Frequency:** once.

### 15.2 🔴 One-Time — Rotate the leaked `SUPABASE_SECRET_KEY`

1. **What:** rotate the server secret key that was historically committed.
2. **Where:** Supabase Dashboard → Project Settings → API keys.
3. **Why:** it bypasses RLS entirely; Git history keeps it reachable.
4. **Value:** newly generated secret key.
5. **Expected result:** old key rejected; app continues working after env update.
6. **Verify:** update `.env` and Vercel, redeploy, confirm edge functions that
   use it still run.
7. **Risk:** brief outage for features using the secret key until redeployed.
8. **Frequency:** once.

### 15.3 🟠 One-Time — Decide on the destructive reset migrations

1. **What:** decide whether to add emptiness guards to
   `20260706121000`, `20260911150300`, `20260912111000`, `20260912172000`.
2. **Where:** Supabase Dashboard → SQL Editor (verify) / editor (edit).
3. **Why:** they `TRUNCATE` 25 business tables and `DELETE FROM auth.users`.
   They are already applied here, so they are dormant on this project — but any
   environment where the version is skipped would run them for real.
4. **Value:** the guard in safety-notes §7.3.
5. **Expected result:** the migrations become inert on any non-empty database.
6. **Verify:** on a scratch database with one invoice row, `db push` raises the
   guard instead of truncating.
7. **Risk:** editing applied migrations. **Mitigation:** the edit adds a guard
   only; it does not change the statements already executed. Migrations already
   applied on Remote will not re-run, so behaviour on this project is unchanged.
8. **Frequency:** once.

### 15.4 🟠 One-Time — Verify RLS on privilege tables

1. **What:** confirm `platform_admins` and `user_roles` expose no INSERT/UPDATE
   to `authenticated`.
2. **Where:** Supabase Dashboard → SQL Editor.
3. **Why:** if writable by a tenant user, self-elevation to super admin is
   possible.
4. **Value:** the query below.
5. **Expected result:** only `service_role` / platform-admin paths appear.

```sql
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE tablename IN ('platform_admins', 'user_roles')
ORDER BY tablename, cmd;
```

6. **Verify:** every `INSERT`/`UPDATE` policy shows `with_check` restricting to
   platform admins, or no such policy exists.
7. **Risk:** none — read-only.
8. **Frequency:** once, then after any policy change.

### 15.5 🟡 One-Time — Run the data integrity queries

1. **What:** execute the read-only integrity queries in §10.
2. **Where:** Supabase Dashboard → SQL Editor.
3. **Why:** determine whether duplicate reference rows or orphan records exist.
4. **Expected result:** ideally zero rows from every query.
5. **Risk:** none — all `SELECT`.
6. **Frequency:** once, then before adding any `UNIQUE` constraint.

### 15.6 🟡 Per-New-Client — First admin provisioning

1. **What:** create the first user and grant the super-admin role.
2. **Where:** Dashboard → Authentication → Users, then SQL Editor.
3. **Why:** provisioning must never be a migration.
4. **Value:** user's real email; the snippet in safety-notes §9 with the
   user's UUID.
5. **Expected result:** the account can sign in and reach super-admin screens.
6. **Verify:** sign in, confirm profile row exists, confirm role dashboards load.
7. **Risk:** low. Granting the role to the wrong UUID grants excess privilege —
   copy the UUID from the Dashboard, not from memory.
8. **Frequency:** once per new customer.

### 15.7 🟡 Per-New-Client — Vercel environment variables

1. **What:** set Supabase variables for the deployment.
2. **Where:** Vercel → Project → Settings → Environment Variables.
3. **Value:** the new project's URL, publishable key, and server secret key.
4. **Verify:** redeploy, confirm the app connects to the correct project.
5. **Risk:** mixing projects' keys — check the project ref matches.
6. **Frequency:** once per new customer.

---

## 16. Commands to Run

**Read-only inspection (safe, run any time):**

```bash
npx supabase migration list --linked
npx supabase db diff --linked
npx supabase db pull --linked --dry-run
```

**Apply pending migrations (additive; the only intended write path):**

```bash
npx supabase db push
```

**Type/lint gates:**

```bash
npx tsc --noEmit
npm run lint
```

**🔴 NEVER run against a linked project — destroys all data:**

```bash
npx supabase db reset
```

> If `db push` reports *"remote migration versions not found in local
> migrations directory"*, **do not** delete local files and **do not** edit
> `schema_migrations` by hand. First `git pull` and confirm the file exists
> locally. If it genuinely does not, `npx supabase migration repair --status
> reverted <version>` is the surgical tool — use it only after confirming the
> object it creates already exists remotely.

---

## 17. Verification Checklist

### Database
- [ ] `npx supabase migration list --linked` shows no unexpected diff
- [ ] `npx supabase db diff --linked` reports no unmanaged schema drift
- [ ] `tsc --noEmit` exits 0
- [ ] `npm run lint` reports 0 errors
- [ ] RLS policies on `platform_admins`, `user_roles` verified (§15.4)

### Data
- [ ] Integrity queries (§10) return zero rows
- [ ] `units` / `expense_categories` rows carry distinct `code` values
- [ ] No orphan `inventory` rows
- [ ] No `user_roles` rows without a matching profile

### Auth
- [ ] Rotated password signs in successfully
- [ ] Super-admin screens reachable
- [ ] A newly created user receives a `profiles` row automatically
- [ ] A non-privileged user cannot reach platform-admin screens

### Seed re-run safety
- [ ] `reference.sql` run twice → no duplicate rows
- [ ] `reference.sql` run twice → no duplicate roles or units
- [ ] No `auth.users` insert exists in any auto-run seed

### Security
- [ ] No plaintext credential anywhere in the repo
- [ ] Rotated secret key reflected in `.env` and Vercel
- [ ] `supabase/.temp/` not tracked
- [ ] `.env` not tracked

---

## 18. Final Architecture

```text
Vortex ERP — target database architecture
│
├── 1. CORE SCHEMA  (supabase/migrations/*.sql — replayed per customer)
│   ├── Tables, columns, FKs, indexes, constraints
│   ├── Enums: payment_method, *_status              ← closed sets
│   ├── Functions: is_staff, is_platform_admin, search_products, guards
│   ├── Triggers: updated_at, profile-on-signup
│   └── RLS policies: USING for reads, WITH CHECK for writes
│       ✗ contains NO tenant rows, NO credentials, NO personal identity
│
├── 2. REFERENCE DATA  (supabase/seeds/reference.sql — idempotent)
│   ├── Starter units, expense categories
│   ├── Keyed by business key (code), ON CONFLICT (code) DO UPDATE
│   └── Safe to run N times; convergent, not merely non-duplicating
│
├── 3. TENANT DEFAULTS  (created per customer, in-app or one-time SQL)
│   ├── company_settings (name, currency, tax, logo, prefix)
│   ├── warehouses, branches
│   └── Permitted to differ entirely between customers
│
├── 4. OPTIONAL MODULES  (data appears only when a module is enabled)
│   ├── loyalty_transactions
│   ├── customer_payment_splits
│   └── tenant_subscriptions
│
├── 5. DEMO DATA  (supabase/seeds/demo.sql — NEVER auto-run)
│   ├── Sample products, customers, suppliers, invoices
│   └── Referenced by no config; executed by hand, never in production
│
├── 6. AUTH BOOTSTRAP  (outside migrations entirely)
│   ├── First user → Supabase Dashboard / Auth Admin API
│   ├── Role grant → explicit SQL snippet, run by a human
│   └── Password → never in the repository, in any form
│
└── 7. APPLICATION CONFIGURATION  (environment + in-app settings)
    ├── .env / Vercel  (public keys + server secret, never committed)
    ├── Settings screen (company identity, currency, branding)
    └── Shared TS domain module (payment-method labels ← mirrors the DB enum)
```

### The one-sentence rule

> **Migrations create structure. Seeds create reference rows. Settings create
> tenant identity. Humans create accounts. These four must never mix.**

---

## 19. Immediate Next Steps

| Priority | Action | Who | Reference |
|---|---|---|---|
| 🔴 1 | Rotate leaked super-admin password | You | §15.1 |
| 🔴 2 | Rotate leaked `SUPABASE_SECRET_KEY` | You | §15.2 |
| 🟠 3 | Decide on guards for destructive migrations | You | §15.3 |
| 🟠 4 | Verify RLS on `platform_admins` / `user_roles` | You | §15.4 |
| 🟡 5 | Run integrity queries | You | §15.5 |
| 🟡 6 | Split seed → `reference.sql` + `demo.sql` | Agent, on approval | §6 |
| 🟡 7 | Add `UNIQUE(code)` to reference tables | Agent, after §15.5 | §6 |
| 🟡 8 | Extract shared payment-method module | Agent, on approval | §7.7 |

Items 6–8 were **not** applied in this session because each changes behaviour
(dev seeding, constraint enforcement, or a wide code sweep) and should be
reviewed as deliberate changes rather than bundled into an audit.