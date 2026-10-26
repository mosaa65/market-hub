# مرجع بنية قاعدة البيانات — Market Hub ERP

> **آخر تحديث:** 2026-10
> **المصدر:** قاعدة البيانات الحيّة، لا تاريخ الملفات
> **المخطط:** `public`
>
> هذا الملف هو المرجع البشري لبنية النظام. يُقرأ مع `migrations/README.md`
> (الدليل المعماري) و`MIGRATIONS_RULES.md` (القانون الملزم).

---

## ملخص الأرقام

| الكائن | العدد |
|---|---|
| الجداول | **81** |
| الدوال | **127** |
| العروض (Views) | **30** |
| المُشغّلات (Triggers) | **21** |
| سياسات RLS | **125** |
| الأنواع (Enums) | **20** |
| التسلسلات (Sequences) | **13** |
| المفاتيح الأجنبية | **178** |

**التغطية الأمنية:** كل جدول له `ENABLE ROW LEVEL SECURITY` وسياسات صريحة — صفر جدول مكشوف.

---

## أولًا: الجداول حسب المجال

### المجال 1 — الهوية والإعدادات
**الملف:** `02_core_identity_and_settings.sql` — 9 جداول

| الجدول | الغرض |
|---|---|
| `profiles` | ملفات المستخدمين: الاسم، اللغة، الحالة |
| `user_roles` | ربط المستخدم بالدور: owner, manager, accountant, cashier, warehouse |
| `platform_admins` | مسؤولو المنصة (فوق مستوى العميل) |
| `company_settings` | **هوية الشركة:** الاسم، العملة، الرقم الضريبي، الشعار، بادئة الفواتير |
| `company_costing_settings` | طريقة التكلفة العامة للمنشأة |
| `warehouses` | المستودعات والفروع |
| `device_registrations` | أجهزة الكاشير المسجّلة |
| `sync_idempotency_keys` | مفاتيح منع تكرار المزامنة |
| `backup_logs` | سجل النسخ الاحتياطي |

> ⚠️ `company_settings` **لا يُكتب من أي ملف بيانات.** العميل يحرّره من شاشة الإعدادات.

### المجال 2 — الكتالوج والمرجعيات
**الملف:** `03_catalog_reference_data.sql` — 8 جداول

| الجدول | الغرض |
|---|---|
| `categories` | تصنيفات الأصناف (شجرية بـ `parent_id`) |
| `brands` | العلامات التجارية |
| `units` | **وحدات القياس:** قطعة، كيلوجرام، لتر، متر… |
| `countries_of_origin` | بلدان المنشأ |
| `quality_grades` | درجات الجودة |
| `vehicle_makes` / `vehicle_models` | ماركات وطرازات المركبات (لتطابق قطع الغيار) |
| `packaging_types` | أنواع العبوات: شوال، كيس |

### المجال 3 — الشركاء
**الملف:** `04_partners_customers_suppliers.sql` — 4 جداول

| الجدول | الغرض |
|---|---|
| `customers` | العملاء: الاتصال، سقف الائتمان، `balance` المخزَّن |
| `suppliers` | الموردون وأرصدتهم |
| `customer_ledger` | **دفتر العميل الحقيقي:** كل حركة مدين/دائن مع مصدرها |
| `loyalty_transactions` | حركات نقاط الولاء |

> `customers.balance` **عمود مُخزَّن** للتحقق، والمصدر الحقيقي `customer_ledger`.
> الفرق بينهما يكشفه عرض `customer_balance_reconciliation`.

### المجال 4 — المنتجات والمخزون
**الملف:** `05_products_and_inventory.sql` — 16 جدولًا (أكبر ملفات المجالات)

**المنتجات:**

