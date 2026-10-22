# خطة إعادة هيكلة الترحيلات — Market Hub ERP

> **الملف:** `supabase/MIGRATIONS_REFACTOR_PLAN.md`
> **الغرض:** خطة تنفيذية كاملة يستطيع أي Agent آخر تنفيذها دون الرجوع لأحد.
> **الحالة:** تخطيط فقط. لا تعديل على أي migration حتى اعتماد الخطة.
> **المرجع الملزم:** `supabase/MIGRATIONS_RULES.md`

---

## القسم 1 — الوضع الحالي

### 1.1 الأرقام

| القياس           | القيمة                                                        |
| ---------------- | ------------------------------------------------------------- |
| ملفات الترحيل    | **132** في `supabase/migrations/`                             |
| جداول `public`   | **~63**                                                       |
| أنواع `ENUM`     | **20**                                                        |
| دوال `public.*`  | **~65** تعريفًا (مع تكرار)                                    |
| Triggers         | **29**                                                        |
| Views            | **~20**                                                       |
| ملفات Seed قائمة | `seeds/reference.sql` + `seeds/demo/` (4) + `seeds/README.md` |

### 1.2 المشاكل المكتشفة — بالأدلة

#### 🔴 مشكلة 1 — ترحيل مدمّر يعمل تلقائيًا

**الملف:** `20260912111000_reset_for_meters_shop.sql`

```sql
TRUNCATE TABLE public.customer_payments, public.loyalty_transactions, public.audit_logs,
  public.sales_return_items, public.sales_returns, ... public.warehouses, public.expense_categories
  RESTART IDENTITY CASCADE;
DELETE FROM public.user_roles;
DELETE FROM public.profiles;
DELETE FROM auth.users;
```

**الأثر:** أي `supabase db reset` أو بناء بيئة جديدة يُشغّل هذا الملف، فيمسح كل المستخدمين والأدوار وسجل التدقيق. هذا ليس خطرًا نظريًا — هو سلوك مضمون عند إعداد أي عميل جديد.

**الحكم:** يجب إزالته بالكامل في البنية الجديدة.

---

#### 🔴 مشكلة 2 — بيانات أعمال داخل الترحيلات

**الملف:** `20261204000000_arabic_rpc_messages_and_data_cleanup.sql`
يُدرج تصنيفات (`قمح`, `ذرة`, `شعير`, `مستلزمات تعبئة`) و**6 منتجات خام + منتجات مطحونة** بـ `sku` و`barcode`، مع `ON CONFLICT (sku) DO UPDATE`.

**الملف:** `20261001000000_mill_complete_cleanup_and_seeding.sql`
يُدرج **مستلزمات تعبئة كاملة** (أكياس PP، خيش) بأسعار تكلفة وبيع، ويعدّل `units`، ويُدرج أصناف المستهلكات (أكياس، خيط، زيت).

**الملف:** `20260912120000_*.sql`
`INSERT INTO public.inventory ... 999999` — **مخزون وهمي**.

**الأثر:** كل عميل جديد يُنشأ له كتالوج منتجات مطحنة يمنية ومخزون وهمي لم يطلبه.

**الحكم:** تُنقل إلى seeds.

---

#### 🔴 مشكلة 3 — هوية شركة مثبَّتة في الترحيل

**الملف:** `20260912111000_*.sql`

```sql
UPDATE public.company_settings SET name = 'محل العدادات وقطع الغيار والزينة', ...
```

**الملف:** `20260621011940_*.sql`
`INSERT` لمستودع `Main Warehouse` وعميل `Walk-in Customer`.

**الأثر:** كل عميل يبدأ بهوية متجر عدادات. وهذا يخالف صراحةً القاعدة R-6 في `docs/database/migration-safety-notes.md`.

**الحكم:** يُمنع منعًا مطلقًا. هوية الشركة إعداد يُحرّره العميل.

---

#### 🟡 مشكلة 4 — تكرار تعريف نفس الدوال

`create_sale` أُعيد تعريفها في **6+ ملفات** بأجسام متضاربة:
`20260628000000`, `20260701000000`, `20260916010000`, `20260928000000`, `20260929030000`, وأخرى.

`is_staff` و`has_role` و`tg_set_updated_at` مُعرَّفة في عدة ملفات.

**الأثر:** النسخة السارية هي الأخيرة زمنيًا فقط. لا يمكن معرفة السلوك الفعلي من قراءة ملف واحد. أي تعديل مستقبلي قد يبني على نسخة قديمة.

**الحكم:** كل دالة تُعرَّف **مرة واحدة** بالشكل النهائي.

---

#### 🟡 مشكلة 5 — `ALTER` متسلسل على نفس الجداول

`products`: أُضيفت أعمدة في `20260621011940`, `20260912120000`, `20260912130000`, `20260929010000`, `20261003080000` ...
`customers`: `loyalty_points` (20260623200000), `balance` متعددة، `credit_limit` ...
`stock_movements`: `reference_id`/`reference_type` (20260628023214), `adjustment_reason` (20260928000000) ...

**الأثر:** الشكل النهائي للجدول موزّع على 5–8 ملفات. لا يمكن معرفة بنيته من قراءة ملف واحد.

**الحكم:** كل جدول يُكتب بتصميمه النهائي مرة واحدة.

---

#### 🟡 مشكلة 6 — حدود غير واضحة بين Schema و Reference

`seeds/README.md` يوثّق أن `reference.sql` **لا يحتوي** تصنيفات/علامات/وحدات لأنها "في الترحيلات". أي أن جزءًا من المرجعيات في الـ seed وجزءًا في الـ migration بلا قاعدة واضحة.

**الحكم:** كل المرجعيات في `seeds/01_system/` بمبدأ واحد.

---

### 1.3 ما هو سليم ويجب الحفاظ عليه

- **التصميم المحاسبي:** `accounts` + `journal_entries` + `journal_lines` + `create_journal_entry` + `reverse_journal_entry` + `trial_balance`. سليم ولا يُمس.
- **حارس التكامل:** `product_delete_guard`, `product_reference_counts`, `warehouse_reference_counts`.
- **نمط الكتابة عبر RPC:** الجداول المالية ممنوعة الكتابة المباشرة.
- **RLS:** مفعَّل على الجداول الحساسة بسياسات `is_staff`/`has_role`.
- **وحدة المصروفات:** دورة حياة كاملة بموافقات ودفعات وضبط تزامن.
- **`docs/database/migration-safety-notes.md`:** يوثّق قواعد السلامة الحالية.

