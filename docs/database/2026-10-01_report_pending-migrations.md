# تقرير: الترحيلات المعلّقة على قاعدة بيانات market-prime

**التاريخ:** 2026-09-29
**المشروع:** `market-prime` — `slmnyjontxydoyuvqitm` (Northeast Asia / Tokyo)
**الفرع المدموج:** `main` @ `b602181`
**الحالة:** فحص قراءة فقط — **لم يُطبَّق أي ترحيل على قاعدة البيانات**

---

## 1. لماذا هذا التقرير

قاعدة `market-prime` قاعدة **إنتاج حقيقية لشركة عاملة**. أي `db push` عليها
يجب أن يكون مسبوقاً بمعرفة دقيقة بما سيفعله. هذا التقرير يوثّق الفحص قبل التنفيذ.

## 2. البيانات الحقيقية الموجودة (قراءة فقط)

| الجدول                | عدد الصفوف |
| --------------------- | ---------- |
| `sales_invoices`      | 86         |
| `sales_invoice_items` | 152        |
| `products`            | 376        |
| `stock_movements`     | 381        |
| `inventory`           | 215        |
| `customers`           | 5          |
| `customer_payments`   | 1          |
| `purchase_invoices`   | 1          |
| `profiles`            | 3          |
| `auth.users`          | 3          |

## 3. الترحيلات المعلّقة (غير مطبّقة)

`supabase migration list --linked` يُظهر 17 ترحيلاً محلياً غير مطبّق على الـremote:

```
20260918000050  restrict_platform_admins_select
20260918000100  add_profiles_is_active
20260918000200  enforce_is_active_in_is_staff
20260926000000  update_superadmin_password
20260928000000  split_payment_and_payment_method_integrity
20260929000000  item_model_nature_inventory_policy
20260929010000  stock_engine_positions_and_ownership
20260929020000  stock_posting_core_and_documents
20260929030000  invoice_line_types_and_policy_sales_engine
20260929040000  policy_purchase_and_transfer_engines
20260929050000  governed_item_policy_transitions
20260929060000  reporting_separation_and_honest_costing
20260930000000  dehardcode_superadmin_identity
20260930000100  separate_platform_and_tenant_privileges
20260930000200  harden_function_exposure
20260930000300  restore_anon_default_privileges
20260930000400  repair_function_grants_and_owner_provisioning
20260930000500  fix_platform_admin_self_read_loop
20260930000600  fix_auth_user_token_columns
```

> **ملاحظة:** الـremote لا يزال على تسلسل `20260918*` القديم. لذلك فإن ترحيلات
> `20260926*` و`20260928*` (سلف `main`) معلّقة أيضاً — وليست خاصة بالدمج.

## 4. تحليل الخطورة لكل ترحيل

### 4.1 لا يحذف ولا يُعدّل بيانات قائمة

| الترحيل                    | ما يفعله                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `20260918000050`           | سياسات RLS فقط                                                                                                |
| `20260918000100`           | `ADD COLUMN is_active NOT NULL DEFAULT true` — كل الصفوف تصبح active                                          |
| `20260918000200`           | تعديل دالة `is_staff`                                                                                         |
| `20260926000000`           | ⚠️ `UPDATE auth.users SET encrypted_password = crypt('Mm0534035aborak') WHERE email = 'mousa.mc13@gmail.com'` |
| `20260930000x00` (7 ملفات) | دوال/صلاحيات/سياسات — لا DML                                                                                  |

### 4.2 ⚠️ تعديل بيانات — لكن **يملأ NULL فقط** (لا يستبدل قيمة قائمة)

| الترحيل          | السطر | الأثر                                                                                              |
| ---------------- | ----- | -------------------------------------------------------------------------------------------------- |
| `20260929000000` | L137  | `UPDATE products SET base_uom_id = unit_id WHERE base_uom_id IS NULL`                              |
| `20260929010000` | L127  | `UPDATE stock_movements SET movement_kind = <map> WHERE movement_kind IS NULL` — يمسّ حتى 381 صفاً |
| `20260929010000` | L142  | `UPDATE stock_movements SET total_cost = abs(qty)*unit_cost WHERE total_cost IS NULL`              |
| `20260929010000` | L149  | `UPDATE stock_movements SET source_type = reference_type WHERE source_type IS NULL`                |