| الجدول | الغرض |
|---|---|
| `products` | **السجل الرئيسي للأصناف.** 40+ عمودًا: SKU، الأسعار، الوحدات، `item_nature`، `inventory_policy`، `costing_method` |
| `product_compatibilities` | توافق الأصناف مع طرازات المركبات |
| `company_items` | تخصيص الصنف للمنشأة |
| `item_policy_review_queue` | طلبات تغيير سياسة الصنف بانتظار الاعتماد |
| `costing_policy_history` | سجل تغييرات سياسة التكلفة |

**المخزون والتكلفة:**

| الجدول | الغرض |
|---|---|
| `inventory` | أرصدة الأصناف لكل مستودع ولكل مالك |
| `stock_movements` | **سجل كل حركة مخزنية** مع مصدرها ونوعها وسببها |
| `item_cost_layers` | طبقات التكلفة (أساس المتوسط المتحرك) |
| `item_cost_transactions` | حركات التكلفة |
| `product_batches` | الدفعات وتواريخ الصلاحية |
| `stock_transfers` / `stock_transfer_items` | التحويل بين المستودعات |
| `stock_openings` / `stock_opening_items` | أرصدة أول المدة المخزنية |
| `stock_adjustments` / `stock_adjustment_items` | تسويات الجرد بسبب موثّق |

> **`stock_movements` هو الجدول المحوري.** كل تغيير في الكمية يمر به عبر دالة
> `post_stock_delta` وحدها — لا كتابة مباشرة.

### المجال 5 — المبيعات والتحصيلات
**الملف:** `06_sales_and_returns.sql` — 7 جداول

| الجدول | الغرض |
|---|---|
| `sales_invoices` | فواتير البيع: الإجماليات، الضريبة، الحالة، طريقة الدفع |
| `sales_invoice_items` | بنود الفاتورة مع `stock_effect` |
| `ad_hoc_service_lines` | بنود خدمة غير مرتبطة بصنف |
| `sales_returns` / `sales_return_items` | مرتجعات المبيعات |
| `customer_payments` | سندات القبض |
| `customer_payment_splits` | تفصيل الدفع المجزأ (نقدي + شبكة) |

### المجال 6 — المشتريات
**الملف:** `07_purchasing_and_returns.sql` — 4 جداول

| الجدول | الغرض |
|---|---|
| `purchase_invoices` | فواتير الشراء |
| `purchase_invoice_items` | بنود الفاتورة مع نوع السطر وأثره المخزني |
| `purchase_returns` / `purchase_return_items` | مرتجعات المشتريات |

> **لا يوجد `supplier_payments`.** سداد المورد مُخزَّن كرقم تراكمي في
> `purchase_invoices.paid` بلا تاريخ سداد مستقل — فجوة موثّقة في تقرير التدقيق.

### المجال 7 — المحاسبة
**الملف:** `08_accounting_ledger.sql` — 5 جداول

| الجدول | الغرض |
|---|---|
| `accounts` | **دليل الحسابات:** الشجرة، النوع، `is_system`، `is_postable` |
| `journal_entries` | **رأس القيد:** التاريخ، البيان، الحالة، المستند المصدر |
| `journal_lines` | **سطور القيد:** مدين أو دائن لحساب واحد |
| `opening_balance_documents` | مستند الأرصدة الافتتاحية |
| `opening_balance_lines` | بنودها بالأقسام الثمانية |

**ضوابط القيد المزدوج المطبَّقة:**

```sql
-- كل سطر إما مدين أو دائن، لا كليهما ولا صفرهما
CONSTRAINT journal_lines_one_side CHECK (
  (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
);

-- لا قيد مُرحَّل بلا توازن
CONSTRAINT journal_posted_has_totals CHECK (
  status <> 'POSTED' OR (total_debit > 0 AND total_debit = total_credit)
);
```

### المجال 8 — المصروفات
**الملف:** `09_expenses.sql` — 9 جداول