---

## القسم 2 — ما سيتم التخلص منه

| النوع                      | التفاصيل                                                        | الإجراء                     |
| -------------------------- | --------------------------------------------------------------- | --------------------------- |
| ترحيلات الإصلاح المتسلسل   | كل ملف يعدّل جدولًا أُنشئ في ملف آخر لإصلاح خطأ سابق            | يُدمج في التعريف النهائي    |
| ترحيلات إعادة تعريف الدوال | الملفات التي تُعيد تعريف `create_sale`/`is_staff`/...           | يُحتفظ بالنسخة النهائية فقط |
| ترحيلات إعادة التسمية      | `RENAME COLUMN` في ملفات منفصلة                                 | تُدمج في التعريف النهائي    |
| الترحيل المدمّر            | `20260912111000_reset_for_meters_shop.sql`                      | **يُحذف بالكامل**           |
| بيانات الأعمال             | منتجات، تصنيفات، مستلزمات تعبئة، مخزون وهمي                     | تُنقل إلى seeds             |
| هوية الشركة                | `company_settings` UPDATE، `Main Warehouse`, `Walk-in Customer` | **يُحذف**                   |
| بيانات المتجر السابق       | أي إشارة لمتجر العدادات أو المطحنة أو المتر                     | **يُحذف**                   |
| التعليقات التاريخية        | "Phase 2", "السابق", "the defect", "was replaced by"            | تُنقّى من البنية الجديدة    |

---

## القسم 3 — كيف سيتم استخراج Final Schema

**لا يُعاد بناء المخطط بقراءة الملفات فقط.** هذا عرضة لفقدان عمود أو قيد أو دالة لم تُلاحَظ.

### الخطوة 3.1 — استخراج من قاعدة حيّة

```bash
supabase db dump --schema public --file supabase/_baseline/schema-baseline.sql
supabase db dump --schema public --data-only --table supabase_migrations.schema_migrations \
  --file supabase/_baseline/applied-migrations.sql
```

### الخطوة 3.2 — استخراج الكائنات المنفصلة

```bash
# الدوال
supabase db dump --schema public -f supabase/_baseline/functions.sql --keep-comments
# الفهارس
psql "$DATABASE_URL" -c "\di public.*" > supabase/_baseline/indexes.txt
# السياسات
psql "$DATABASE_URL" -c "SELECT * FROM pg_policies WHERE schemaname='public'" \
  > supabase/_baseline/policies.txt
# القيود
psql "$DATABASE_URL" -c "SELECT * FROM pg_constraint WHERE connamespace='public'::regnamespace" \
  > supabase/_baseline/constraints.txt
```

### الخطوة 3.3 — التحقق من الاكتمال

قبل كتابة أي ملف جديد، يُبنى **جرد مقارن**:

| الكائن    | عدد في القاعدة | عدد في الخطة | مطابق؟ |
| --------- | -------------- | ------------ | ------ |
| الجداول   | ?              | ?            | ✅/❌  |
| الأعمدة   | ?              | ?            | ✅/❌  |
| الدوال    | ?              | ?            | ✅/❌  |
| Triggers  | ?              | ?            | ✅/❌  |
| السياسات  | ?              | ?            | ✅/❌  |
| الفهارس   | ?              | ?            | ✅/❌  |
| القيود    | ?              | ?            | ✅/❌  |
| الـ Enums | ?              | ?            | ✅/❌  |

**لا يُقبل أي ملف جديد حتى يطابق الجرد 100%.**

### الخطوة 3.4 — ترتيب الاستخراج

الترتيب الإلزامي داخل كل ملف:

```
1. CREATE TYPE (enums)
2. CREATE TABLE (الجداول الأساسية)
3. ALTER TABLE / FOREIGN KEYS (العلاقات والقيود)
4. CREATE INDEX
5. CREATE FUNCTION / RPC
6. CREATE TRIGGER
7. CREATE VIEW
8. ALTER TABLE ... ENABLE ROW LEVEL SECURITY + CREATE POLICY
9. GRANT / REVOKE
```

> **ملاحظة معمارية مهمة:** يجب فصل `CREATE TABLE` عن `FOREIGN KEY` عندما توجد دورة اعتماد بين جدولين (مثل `sales_invoices ↔ customer_payments`). تُنشأ الجداول أولًا، ثم تُضاف القيود في خطوة لاحقة.

---

## القسم 4 — التقسيم النهائي وترتيب الملفات

الترتيب التالي **مستخرج من تحليل الاعتماديات الفعلي**، لا من مثال مفترض.

### 4.1 منطق الترتيب

```
①  لا شيء يعتمد على شيء
    └─ enums + helper functions (is_staff, has_role, tg_set_updated_at)

②  الهوية (كل شيء يشير إلى auth.users)
    └─ profiles → user_roles → company_settings → warehouses

③  المرجعيات (لا تشير إلا لنفسها)
    └─ categories, brands, units, countries, quality_grades, vehicle_*

④  الكتالوج (يشير إلى ③)
    └─ products → product_batches → product_compatibilities

⑤  المخزون (يشير إلى ② و ④)
    └─ inventory → stock_movements → stock_transfers → stock_adjustments

⑥  الأطراف (يشير إلى ②)
    └─ customers → suppliers → customer_ledger

⑦  المبيعات والمشتريات (يشير إلى ④⑤⑥)
    └─ sales_invoices → sales_invoice_items → sales_returns
    └─ purchase_invoices → purchase_invoice_items → purchase_returns

⑧  المدفوعات (يشير إلى ⑥⑦)
    └─ customer_payments → customer_payment_splits

⑨  المحاسبة (يشير إلى ②⑥)
    └─ accounts → journal_entries → journal_lines → opening_balances

⑩  المصروفات (يشير إلى ②④⑨)
    └─ expense_entries → expense_lines → expense_payments → expense_approvals

⑪  المطحنة المبسطة (يشير إلى ④⑤⑥)
    └─ custody_ledger + دوال RPC — جدول واحد، الرصيد مشتق

⑫  المنصة (مستقلة عن كل ما سبق)
    └─ platform_admins → platform_modules → platform_plans → tenant_subscriptions

⑬  التدقيق (يشير إلى ②)
    └─ audit_logs → platform_audit_logs

⑭  Views والتحقق النهائي
```