**كلها `WHERE ... IS NULL`** — لا تُفقد أي قيمة موجودة. الأثر إضافة، لا استبدال.

### 4.3 لا يوجد أي `DELETE` / `TRUNCATE` / `DROP TABLE` / `DROP COLUMN` فعّال

كل عبارات `DROP` في ترحيلات `20260929*` موجودة **معلّقة بـ`--`** كتوثيق rollback فقط.
لا يوجد أي حذف فعّال.

## 5. حالة القاعدة الحالية مقابل ما تفترضه الترحيلات

| العنصر                                                                                                                 | على market-prime  |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------- |
| أعمدة نموذج الأصناف على `products` (`item_nature`, `inventory_policy`, `tracking`, `costing_method`, `base_uom_id`, …) | ❌ **غير موجودة** |
| `company_items`                                                                                                        | ❌ غير موجود      |
| `stock_openings` / `stock_opening_items`                                                                               | ❌ غير موجودة     |
| `stock_adjustments` / `stock_adjustment_items`                                                                         | ❌ غير موجودة     |
| `item_policy_review_queue`                                                                                             | ❌ غير موجود      |
| `ad_hoc_service_lines`                                                                                                 | ❌ غير موجود      |
| `customer_payment_splits`                                                                                              | ❌ غير موجود      |
| `stock_positions` (view)                                                                                               | ❌ غير موجود      |
| `stock_transfers` / `stock_transfer_items`                                                                             | ✅ موجودة         |

**الخلاصة:** الترحيلات معلّقة لا لأن الدمج أفسد شيئاً، بل لأن **main نفسه
لم يُطبَّق على market-prime بعد**. الـremote متأخر عن `main` بعدة أطوار.

## 6. المخاطر الفعلية عند التنفيذ

| #   | الخطر                                                                            | التقييم                                                               |
| --- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| R1  | `20260926000000` يعيد ضبط كلمة مرور `mousa.mc13@gmail.com` إلى قيمة نصّية في git | 🔴 مرتفع — سرّ مكشوف في المستودع + يُبطل كلمة المرور الحالية للمستخدم |
| R2  | backfill `stock_movements` على 381 صفاً حقيقي                                    | 🟡 متوسط — يملأ NULL فقط، لكن يستحسن نسخة احتياطية أولاً              |
| R3  | إعادة بناء دوال `create_sale` وسياسات RLS على قاعدة عاملة                        | 🟡 متوسط — لحظة التنفيذ تنقطع الكتابة، وقد تتغيّر صلاحيات الواجهة     |
| R4  | `20260918000100` يضيف `is_active` افتراضياً `true` لكل المستخدمين                | 🟢 منخفض — مقصود                                                      |
| R5  | لا يوجد `DELETE`/`TRUNCATE`/`DROP` فعّال                                         | 🟢 لا خطر حذف سجلات                                                   |

## 7. التوصية

1. **نسخة احتياطية أولاً** (`supabase db dump`) قبل أي `db push` — إلزامي.
2. **معالجة `20260926000000`**: إزالة كلمة المرور من الملف وتحويلها إلى
   عملية يدوية عبر Dashboard، أو نقلها إلى متغيّر بيئة. ترك سرّ نصّي في git
   مشكلة أمنية قائمة بذاتها.
3. تنفيذ الـpush على **نسخة staging من market-prime** أولاً (R11: اختبار على
   نسخة من قاعدة قائمة) ثم على الإنتاج.
4. لا تُطبَّق ترحيلات `20260930*` (إصلاحات المصادقة) قبل التأكد أن
   `20260929*` نجحت — فهي مبنية على افتراض أن نموذج الأصناف موجود.

## 8. ما لم يُفعَل

- ❌ لم يُطبَّق أي ترحيل.
- ❌ لم يُنفَّذ أي DML.
- ❌ لم يُعدَّل أي صف.
- ✅ كل ما سبق كان استعلامات `SELECT` قراءة فقط.