| الجدول | الغرض |
|---|---|
| `expense_entries` | مستند المصروف: الحالة، التواريخ الثلاثة، الإجماليات |
| `expense_lines` | البنود: التصنيف، الصافي، الضريبة، الإجمالي |
| `expense_payments` | الدفعات كمستندات مستقلة (تدعم الدفع الجزئي) |
| `expense_approvals` | **سجل الموافقات** — append-only |
| `expense_attachments` | المرفقات |
| `expense_categories` | تصنيفات المصروف |
| `expense_cost_centers` / `expense_projects` | أبعاد التوزيع |
| `expenses` | الجدول القديم (يبقى للتوافق) |

**دورة حياة المصروف:**

```
DRAFT → SUBMITTED → APPROVED → POSTED → PARTIALLY_PAID → PAID → CLOSED
   ↓         ↓          ↓
REJECTED  CANCELLED  REVERSED
```

**ثلاثة تواريخ منفصلة في `expense_entries`:**

| العمود | المعنى |
|---|---|
| `expense_date` | تاريخ الحدوث الفعلي |
| `due_date` | تاريخ الاستحقاق |
| `posting_date` | تاريخ الترحيل المحاسبي |

### المجال 9 — الطحن المبسط (أمانات العملاء)
**الملف:** `10_milling_custody.sql` — رأس مستند خفيف + سجل أمانات وتسلسلات

**الفكرة الحاكمة (docs/milling/00):** سطر واحد لكل حركة، والرصيد مشتق دائماً —
لا رصيد مخزَّن، لا أوامر، لا فاقد مدخل، لا صوامع، لا أوزان عبوات.

| الكائن | الغرض |
|---|---|
| `milling_service_documents` | رأس مستند خدمة الطحن: العميل والمخزن وفاتورة المبيعات وحالة `RECEIVED/PROCESSED/DELIVERED` |
| `custody_ledger` | سجل الأمانات: `INTAKE/MILLING/DELIVERY/ADJUSTMENT` — أكياس وكجم وارد/صادر، مربوط بـ `milling_document_id` |
| `custody_entry_type` (enum) | أنواع الحركة الأربعة |
| `custody_balances` (view) | الرصيد لكل عميل/صنف/مخزن = `sum(bags_in − bags_out)` — مشتق |
| `custody_intake` (RPC) | استلام: حبوب خام (RAW_MATERIAL) → رصيد العميل |
| `custody_milling` (RPC) | طحن: صادر حبوب + وارد نواتج (FINISHED_GOOD/BY_PRODUCT) في معاملة واحدة |
| `custody_delivery` (RPC) | تسليم: يرفض لو الرصيد يصير سالباً |
| `custody_adjustment` (RPC) | تسوية جردي بسبب إلزامي |
| `create_milling_service_document` (RPC) | ينشئ الاستلام وفاتورة المبيعات الرسمية ورأس المستند ذرّياً |
| `milling_document_process` / `milling_document_delivery` | تسجل النواتج والتسليم على المستند ذاته فقط |
| `smart_manufacture` (RPC) | زر التصنيع الذكي: قمح ملكنا يُنقص، نواتج تدخل بتكلفة موزعة حسب أسعار البيع النسبية |
| `consume_internal_supplies` (RPC) | صرف مستهلكات داخلي (NON_STOCK_ITEM/PACKAGING) — تُنقص من مخزن المستهلكات بدقة |
| sequences | `milling_intake_seq` (CI) · `milling_service_seq` (CM/CA/SM) · `milling_delivery_seq` (CD) — مملوكة هنا |

**أُزيل نهائياً من هذا المجال:** `milling_jobs`, `milling_job_outputs`,
`milling_intake_receipts`, `milling_delivery_notes/_items`,
`milling_service_agreements`, `milling_grain_grades`, `milling_unit_conversions`,
وكل جداول `production_*` (BOM/أوامر/مواد/نواتج/فاقد) — التعليل في
`docs/milling/01_التحليل_المعمق_وحذف_التعقيد.md`. الرابط المالي الوحيد
للفواتير الجديدة: `milling_service_documents.sales_invoice_id` مباشرة.
`custody_ledger.service_invoice_id` متروك لقراءة البيانات التاريخية فقط
(عمود `sales_invoices.milling_job_id` أُزيل).