### 4.2 الملفات النهائية المقترحة

| #   | اسم الملف                             | المجال                                                                                                                                                                                                                                                | يعتمد على  |
| --- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 01  | `01_core_enums_and_helpers.sql`       | كل الـ enums + `is_staff`, `has_role`, `is_platform_admin`, `tg_set_updated_at`                                                                                                                                                                       | —          |
| 02  | `02_core_identity_and_settings.sql`   | `profiles`, `user_roles`, `company_settings`, `warehouses`                                                                                                                                                                                            | 01         |
| 03  | `03_catalog_reference_data.sql`       | `categories`, `brands`, `units`, `countries_of_origin`, `quality_grades`, `vehicle_makes`, `vehicle_models`                                                                                                                                           | 01, 02     |
| 04  | `04_products_and_batches.sql`         | `products`, `product_batches`, `product_compatibilities`                                                                                                                                                                                              | 03         |
| 05  | `05_inventory_and_movements.sql`      | `inventory`, `stock_movements`, `stock_transfers(+items)`, `stock_adjustments(+items)`                                                                                                                                                                | 02, 04     |
| 06  | `06_partners_customers_suppliers.sql` | `customers`, `suppliers`, `customer_ledger`, `loyalty_transactions`                                                                                                                                                                                   | 02         |
| 07  | `07_sales_and_returns.sql`            | `sales_invoices(+items)`, `sales_returns(+items)`, `customer_payments`, `customer_payment_splits`                                                                                                                                                     | 04, 05, 06 |
| 08  | `08_purchasing_and_returns.sql`       | `purchase_invoices(+items)`, `purchase_returns(+items)`                                                                                                                                                                                               | 04, 05, 06 |
| 09  | `09_accounting_ledger.sql`            | `accounts`, `journal_entries`, `journal_lines`, `opening_balance_*`                                                                                                                                                                                   | 02, 06     |
| 10  | `10_expenses.sql`                     | `expense_categories`, `expense_entries`, `expense_lines`, `expense_payments`, `expense_approvals`, `expense_attachments`, `expense_cost_centers`, `expense_projects`                                                                                  | 02, 04, 09 |
| 11  | `10_milling_custody.sql`              | `milling_service_documents` + `custody_ledger` ودوال RPC للمستند الموحد وعمليات الأمانة                                                                                                                                                               | 04, 05, 06 |
| 12  | `12_platform_and_subscriptions.sql`   | `platform_admins`, `platform_modules`, `platform_plans`, `tenant_subscriptions`                                                                                                                                                                       | 02         |
| 13  | `13_audit_and_governance.sql`         | `audit_logs`, `platform_audit_logs`                                                                                                                                                                                                                   | 02, 12     |
| 14  | `14_reporting_views.sql`              | كل الـ Views: `trial_balance`, `inventory_valuation`, `company_stock_positions`, `customer_owned_positions`, `customer_ledger_balances`, `invoice_ledger_status`, `custody_customer_statement`, `custody_service_money`, `custody_detected_loss`, ... | 01–13      |

**الإجمالي: 14 ملفًا** بدل 132.

> **لماذا 14 وليس أقل؟** لأن الدمج الأعمق يخلق ملفات ضخمة يصعب مراجعتها، ويكسر حدود المجال. و14 ملفًا يحقّق: ترتيبًا واضحًا، حدودًا نظيفة، وقابلية نقل. هذا هو **أبسط بنية صحيحة**، لا أقل عدد ممكن.

### 4.3 ملاحظة على ملفات 07 و 08

المبيعات والمشتريات منفصلتان لأن:

- لكل منهما دورة حياة مختلفة (تحصيل مقابل سداد)
- `create_sale` و`create_purchase` ضخمتان ومستقلتان
- فصلهما يسمح بتعديل إحداهما دون المساس بالأخرى

### 4.4 ملاحظة على ملف 14

الـ Views مؤجلة للنهاية **قصدًا**: كل view يعتمد على جداول من عدة مجالات. تأجيلها يضمن أن كل الجداول موجودة قبل تعريفها.

---

## القسم 5 — ما يبقى في Migration وما ينتقل إلى Seeds

### 5.1 يبقى في Migration (Schema فقط)

```
✅ CREATE TYPE (enums)
✅ CREATE TABLE + الأعمدة + القيود
✅ FOREIGN KEY / UNIQUE / CHECK
✅ CREATE INDEX
✅ CREATE FUNCTION / RPC
✅ CREATE TRIGGER
✅ CREATE VIEW
✅ ENABLE ROW LEVEL SECURITY + CREATE POLICY
✅ GRANT / REVOKE
✅ SEQUENCE
```

### 5.2 ينتقل إلى `seeds/01_system/` (بيانات لا يعمل النظام بدونها)

تتوزّع اليوم على **8 ملفات** في `seeds/01_system/` (كل ملف لموضوع واحد):

```
✅ 01_modules.sql            صفوف platform_modules (النظام يقرأها لتحديد الميزات)
✅ 02_plans.sql              صفوف platform_plans (الباقات)
✅ 03_chart_of_accounts.sql  دليل الحسابات الافتراضي (1101, 1211, 1311, 2111, 4111, 5111, ...)
✅ 04_units.sql              وحدات القياس الفيزيائية
✅ 05_expense_categories.sql تصنيفات المصروفات الافتراضية (مربوطة بحساباتها)
✅ 06_platform_admins.sql    مسؤولو المنصة (استثناء مقصود: auth.users حقيقي)
✅ 07_document_numbering.sql إعداد ترقيم المستندات (محرّك 14 يقرأ منه)
✅ 08_payment_methods.sql    كتالوج طرق الدفع + إعداد المنشأة (الترحيل 16 يقرأ منه)
```

> أدوار النظام (`owner, manager, accountant, cashier, warehouse`) وأنواع المستندات
> تُعرَّف في المخطط نفسه كـ ENUM/CHECK، ولا تحتاج صفوف seed.

> **ملاحظة مهمة:** `journal_entries` و`journal_lines` و`inventory` و`stock_movements` **لا تحتوي أي بيانات** في المرجعيات. تبدأ فارغة.

### 5.3 ينتقل إلى `seeds/03_samples/`

