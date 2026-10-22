# محرك النسخ الاحتياطي v3 — التفريغ الديناميكي من الخادم

> **التاريخ:** 2026-10-18
> **الحالة:** مُنفّذ (Migration 31) — الواجهات ما زالت على v2 وتحتاج تحديثاً
> **المرجع:** `supabase/migrations/31_backup_engine.sql`

---

## 1. لماذا أُعيد بناء المحرك؟

المحرك القديم (`src/lib/backup/engine.ts` — extractTenantDataReadOnly) كان:

| المشكلة                | التفصيل                                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| قائمة جداول يدوية      | 37 جدول مكتوب هاردكود، تفوّت كل الوحدات المحاسبية (accounts, journal_entries, journal_lines, fiscal_periods, fixed_assets, payment_methods, supplier_ledger, supplier_payments) |
| لا تكيف مع السكيما     | `CURRENT_SCHEMA_VERSION` ثابت نصي، لا يقرأ شيئاً من قاعدة البيانات، والفحص عند الاستعادة تحذير فقط بلا تحويل                                                                    |
| حدود صفوف تُفقد بيانات | audit_logs بحد 1000 صف وidempotency_keys بحد 500 — الاستعادة تفقد التاريخ الأقدم                                                                                                |
| الاستعادة غير موجودة   | زر "تأكيد وبدء الاستعادة" في الواجهة يعرض رسالة فقط (Dry-Run) — صفر كود يستعيد بيانات                                                                                           |
| لا يستفيد من Supabase  | لا pg_dump ولا PITR ولا وظائف خادمية — كل شيء من المتصفح                                                                                                                        |

---

## 2. المحرك الجديد: ثلاث دوال Postgres (Migration 31)

### 2.1 `public.backup_schema_fingerprint()` → text

بصمة SHA-256 لكل جداول public وأعمدتها وأنواعها، مبنية من `information_schema`. تُحفظ داخل النسخة، وعند الاستعادة تُقارن مع البصمة الحالية: اختلاف = السكيما تغيّرت بين النسختين.

### 2.2 `public.backup_export_all(p_max_log_rows integer DEFAULT 5000)` → jsonb

- يقرأ **كل جداول public الأساسية ديناميكياً** من `information_schema.tables` — لا قائمة يدوية، يتكيف مع أي مهاجرة جديدة تلقائياً.
- الصفوف تُجمّع `jsonb_agg(to_jsonb(...))` بأعمدتها كما هي.
- جداول السجل الضخمة (`audit_logs`, `backup_logs`, `idempotency_keys`) تُفرَّغ بأحدث N صف فقط (بترتيب `created_at DESC`) — قابل للضبط عبر المعامل.
- الصلاحية: `SECURITY DEFINER` مع فحص صريح — تتطلب دور **owner أو manager**.
- المخرج: `{ kind: 'server_dynamic_export', exported_at, schema_fingerprint, table_count, total_rows, capped_log_tables, tables: { اسم_الجدول: [صفوف...] } }`.

### 2.3 `public.backup_restore_all(p_payload jsonb)` → jsonb

استعادة كاملة داخل **Transaction واحد**:

1. فحص دور **owner فقط** (الاستعادة إجراء خارق لا يُمنح لغيره).
2. التحقق من بنية الحمولة (`kind` + `tables` + `schema_fingerprint`).
3. `SET LOCAL session_replication_role = replica` — تعطيل مؤقت للمفاتيح الخارجية والمحفزات حتى تُدرج الصفوف بأي ترتيب.
4. `TRUNCATE` **لكل** جداول public (حتى غير المذكورة في الحمولة — لا تبقى بيانات قديمة مزيفة). الجداول المحذوفة من السكيما تُسقَط بأمان (`BACKUP_SKIP_TABLE`).
5. الإدراج عبر `jsonb_populate_recordset` — يطابق الأعمدة **بالاسم لا بالترتيب**، فيتكيف مع ترتيب الأعمدة الجديد.
6. `SET LOCAL session_replication_role = DEFAULT` — إعادة تشغيل المحفزات.
7. إعادة ضبط sequences (`pg_get_serial_sequence` + `setval`) إلى القيم المدرجة فعلياً.
8. المخرج: `{ restored_at, inserted_rows, skipped_tables, schema_fingerprint_mismatch, current_fingerprint }`.

> **معلومة معلنة:** الجداول ذات أعمدة `IDENTITY GENERATED ALWAYS` لا تقبل إدراج معرّفات صريحة — الكتالوج الحالي لا يستخدمها (كلها `gen_random_uuid()` أو `serial`).

---

## 3. ماذا يستخدم من Supabase / PostgreSQL؟

| الميزة                                                | الاستخدام                                                  |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| `information_schema`                                  | استكشاف الجداول والأعمدة ديناميكياً وقت التنفيذ            |
| `jsonb_agg` / `to_jsonb` / `jsonb_populate_recordset` | تفريغ وإدراج مطابق بالاسم                                  |
| `SECURITY DEFINER` + `has_role()`                     | تجاوز RLS المحصور بصلاحيات داخلية صريحة                    |
| `pg_get_serial_sequence` / `setval`                   | إعادة بناء التسلسلات                                       |
| `session_replication_role`                            | تعطيل مؤقت للمفاتيح داخل Transaction                       |
| **لا يعتمد على**                                      | pg_dump / PITR / Daily Backups — الخدمات السحابية المدفوعة |

---

## 4. حالة الواجهات (src/) — **تحتاج تعديلاً**

| الملف                                      | الحالة                                                                                | المطلوب                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/components/backup-settings-card.tsx`  | ❌ يستدعي المحرك القديم `extractTenantDataReadOnly` فقط                               | استدعاء `supabase.rpc('backup_export_all')` بدلاً منه                            |
| `src/components/backup-restore-dialog.tsx` | ❌ الاستعادة رسالة فقط (Dry-Run)                                                      | استدعاء `supabase.rpc('backup_restore_all', { p_payload })` بعد التحقق           |
| `src/lib/backup/engine.ts`                 | ❌ قائمة 37 جدولاً يدوية                                                              | إضافة دالة `exportTenantDataServerSide()` فوق الـ RPC                            |
| كلمة المرور                                | ❌ `"VORTEX_SECURE_BACKUP_2026"` مضمنة في `backup-settings-card.tsx:75` و `crypto.ts` | يظل تشفير AES للملف المحلي (طبقة إضافية) — التفريغ السحابي محمي بالصلاحيات أصلاً |
| `backup_logs`                              | ✅ موجود ويكفي                                                                        | لا تغيير                                                                         |

**صفر استدعاءات حالية** لـ `backup_export_all` / `backup_restore_all` / `backup_schema_fingerprint` في `src/` — الدوال الجديدة غير موصولة بالواجهة بعد.