### المجال 10 — المنصة والتدقيق
**الملف:** `11_platform_and_audit.sql` — 5 جداول

| الجدول | الغرض |
|---|---|
| `platform_modules` | **سجل الوحدات:** 14 وحدة يقرأها التطبيق |
| `platform_plans` | باقات الاشتراك |
| `tenant_subscriptions` | اشتراك كل عميل |
| `audit_logs` | **سجل التدقيق العام:** كل حركة إدارية ومالية |
| `platform_audit_logs` | تدقيق مستوى المنصة |

---

## ثانيًا: الدوال — 127 دالة

### دوال التخويل (الملف 02) — تعتمد عليها 125 سياسة

| الدالة | الغرض |
|---|---|
| `is_staff(uuid)` | هل المستخدم موظف نشط؟ |
| `has_role(uuid, app_role)` | هل يملك دورًا بعينه؟ |
| `expense_role_rank(uuid)` | رتبة الدور: مالك 50، مدير 40، محاسب 30 |
| `can_read_finance(uuid)` | صلاحية قراءة المالية |
| `can_read_expense_entry(uuid, uuid)` | صلاحية قراءة مستند مصروف |
| `can_operate_milling(uuid)` / `can_view_milling(uuid)` | صلاحيات الطحن |
| `is_platform_admin(uuid)` / `is_platform_superadmin(uuid)` | مسؤول المنصة — الثانية تقبل `superadmin` فقط، لا `support` |
| `handle_new_user()` | مُشغّل إنشاء الملف عند تسجيل مستخدم |
| `tg_set_updated_at()` | تحديث `updated_at` تلقائيًا |

### دوال المخزون والتكلفة (الملف 05)

| الدالة | الغرض |
|---|---|
| `post_stock_delta(...)` | **المحرك الوحيد** الذي يكتب `inventory` و`stock_movements` |
| `apply_cost_movement(...)` | تسجيل حركة التكلفة في الطبقات |
| `resolve_unit_cost(product, warehouse)` | تكلفة الوحدة الحالية (متوسط أو معياري) |
| `item_effective_policy(product)` | سياسة المخزون الفعلية للصنف |
| `item_line_type(...)` / `item_stock_effect(...)` | تصنيف السطر وأثره المخزني |
| `product_delete_guard(uuid)` | منع حذف صنف له حركات |
| `product_reference_counts(uuid)` | **يحسب ارتباطات الصنف** — يقرأ `stock_movements` |
| `search_products(...)` | بحث فوري من الخادم |
| `set_standard_costs(...)` | ضبط التكاليف المعيارية |
| `save_item_policy(...)` / `approve_item_policy_change(...)` | دورة تغيير السياسة |

### دوال المبيعات (الملف 06)

| الدالة | الغرض |
|---|---|
| `create_sale(...)` | إنشاء فاتورة بيع (لها **ثلاث نسخ** بمعاملات مختلفة) |
| `create_sales_return(...)` | مرتجع مبيعات |
| `record_customer_payment(...)` | تسجيل تحصيل |
| `resolve_sale_line(...)` / `sales_line_cost(...)` | تصنيف البند وحساب تكلفته |
| `sales_invoice_tender_breakdown(uuid)` | تفصيل وسائل الدفع للفاتورة |

### دوال المحاسبة (الملف 08)

| الدالة | الغرض |
|---|---|
| `create_journal_entry(...)` | **محرك القيد المزدوج** — يرفض أي قيد غير متوازن |
| `reverse_journal_entry(uuid, text)` | **العكس بدل الحذف** — يفرض سببًا |
| `create_opening_balance(...)` | إنشاء مسودة الرصيد الافتتاحي |
| `post_opening_balance(uuid)` | ترحيله (يرفض إن لم يتوازن) |
| `post_sales_invoice(uuid)` | ترحيل فاتورة بيع إلى دفتر الأستاذ |
| `post_purchase_invoice(uuid)` | ترحيل فاتورة شراء |
| `next_journal_number(date)` | توليد رقم القيد |