```
→ كل ما هو حاليًا في seeds/demo/ بالبنية القديمة (accounts, wholesale-retail, stationery)
→ منتجات المطحنة من 20261204000000 و 20261001000000
→ مستلزمات التعبئة والأصناف الخام
→ التصنيفات (قمح، ذرة، شعير، مستلزمات تعبئة)
→ Main Warehouse / Walk-in Customer
```

### 5.4 ينتقل إلى `seeds/04_tests/`

```
→ بيانات اختبارات آلية (لا توجد حاليًا — يُنشأ المجلد عند الحاجة)
```

### 5.5 ينتقل إلى `seeds/02_company/`

```
→ لا شيء يُرفع للمستودع
→ قوالب فقط: customer-template.sql.example
→ الهوية والأرصدة الافتتاحية تُدخَل يدويًا لكل عميل
```

### 5.6 يُحذف نهائيًا

```
❌ 20260912111000_reset_for_meters_shop.sql — بالكامل
❌ UPDATE company_settings في أي migration
❌ INSERT INTO inventory ... 999999
❌ أي إشارة لمتجر عدادات أو مطحنة أو متر
```

---

## القسم 6 — البنية النهائية للمجلدات

```
supabase/
├── MIGRATIONS_RULES.md                  ← قانون ملزم (موجود)
├── MIGRATIONS_REFACTOR_PLAN.md          ← هذه الخطة (موجود)
├── config.toml                          ← يربط seeds/01_system/
├── migrations/                          ← الترتيب الفعلي المعتمد (راجع 13.2)
│   ├── 01_core_enums_and_helpers.sql
│   ├── 02_core_identity_and_settings.sql
│   ├── 03_catalog_reference_data.sql
│   ├── 04_partners_customers_suppliers.sql
│   ├── 05_products_and_inventory.sql
│   ├── 06_sales_and_returns.sql
│   ├── 07_purchasing_and_returns.sql
│   ├── 08_accounting_ledger.sql
│   ├── 09_expenses.sql
│   ├── 10_milling_custody.sql
│   ├── 11_platform_and_audit.sql
│   ├── 12_reporting_views.sql
│   ├── 13_foreign_keys_and_grants.sql
│   ├── 14_document_numbering_engine.sql
│   ├── 15_freeze_document_numbers.sql
│   └── 16_payment_methods.sql
├── seeds/
│   ├── README.md
│   ├── 01_system/                          ← يُشغَّل تلقائيًا (Essential Reference)
│   │   ├── 01_modules.sql
│   │   ├── 02_plans.sql
│   │   ├── 03_chart_of_accounts.sql
│   │   ├── 04_units.sql
│   │   ├── 05_expense_categories.sql
│   │   ├── 06_platform_admins.sql
│   │   ├── 07_document_numbering.sql
│   │   ├── 08_payment_methods.sql
│   │   └── README.md
│   ├── 02_company/                         ← يدوي: هوية العميل وأرصدته
│   │   ├── README.md
│   │   └── customer-template.sql.example
│   ├── 03_samples/                         ← يدوي: بيانات عرض
│   │   ├── README.md
│   │   └── sample-mill.sql
│   └── 04_tests/                           ← يدوي: مثبتات الاختبارات
│       ├── README.md
│       └── fixtures.sql.example
├── _archive/                                ← مرجع تاريخي فقط، لا يُشغَّل
│   ├── migrations-v1/                       ← 131 ترحيلًا قديمًا بترقيم زمني
│   └── team-seeds-v1/                       ← بذور الفريق المسطّحة (reference.sql, demo/)
└── tests/
```

**ملاحظة:** مجلد `_baseline/` مؤقت لأغراض التحقق، يُحذف بعد اعتماد البنية الجديدة. يُضاف إلى `.gitignore` أو يُحفظ كمرجع تاريخي.

---

## القسم 7 — طريقة التنفيذ (خطوة بخطوة)

### المرحلة 0 — التجهيز (لا تغيير)

1. إنشاء `supabase/_baseline/` وتشغيل أوامر الاستخراج (القسم 3.1 و 3.2).
2. بناء جدول الجرد المقارن (القسم 3.3).

### المرحلة 1 — استخراج الشكل النهائي

3. من `schema-baseline.sql`، استخرج تعريف كل جدول **بشكله النهائي**.
4. استخرج كل دالة بنسختها السارية (الأخيرة زمنيًا).
5. استخرج كل trigger وpolicy وindex وview.
6. **تحقق:** كل جدول في الجرد له تعريف نهائي.

### المرحلة 2 — كتابة الملفات الجديدة

7. اكتب `01` → `14` بالترتيب.
8. اتبع ترتيب الكائنات داخل كل ملف (القسم 3.4).
9. **لا تنسخ** أي بيانات أعمال أو هوية شركة.

### المرحلة 3 — كتابة الـ Seeds

10. `seeds/01_system/` — الوحدات، دليل الحسابات، التصنيفات، وحدات القياس، الباقات.
11. `seeds/03_samples/sample-mill.sql` — منقول من migrations.
12. تحديث `seeds/README.md` و`config.toml`.

### المرحلة 4 — التحقق (حرجة)

13. **اختبار قاعدة فارغة:**
    ```bash
    supabase db reset   # يجب أن ينجح بلا خطأ واحد
    ```
14. **مقارنة الجرد:** أعد تشغيل أوامر الاستخراج على القاعدة الجديدة وقارن مع `_baseline/`.
15. **اختبار التطبيق:** تشغيل `npm run dev` والتأكد من عمل كل الشاشات.

### المرحلة 5 — الاستبدال

16. نقل الترحيلات القديمة إلى `supabase/_archive/migrations-v1/`.
17. نقل الترحيلات الجديدة إلى `supabase/migrations/`.
18. إعادة `supabase db reset` والتأكد من النجاح.

### المرحلة 6 — التنظيف

19. حذف `_archive/` بعد التأكد الكامل.
20. تحديث `docs/database/schema-reference.md`.

---

## القسم 8 — اختبارات التحقق

### 8.1 اختبار قاعدة جديدة فارغة (إلزامي)

```bash
# 1. قاعدة نظيفة تمامًا
supabase db reset

# النتيجة المطلوبة:
#   ✅ كل الترحيلات تُطبَّق بلا خطأ
#   ✅ seeds/01_system/ يُطبَّق بلا خطأ
#   ✅ لا رسالة "duplicate key"
#   ✅ لا رسالة "relation already exists"
```

### 8.2 اختبار عدم فقد أي كائن

```sql
-- قارن الأعداد قبل وبعد
SELECT 'tables'     AS kind, count(*) FROM information_schema.tables
  WHERE table_schema='public' AND table_type='BASE TABLE'
UNION ALL SELECT 'views',      count(*) FROM information_schema.views WHERE table_schema='public'
UNION ALL SELECT 'functions',  count(*) FROM information_schema.routines WHERE routine_schema='public'
UNION ALL SELECT 'triggers',   count(*) FROM information_schema.triggers WHERE trigger_schema='public'
UNION ALL SELECT 'policies',   count(*) FROM pg_policies WHERE schemaname='public'
UNION ALL SELECT 'indexes',    count(*) FROM pg_indexes WHERE schemaname='public'
UNION ALL SELECT 'enums',      count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
  WHERE n.nspname='public' AND t.typtype='e'
UNION ALL SELECT 'columns',    count(*) FROM information_schema.columns WHERE table_schema='public';
```

**النتيجة المطلوبة: كل رقم في القاعدة الجديدة = الرقم في `_baseline/`. أي فرق = فشل.**

### 8.3 اختبار الوظائف الحرجة

```sql
-- 1. الدوال الأساسية موجودة
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND proname IN
  ('is_staff','has_role','create_sale','create_purchase','create_sales_return',
   'record_customer_payment','post_stock_delta','create_journal_entry',
   'reverse_journal_entry','post_sales_invoice','post_purchase_invoice');

-- 2. RLS مفعَّل على كل الجداول
SELECT tablename FROM pg_tables t
WHERE schemaname='public' AND NOT rowsecurity;
-- النتيجة المطلوبة: صفر صفوف

-- 3. لا جدول بلا سياسة
SELECT t.tablename FROM pg_tables t
LEFT JOIN pg_policies p ON p.tablename=t.tablename AND p.schemaname='public'
WHERE t.schemaname='public' AND p.policyname IS NULL;
-- النتيجة المطلوبة: صفر صفوف (أو مراجعة يدوية للمقصود)
```

### 8.4 اختبار سلامة البيانات المرجعية

```sql
-- لا منتجات في قاعدة جديدة
SELECT count(*) FROM public.products;          -- المطلوب: 0
-- لا مخزون
SELECT count(*) FROM public.inventory;         -- المطلوب: 0
-- لا فواتير
SELECT count(*) FROM public.sales_invoices;    -- المطلوب: 0
-- لا هوية شركة مفروضة
SELECT name, currency FROM public.company_settings;  -- المطلوب: صف واحد بقيم افتراضية محايدة أو فارغ
-- دليل الحسابات موجود
SELECT count(*) FROM public.accounts;          -- المطلوب: >= 30
-- الأدوار موجودة
SELECT count(DISTINCT role) FROM public.user_roles;  -- المطلوب: >= 5 (أو من جدول الأدوار)
```

### 8.5 اختبار التطبيق

```bash
npm run build      # يجب أن ينجح
npm run dev        # ثم فحص الشاشات:
#   /products, /inventory, /customers, /suppliers
#   /sales, /purchases, /payments
#   /trial-balance, /income-statement, /balance-sheet
#   /expenses, /opening-balances
#   /settings (حفظ هوية الشركة يعمل)
```

---

## القسم 9 — المخاطر والتنبيهات

### 🔴 خطر 1 — دورة اعتماد بين الجداول

`sales_invoices` يشير إلى `customers`، و`customer_payments` يشير إلى `sales_invoices`. عند إعادة الكتابة:

- أنشئ كل الجداول أولًا بلا `FOREIGN KEY`، ثم أضف القيود في خطوة منفصلة.
- أو رتّب بحيث لا تنشأ الدورة.

**لا تفترض أن ترتيب `CREATE TABLE` يكفي — تحقق من القيود الدائرية.**

### 🔴 خطر 2 — الدوال المتعددة النسخ

`create_sale` لها 6+ نسخ. **استخرج النسخة السارية من قاعدة البيانات الحيّة** (`pg_get_functiondef`)، لا من الملفات.

```sql
SELECT pg_get_functiondef('public.create_sale(uuid,uuid,text,numeric,numeric,text,jsonb)'::regprocedure);
```

اكتب هذا لكل دالة متعددة النسخ قبل إعادة الكتابة.

### 🟡 خطر 3 — الأعمدة المنسية

جداول مثل `products` و`customers` و`stock_movements` لها أعمدة مضافة عبر 5–8 ملفات. الاعتماد على قراءة الملفات سيُسقط أعمدة.
**الحل:** استخدم `information_schema.columns` من القاعدة الحيّة كمرجع وحيد.

### 🟡 خطر 4 — Views تعتمد على أعمدة محددة

`inventory_valuation` و`company_stock_positions` تعتمد على أعمدة في `products` و`inventory`. أي عمود ناقص يكسرها.
**الحل:** اختبر كل view بعد البناء: `SELECT * FROM <view> LIMIT 1;`

### 🟡 خطر 5 — الاعتماديات عبر `src/`

الكود في `src/` يستدعي أسماء جداول وأعمدة ودوال محددة. أي تغيير اسم يكسر التطبيق.
**الحل:** بعد البناء، شغّل `npm run build` وافحص الشاشات. لا تُعِد تسمية أي شيء بلا تحقق من `src/`.

### 🟢 خطر 6 — فقدان بيانات حقيقية

**غير موجود حاليًا** — القاعدة تجريبية وستُبنى من الصفر. لكن إن أصبحت هناك بيانات حقيقية، **يجب** أخذ نسخة احتياطية كاملة قبل أي استبدال.

### ⚠️ خطر 7 — ملف `20260912111000_reset_for_meters_shop.sql`

هذا الملف **يجب حذفه قبل أي شيء**. إن بقي، أي `db reset` سيمسح كل المستخدمين. **أعلى أولوية.**

---

## القسم 10 — قائمة التحقق النهائية

### قبل البدء

```
[ ] نسخة احتياطية من القاعدة الحالية
[ ] _baseline/ مستخرج بالكامل
[ ] جرد الأعداد موثّق (جداول، أعمدة، دوال، triggers، سياسات، فهارس)
[ ] النسخ السارية للدوال المتعددة مستخرجة بـ pg_get_functiondef
```

### أثناء الكتابة