### دوال المصروفات (الملف 09) — 33 دالة

دورة كاملة: `create_expense` · `update_expense` · `submit_expense` ·
`decide_expense` · `post_expense` · `cancel_expense` · `reverse_expense` ·
`record_expense_payment` · `reverse_expense_payment`
قراءة: `list_expenses` · `expense_detail` · `expense_summary` · `expense_report` ·
`expense_lookups`
حساب: `expense_round` · `expense_line_net` · `expense_line_tax` · `expense_settlement_status`
صلاحيات: `expense_can` · `expense_role_rank` · `expense_assert_capability`

### دوال الطحن والإنتاج (الملف 10) — 24 دالة

`custody_intake` · `custody_milling` · `custody_delivery` · `custody_adjustment` ·
`custody_link_invoice` · `smart_manufacture` · `consume_internal_supplies`

---

## ثالثًا: العروض — 30 عرضًا

### العروض المحاسبية

| العرض | ما يحسبه |
|---|---|
| `trial_balance` | أرصدة كل حساب من القيود المُرحَّلة فقط |
| `opening_balance_summary` | ملخص الأرصدة الافتتاحية مع `is_balanced` |

### عروض المخزون

| العرض | ما يحسبه |
|---|---|
| `stock_positions` | **العرض الأم** — الأرصدة حسب المالك والمستودع |
| `company_stock_positions` | المخزون المملوك للشركة فقط |
| `customer_owned_positions` | الأمانات (لا تُحتسب في الأصول) |
| `inventory_valuation` | قيمة المخزون المملوك للشركة |

### عروض المطابقة — تكشف الأخطاء

| العرض | يكشف |
|---|---|
| `customer_balance_reconciliation` | فرق بين الدفتر والعمود المخزَّن |
| `invoice_ledger_status` | فواتير لم تُرحَّل للأستاذ |
| `purchase_ledger_status` | مشتريات لم تُرحَّل |
| `expense_legacy_reconciliation` | فروق المصروفات القديمة |
| `item_classification_gaps` | أصناف بلا تصنيف نوع |
| `standard_cost_readiness` | أصناف بلا تكلفة معيارية |

### عروض الطحن — 12 عرضًا

`custody_balances` · `custody_customer_statement` · `custody_service_money` ·
`custody_detected_loss` · `milling_margin_report` · `milling_inventory_report`

---

## رابعًا: المُشغّلات — 21 مُشغّلًا

### تحديث وقت التعديل — 11 مُشغّلًا

على: `profiles` · `customers` · `suppliers` · `products` · `purchase_invoices` ·
`sales_invoices` · `warehouses` · `company_items` · `expenses` ·
`customer_payments` · `product_batches`
والخمسة `tg_expense_*_updated` على جداول المصروفات.

### حماية سلامة البيانات — 7 مُشغّلات (الأهم)

| المُشغّل | يمنع |
|---|---|
| `products_guard_policy_change` | تغيير سياسة المخزون لأصناف لها حركات |
| `tg_sync_item_class` | تعارض `item_nature` مع `item_class` |
| `tg_expense_entries_guard` | تعديل مستند مصروف مُرحَّل |
| `tg_expense_lines_sync_total` | اختلاف مجموع البنود عن إجمالي المستند |
| `tg_expense_payments_sync_entry` | عدم تحديث حالة السداد عند دفعة |

---

## خامسًا: الأنواع (Enums) — 20 نوعًا

مجموعة في الملف `01_core_enums_and_helpers.sql`. أهمها:

| النوع | القيم |
|---|---|
| `account_type` | ASSET · LIABILITY · EQUITY · REVENUE · EXPENSE |
| `app_role` | owner · manager · accountant · cashier · warehouse |
| `invoice_status` | draft · confirmed · paid · partial · unpaid · cancelled · returned |
| `payment_method` | cash · card · bank_transfer · mobile_money · credit · split |
| `movement_type` | receipt · issue · adjustment · return_in · return_out · transfer |
| `stock_movement_kind` | RECEIPT · ISSUE · ADJUSTMENT · OPENING |
| `item_nature` | GOOD · SERVICE |
| `inventory_policy` | TRACKED · UNTRACKED |
| `costing_method` | MOVING_AVERAGE · STANDARD · FIFO |
| `expense_status` | DRAFT · SUBMITTED · APPROVED · REJECTED · POSTED · PARTIALLY_PAID · PAID · CLOSED · CANCELLED · REVERSED |
| `owner_type` | COMPANY · CUSTOMER |

---

## سادسًا: التسلسلات — 13 تسلسلًا

| التسلسل | يُستخدم في |
|---|---|
| `sales_invoice_seq` | أرقام فواتير البيع |
| `sales_return_seq` | أرقام مرتجعات البيع |
| `purchase_invoice_seq` | أرقام فواتير الشراء |
| `purchase_return_seq` | أرقام مرتجعات الشراء |
| `stock_opening_seq` | أرقام أرصدة أول المدة |
| `stock_transfer_seq` | أرقام التحويلات |
| `stock_adjustment_seq` | أرقام التسويات |
| `opening_balance_seq` | أرقام المستندات الافتتاحية |
| `expense_reference_seq` | المراجع `EXP-YYYYMM-00001` |
| `milling_intake_seq` · `milling_service_seq` · `milling_delivery_seq` | مستندات الأمانات (CI/CM/CD/CA/SM) |

---

## سابعًا: الفجوات المحاسبية المعروفة

هذه فجوات **مُثبتة بفحص الكود**، وموثّقة بتفصيلها في
`ACCOUNTING_GAPS_AUDIT_REPORT.md`. تُذكر هنا لأن من يعدّل الجداول المحاسبية
يجب أن يعرفها.

| الفجوة | الأثر |
|---|---|
| القوائم المالية (ميزان المراجعة، الدخل، الميزانية) تُحسب في المتصفح من جداول تشغيلية، **لا من `journal_lines`** | التقارير ليست انعكاسًا لدفتر الأستاذ |
| حقوق الملكية في الميزانية = الأصول − الخصوم | الميزانية متوازنة دائمًا بالتعريف، فلا تكشف خطأ |
| المصروفات والمرتجعات وتسويات المخزون **لا تُنتج قيودًا** | أحداث مالية غائبة عن دفتر الأستاذ |
| الأرصدة الافتتاحية: `CASH`/`BANK`/`ASSET`/`LIABILITY`/`CAPITAL` تُسجَّل ولا تُرحَّل | رأس المال المدفوع غير مرئي في القوائم |
| **لا إقفال سنوي** | لا نقل للأرباح إلى `3911`، ولا فتح سنة جديدة بأرصدة |
| لا أصول ثابتة ولا إهلاك | حساب `1491` موجود بلا محرك |
| `supplier_payments` غير موجود | تاريخ سداد المورد غير معروف — أعمار الديون غير دقيقة |
| لا فترة محاسبية مقفلة | يمكن الترحيل بأي تاريخ |

---

## ثامنًا: المراجع

| الملف | الدور |
|---|---|
| `migrations/README.md` | الدليل المعماري وشرح العروض والمُشغّلات |
| `MIGRATIONS_RULES.md` | قانون الترحيلات (ملزم) |
| `MIGRATIONS_REFACTOR_PLAN.md` | خطة إعادة البناء ونتائج التحقق |
| `SEEDS_AND_REFERENCE_REFACTOR_PLAN.md` | خطة تنظيم البيانات |
| `seeds/README.md` | دليل البيانات |
| `../ACCOUNTING_GAPS_AUDIT_REPORT.md` | تقرير التدقيق المحاسبي الكامل |