```
[ ] 14 ملفًا بالترتيب المحدد
[ ] لا بيانات أعمال أو هوية شركة في أي ملف
[ ] لا TRUNCATE / DELETE جماعي
[ ] كل دالة معرَّفة مرة واحدة
[ ] كل جدول بتصميمه النهائي
[ ] كل جدول له RLS + سياسات
[ ] كل SECURITY DEFINER له search_path
[ ] الجداول المالية بلا كتابة مباشرة
[ ] ترتيب الكائنات داخل كل ملف صحيح
```

### بعد الكتابة

```
[ ] supabase db reset ينجح بلا خطأ
[ ] جرد الأعداد مطابق 100%
[ ] كل view يعمل
[ ] كل دالة موجودة
[ ] صفر جدول بلا RLS
[ ] صفر منتج/مخزون/فاتورة في قاعدة جديدة
[ ] دليل الحسابات موجود
[ ] npm run build ينجح
[ ] كل الشاشات تعمل
[ ] seeds/01_system/ idempotent (تشغيله مرتين لا يُنشئ تكرارًا)
[ ] التوثيق محدَّث
```

### قبل الحذف النهائي

```
[ ] الترحيلات القديمة مؤرشفة في _archive/
[ ] لا مرجع لأي ترحيل قديم في الكود أو التوثيق
[ ] القاعدة الجديدة تعمل بالكامل
[ ] _baseline/ محفوظ أو محذوف بوعي
```

---

## القسم 11 — جدول مقارنة قبل/بعد

| المقياس                          | قبل                               | بعد          |
| -------------------------------- | --------------------------------- | ------------ |
| ملفات الترحيل                    | 132                               | 14           |
| ملفات Seed                       | 5                                 | 10+ منظمة    |
| بيانات أعمال في الترحيلات        | نعم (منتجات، تصنيفات، مخزون وهمي) | لا           |
| هوية شركة في الترحيلات           | نعم                               | لا           |
| `TRUNCATE`/`DELETE` مدمّر        | نعم                               | لا           |
| تكرار تعريف الدوال               | نعم (6+ لـ `create_sale`)         | لا           |
| `ALTER` متسلسل على نفس الجدول    | نعم                               | لا           |
| الشكل النهائي للجدول في ملف واحد | لا                                | نعم          |
| بناء قاعدة جديدة من الصفر        | يفشل                              | ينجح         |
| حدود Schema/Reference/Demo       | غير واضحة                         | واضحة        |
| أسماء الملفات                    | UUID وأسماء عشوائية               | وصفية مرقّمة |

---

## القسم 12 — ملاحظات للـ Agent المنفّذ

1. **اقرأ `MIGRATIONS_RULES.md` أولًا.** لا استثناء.
2. **لا تعتمد على قراءة الملفات لاستخراج البنية.** استخدم القاعدة الحيّة.
3. **لا تُعِد تسمية أي جدول أو عمود أو دالة** بلا تحقق من `src/`.
4. **الترتيب في القسم 4 مُستخرَج من الاعتماديات الفعلية.** إن اكتشفت اعتمادية تخالفه، عدّل الترتيب ووثّق السبب.
5. **إن اكتشفت كائنًا غير مذكور في هذه الخطة، أضفه إلى ملفه الصحيح** ولا تحذفه.
6. **اختبار `db reset` ليس اختياريًا.** هو معيار القبول.
7. **إن فشل أي اختبار، لا تُكمل.** أصلح ثم أعد من البداية.
8. **وثّق كل انحراف عن هذه الخطة** في نهاية هذا الملف.

---

_انتهت الخطة. التنفيذ يبدأ فقط بعد اعتمادها._
---

## القسم 13 — حالة التنفيذ (محدَّثة)

> **الحالة: ✅ منفَّذ ومتحقَّق منه.**

### 13.1 النتيجة

| المقياس                                             | قبل                     | بعد                           |
| --------------------------------------------------- | ----------------------- | ----------------------------- |
| ملفات الترحيل                                       | 126                     | **16**                        |
| ملفات Seed النظام                                   | 5                       | **8** (في `seeds/01_system/`) |
| الشكل النهائي للجدول في ملف واحد                    | لا                      | نعم                           |
| بناء قاعدة جديدة من الصفر                           | يفشل                    | **ينجح (exit 0)**             |
| بيانات أعمال في الترحيلات                           | نعم                     | **لا**                        |
| ترحيل مدمّر (`TRUNCATE` + `DELETE FROM auth.users`) | موجود                   | **مؤرشف**                     |
| تكرار تعريف الدوال                                  | 6+ نسخ لـ `create_sale` | **نسخة واحدة**                |

### 13.2 الترتيب النهائي المعتمد

الترتيب أدناه **مختلف عن الترتيب المفترض في القسم 4**، لأن اختبار القاعدة الفارغة كشف
اعتماديات حقيقية لم تظهر من قراءة الملفات. كل تغيير موثَّق بسببه.

| #   | الملف                          | الحجم        | السبب                                                                             |
| --- | ------------------------------ | ------------ | --------------------------------------------------------------------------------- |
| 01  | `core_enums_and_helpers`       | 4.7 KB       | 20 نوع ENUM + دوال حسابية نقية بلا جداول                                          |
| 02  | `core_identity_and_settings`   | 15.6 KB      | الهوية + **دوال التخويل** التي تعتمد عليها كل سياسة RLS                           |
| 03  | `catalog_reference_data`       | 3.7 KB       | تصنيفات، وحدات، علامات                                                            |
| 04  | `partners_customers_suppliers` | 4.7 KB       | **قبل المخزون**: `inventory` يشير إلى `customers`                                 |
| 05  | `products_and_inventory`       | 76.9 KB      | **مدموجان**: دوال المنتج تعدّ صفوف المخزون، ودوال المخزون تكتب طبقات تكلفة المنتج |
| 06  | `sales_and_returns`            | 35.3 KB      | يعتمد على 05 و04                                                                  |
| 07  | `purchasing_and_returns`       | 15.2 KB      | يعتمد على 05 و04                                                                  |
| 08  | `accounting_ledger`            | 33.2 KB      | دليل الحسابات والقيود المزدوجة والأرصدة الافتتاحية                                |
| 09  | `expenses`                     | 93.2 KB      | يعتمد على 02 و08                                                                  |
| 10  | `milling_custody`              | (انظر الملف) | يعتمد على 04 و05 و06                                                              |
| 11  | `platform_and_audit`           | 4.5 KB       | مستقل                                                                             |
| 12  | `reporting_views`              | 30.4 KB      | **مؤجَّل**: 30 view مرتبة حسب اعتمادها على بعضها                                  |
| 13  | `foreign_keys_and_grants`      | 127.5 KB     | **كل** المفاتيح الأجنبية + Triggers + سياسات RLS + الصلاحيات                      |
| 14  | `document_numbering_engine`    | —            | محرّك مركز لترقيم المستندات؛ تقرأ إعداده البذرة `07`                              |
| 15  | `freeze_document_numbers`      | —            | تجميد الأرقام المولَّدة؛ صغير ومستقل                                              |
| 16  | `payment_methods`              | —            | كتالوج طرق الدفع الموحّد + حرّاس الكتابة + محرّك الترحيل؛ الكتالوج في البذرة `08` |

### 13.3 القرارات المعمارية الثلاثة التي فرضها الاختبار

**1. دمج المنتجات والمخزون في ملف واحد.**
الاختبار أثبت دورة حقيقية: `product_reference_counts()` تقرأ `stock_movements`، و
`apply_cost_movement()` تكتب `item_cost_layers` المرتبطة بالمنتج. **لا يوجد ترتيب ملفات
يُرضي الطرفين.** الدمج هو الحل الوحيد الصحيح، وقد وُثِّق داخل الملف نفسه.

**2. تأجيل كل المفاتيح الأجنبية إلى الملف الأخير.**
81 جدولًا فيها أكثر من 200 مرجع متشابك، و`products` يشير إليه 25 جدولًا يشير بعضها إلى
`inventory`. كتابة المفاتيح داخل ملف كل مجال تفرض ترتيبًا هشًّا ينكسر بأي عمود جديد.

**3. تأجيل Triggers وسياسات RLS إلى الملف الأخير.**
لنفس السبب: سياسة `products` تقرأ `stock_movements` من مجال آخر. تأجيلها جعل ملفات
المجالات مستقلة عن ترتيبها، وكل ملف يُقرأ وحده.

**النتيجة المعمارية:** ملفات المجالات (01–12) تحمل **جداولها وقيودها وفهارسها ودوالها**،
والملف 13 يحمل **ما يعبر المجالات**. هذا هو النمط القياسي لمخطط بهذا القدر من التشابك.

### 13.4 فصل البيانات — ما انتقل خارج الترحيل

| المصدر (داخل الترحيل سابقًا)                                           | المصير                             |
| ---------------------------------------------------------------------- | ---------------------------------- |
| منتجات المطحنة (قمح، دقيق، نخالة) — `20261204000000`, `20261001000000` | `seeds/03_samples/sample-mill.sql` |
| تصنيفات المطحنة ومستلزمات التعبئة                                      | `seeds/03_samples/sample-mill.sql` |
| `INSERT INTO inventory ... 999999` (مخزون وهمي)                        | **حُذف**                           |
| `UPDATE company_settings SET name = 'محل العدادات...'`                 | **حُذف**                           |
| `Main Warehouse` / `Walk-in Customer`                                  | `seeds/03_samples/sample-mill.sql` |
| `20260912111000_reset_for_meters_shop.sql` (TRUNCATE + DELETE users)   | **مؤرشف — لم يُنقل**               |

### 13.5 ما بقي داخل `seeds/01_system/` — ومبرر كل ملف

| الملف                       | لماذا هو مرجعي                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `01_modules.sql`            | التطبيق يقرأ `code` لتحديد الشاشات المتاحة؛ غيابه يعطّل كل وحدة                           |
| `02_plans.sql`              | كتالوج الباقات                                                                            |
| `03_chart_of_accounts.sql`  | **دوال الترحيل تحتوي أكواد الحسابات كنصوص** (`'4111'`, `'1211'`)؛ حساب ناقص يُفشل الترحيل |
| `04_units.sql`              | كل منتج يحتاج وحدة قياس                                                                   |
| `05_expense_categories.sql` | نموذج المصروف يشترط تصنيفًا، وكل تصنيف مربوط بحسابه                                       |
| `06_platform_admins.sql`    | بلا مسؤول منصة لا تُدار الباقات والوحدات والاشتراكات                                      |
| `07_document_numbering.sql` | بلاها يرفض محرّك الترقيم توليد أي رقم                                                     |
| `08_payment_methods.sql`    | كل دفعة تمر من هنا + إعداد المنشأة الافتراضي                                              |

**أصناف المطحنة (حبوب خام، نواتج، مستهلكات) ليست مرجعية** — كلها منتجات حقيقية
تشتريها مطحنة معيّنة، فمكانها `03_samples/sample-mill.sql`. الحبوب أصناف
`RAW_MATERIAL` والنواتج `FINISHED_GOOD/BY_PRODUCT` والخدمة صنف واحد
«أجور طحن وتجهيز» (docs/milling/00 — ق5).

### 13.6 التحقق النهائي — نتائج فعلية

```
✅ 16/16 ملف ترحيل تُطبَّق على قاعدة فارغة بلا خطأ واحد
✅ 8/8 ملفات seed في `01_system/` تُطبَّق بلا خطأ
✅ 81 جدول    | baseline 81
✅ 127 دالة   | baseline 127
✅ 125 سياسة  | baseline 125
✅ 30 view    | baseline 30
✅ 20 enum    | baseline 20
✅ 13 sequence| baseline 13
✅ 100% من الجداول لها RLS
✅ صفر منتج / صفر مخزون / صفر فاتورة / صفر إعدادات شركة في القاعدة الجديدة
✅ دليل الحسابات (32) والوحدات والوحدات والتصنيفات موجودة
✅ npm run build ينجح
```

### 13.7 ملاحظة على الأرشيف

| الترحيلات القديمة `supabase/_archive/migrations-v1/` و`team-seeds-v1/` و`seeds/_archive/` **حُذفت نهائيًا** (2026-10-21) بقرار صاحب المشروع. كانت تحتوي ترحيلات كاسرة لكلمات المرور وكبيانات لا تعمل على قاعدة جديدة. لا تشغّل أي ترحيل قديم على أي قاعدة.

> **تنبيه:** الترحيلات القديمة مُطبَّقة بالفعل على قاعدة بياناتك الحالية. الترحيلات
> الجديدة تُستخدم لبناء **قواعد جديدة من الصفر**. لا تُشغِّل `supabase db push` على
> قاعدة قائمة، لأنها ستحاول إنشاء كائنات موجودة. راجع القسم 14.

---

## القسم 14 — جولة دمج ثانية (`origin/main` التالي)

> **التاريخ:** 2026-10-11 · **الفرع:** `merge/team-work`

تقدّم `origin/main` بعمل واجهات جديد و**ترحيل واحد جديد**:
`20261211000000_strict_customer_collections_and_explicit_advances.sql`.

**القرار:** لم يُدخَل كملف مرقّم زمنيًا (القاعدة R-11: الأسماء وصفية مرقّمة)، بل:

| المكوّن                                                 | مكانه الصحيح                     |
| ------------------------------------------------------- | -------------------------------- |
| `record_customer_payment` (بمنطق التحصيل الصارم الجديد) | `06_sales_and_returns.sql`       |
| `record_customer_advance_payment` (دالة جديدة)          | `06_sales_and_returns.sql`       |
| منح الدالتين                                            | `13_foreign_keys_and_grants.sql` |
| الملف الزمني الأصلي                                     | **حُذف** من `migrations/`        |

**دمج ذكي لا نسخ:** أُخذ **منطق** main الجديد (منع تحوّل الفائض إلى دفعة مقدمة
بصمت، فحص الرصيد الكلي قبل التوزيع، الدالة الصريحة للدفعة المقدمة) ووُضع في
**جسمنا الأحدث** (`derive_payment_status` + `resolve_writable_payment_method`).
الحصيلة: بقي عدد ملفات الترحيل **16**، ولا دالة معرَّفة مرتين (R-13/R-14).

التفاصيل الكاملة في `TEAM_MERGE_REPORT.md` القسم 9.

---

## القسم 14 — تحديث ما بعد الإصلاح (Prettier + ESLint)

> **التاريخ:** 2026-10-12 · **الحالة:** ✅ منفَّذ ومتحقَّق منه

### 14.1 القياس الفعلي

| المقياس                  | القيمة                                                                          |
| ------------------------ | ------------------------------------------------------------------------------- |
| `npm run lint` — النتيجة | `✖ 61 problems (0 errors, 61 warnings)`                                         |
| أخطاء                    | **0**                                                                           |
| تحذيرات                  | 61 (كلها `react-hooks/exhaustive-deps` و`react-refresh/only-export-components`) |
| exit code                | 0                                                                               |

> التحذيرات المتبقية **ليست أخطاء تنسيق**، بل تحذيرات معمارية في React Hooks
> وFast Refresh. لا تُصلَح آليًا ولا تُفشل البناء. تُعالَج في ممر منفصل إن لزم.

### 14.2 الأخطاء التي أُصلحت في هذا الممر

| #   | الخطأ                                                                                  | الملف                          | الإصلاح                                             |
| --- | -------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------- |
| 1   | متغيرات `BRAND_SLUG`, `VAT_RATE` معلَّقة في JSX بلا استخدام (3 أسطر، `no-unused-vars`) | `src/routes/_app.settings.tsx` | حُذفت من الـ JSX مع الحفاظ على المنطق الذي يستهلكها |
| 2   | مسافة بادئة/فواصل مخالفة لـ Prettier                                                   | ملفات المصادر المتأثرة         | أُصلحت يدويًا ثم تحقُّق آلي                         |

### 14.3 تنبيه على `git diff` — أسطر CRLF

`git diff` يعرض عددًا كبيرًا من الأسطر المحذوفة والمضافة في الملفات التي لم
يُغيَّر منطقها. **السبب:** اختلاف نهايات الأسطر (CRLF ↔ LF)، لا تعديل حقيقي.

**قبل أي commit، تحقَّق من التغيير الحقيقي فقط:**

```powershell
git diff --ignore-cr-at-eol --stat
git diff --ignore-cr-at-eol -- <file>
```

هذا يستبعد ضجيج CRLF ويعرض التعديل الفعلي في المنطق.

### 14.4 الملفات المؤكَّدة سليمة (لا ضجيج)

| الملف                                  | الحالة         |
| -------------------------------------- | -------------- |
| `supabase/MIGRATIONS_REFACTOR_PLAN.md` | ثابت — لا CRLF |
| `supabase/SYSTEM_DATA_AUDIT_PLAN.md`   | ثابت — لا CRLF |
| ملفات `supabase/migrations/*.sql`      | ثابتة          |
| ملفات `supabase/seeds/**`              | ثابتة          |

> **الخلاصة:** ملفات قاعدة البيانات والترحيلات لم تتأثّر بضجيج CRLF. الضجيج
> محصور في ملفات `src/**` والملفات الجذرية، وهو أثر تنسيق لا أثر منطقي.

## تحديث 2026-10-13 — التبسيط المعتمد للمطحنة

> المرجع: `docs/milling/00_خطة_التبسيط_المعتمدة.md` (القرارات ق1–ق10) و`02_خطة_الإصلاح_والتنفيذ.md`.

| التغيير           | التفصيل                                                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| استبدال ملف 10    | `10_milling_and_production.sql` → `10_milling_custody.sql`: رأس مستند خدمة خفيف + سجل `custody_ledger` ودوال RPC للمستند الموحد وعمليات الأمانة                                                         |
| حذف كامل          | كل جداول `milling_*` القديمة وكل جداول `production_*` (BOM/أوامر/فاقد) — قاعدة تجريبية، إعادة بناء لا مهاجرة (ق1، ق6، ق8)                                                                               |
| إزالة enums       | `milling_status` و`milling_output_type` من الملف 01                                                                                                                                                     |
| إزالة رابط فواتير | عمود `sales_invoices.milling_job_id` — البديل المعتمد `milling_service_documents.sales_invoice_id`؛ حقل السجل القديم للتاريخ فقط                                                                        |
| تسلسلات مملوكة    | `milling_intake_seq`/`milling_service_seq`/`milling_delivery_seq` في الملف 10؛ حُذفت `milling_job_seq` و`production_order_seq`                                                                          |
| views جديدة       | `custody_balances` · `custody_customer_statement` · `custody_service_money` · `custody_detected_loss` (بديل كل views `milling_*` عدا `milling_margin_report` و`milling_inventory_report` اللذين يبقيان) |
| doc types         | صف `production_order` أُزيل من ترقيم المستندات (seeds 07)                                                                                                                                               |
| التحقق            | `supabase db reset` على قاعدة فارغة ينجح بلا خطأ (R-20)                                                                                                                                                 |
