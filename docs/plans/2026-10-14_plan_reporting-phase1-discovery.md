# Vortex ERP — المرحلة الأولى: تدقيق الجاهزية والتصميم التوثيقي لمحرك التقارير والكشوفات
**مسار الوثيقة المرجعية:** `docs/REPORTING_PHASE_1_DISCOVERY.md`  
**تاريخ الإعداد والتدقيق:** 13 أكتوبر 2026  
**الإصدار:** 1.0.0 (المرحلة الأولى — الاكتشاف والتحليل والتصميم التوثيقي)  
**حالة الوثيقة:** معتمدة للتدقيق الفني وجاهزة لمراجعة المطور وصاحب النظام  

---

## 1. الملخص التنفيذي (Executive Summary)

تم إعداد هذا التقرير التوثيقي المعمق لتأسيس **محرك التقارير والكشوفات الموحد في نظام Vortex ERP**. يرتكز النظام على قاعدة بيانات علائقية متطورة (PostgreSQL / Supabase) تتضمن 81 جدولاً، و127 دالة خادم وRPC، و30 عرضاً (View)، و21 مُشغلاً (Trigger)، و125 سياسة أمان على مستوى الصفوف (RLS)، بالإضافة إلى معمارية واجهة حديثة مبنية على React 18 وTanStack Router وTanStack Query وTailwind CSS.

### أهم النتائج الإيجابية المكتشفة:
1. **وجود بنية تحتية سفلية قوية في قاعدة البيانات:** توجد في ملف الترحيلات المعتمد (`supabase/migrations/12_reporting_views.sql`) حزمة كاملة من 30 عرضاً متخصصاً للتقارير، تشمل سجل المبيعات (`sales_register`)، وسجل المشتريات (`purchase_register`)، وإيرادات الخدمات (`service_revenue`)، ومواقع المخزون وتقييمها (`stock_positions`, `inventory_valuation`, `item_valuation`)، وكشوف كفاءة ومخزون وحسابات المطحنة (`milling_efficiency_report`, `milling_customer_custody`, `milling_output_balances`, `milling_inventory_report` وغيرها).
2. **محرك حركات مخزنية غير قابل للتلاعب (Immutable Movements):** جميع حركات المخزون تمر عبر دالة مركزية وحيدة (`post_stock_delta`) وتسجل في جدول `stock_movements` مع هوية المالك (`COMPANY` مقابل `CUSTOMER`) والمستودع ونوع الحركة، مما يوفر مصدراً موثوقاً لكشوفات حركة المخزون.
3. **محرك كشوفات نقي (Pure Statement Engine):** تم إنجاز محرك حساب نقي ومختبر في `src/lib/statements/engine.ts` يحقق الدقة الحسابية، والفرز الحتمي، والفصل الصارم بين المنطق الحسابي وعرض الواجهة.

### أهم الفجوات والمشكلات المكتشفة (Gaps & Architectural Debt):
1. **انفصال الواجهة الحالية عن عروض التقارير:** شاشات التقارير الحالية في الواجهة (`operational-reports.tsx` و `reports-hub-tab.tsx`) لا تستخدم عروض التقارير الموجودة في SQL (`12_reporting_views.sql`)، بل تنفذ استعلامات مباشرة على الجداول الخام (`sales_invoices`, `stock_movements`) وتجلب مئات السجلات دون ترقيم في قاعدة البيانات (Client-side in-memory filtering & sorting).
2. **مشكلة N+1 RPC في تقرير أرباح ومبيعات الواجهة:** يتبين في ملف `profit-sales-report.tsx` أن الواجهة تستدعي دالة الخادم `sales_line_cost` لكل سطر فاتورة على حدة عبر حلقة `soldLines.map(async (line) => supabase.rpc(...))`، مما يولد مئات استدعاءات الشبكة المتزامنة بدلاً من الاعتماد على عمود التكلفة المدمج في عرض `sales_register`.
3. **غياب جداول أوامر الشراء وسندات صرف الموردين المستقلة:** لا يوجد جدول لأوامر الشراء (`purchase_orders`)، كما أن سداد الموردين مخزن كرقم تراكمي في عمود `purchase_invoices.paid` دون جدول سندات سداد للموردين يوثق تواريخ الدفع المستقلة وطرقها، بعكس العملاء الذين يمتلكون جدول `customer_payments` و `customer_payment_splits`.
4. **تجميع التقارير في شاشة واحدة متضخمة:** يوجد تجميع غير منظم لأكثر من 12 تقريراً مختلفاً داخل ملف واحد متضخم (`reports-hub-tab.tsx` يتجاوز 2600 سطر)، مما يضعف الأداء وتجربة المستخدم، ويؤكد الحاجة المعمارية لفصل الشاشات حسب مجالات العمل (Domain-Driven Reporting Screens).

---

## 2. نطاق المهمة والاستثناءات (Scope & Exclusions)

### أولاً: التقارير المشمولة في نطاق التحليل والتصميم
يشمل هذا التدقيق جرد وتحديد مصادر وحسابات التقارير التشغيلية والتحليلية للمجالات التالية:
- **المبيعات ونقطة البيع (Sales & POS):** المبيعات اليومية، المبيعات خلال فترة، المبيعات حسب المنتج، المبيعات حسب التصنيف، المبيعات حسب العميل، المبيعات حسب الكاشير، المبيعات حسب المستودع، المبيعات حسب طريقة الدفع، المرتجعات، الخصومات، الفواتير الملغاة، متوسط الفاتورة، وحالات التحصيل التشغيلية للفواتير.
- **المشتريات والتوريد (Purchases & Procurement):** المشتريات حسب الفترة، المشتريات حسب المورد، المشتريات حسب المنتج، المشتريات حسب المستودع، مرتجعات المشتريات، تغير أسعار الشراء، والموردين الأكثر توريداً.
- **المخزون والمستودعات (Inventory & Warehousing):** أرصدة المخزون، حركة المخزون، كشف حركة صنف محدد، المخزون حسب المستودع، قيمة المخزون، المنتجات النافذة وتحت حد الطلب، المنتجات بطيئة الحركة والأكثر حركة، التحويلات بين المستودعات، التسويات المخزنية، وأمانات العملاء.
- **العملاء تشغيلياً (Customer Operations):** العملاء النشطون، العملاء الجدد، المبيعات حسب العميل، المنتجات الأكثر طلباً لكل عميل، تكرار الشراء، والعملاء الراكدون.
- **الموردون تشغيلياً (Supplier Operations):** الموردون النشطون، المشتريات حسب المورد، تكرار التوريد، مقارنة أسعار الموردين التاريخية، والموردون الراكدون.
- **الطحن والإنتاج (Milling & Industrial Production):** استلام الحبوب والأمانات، كفاءة الطحن ونسب الاستخلاص والفقد، نواتج الطحن والتسليمات، حركة أمانات العملاء، أوامر الطحن وحالات الربط بالعقود وفحوصات الجودة، وأوامر الإنتاج والتصنيع الداخلي والفاقد.
- **العمليات والتدقيق التشغيلي (Audit & Operations):** سجل التدقيق، العمليات الملغاة، وفجوات التصنيف والمطابقة.

### ثانياً: الاستثناءات المؤجلة للمرحلة المالية والمحاسبية اللاحقة
تم استبعاد التقارير والقوائم المحاسبية المعقدة التالية بصورة صريحة من هذه المرحلة:
- ميزان المراجعة المحاسبي العام (`trial_balance`).
- قائمة الدخل والأرباح والخسائر المحاسبية (`income_statement`).
- الميزانية العمومية والمركز المالي (`balance_sheet`).
- قائمة التدفقات النقدية وقائمة التغير في حقوق الملكية.
- كشوف حسابات دفتر الأستاذ العام (`general_ledger`).
- كشوفات الحسابات المحاسبية وأعمار الديون (Aging) للعملاء والموردين المعتمدة على إقفال القيود.
- التسويات المالية المعقدة والقيود اليومية المركبة.

> **قاعدة فصل المفاهيم:** عرض قيمة مبيعات أو مشتريات تشغيلية في تقرير تجاري لا يجعله تقريراً محاسبياً، طالما أنه لا يخلط بين إجمالي المبيعات، والتحصيل الفعلي، وصافي الربح المحاسبي الناتج عن قيود دفتر الأستاذ.

---

## 3. تدقيق حالة المستودع ومزامنة GitHub

عملاً بقواعد المشروع الصارمة (`AGENTS.md` و `VORTEX_AI_DEVELOPMENT_RULES (1).md`):
1. تم فحص حالة المستودع عبر الأوامر الرسمية دون تغيير التاريخ أو إعادة كتابة git history.
2. **الفرع الحالي:** `إصلاحات-البحث-والتقارير`.
3. **آخر Commit تم فحصه واعتماده:**  
   `10acace6bee69a40c5ad8e13cee9c7f0b3ccc5d8` (`fix: align report printing and statement date display`).
4. **حالة الفرع:** الفرع متقدم عن `origin/main` (الذي يقف عند commit `7dc4194`) بالتزامين محليين نظيفين:
   - `e266909`: `fix: improve search reports and sidebar controls`
   - `10acace`: `fix: align report printing and statement date display`
5. **شجرة العمل:** نظيفة تماماً (`nothing to commit, working tree clean`).
6. **المزامنة:** تم تنفيذ `git fetch origin` بنجاح وتحديث كافة مراجع الفروع البعيدة، وتأكد أن شجرة العمل المحلية تضم أحدث التعديلات التشغيلية ومكونات التقارير والطباعة دون أي تعارضات.

---

## 4. مسارات الملفات التي تمت مراجعتها وفحصها

تم فحص الكود المصدري ومخططات قاعدة البيانات في الملفات التالية:

### أ. ملفات قاعدة البيانات وترحيلات SQL (`supabase/`)
- `supabase/SCHEMA_REFERENCE.md`: المرجع البشري الشامل لبنية قاعدة البيانات.
- `supabase/migrations/README.md`: الدليل المعماري لترحيلات النظام وقوانين الفصل.
- `supabase/migrations/01_core_enums_and_helpers.sql`: الأنواع والـ Enums والدوال المساعدة.
- `supabase/migrations/02_core_identity_and_settings.sql`: المستخدمون، الأدوار، إعدادات الشركة، والمستودعات.
- `supabase/migrations/03_catalog_reference_data.sql`: التصنيفات، الوحدات، والماركات.
- `supabase/migrations/04_partners_customers_suppliers.sql`: العملاء، الموردون، ودفتر العميل.
- `supabase/migrations/05_products_and_inventory.sql`: المنتجات، المخزون، الحركات، التسويات، التحويلات، وطبقات التكلفة.
- `supabase/migrations/06_sales_and_returns.sql`: فواتير المبيعات، البنود، المرتجعات، سندات القبض، ودوال البيع.
- `supabase/migrations/07_purchasing_and_returns.sql`: فواتير المشتريات، البنود، والمرتجعات.
- `supabase/migrations/08_accounting_ledger.sql`: دليل الحسابات، قيود اليومية، والأرصدة الافتتاحية.
- `supabase/migrations/09_expenses.sql`: مستندات المصروفات، البنود، الدفعات، والتصنيفات.
- `supabase/migrations/10_milling_and_production.sql`: استلام الحبوب، أوامر الطحن، النواتج، التسليمات، أوامر الإنتاج والتصنيع، والفاقد.
- `supabase/migrations/11_platform_and_audit.sql`: سجل التدقيق، باقات المنصة، والوحدات.
- `supabase/migrations/12_reporting_views.sql`: عروض التقارير الـ 30 الرسمية المعتمدة.
- `supabase/migrations/13_foreign_keys_and_grants.sql`: المفاتيح الخارجية، الفهارس، وصلاحيات الوصول.
- `supabase/migrations/16_payment_methods.sql`: كتالوج وسائل الدفع والتجزئة.

### ب. ملفات مسارات الواجهة والصفحات (`src/routes/`)
- `src/routes/_app.reports.tsx`: مسار التقارير الحالي (يقوم بإعادة التوجيه إلى `/account-statement?tab=reports`).
- `src/routes/_app.account-statement.tsx`: شاشة مركز الكشوفات والتقارير الموحدة.
- `src/routes/_app.analytics.tsx`: صفحة التحليلات والرسوم البيانية والمؤشرات.
- `src/routes/_app.milling.reports.tsx`: شاشة تقارير كفاءة واستلامات المطحنة.
- `src/routes/_app.sales.tsx`: شاشة قائمة فواتير المبيعات.
- `src/routes/_app.purchases.tsx`: شاشة قائمة فواتير المشتريات.
- `src/routes/_app.inventory.tsx`: شاشة الأرصدة والمخزون.
- `src/routes/_app.transfers.tsx`: شاشة التحويلات المخزنية.
- `src/routes/_app.settlements.tsx`: شاشة تسويات الجرد.
- `src/routes/_app.customers.tsx`: شاشة العملاء وسجلاتهم.
- `src/routes/_app.suppliers.tsx`: شاشة الموردين وسجلاتهم.

### ج. مكونات التقارير والكشوفات والواجهة (`src/components/`)
- `src/components/statements/reports-hub-tab.tsx`: المكون الجامع لتبويب التقارير (12 تقريراً).
- `src/components/statements/operational-reports.tsx`: محرك عرض التقارير التشغيلية الحالية.
- `src/components/statements/profit-sales-report.tsx`: تقرير الأرباح والمبيعات ومصائد أداء N+1 RPC.
- `src/components/statements/purchases-report.tsx`: تقرير المشتريات الحالي.
- `src/components/statements/debts-report.tsx`: تقرير الديون الحالي.
- `src/components/statements/report-shell.tsx`: الهيكل البصري المشترك وبطاقات الملخص.
- `src/components/statements/report-filter-menu.tsx`: قائمة الفلاتر المسبقة والمخصصة.
- `src/components/statements/column-visibility-menu.tsx`: قائمة التحكم بأعمدة التقرير.
- `src/components/statements/report-tools.tsx`: أزرار التصدير والمعاينة وتفاصيل الصف.
- `src/components/luxury-print-preview-modal.tsx`: نافذة معاينة الطباعة الفاخرة للتقارير والمستندات.
- `src/components/ui/records-toolbar.tsx` و `records-panels.tsx`: أشرطة الأدوات واللوحات المتوافقة.

### د. دوال الأعمال والمحركات والمكتبات (`src/lib/`)
- `src/lib/statements/engine.ts`: محرك حساب الكشوفات النقي (Pure Function).
- `src/lib/statements/report-registry.ts`: سجل تعريفات الكشوفات الـ 11 الحالية.
- `src/lib/statements/types.ts`: عقود وأنواع البيانات للكشوفات والأرصدة.
- `src/lib/records/column-registry.ts`: سجل أعمدة الجداول وسلوك الإخفاء والإظهار.
- `src/lib/records/registries.ts`: تعريفات أعمدة المنتجات والمخزون والشركاء.
- `src/lib/excel-export.ts` و `reports-export.ts`: أدوات تصدير CSV وExcel.
- `src/lib/pdf.ts` و `invoice-print.ts`: أدوات توليد ملفات الطباعة وPDF.
- `src/lib/query-keys.ts`: مصانع مفاتيح التخزين المؤقت لـ React Query.
- `src/lib/format.ts`: دوال تنسيق الأرقام والعملات والتواريخ.
- `src/lib/milling/agreements.ts`: استعلامات تقارير كفاءة وتشخيصات المطحنة.

---

## 5. خريطة الجداول والعمليات الحالية حسب المجال

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           VORTEX ERP — DOMAIN MAP                           │
└─────────────────────────────────────────────────────────────────────────────┘
  [المبيعات والنقطة]      [المشتريات والتوريد]       [المخزون والمستودعات]
  - sales_invoices        - purchase_invoices       - inventory (balances)
  - sales_invoice_items   - purchase_invoice_items  - stock_movements (immutable)
  - sales_returns         - purchase_returns        - item_cost_layers (costing)
  - sales_return_items    - purchase_return_items   - stock_transfers / items
  - customer_payments     (لا يوجد supplier_pmts)   - stock_adjustments / items
  - customer_payment_splits                         - stock_openings / items
           │                        │                         │
           └────────────────────────┴─────────────────────────┘
                                    │
                                    ▼
       [محرك حركات المخزون: post_stock_delta] ──► [تحديث الطبقات: apply_cost_movement]
                                    │
    ┌───────────────────────────────┴───────────────────────────────┐
    ▼                                                               ▼
  [الشركاء والعملاء/الموردين]                             [الطحن والإنتاج]
  - customers (balance legacy)                            - milling_intake_receipts
  - customer_ledger (source of truth)                     - milling_service_agreements
  - loyalty_transactions                                  - milling_jobs & outputs
  - suppliers                                             - milling_delivery_notes
                                                          - production_orders & losses
```

### أ. مجال المبيعات ونقطة البيع (Sales & POS)
- **الجداول الأساسية:**
  - `sales_invoices`: رأس الفاتورة. يتضمن `id`, `invoice_number`, `customer_id`, `warehouse_id`, `status` (`draft`, `confirmed`, `cancelled`, `returned`), `payment_status` (`unpaid`, `partial`, `paid`, `overpaid`), `subtotal`, `discount`, `tax`, `total`, `paid`, `payment_method`, `created_at`, `milling_job_id`.
  - `sales_invoice_items`: بنود الفاتورة. يتضمن `id`, `invoice_id`, `product_id`, `quantity`, `unit_price`, `discount`, `tax`, `total`, `line_type` (`STOCKED_GOOD`, `SERVICE`, `AD_HOC_SERVICE`), `stock_effect` (`STOCK_ISSUE`, `NONE`), `uom_id`.
  - `sales_returns` و `sales_return_items`: رأس وبنود المرتجعات كمستندات منفصلة مرتبطة أو غير مرتبطة برقم الفاتورة الأصلية.
  - `customer_payments` و `customer_payment_splits`: سندات التحصيل والدفع المجزأ (نقدي، شبكة، تحويل).
- **العمليات والدوال المؤثرة:**
  - دالة `create_sale` (بثلاث نسخ محملة Overloaded): تقوم بالتحقق من الأصناف، حساب الإجماليات، إقفال المخزون، استدعاء `post_stock_delta` لإخراج البضاعة (`STOCK_ISSUE`)، وتوليد سجل التدقيق وسندات الدفع المجزأ.
  - دالة `create_sales_return`: تسجل مستند الإرجاع وتستدعي `post_stock_delta` لإدخال الكميات المرجعة (`movement_type = return_in`).

### ب. مجال المشتريات والتوريد (Purchasing & Procurement)
- **الجداول الأساسية:**
  - `purchase_invoices`: رأس الفاتورة. يتضمن `id`, `invoice_number`, `supplier_id`, `warehouse_id`, `status` (`draft`, `confirmed`, `cancelled`), `payment_status` (`unpaid`, `partial`, `paid`), `subtotal`, `discount`, `tax`, `total`, `paid`, `payment_method`, `created_at`.
  - `purchase_invoice_items`: بنود الفاتورة. يتضمن `product_id`, `quantity`, `unit_cost`, `discount`, `tax`, `total`, `line_type`, `stock_effect` (`STOCK_RECEIPT`, `NONE`).
  - `purchase_returns` و `purchase_return_items`: مرتجعات المشتريات للموردين.
- **الفجوات التشغيلية الكبرى:**
  - **لا يوجد جدول `supplier_payments`:** سداد الموردين مسجل فقط كرقم مالي في عمود `purchase_invoices.paid`. لا توجد سجلات مستقلة تحدد تواريخ الدفعات، ولا طرق السداد الموزعة، ولا أرقام سندات صرف للموردين.
  - **لا توجد أوامر شراء (`purchase_orders`):** الدورة تبدأ مباشرة من الفاتورة المؤكدة.

### ج. مجال المنتجات والمخزون (Products & Inventory)
- **الجداول الأساسية:**
  - `products`: السجل الرئيسي للأصناف (40+ عموداً). يتضمن SKU، الباركود، الأسعار (`sale_price`, `cost_price`, `standard_cost`)، `item_nature` (`GOOD`, `SERVICE`)، `inventory_policy` (`TRACKED`, `UNTRACKED`, `CUSTOMER_OWNED`)، `costing_method` (`MOVING_AVERAGE`, `STANDARD`, `FIFO`).
  - `inventory`: أرصدة الأصناف لكل مستودع ولكل مالك (`owner_type` إما `COMPANY` أو `CUSTOMER`).
  - `stock_movements`: السجل المحوري غير القابل للتعديل (Append-Only) لكل حركة إدخال وإخراج ونقل وتعديل ورصيد افتتاحي.
  - `item_cost_layers` و `item_cost_transactions`: طبقات وحركات التكلفة لحساب المتوسط المتحرك.
  - `stock_transfers` و `stock_transfer_items`: عمليات التحويل بين المستودعات وحالاتها (`draft`, `sent`, `received`, `cancelled`).
  - `stock_adjustments` و `stock_adjustment_items`: تسويات الجرد المخزني مع الأسباب (`damaged`, `expired`, `inventory_count`, `theft`, `correction`).
- **المحرك المركزي:**
  - دالة `post_stock_delta`: البوابة الحصرية الوحيدة لكتابة وتعديل كميات المخزون وتحديث طبقات التكلفة.

### د. مجال الشركاء: العملاء والموردين
- **الجداول الأساسية:**
  - `customers`: بيانات العميل، الهاتف، سقف الائتمان، وعمود `balance` القديم.
  - `customer_ledger`: **المصدر الحقيقي المطلق (Source of Truth)** لحركات وأرصدة العملاء (مدين/دائن) مع المستند المصدر.
  - `suppliers`: بيانات المورد وأرقام التواصل ورصيده.

### هـ. مجال الطحن والإنتاج
- **الطحن (تشغيل أمانات العملاء):**
  - `milling_intake_receipts`: استلام الحبوب من العميل (أمانة) مع فحص الرطوبة والشوائب والوزن القائم والصافي.
  - `milling_service_agreements`: عقود وأسعار خدمات الطحن (بالكيس أو بالطن) ونسب الاستخلاص المعتمدة.
  - `milling_jobs`: أوامر الطحن، الكمية المدخلة، الفاقد الفعلي، الفاقد المسموح، وفائض الفاقد.
  - `milling_job_outputs`: نواتج الطحن موزعة على أحجام الأكياس والأنواع (دقيق، نخالة، فاقد).
  - `milling_delivery_notes`: أذون تسليم النواتج للعميل من رصيد أمانته.
- **الإنتاج الداخلي (التصنيع للأصناف المملوكة للشركة):**
  - `production_boms` و `production_bom_lines`: قوائم مكونات وتكاليف الإنتاج.
  - `production_orders`: أوامر الإنتاج وحالاتها وتواريخها.
  - `production_order_materials` و `production_order_outputs`: المواد الخام المصروفة والنواتج الجاهزة.
  - `production_order_losses`: الفاقد التشغيلي الداخلي المحمّل على حساب الخسائر.

---

## 6. جرد عروض التقارير (Views) والدوال والفهارس في قاعدة البيانات

### أولاً: العروض الـ 30 المعرفة في `supabase/migrations/12_reporting_views.sql`

| # | اسم العرض في SQL | الغرض ومستوى الصف (Row Grain) | الجداول الأساسية المعتمدة |
|---|---|---|---|
| 1 | `sales_register` | سجل بنود المبيعات الشامل، يتضمن نوع السطر، الأثر المخزني، وتكلفة السطر عبر دالة `sales_line_cost` | `sales_invoice_items`, `sales_invoices`, `products` |
| 2 | `purchase_register` | سجل بنود المشتريات الشامل، مع توضيح الأثر المخزني والتكاليف والضرائب | `purchase_invoice_items`, `purchase_invoices`, `products` |
| 3 | `service_revenue` | إيرادات الخدمات المحضة والأعمال الخدمية العرضية التي لا تؤثر على المخزون | `sales_register` (بفلترة `line_type`) |
| 4 | `stock_positions` | أرصدة المخزون المفصلة حسب الصنف والمستودع والمالك (شركة مقابل أمانات عملاء) مع التكلفة المرجعية | `inventory`, `products`, `warehouses`, `company_items` |
| 5 | `company_stock_positions` | أرصدة الأصناف المملوكة للشركة فقط والخاضعة للتتبع المخزني | `stock_positions` (`owner_type = 'COMPANY'`) |
| 6 | `customer_owned_positions` | كميات البضائع والحبوب الموجودة كأمانة مملوكة للعملاء (خارج أصول المنشأة) | `stock_positions` (`owner_type <> 'COMPANY'`) |
| 7 | `inventory_valuation` | تقييم كميات المخزون المملوك للشركة مع بيان هل التكلفة معيارية أم مرجعية | `company_stock_positions` |
| 8 | `item_valuation` | التكلفة الفعلية للوحدة وقيمة المخزون الإجمالية بناءً على طبقات التكلفة النشطة (`item_cost_layers`) | `inventory`, `item_cost_layers`, `products` |
| 9 | `item_classification_gaps` | كشف الأصناف التي تعاني من نقص في التوصيف أو تناقض في سياسة المخزون ونوع الصنف | `products` |
| 10 | `standard_cost_readiness` | جاهزية الأصناف لتطبيق التكلفة المعيارية وحالة وجود تكلفة في الكتالوج مقابل طبقات التكلفة | `products`, `item_cost_layers` |
| 11 | `customer_ledger_balances` | أرصدة العملاء الحقيقية المحسوبة من حركات `customer_ledger` مقارنة بالعمود القديم `balance` | `customers`, `customer_ledger` |
| 12 | `customer_balance_reconciliation` | كشف العملاء الذين يوجد لديهم فرق بين رصيد الدفتر والعمود المخزن | `customer_ledger_balances` |
| 13 | `milling_customer_custody` | كشف حركة أمانات العميل: المستلم (كجم/أكياس)، المطحون، المنتج، والمسلم فعلياً | `milling_intake_receipts`, `milling_jobs`, `milling_job_outputs` |
| 14 | `milling_output_balances` | أرصدة نواتج الطحن المتبقية في المستودع بانتظار التسليم لكل عميل ولكل حجم كيس | `milling_job_outputs`, `milling_jobs` |
| 15 | `milling_efficiency_report` | كفاءة الطحن لكل أمر: الاستخلاص الفعلي، الفاقد الفعلي، الفاقد الزائد، والفاتورة المرتبطة | `milling_jobs`, `warehouses`, `customers`, `milling_intake_receipts`, `sales_invoices` |
| 16 | `milling_inventory_report` | تقرير مخزون المطحنة (المواد الخام، المنتجات النهائية، النخالة) وتقييمها المالي | `products`, `stock_positions`, `units`, `item_valuation` |
| 17 | `milling_revenue_report` | إيرادات خدمات الطحن المجمعة شهرياً حسب المستودع والعميل ونوع الخدمة | `sales_invoice_items`, `sales_invoices`, `milling_jobs`, `milling_service_agreements` |
| 18 | `milling_margin_report` | هامش ربح مبيعات منتجات المطحنة خلال آخر 365 يوماً بناءً على تكلفة المبيعات الفعلية | `sales_invoice_items`, `sales_invoices`, `products`, `item_cost_layers` |
| 19 | `milling_intake_health` | فحص جودة سندات الاستلام: نسبة الرطوبة، الفارق بين الوزن الاسمي والفعلي، والربط بدرجة الجودة | `milling_intake_receipts`, `customers`, `milling_grain_grades` |
| 20 | `milling_jobs_without_agreement` | أوامر الطحن المكتملة أو الجارية التي تفتقر لعقد تسعير معتمد مع تشخيص السبب | `milling_jobs`, `sales_invoices` |
| 21 | `milling_pricing_diagnostics` | كشف أوامر الطحن التي تحتوي على أخطاء تسعيرية (كالجمع بين التسعير بالكيس والطن معاً) | `milling_jobs`, `sales_invoices` |
| 22 | `milling_agreements_view` | تفاصيل اتفاقيات أجور الطحن المعتمدة وشروط الاستخلاص | `milling_service_agreements`, `customers`, `milling_intake_receipts` |
| 23 | `milling_grain_grades_view` | درجات ومواصفات الحبوب (الرطوبة القصوى، الشوائب، حجم العبوة) | `milling_grain_grades`, `products` |
| 24 | `milling_service_money` | مطابقة المبالغ المفوترة لأجور الطحن مع أوامر التشغيل | `sales_invoices`, `milling_jobs` |
| 25 | `invoice_ledger_status` | فحص ترحيل فواتير المبيعات إلى دفتر الأستاذ العام وتوازن القيد | `sales_invoices`, `journal_entries` |
| 26 | `purchase_ledger_status` | فحص ترحيل فواتير المشتريات إلى قيود اليومية | `purchase_invoices`, `journal_entries` |
| 27 | `production_ledger_status` | فحص ترحيل أوامر الإنتاج وقيد الفاقد المحاسبي في الحساب `5911` | `production_orders`, `journal_entries` |
| 28 | `expense_legacy_reconciliation` | مطابقة سجلات المصروفات القديمة مع جدول `expense_entries` الجديد | `expenses`, `expense_entries`, `expense_lines` |
| 29 | `opening_balance_summary` | ملخص مستندات الأرصدة الافتتاحية مع مؤشر التوازن المحاسبي | `opening_balance_documents`, `opening_balance_lines` |
| 30 | `trial_balance` | ميزان المراجعة من القيود المحاسبية المرحلة فقط (مستبعد ومؤجل للمرحلة المالية) | `accounts`, `journal_lines`, `journal_entries` |

### ثانياً: دوال الخادم والـ RPC ذات الصلة
- `sales_line_cost(product_id, invoice_id, quantity, line_type)`: دالة PostgreSQL لحساب التكلفة الفعلية المنصرفة مع كل سطر بيع.
- `resolve_unit_cost(product_id, warehouse_id)`: استخراج تكلفة الوحدة اللحظية للصنف.
- `sales_invoice_tender_breakdown(invoice_id)`: تفصيل مبالغ وسائل الدفع لكل فاتورة بيع.
- `fetchEfficiencyReport()`, `fetchIntakeHealth()`, `fetchPricingDiagnostics()`: دوال TypeScript تستعلم العروض مباشرة في `src/lib/milling/agreements.ts`.

### ثالثاً: تدقيق الفهارس الحالية والفهارس الناقصة (Indexes Audit)
- **الفهارس المتوفرة حالياً في الترحيلات:**
  - `idx_inventory_product`, `idx_inventory_warehouse`, `idx_inventory_owner` على جدول `inventory`.
  - `idx_stock_movements_kind`, `idx_stock_movements_product`, `idx_stock_movements_warehouse`, `idx_stock_movements_reference` على `stock_movements`.
  - `customer_ledger_customer_date_idx` على `customer_ledger (customer_id, occurred_at, id)`.
  - `idx_sales_invoice_items_product`, `idx_purchase_invoice_items_product`.
  - `customer_payment_splits_occurred_at_idx` على `customer_payment_splits`.
- **الفهارس الغائبة المؤثرة على سرعة التقارير (Missing Reporting Indexes):**
  - **`sales_invoices(created_at DESC)`:** لا يوجد فهرس مستقل على تاريخ الفاتورة؛ مما يفرض مسحاً تسلسلياً (Seq Scan) عند استعلام التقارير حسب الفترة الزمنية.
  - **`sales_invoices(status, created_at)`:** ضروري لتسريع فلترة الفواتير المؤكدة واستبعاد المسودات والملغاة.
  - **`sales_invoices(customer_id, created_at)`:** ضروري لتسريع تقارير مبيعات العميل وتكرار الشراء.
  - **`purchase_invoices(created_at DESC)` و `purchase_invoices(supplier_id)`:** غير مفهرسين للبحث الزمني والتوريدي.
  - **`stock_movements(created_at DESC)`:** حركات المخزون مفهرسة بالصنف والنوع، لكن فلترة الفترة الزمنية تتطلب فهرساً زمنياً مدمجاً `(product_id, created_at DESC)`.

---

## 7. خريطة تدفق البيانات: من الواجهة إلى العمليات وقاعدة البيانات

```
[مستخدم النظام / المتصفح]
        │
        ▼ (TanStack Router & Query)
[شاشة التقرير المتخصصة (Domain Screen)]
        │
        ├── 1. قراءة الفلاتر الموحدة (ReportFilterMenu)
        ├── 2. قراءة تفضيلات الأعمدة (ColumnRegistry / LocalStorage)
        │
        ▼ (RPC / Views Queries مع Pagination)
[Supabase Client / PostgREST]
        │
        ├──► تقارير المبيعات: الاستعلام من View `sales_register` المفلتر بالتواريخ
        ├──► تقارير المخزون: الاستعلام من View `stock_positions` أو دالة الحركة
        ├──► تقارير المطحنة: الاستعلام من `milling_efficiency_report`
        │
        ▼ (PostgreSQL Execution Engine)
[قاعدة البيانات: Tables, Views, RLS, Indexes]
        │
        ├── حساب الإجماليات عبر Server-side Aggregations (COUNT / SUM)
        ├── تطبيق أمان RLS حسب الفرع والدور والمؤسسة
        │
        ▼ (JSON Rows & Aggregates)
[محرك العرض والتصدير الموحد]
        │
        ├── Render Table & Metric Tiles
        ├── طباعة أنيقة (printLuxuryReport / UniversalPrintPreview)
        └── تصدير بيانات نظيفة (exportToCSV / Excel)
```

---

## 8. جدول جرد التقارير المقترحة ومصادرها (Candidate Reports Inventory)

| معرف التقرير (ID) | اسم التقرير | المجال | الهدف التشغيلي | نوع العرض | حالة الجاهزية | مصدر البيانات (SQL/View) | درجة الدليل | أهم الفلاتر | أهم المقاييس |
|---|---|---|---|---|---|---|---|---|---|
| `rep-sales-daily` | تقرير المبيعات اليومية | مبيعات | كشف مبيعات اليوم والورديات وإجمالي النقدية والآجل | ملخص وجدول | جاهز من ناحية المصدر | `sales_invoices`, `customer_payment_splits` | مثبت من الكود | اليوم، المستودع، الكاشير | إجمالي المبيعات، المحصل، المتبقي، عدد الفواتير |
| `rep-sales-period` | المبيعات خلال فترة | مبيعات | تتبع المبيعات والضرائب والخصومات خلال مدى زمني | جدول تفصيلي | جاهز من ناحية المصدر | `sales_invoices`, `sales_register` | مثبت من الكود | من تاريخ، إلى تاريخ، المستودع، الحالة | المبيعات الإجمالية، الخصومات، الصافي، الضريبة |
| `rep-sales-product` | المبيعات حسب المنتج | مبيعات | تحليل الكميات المباعة والإيراد وتكلفة المبيعات لكل صنف | تجميعي تحليلي | جاهز من ناحية المصدر | `sales_register` | مثبت من الكود | الفترة، التصنيف، الصنف، المستودع | الكمية المباعة، إجمالي القيمة، تكلفة المبيعات، هامش المساهمة |
| `rep-sales-category` | المبيعات حسب التصنيف | مبيعات | مقارنة أداء مجموعات المنتجات والأقسام | مجمع ومقارنة | جاهز من ناحية المصدر | `sales_register`, `categories` | مثبت من الكود | الفترة الزمنية، المستودع | إجمالي مبيعات التصنيف، النسبة المئوية من المبيعات |
| `rep-sales-customer` | المبيعات حسب العميل | مبيعات | معرفة حجم مشتريات كل عميل ونمط تعامله التجاري | جدول مجمع | جاهز من ناحية المصدر | `sales_invoices`, `customers` | مثبت من الكود | الفترة، العميل، نوع الفاتورة | إجمالي المبيعات، المسدد نقداً، الآجل، عدد العمليات |
| `rep-sales-cashier` | المبيعات حسب الكاشير | مبيعات | تدقيق أداء نقاط البيع والموظفين ومطابقة الصناديق | تفصيلي ومجمع | جاهز من ناحية المصدر | `sales_invoices`, `profiles` | مثبت من الكود | الفترة، الكاشير، المستودع | مبيعات الكاشير، المقبوض، المرتجع، متوسط الفاتورة |
| `rep-sales-warehouse` | المبيعات حسب المستودع | مبيعات | مقارنة أداء الفروع ومنافذ التوزيع | مقارنة ومجمع | جاهز من ناحية المصدر | `sales_invoices`, `warehouses` | مثبت من الكود | الفترة الزمنية، المستودعات المختارة | إجمالي مبيعات الفرع، عدد الفواتير، متوسط الفاتورة |
| `rep-sales-payment-method` | المبيعات حسب طريقة الدفع | مبيعات | توزيع التحصيلات بين النقد والشبكة والتحويل والآجل | توزيع وملخص | جاهز من ناحية المصدر | `customer_payment_splits`, `sales_invoices` | مثبت من الكود | الفترة، المستودع، وسيلة الدفع | إجمالي النقد، الشبكة، المحافظ، التحويل، الآجل |
| `rep-sales-settlement-status` | الفواتير المسددة وغير المسددة | مبيعات | متابعة التحصيل التشغيلي ومتبقيات فواتير البيع | جدول تفصيلي | جاهز من ناحية المصدر | `sales_invoices` | مثبت من الكود | حالة السداد (غير مسدد، جزئي، مسدد)، العميل | إجمالي الفواتير، المسدد، المتبقي للتحصيل |
| `rep-sales-returns` | تقرير المرتجعات | مبيعات | متابعة المرتجعات وأسبابها وطرق رد الأموال | جدول تفصيلي | جاهز من ناحية المصدر | `sales_returns`, `sales_return_items` | مثبت من الكود | الفترة، المستودع، الصنف، طريقة الرد | إجمالي المرتجعات، الكميات المرجعة، عدد العمليات |
| `rep-sales-discounts` | تقرير الخصومات الممنوحة | مبيعات | تدقيق التخفيضات الممنوحة على الفواتير والبنود | جدول تفصيلي | جاهز من ناحية المصدر | `sales_invoices`, `sales_invoice_items` | مثبت من الكود | الفترة، الكاشير، المستودع | إجمالي الخصم، نسبة الخصم إلى إجمالي المبيعات |
| `rep-sales-top-products` | المنتجات الأكثر والأقل مبيعاً | مبيعات | ترتيب المنتجات حسب سرعة الدوران والإيراد | ترتيب ومقارنة | جاهز من ناحية المصدر | `sales_register` | مثبت من الكود | الفترة، الترتيب (أعلى/أدنى)، التصنيف | الكمية المباعة، الإيراد المحقق، الترتيب |
| `rep-sales-cancelled` | الفواتير الملغاة | مبيعات | تدقيق العمليات الملغاة وأسباب الإلغاء للرقابة | جدول تفصيلي | جاهز من ناحية المصدر | `sales_invoices` (`status = 'cancelled'`) | مثبت من الكود | الفترة، الكاشير، المستودع | عدد الفواتير الملغاة، القيمة المفقودة |
| `rep-sales-averages` | متوسط الفاتورة والكميات | مبيعات | قياس متوسط سلة المشتريات ومعدل إنفاق العميل | مؤشرات وملخص | جاهز من ناحية المصدر | `sales_invoices`, `sales_invoice_items` | مثبت من الكود | الفترة، المستودع | متوسط قيمة الفاتورة (AOV)، متوسط عدد البنود |
| `rep-purchases-period` | المشتريات حسب الفترة | مشتريات | تتبع تكاليف التوريد والكميات المشتراة دورياً | جدول تفصيلي | جاهز من ناحية المصدر | `purchase_invoices`, `purchase_register` | مثبت من الكود | الفترة الزمنية، المستودع، الحالة | إجمالي المشتريات، الضريبة، الخصم، الصافي |
| `rep-purchases-supplier` | المشتريات حسب المورد | مشتريات | معرفة حجم التعامل مع كل مورد وتوزيع التوريد | مجمع | جاهز من ناحية المصدر | `purchase_invoices`, `suppliers` | مثبت من الكود | الفترة، المورد | إجمالي المشتريات، المدفوع، المتبقي للمورد |
| `rep-purchases-product` | المشتريات حسب المنتج | مشتريات | كميات وتكاليف شراء كل صنف خلال مدة | تفصيلي ومجمع | جاهز من ناحية المصدر | `purchase_register` | مثبت من الكود | الفترة، المنتج، التصنيف | الكمية المشتراة، متوسط سعر الشراء، إجمالي التكلفة |
| `rep-purchases-warehouse` | المشتريات حسب المستودع | مشتريات | مراقبة إدخالات الشراء لكل فرع أو مخزن | مجمع ومقارنة | جاهز من ناحية المصدر | `purchase_invoices`, `warehouses` | مثبت من الكود | الفترة، المستودع | إجمالي مشتريات المستودع، عدد الشحنات |
| `rep-purchases-returns` | مرتجعات المشتريات | مشتريات | حصر البضائع المعادة للموردين واسترداد قيمتها | جدول تفصيلي | جاهز من ناحية المصدر | `purchase_returns`, `purchase_return_items` | مثبت من الكود | الفترة، المورد، المستودع | إجمالي المرتجع، الكميات المعادة |
| `rep-purchases-price-changes` | تغير أسعار الشراء | مشتريات | تتبع تطور سعر شراء الصنف مع الوقت والموردين | حركة وتغير | جاهز من ناحية المصدر | `purchase_invoice_items`, `item_cost_transactions` | مثبت من الكود | الصنف، الفترة الزمنية | السعر السابق، السعر الجديد، نسبة التغير |
| `rep-purchases-top-suppliers` | الموردون الأكثر توريداً | مشتريات | ترتيب الموردين حسب حجم المشتريات والاعتمادية | ترتيب ومقارنة | جاهز من ناحية المصدر | `purchase_invoices` | مثبت من الكود | الفترة الزمنية | حجم التوريد، النسبة المئوية من المشتريات |
| `rep-purchases-orders` | أوامر الشراء وحالاتها | مشتريات | متابعة دورة أوامر الشراء قبل الفوترة | غير متاح | غير مدعوم حالياً | لا يوجد جدول `purchase_orders` | مثبت غيابه | — | — |
| `rep-purchases-invoices-status` | فواتير الشراء وحالات السداد | مشتريات | كشف الفواتير المسددة والمستحقة للموردين تشغيلياً | جدول تفصيلي | جاهز جزئياً | `purchase_invoices` | مثبت من الكود | حالة السداد التشغيلية، المورد | إجمالي المشتريات، المسدد، المتبقي (دون تواريخ دفع مستقلة) |
| `rep-inventory-balances` | أرصدة المخزون الحالية | مخزون | كميات المخزون المتوفرة لكل صنف ومستودع | جدول أرصدة | جاهز من ناحية المصدر | `inventory`, `company_stock_positions` | مثبت من الكود | المستودع، التصنيف، الصنف | الكمية المتوفرة، الوحدة، حد الطلب الأدنى |
| `rep-inventory-movements` | حركة المخزون الشاملة | مخزون | سجل الحركات التاريخية للإدخال والإخراج والتحويل | جدول حركات | جاهز من ناحية المصدر | `stock_movements`, `products`, `warehouses` | مثبت من الكود | الفترة، نوع الحركة، المستودع، المرجع | الكمية الداخلة، الكمية الخارجة، نوع المستند |
| `rep-inventory-item-card` | كشف حركة صنف محدد | مخزون | تتبع تسلسلي لرصيد صنف معين بعد كل حركة | كشف حركة ورصيد | جاهز من ناحية المصدر | `stock_movements` (مرتب تصاعدياً) | مثبت من الكود | الصنف، المستودع، الفترة الزمنية | الرصيد الافتتاحي، الحركات، الرصيد اللحظي |
| `rep-inventory-warehouse` | المخزون حسب المستودع | مخزون | حصر كميات الأصناف في مستودع محدد | جدول أرصدة | جاهز من ناحية المصدر | `company_stock_positions` | مثبت من الكود | المستودع، التصنيف | عدد الأصناف، إجمالي الكميات |
| `rep-inventory-valuation` | تقرير قيمة المخزون | مخزون | تقييم رأس المال المستثمر في المخزون | تقييم مالي | جاهز من ناحية المصدر | `inventory_valuation`, `item_valuation` | مثبت من الكود | المستودع، أساس التكلفة (فعلي/مرجعي) | الكمية، تكلفة الوحدة، القيمة الإجمالية، أساس التكلفة |
| `rep-inventory-low-stock` | النواقص وحد إعادة الطلب | مخزون | تنبيه بالأصناف التي وصلت أو نزلت عن حد الأمان | تنبيه وجدول | جاهز من ناحية المصدر | `inventory`, `products` (`quantity <= min_stock`) | مثبت من الكود | المستودع، التصنيف | الكمية الحالية، الحد الأدنى، العجز المطلوب شراؤه |
| `rep-inventory-slow-moving` | المنتجات الراكدة | مخزون | كشف الأصناف التي لم تتحرك منذ فترة لتقليل التلف | تحليلي رقابي | جاهز من ناحية المصدر | `inventory`, `stock_movements` | يحتاج تحقق | مدة الركود (30/60/90 يوماً)، المستودع | كمية الركود، تاريخ آخر حركة، قيمة الركود المرجعية |
| `rep-inventory-transfers` | التحويلات بين المستودعات | مخزون | كشف نقل البضائع بين الفروع والمخازن | تفصيلي ومتابعة | جاهز من ناحية المصدر | `stock_transfers`, `stock_transfer_items` | مثبت من الكود | الفترة، مستودع الإرسال، مستودع الاستلام، الحالة | كميات التحويل، الأصناف، أرقام الشحنات |
| `rep-inventory-adjustments` | التسويات والفروقات المخزنية | مخزون | حصر التسويات الناتجة عن الجرد أو التلف مع السبب | تفصيلي رقابي | جاهز من ناحية المصدر | `stock_adjustments`, `stock_adjustment_items` | مثبت من الكود | الفترة، المستودع، سبب التسوية | كميات العجز/الزيادة، التكلفة، السبب الموثق |
| `rep-inventory-customer-custody`| بضائع وأمانات العملاء | مخزون | متابعة المواد المخزنة على سبيل الأمانة للغير | جدول أرصدة | جاهز من ناحية المصدر | `customer_owned_positions` | مثبت من الكود | العميل، المستودع، الصنف | كمية الأمانة المتوفرة، الصنف، العميل المالك |
| `rep-customers-active` | العملاء النشطون | عملاء | قائمة العملاء الذين أجروا عمليات شراء حديثة | تحليلي تجاري | جاهز من ناحية المصدر | `sales_invoices`, `customers` | مثبت من الكود | الفترة، الحد الأدنى لعدد الفواتير | عدد الفواتير، قيمة المشتريات، تاريخ آخر عملية |
| `rep-customers-new` | العملاء الجدد | عملاء | العملاء الذين انضموا للنظام وأجروا أول عملية | جدول متابعة | جاهز من ناحية المصدر | `customers`, `sales_invoices` | مثبت من الكود | تاريخ التسجيل، المستودع | تاريخ التسجيل، أول فاتورة، إجمالي الإنفاق |
| `rep-customers-top-products` | الأصناف الأكثر طلباً للعميل | عملاء | تحليل تفضيلات كل عميل والأصناف التي يكررها | تحليلي تجاري | جاهز من ناحية المصدر | `sales_register` | مثبت من الكود | العميل، الفترة الزمنية | الصنف، الكمية المشتراة، إجمالي القيمة |
| `rep-customers-inactive` | العملاء الراكدون (المتوقفون) | عملاء | كشف العملاء الذين انقطعوا عن الشراء لفترة | تحليلي تنبيهي | جاهز من ناحية المصدر | `customers` LEFT JOIN `sales_invoices` | مثبت من الكود | فترة الانقطاع (أكثر من X يوم) | آخر تاريخ شراء، عدد أيام الانقطاع، الرصيد القديم |
| `rep-suppliers-active` | الموردون النشطون | موردون | حصر الموردين الذين تم الشراء منهم خلال مدة | مجمع تجاري | جاهز من ناحية المصدر | `purchase_invoices`, `suppliers` | مثبت من الكود | الفترة، المستودع | عدد الفواتير، حجم التوريد، تاريخ آخر فاتورة |
| `rep-suppliers-inactive` | الموردون الراكدون | موردون | كشف الموردين المعتمدين الذين لم نسحب منهم مؤخراً | تحليلي تجاري | جاهز من ناحية المصدر | `suppliers` LEFT JOIN `purchase_invoices` | مثبت من الكود | فترة الركود | تاريخ آخر توريد، قيمة آخر عملية |
| `rep-milling-intake` | استلام الحبوب والأمانات | طحن وإنتاج | سندات استلام القمح والشعير من المزارعين والعملاء | جدول تفصيلي | جاهز من ناحية المصدر | `milling_intake_receipts`, `milling_intake_health` | مثبت من الكود | الفترة، العميل، درجة الجودة، المستودع | الوزن القائم، الوزن الصافي، عدد الأكياس، نسبة الرطوبة |
| `rep-milling-jobs` | عمليات وأوامر الطحن | طحن وإنتاج | متابعة دورة تشغيل المطحنة وأوامر الطحن | جدول تفصيلي | جاهز من ناحية المصدر | `milling_jobs`, `milling_efficiency_report` | مثبت من الكود | الفترة، الحالة (مكتمل، جاري، معلق)، العميل | وزن الحبوب المدخلة، النواتج، الفاقد، الاستخلاص |
| `rep-milling-customer-custody`| كشف حركة أمانة عميل مطحنة | طحن وإنتاج | تتبع ما سلمه العميل وما طحن وما تبقى له | كشف حساب كمي | جاهز من ناحية المصدر | `milling_customer_custody` | مثبت من الكود | العميل، المستودع | المستلم (كجم)، المطحون، المنتج، المسلم، الرصيد الباقي |
| `rep-milling-output-balances` | أرصدة النواتج الجاهزة للتسليم | طحن وإنتاج | كميات الدقيق والنخالة الجاهزة في المطحنة | جدول أرصدة | جاهز من ناحية المصدر | `milling_output_balances` | مثبت من الكود | العميل، نوع الناتج (دقيق/نخالة)، حجم الكيس | الأكياس المنتجة، الأكياس المسلمة، الأكياس المتبقية |
| `rep-milling-efficiency` | كفاءة الطحن ونسب الاستخلاص | طحن وإنتاج | مقارنة الاستخلاص الفعلي بالمعياري وكشف الفاقد الزائد | تحليلي فني | جاهز من ناحية المصدر | `milling_efficiency_report` | مثبت من الكود | الفترة، حالة الفاقد (`EXCEEDS`/`WITHIN`) | نسبة الاستخلاص الفعلية، الفاقد الفعلي (كجم)، الفاقد الزائد |
| `rep-milling-orphan-jobs` | أوامر طحن دون اتفاقية | طحن وإنتاج | تشخيص الأوامر المعلقة التي تفتقر لتسعير معتمد | تشخيص رقابي | جاهز من ناحية المصدر | `milling_jobs_without_agreement` | مثبت من الكود | الحالة، العميل | رقم الأمر، سبب عدم وجود العقد، الأجر المفقود |
| `rep-milling-intake-health` | جودة واكتمال بيانات الاستلام | طحن وإنتاج | كشف تجاوزات الرطوبة وفروقات الأوزان والسندات المعلقة | تدقيق جودة | جاهز من ناحية المصدر | `milling_intake_health` | مثبت من الكود | حالة الرطوبة (`ABOVE_LIMIT`)، الربط بالجودة | فروقات الوزن، نسبة الرطوبة، السندات غير المربوطة |
| `rep-production-internal` | الإنتاج والتصنيع الداخلي | طحن وإنتاج | متابعة أوامر الإنتاج الذاتي واستهلاك المواد الخام | جدول تفصيلي | جاهز من ناحية المصدر | `production_orders`, `production_order_materials` | مثبت من الكود | الفترة، المنتج النهائي، الحالة | الكمية المنتجة، المواد الخام المستهلكة، الفاقد |
| `rep-production-losses` | تقرير الفاقد في التصنيع | طحن وإنتاج | حصر الفواقد التشغيلية في خطوط الإنتاج الذاتية | تفصيلي رقابي | جاهز من ناحية المصدر | `production_order_losses`, `production_orders` | مثبت من الكود | الفترة، أمر الإنتاج | كمية الفاقد، الوحدة، السبب المسجل |
| `rep-audit-log` | سجل العمليات والتدقيق | رقابي وتشغيلي | تتبع من أنشأ أو عدل أو حذف العمليات التشغيلية | جدول تدقيق | جاهز من ناحية المصدر | `audit_logs`, `profiles` | مثبت من الكود | الفترة، المستخدم، نوع الكيان (`sales_invoice`...) | الحدث، المستخدم، التاريخ، تفاصيل الحمولة (Payload) |

---

## 9. مصدر كل رقم وقواعد الحساب (Calculation Rules & Row Grain)

تعد هذه الجزئية المعيار الحاسم لسلامة وموثوقية منظومة التقارير لمنع أي تضارب أو ازدواجية في الحسابات:

### أ. مقاييس المبيعات (Sales Metrics)
1. **إجمالي المبيعات قبل الخصم والضريبة (`Gross Sales / Subtotal`):**
   - **الاسم الظاهر:** إجمالي المبيعات (غير الصافي).
   - **المصدر الأساسي:** `sales_invoices.subtotal` (على مستوى الفاتورة) أو `SUM(sales_invoice_items.quantity * sales_invoice_items.unit_price)` (على مستوى البنود).
   - **مستوى التفاصيل (Row Grain):** صف واحد لكل فاتورة في التقارير الإجمالية، وصف لكل بند في التقارير التفصيلية.
   - **الحالات الداخلة:** `status IN ('confirmed', 'paid', 'partial', 'unpaid')`.
   - **الحالات المستبعدة:** تُستبعد تماماً الفواتير في حالة `draft` وحالة `cancelled`.
   - **المرتجعات:** لا تُخصم من هذا المقياس، بل تعرض في بند مستقل أو تحسب ضمن "صافي المبيعات".

2. **الخصومات الممنوحة (`Discounts`):**
   - **الاسم الظاهر:** الخصم التجاري.
   - **المصدر الأساسي:** `sales_invoices.discount` على مستوى رأس الفاتورة.
   - **تنبيه الحساب المزدوج:** بند الفاتورة يحتوي أيضاً على حقل `discount`؛ لذا عند التجميع على مستوى البنود يجب الانتباه: إذا كان خصم الفاتورة موزعاً على البنود لا يجوز جمع خصم الرأس مع خصم البنود معاً حتى لا يتضاعف الخصم. القاعدة المعتمدة: في تقرير الفواتير يؤخذ خصم رأس الفاتورة، وفي تقرير المنتجات يؤخذ خصم البند فقط.

3. **الضريبة المحتسبة (`Tax Total`):**
   - **الاسم الظاهر:** ضريبة القيمة المضافة.
   - **المصدر:** `sales_invoices.tax` أو `SUM(sales_invoice_items.tax)`.

4. **صافي المبيعات التشغيلية (`Net Sales`):**
   - **الصيغة الدقيقة:**  
     $$\text{Net Sales} = \text{Gross Subtotal} - \text{Invoice Discounts} - \text{Total Sales Returns}$$
   - **تنبيه حاسم:** عمود `sales_invoices.total` في قاعدة البيانات محسوب بالمعادلة:  
     $$\text{total} = \text{subtotal} + \text{tax} - \text{discount}$$  
     وبالتالي، إذا تم جمع `sales_invoices.total`، فإنه **يتضمن الضريبة ومخصوم منه الخصم بالفعل**. لا يجوز خصم الخصم مرة ثانية كما حدث في الكود القديم لـ `profit-sales-report.tsx`.

5. **المقبوض الفعلي (`Paid Amount`):**
   - **الاسم الظاهر:** المقبوض / المحصل.
   - **المصدر:** `sales_invoices.paid` أو `SUM(customer_payment_splits.amount)`.
   - **القاعدة:** المقبوض هو تدفق نقدي/بنكي تشغيلي ولا يمثل الإيراد المستحق.

6. **المتبقي الآجل للتحصيل (`Remaining Balance`):**
   - **الاسم الظاهر:** المتبقي للتحصيل.
   - **الصيغة:** `ROUND(sales_invoices.total - sales_invoices.paid, 2)`.

### ب. مقاييس تكلفة المبيعات وهامش المساهمة (Cost & Margin Metrics)
1. **تكلفة البضاعة المباعة (`Line Cost / COGS`):**
   - **الاسم الظاهر:** تكلفة المبيعات التشغيلية.
   - **المصدر المعتمد:** عمود `line_cost` المحسوب في عرض `sales_register` بواسطة الدالة `sales_line_cost(product_id, invoice_id, quantity, line_type)`.
   - **القاعدة:** تقرأ الدالة تكلفة الإخراج المخزني الفعلية المسجلة في `item_cost_layers`. وفي حال كون السطر خدمة (`SERVICE`) تكون التكلفة صفراً. وإذا تعذر تحديد التكلفة الفعلية يوثق السطر كـ `REFERENCE_ONLY` بناءً على سعر التكلفة بالكتالوج.

2. **هامش المساهمة التشغيلي (`Gross Margin`):**
   - **الصيغة:** `ROUND(sales_register.total - sales_register.line_cost, 2)`.
   - **نسبة الهامش:** `ROUND((Margin / sales_register.total) * 100, 2)`.
   - **قيد الاعتماد:** هذا الهامش هو هامش تشغيلي مبدئي وليس الربح الصافي المحاسبي للمنشأة؛ حيث لم تخصم منه المصروفات التشغيلية والإدارية والعمومية.

### ج. مقاييس المشتريات والتوريد (Procurement Metrics)
1. **إجمالي المشتريات (`Gross Purchases`):**
   - **المصدر:** `purchase_invoices.subtotal` أو `SUM(purchase_invoice_items.total)`.
   - **الحالات الداخلة:** `status = 'confirmed'`. المستبعد: `draft`, `cancelled`.
2. **مرتجعات المشتريات (`Purchase Returns`):**
   - **المصدر:** `SUM(purchase_returns.total)`.
3. **الرصيد المستحق للموردين (`Supplier Outstanding`):**
   - **المصدر:** `ROUND(purchase_invoices.total - purchase_invoices.paid, 2)`.
   - **تنبيه:** هذا رصيد تشغيلي للفواتير فقط، ولا يعبر عن كشف حساب المورد المحاسبي الكامل نظراً لعدم وجود جدول سندات صرف للموردين.

### د. مقاييس المخزون (Inventory Metrics)
1. **الكمية المتوفرة (`On Hand Quantity`):**
   - **المصدر:** `inventory.quantity` حيث `owner_type = 'COMPANY'` للمخزون التجاري، أو `owner_type = 'CUSTOMER'` للأمانات.
2. **الرصيد بعد الحركة في كشف الصنف (`Running Stock Balance`):**
   - **المصدر:** `stock_movements`.
   - **القاعدة الحسابية:** فرز الحركات تصاعدياً حسب `created_at ASC, id ASC`.
   - **الصيغة:**  
     $$\text{Running Balance} = \text{Opening} + \sum (\text{Receipts} + \text{Return In} + \text{Adj In}) - \sum (\text{Issues} + \text{Return Out} + \text{Adj Out})$$
3. **قيمة المخزون (`Inventory Valuation`):**
   - **المصدر:** عرض `inventory_valuation`.
   - **أساس التكلفة:** يوضح التقرير صراحة حقل `valuation_is_reference_based`؛ إذا كان الصنف يتبع التكلفة المعيارية فهو `STANDARD`، وإذا كان يتبع المتوسط المرجح فهو `ACTUAL`، وإذا لم تكن هناك حركات تكلفة مسجلة فهو `REFERENCE_ONLY` (سعر الكتالوج).

### هـ. مقاييس الطحن والإنتاج (Milling Metrics)
1. **كمية الحبوب المستلمة (`Received Intake Kg`):**
   - **المصدر:** `SUM(milling_intake_receipts.net_weight_kg)`.
2. **نسبة الاستخلاص الفعلية (`Actual Extraction Rate %`):**
   - **المصدر:** `milling_efficiency_report.actual_extraction_rate`.
   - **الصيغة:** `ROUND(((input_weight_kg - actual_loss_kg) * 100.0) / input_weight_kg, 2)`.
3. **فائض الفاقد الزائد عن المسموح (`Loss Excess Kg`):**
   - **المصدر:** `milling_jobs.loss_excess_kg`.
   - **القاعدة:** يحسب الفارق بين الفاقد الفعلي والنسبة المسموح بها في اتفاقية العميل (`allowed_loss_percentage`). في حال كانت النتيجة موجبة، تصنف الحالة بـ `EXCEEDS` لتنبيه الإدارة ومطالبة العميل أو تعويضه.

---

## 10. قواعد التاريخ والمرتجعات والإلغاءات والوحدات والتكاليف

### 1. قواعد التواريخ والفترات الزمنية (Timezone & Date Ranges)
- **الحقل الزمني المعتمد:** في فواتير المبيعات والمشتريات يُعتمد حقل `created_at` الموثق بالطابع الزمني الكامل UTC / Local. وفي المصروفات يُعتمد `expense_date`. وفي كشوفات حركة المخزون يُعتمد `created_at` لسجل الحركة.
- **حدود الفترة الزمنية (End-of-day Inclusion):**
  - عند اختيار تاريخ نهاية "إلى تاريخ" `2026-10-31`، يجب أن يمتد شرط الاستعلام حتى نهاية الثانية الأخيرة من اليوم:  
    `created_at <= '2026-10-31T23:59:59.999Z'`  
    تجنباً لخطأ حرمان عمليات اليوم الأخير عند استخدام المقارنة الافتراضية.
- **المنطقة الزمنية:** يتم تخزين التواريخ في قاعدة البيانات بنظام `timestamp with time zone`. يتم تحويل التاريخ في استعلامات العرض والتصدير حسب التوقيت المحلي للمنشأة المحدد في `company_settings`.

### 2. معالجة المستندات الملغاة (Cancelled Documents)
- الفواتير التي تحمل `status = 'cancelled'` تستبعد تلقائياً وإلزامياً من جميع تقارير المبيعات، والإيرادات، وحسابات الديون، والكميات المباعة.
- تُعرض الفواتير الملغاة حصراً داخل تقرير رقابي مخصص: **تقرير الفواتير الملغاة والعمليات المرفوضة (`rep-sales-cancelled`)**.

### 3. معالجة المرتجعات (Returns Handling)
- المرتجعات في النظام مسجلة كمستندات موجبة في جداول مستقلة (`sales_returns`, `purchase_returns`).
- في التقارير المجمعة لا تدمج المرتجعات كفواتير بيع، بل تحسب كبند استقطاع مستقل لإظهار إجمالي المبيعات، وإجمالي المرتجعات، وصافي المبيعات بوضوح وشفافية تامة.
- أثر المرتجع المخزني يظهر كحركة إدخال منفصلة من نوع `return_in` في `stock_movements`.

### 4. معالجة الخصومات والضرائب (Discounts & Taxes)
- الخصم يظهر كبند منفصل في ملخصات التقارير.
- يوضح التقرير دائماً ما إذا كانت المبالغ المعروضة "شاملة الضريبة" أم "قبل الضريبة".

### 5. وحدات القياس (Units of Measure - UoM)
- كل صنف يرتبط بوحدة قياس أساسية (`base_uom_id`).
- في تقارير الطحن: يتم التحويل دائماً إلى الكيلوجرام (`Kg`) كمعيار موحد للوزن، وإلى عدد الأكياس الاسمي (`Bags`) بناءً على معاملات جدول `milling_unit_conversions`.
- لا يجوز جمع كميات أصناف مختلفة بوحدات مختلفة (مثلاً: جمع لترات مع حبات)؛ في التقارير المجمعة المتعددة الأصناف يتم جمع "القيم المالية"، بينما تقتصر إجماليات الكميات على الصنف الواحد أو بعد توحيد وحدة القياس.

---

## 11. أنواع الفلاتر والأعمدة المقترحة الموحدة (Unified Filter & Column Types)

لتفادي تكرار الأكواد، يتم تصميم نظام موحد للفلاتر والأعمدة تستند عليه كافة شاشات التقارير:

### أ. أنواع الفلاتر الموحدة (Filter Types)

```typescript
export type FilterType =
  | "date-range"      // نطاق زمني (من / إلى) مع خيارات سريعة: اليوم، أمس، هذا الشهر...
  | "single-select"   // اختيار مفرد من قائمة (مستودع، طريقة دفع، حالة مستند)
  | "multi-select"    // اختيار متعدد (تصنيفات، مستودعات متعددة)
  | "entity-picker"   // اختيار شريك (عميل، مورد، كاشير) مع بحث فوري
  | "product-picker"  // اختيار صنف مع دعم الباركود والـ SKU
  | "text-search"     // بحث نصي آمن
  | "numeric-range"   // نطاق رقمي (الكمية، القيمة)
  | "boolean-toggle"; // تبديل منطقي (إظهار المسددة، إظهار الصفرية)
```

| نوع الفلتر التقني | الاسم الظاهر | الإلزامية والافتراضي | مصدر الخيارات والتحقق | التحويل الآمن للاستعلام |
|---|---|---|---|---|
| `date-range` | الفترة الزمنية | اختياري (افتراضي آخر 30 يوماً) | حقول إدخال تاريخ قياسية | `.gte('created_at', from).lte('created_at', toEnd)` |
| `warehouse-picker` | المستودع / الفرع | اختياري (الكل افتراضياً) | جدول `warehouses` | `.eq('warehouse_id', val)` عند التحديد |
| `customer-picker` | العميل | اختياري | جدول `customers` | `.eq('customer_id', val)` |
| `supplier-picker` | المورد | اختياري | جدول `suppliers` | `.eq('supplier_id', val)` |
| `payment-method` | طريقة الدفع | اختياري | Enum `payment_method` | `.eq('payment_method', val)` |
| `status-filter` | حالة المستند | اختياري (المعتمد افتراضياً) | Enum `invoice_status` | `.in('status', ['confirmed', 'paid'])` |
| `category-picker` | التصنيف | اختياري | جدول `categories` | فحص شجرة التصنيفات |

> **قاعدة أمان حاسمة:** يمنع منعاً باتاً السماح للواجهة بإرسال استعلامات SQL حرة أو أسماء أعمدة غير موثوقة. جميع معاملات الفلاتر تخضع لمخططات تحقق صارمة عبر Zod قبل تطبيقها على الاستعلام.

### ب. أنواع الأعمدة الموحدة (Column Types)

| نوع العمود | المحاذاة والتنسيق | القابلية للفرز والبحث | دعم الإجماليات (Totals) | المعالجة عند التصدير |
|---|---|---|---|---|
| `text` | يمين (RTL) | فرز أبجدي، بحث نصي | لا يُجمع | نص عادي |
| `code / sku` | يسار (LTR)، خط مونو | فرز وبحث دقيق | لا يُجمع | نص مرمز |
| `money` | يسار (LTR)، فاصل آلاف ومنزلتين | فرز رقمي | **يُجمع (SUM)** | رقم عشري حقيقي |
| `quantity` | يسار (LTR) مع اسم الوحدة | فرز رقمي | يُجمع بشرط تطابق الوحدة | رقم عشري |
| `percentage` | يسار (LTR) مع علامة `%` | فرز رقمي | **متوسط فقط (AVG)** | رقم عشري |
| `date` | يسار / منتصف | فرز زمني | لا يُجمع | صيغة ISO `YYYY-MM-DD` |
| `status-badge` | منتصف، شارة ملونة | فرز حسب الحالة | عدد التكرارات (COUNT) | نص الحالة المترجم |
| `link / action` | منتصف | غير قابل للفرز | لا ينطبق | يُستبعد من التصدير |

---

## 12. نموذج TypeScript التوضيحي لتعريفات التقارير (Report Definition Contract)

يوضح هذا النموذج المعماري كيف سيتم تعريف أي تقرير في النظام مستقبلاً بطريقة معيارية قابلة لإعادة الاستخدام:

```typescript
/**
 * Vortex ERP — عقود تعريف التقارير الموحدة
 * ملف توثيقي تصميمي (Design Schema Only)
 */

export type ReportDomain =
  | "sales"
  | "purchases"
  | "inventory"
  | "customers"
  | "suppliers"
  | "milling"
  | "production"
  | "operations_audit";

export type ReportType = "summary" | "detailed_table" | "ledger_movement" | "matrix_comparison";

export type ReadinessStatus =
  | "READY_AT_SOURCE"     // المصدر مكتمل وموثوق ويحتاج فقط لواجهة واستعلام
  | "PARTIALLY_READY"    // المصدر متوفر ولكن ينقصه بعض الأعمدة أو الشروط
  | "NEEDS_DECISION"      // البيانات متوفرة لكن قاعدة الحساب تحتاج قرار صاحب العمل
  | "NEEDS_DATA_SOURCE"   // المصدر غير متوفر حالياً
  | "EXCLUDED_FINANCIAL"; // مؤجل للمرحلة المالية

export interface ReportColumnDef {
  key: string;
  labelAr: string;
  labelEn: string;
  type: "text" | "code" | "money" | "quantity" | "percentage" | "date" | "status";
  essential?: boolean;
  defaultVisible: boolean;
  align?: "right" | "left" | "center";
  aggregate?: "sum" | "avg" | "count" | "none";
  exportable?: boolean;
}

export interface ReportFilterDef {
  key: string;
  type: "date-range" | "single-select" | "multi-select" | "entity-picker" | "text-search";
  labelAr: string;
  labelEn: string;
  required: boolean;
  defaultValue?: unknown;
  optionsSource?: string; // اسم الجدول أو الـ enum المزود للخيارات
}

export interface ReportMetricSummaryDef {
  key: string;
  labelAr: string;
  labelEn: string;
  format: "money" | "number" | "percentage";
  description?: string;
}

export interface ReportDefinition {
  id: string;                               // معرف فريد: مثل 'rep-sales-period'
  domain: ReportDomain;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  reportType: ReportType;
  readinessStatus: ReadinessStatus;
  
  // البنية السفلية ومصدر البيانات
  dataSource: {
    type: "view" | "table" | "rpc";
    name: string;                           // مثل 'sales_register'
    rowGrainAr: string;                     // ما يمثله الصف الواحد
    defaultSortField: string;
    defaultSortOrder: "asc" | "desc";
    requiredParameters?: string[];
  };

  // الفلاتر والأعمدة والمقاييس
  filters: ReportFilterDef[];
  columns: ReportColumnDef[];
  metrics: ReportMetricSummaryDef[];

  // قدرات العرض والتصدير
  pagination: {
    enabled: boolean;
    defaultPageSize: number;
    supportedPageSizes: number[];
  };
  exportCapabilities: {
    pdf: boolean;
    excel: boolean;
    csv: boolean;
    print: boolean;
  };
  
  // الصلاحيات والوصول
  requiredPermission?: string;
}
```

---

## 13. تصميم شاشات التقارير حسب المجال (Domain-Driven Screens Design)

بدلاً من الشاشة الواحدة المكتظة، يتم توزيع التقارير على شاشات متخصصة مستقلة ترتبط بالقائمة الجانبية:

```
Vortex ERP Main Navigation
 ├── المبيعات ──────────► [شاشة تقارير المبيعات: /reports/sales]
 ├── المشتريات ─────────► [شاشة تقارير المشتريات: /reports/purchases]
 ├── المخزون ───────────► [شاشة تقارير المخزون: /reports/inventory]
 ├── العملاء ───────────► [شاشة تقارير العملاء التشغيلية: /reports/customers]
 ├── الموردون ──────────► [شاشة تقارير الموردين التشغيلية: /reports/suppliers]
 ├── المطحنة والإنتاج ──► [شاشة تقارير الطحن والإنتاج: /reports/milling]
 └── النظام والرقابة ──► [شاشة التدقيق والعمليات: /reports/operations-audit]
```

### هيكل الشاشة النموذجي الموحد (Standard Screen Wireframe Structure):
1. **الترويسة (Header):** عنوان المجال، وصف وظيفي، زر تحديث فوري، وأزرار التصدير (PDF, Excel, Print).
2. **شريط اختيار التقرير (Sub-tabs / Report Selector):** تبويبات أفقية أو قائمة منسدلة أنيقة للاختيار بين تقارير المجال.
3. **شريط الفلاتر الديناميكي (Dynamic Filters Bar):** فلاتر تتغير تلقائياً بحسب التقرير النشط مع زر تفريغ الفلاتر.
4. **شريط بطاقات المؤشرات (Metric Cards Deck):** 3 إلى 5 بطاقات تعرض مجاميع التقرير فورياً (مثل: إجمالي المبيعات، المحصل، المتبقي، عدد الفواتير).
5. **جدول النتائج التفاعلي (Data Table):** يدعم فرز الأعمدة، إخفاء/إظهار الأعمدة، ترقيم الصفحات، وخطوط واضحة.
6. **نافذة تفاصيل السجل (Drawer / Row Details):** إمكانية النقر على أي صف لعرض الفاتورة الأصلية أو مستند الحركة دون مغادرة التقرير.

### تفصيل شاشات المجالات السبعة:

| الشاشة والمسار المقترح | التقارير المتاحة فيها | الفلاتر الخاصة | بطاقات المؤشرات (KPI Tiles) | المكونات الحالية القابلة لإعادة الاستخدام |
|---|---|---|---|---|
| **تقارير المبيعات**  <br>`/reports/sales` | المبيعات اليومية، المبيعات حسب الفترة، حسب المنتج، حسب العميل، حسب الكاشير، حسب طريقة الدفع، المرتجعات، والخصومات | التاريخ، المستودع، الكاشير، العميل، طريقة الدفع، الصنف | إجمالي المبيعات، الخصومات، الصافي، المحصل، المتبقي الآجل | `ReportFilterMenu`, `ColumnVisibilityMenu`, `ReportShell`, `exportToCSV`, `printLuxuryReport` |
| **تقارير المشتريات**  <br>`/reports/purchases` | المشتريات حسب الفترة، حسب المورد، حسب المنتج، حسب المستودع، مرتجعات المشتريات، وتغير أسعار الشراء | التاريخ، المورد، المستودع، الصنف | إجمالي المشتريات، الضريبة، المرتجعات، المستحق للموردين | `PurchasesReport` (إعادة هيكلة), `ReportSummary` |
| **تقارير المخزون**  <br>`/reports/inventory` | أرصدة المخزون، حركة المخزون، كشف حركة صنف، المخزون حسب المستودع، تقييم المخزون، حد إعادة الطلب، والتسويات | المستودع، التصنيف، الصنف، نوع الحركة، سبب التسوية | إجمالي عدد الأصناف، قيمة المخزون، الأصناف تحت حد الطلب | `INVENTORY_COLUMNS`, `records-toolbar`, `Ltr` |
| **تقارير العملاء**  <br>`/reports/customers` | العملاء النشطون، العملاء الجدد، المبيعات حسب العميل، المنتجات الأكثر طلباً، والعملاء الراكدون | الفترة، المستودع، حد الركود (أيام) | عدد العملاء النشطين، إجمالي مشترياتهم، متوسط الشراء | `CUSTOMER_COLUMNS`, `CustomerFormDialog` |
| **تقارير الموردين**  <br>`/reports/suppliers` | الموردون النشطون، المشتريات حسب المورد، تكرار التوريد، والموردون الراكدون | الفترة، المورد | عدد الموردين النشطين، إجمالي التوريد | `SUPPLIERS_COLUMNS`, `SupplierFormDialog` |
| **تقارير المطحنة والإنتاج** <br>`/reports/milling` | كفاءة الطحن والاستخلاص، استلام الحبوب، حركة أمانات العملاء، أرصدة النواتج، تشخيص العقود، والإنتاج الداخلي | الفترة، العميل، درجة الجودة، حالة الفاقد، المستودع | الحبوب المستلمة (كجم)، نسبة الاستخلاص الفعلية، الفاقد الزائد | `MillingTable`, `MillingPanel`, `StatTile`, `QueryErrorGuard` |
| **التدقيق والعمليات** <br>`/reports/operations-audit` | سجل التدقيق، الفواتير الملغاة، فجوات التصنيف، وتعديلات الأسعار | الفترة، المستخدم، نوع الكيان، الحدث | عدد العمليات الملغاة، عدد أخطاء المطابقة | `StatementIntegrityBadge`, `SourceBadge` |

---

## 14. المكونات الحالية القابلة لإعادة الاستخدام

يمتلك المشروع مجموعة متميزة من المكونات التي توفر مئات ساعات العمل:
1. **مكونات هيكل التقرير والبطاقات (`ReportShell` & `ReportSummary`):**
   - موجود في `src/components/statements/report-shell.tsx`.
   - يوفر إطاراً موحداً وشارات أنيقة وبطاقات ملخص متناسقة مع سمة الفخامة (Luxury Theme).
2. **سجل وتفضيلات الأعمدة (`ColumnRegistry`):**
   - موجود في `src/lib/records/column-registry.ts` و `column-visibility-menu.tsx`.
   - يمنع إخفاء الأعمدة الجوهرية (Essential) ويحفظ خيارات المستخدم في `localStorage`.
3. **محرك الطباعة الفاخرة (`LuxuryPrintPreviewModal` & `printLuxuryReport`):**
   - موجود في `src/components/luxury-print-preview-modal.tsx` و `src/lib/statements/print.ts`.
   - يدعم رأس الشركة، الشعار، الألوان العالية التباين، اتجاه RTL، والطباعة الحرارية ومقاس A4.
4. **أدوات تصدير Excel وCSV (`exportToCSV` & `exportReportToExcel`):**
   - موجود في `src/lib/excel-export.ts` و `reports-export.ts`.
   - يدعم ترميز UTF-8 مع BOM لدعم اللغة العربية في Microsoft Excel دون تشوه الحروف.
5. **مكونات المطحنة الفنية (`MillingTable`, `StatTile`, `Pill`, `Mono`):**
   - موجود في `src/components/milling/milling-ui.tsx`.
   - عالية الجودة ومجهزة لعرض مؤشرات الكفاءة ونسب الاستخلاص.
6. **تنسيق القيم والعملات (`money`, `num`, `Ltr`):**
   - موجود في `src/lib/format.ts` و `src/components/ltr-value.tsx`.
   - يضمن ثبات محاذاة الأرقام ورموز العملات دون انعكاس بسبب RTL.

---

## 15. مراجعة الأداء من دون Materialized Views

وفق القيود المعمارية المعتمدة، لن يتم استخدام Materialized Views، وسنعتمد على الكفاءة الهندسية في الاستعلام:

### أ. مواطن الخلل الحالية المكتشفة في الأداء:
1. **جلب البيانات دفعة واحدة إلى المتصفح (In-memory Processing):**
   - في `operational-reports.tsx` يتم استدعاء `.select("*")` لكامل الفواتير في الفترة المحددة، ثم تصفيتها بالـ JavaScript بواسطة `JSON.stringify(row).toLowerCase().includes(query)`. إذا كان لدى المنشأة 10,000 فاتورة، سيؤدي هذا لتجميد المتصفح واستهلاك الذاكرة.
2. **مصيدة N+1 RPC في `profit-sales-report.tsx`:**
   - تنفيذ استدعاء منفصل لـ `supabase.rpc("sales_line_cost")` لكل سطر فاتورة في حلقة تكرارية بالمتصفح، مما يسبب بطئاً شديداً وفشلاً في الاتصال عند زيادة عدد السطور.

### ب. خطة التحسين المعتمدة للمرحلة التنفيذية:
1. **الترحيل إلى عروض قاعدة البيانات (Views Pushdown):**
   - استبدال الاستعلامات المباشرة باستعلام عرض `sales_register` الذي يحتوي مسبقاً على `sales_line_cost` محسوبة داخل PostgreSQL في خطوة واحدة دون أي استدعاءات إضافية.
2. **الترقيم على مستوى الخادم (Server-Side Pagination):**
   - استخدام `.range(page * pageSize, (page + 1) * pageSize - 1)` مع `.select("...", { count: "exact" })` لضمان جلب 25 إلى 50 صفاً فقط في كل طلب.
3. **التجميع في قاعدة البيانات (Server-side Aggregation):**
   - بطاقات الملخص (KPIs) تحسب عبر دوال تجميعية خفيفة في الخادم بدلاً من حسابها عبر تكرار مصفوفات ضخمة في React (`reduce`).
4. **إضافة الفهارس الموجهة (Composite Indexes):**
   - إضافة فهارس مركبة في مرحلة لاحقة على `sales_invoices(created_at DESC, status)` و `purchase_invoices(created_at DESC)` لتأمين زمن استجابة أقل من 100ms.
5. **التصدير على دفعات (Chunked Streaming Export):**
   - للتقارير التي تتجاوز 5,000 سجل، يتم التصدير على دفعات متتالية (Batches) لتفادي استهلاك موارد الخادم.

---

## 16. مصفوفة الجاهزية والنواقص والأولويات (Readiness & Gaps Matrix)

### جدول تصنيف الأولويات:
- `P0`: خلل جوهري يهدد صحة الحسابات أو يسبب استدعاءات N+1 أو يخل بسلامة الأرقام.
- `P1`: فجوة تؤثر على اكتمال التقرير أو غياب فلتر رئيسي أو عدم كفاءة الواجهة.
- `P2`: تحسين ثانوي أو فرز إضافي أو ميزة تجميلية.

| المعرف | اسم التقرير | حالة الجاهزية | الأولوية | الفجوة المكتشفة والأثر | الخطوة التالية المطلوبة قبل التنفيذ |
|---|---|---|---|---|---|
| `rep-sales-period` | المبيعات خلال فترة | جاهز جزئياً | `P0` | الواجهة الحالية تستعلم الجدول الخام دون العرض، وتخلط بين خصم الفاتورة وخصم البند | توجيه الاستعلام إلى عرض `sales_register` وحسم معادلة صافي المبيعات |
| `rep-profit-sales` | الأرباح والمبيعات | يحتاج لقرار | `P0` | كارثة أداء (N+1 RPC) + معادلة خصم غير دقيقة + اعتماد على تكلفة مرجعية في بعض البنود | استبدال الكود بـ `sales_register`، واعتماد شارة توضح هل التكلفة فعلية أم مرجعية |
| `rep-purchases-orders` | أوامر الشراء | غير مدعوم | `P1` | لا يوجد جدول لأوامر الشراء في قاعدة البيانات | استبعاد التقرير من شاشات المرحلة الأولى أو بناء دورة أوامر الشراء مستقبلاً |
| `rep-purchases-payments` | سداد فواتير المشتريات | جاهز جزئياً | `P1` | لا يوجد جدول سندات صرف موردين؛ السداد مخزن كرقم تراكمي بلا تاريخ | حسم عرض السداد كرقم تراكمي على مستوى الفاتورة وتأجيل كشوفات السداد التاريخية |
| `rep-inventory-item-card` | كشف حركة الصنف | جاهز من ناحية المصدر | `P1` | يحتاج لفرز حتمي تصاعدي وحساب الرصيد اللحظي بعد كل حركة (Running Balance) | تطبيق منطق `compareEntries` من `engine.ts` على حركات `stock_movements` |
| `rep-milling-efficiency` | كفاءة الطحن والاستخلاص | جاهز من ناحية المصدر | `P1` | العرض موجود ومكتمل في `milling_efficiency_report` ولكن معزول في شاشة المطحنة | دمجه في شاشة تقارير الطحن الموحدة وربطه بالفلاتر الزمنية |
| `rep-milling-shifts` | الإنتاج حسب الوردية | غير مدعوم | `P2` | لا توجد بيانات للورديات أو خطوط الإنتاج في جداول المطحنة | توثيق عدم الدعم واستبعاد التقرير من الواجهة |
| `rep-all-screens` | شاشات التقارير | يحتاج لقرار | `P1` | التقارير مجمعة في شاشة واحدة متضخمة تتجاوز 2600 سطر | تفكيك الشاشة إلى 7 شاشات متخصصة حسب المجالات |

---

## 17. التقارير المستثناة المؤجلة للمرحلة المالية والمحاسبية

تؤكد هذه الوثيقة استبعاد التقارير التالية تماماً من المرحلة الحالية لتفادي الخلط بين العمليات والقيود المالية المعقدة:
1. **ميزان المراجعة العام (`trial_balance`):** على الرغم من وجود العرض في SQL، إلا أن إطلاقه يتطلب اكتمال شجرة الحسابات وترحيل جميع الفواتير والمصروفات بالكامل.
2. **قائمة الدخل والأرباح والخسائر المحاسبية (`income_statement`):** تتطلب إقفال الفترات المالية وحساب الاستهلاكات والمصروفات المستحقة والمقدمة.
3. **الميزانية العمومية والمركز المالي (`balance_sheet`):** تتطلب توازن الأصول والخصوم وحقوق الملكية بالكامل.
4. **كشف حساب دفتر الأستاذ العام (`general_ledger`):** مرتبط بدورة قيود اليومية (`journal_entries`).
5. **أعمار الديون المحاسبية (Aging Schedule) وكشوف الحسابات المحاسبية للعملاء والموردين:** تترك لتبويب الكشوفات المالية المتخصص في المرحلة اللاحقة.

---

## 18. القرارات المطلوبة من صاحب النظام (Decisions Required)

قبل الشروع في كتابة كود المرحلة التنفيذية، يلزم حسم القرارات التالية مع صاحب النظام والمطور:
1. **قرار احتساب صافي المبيعات والخصم:** هل خصم الفاتورة يعتبر مخصوماً من صافي المبيعات الخاضع للضريبة، أم يطبق بعد احتساب الضريبة؟ (المعتمد في الكود الحالي هو الخصم التجاري قبل الضريبة).
2. **قرار أساس تكلفة المخزون في التقارير:** عند عدم توفر طبقات تكلفة فعلية (`item_cost_layers`) لمنتج معين (مثل المنتجات القديمة قبل تطبيق النظام)، هل يتم الاعتماد على سعر التكلفة بالكتالوج مع وضع شارة تنبيه "تكلفة مرجعية تقريبية"، أم يُستثنى الصنف من حساب الأرباح؟
3. **قرار غياب سندات صرف الموردين:** هل يكتفي تقرير المشتريات بعرض عمود "المسدد والمتبقي" من واقع الفاتورة، مع توضيح أنه لا يمكن استخراج كشف تاريخي بدفعات الموردين في هذه المرحلة؟
4. **قرار فرز حركات المخزون:** هل يتم ترتيب حركات كشف الصنف بالاعتماد على تاريخ `created_at` أم تاريخ المستند؟ (التوصية: `created_at ASC, id ASC` لضمان عدم اختلال الرصيد اللحظي).
5. **قرار اعتماد مسارات الشاشات السبعة:** هل يتم اعتماد فصل شاشات التقارير إلى 7 مسارات مستقلة في القائمة الجانبية (`/reports/sales`, `/reports/purchases`...)، أم الإبقاء على روابط سريعة داخل مركز موحد؟ (التوصية: شاشات مستقلة مع شريط تنقل موحد).
6. **قرار ترحيل استعلامات الواجهة إلى العروض:** الموافقة على إلغاء الاستعلامات المباشرة للجداول في `operational-reports.tsx` وربط الشاشات مباشرة بالعروض المعتمدة في `12_reporting_views.sql`.

---

## 19. ما تم التحقق منه وما تعذر التحقق منه

### أ. ما تم التحقق منه بالدليل القاطع:
- فحص مستودع Git والتأكد من مطابقة الالتزامات والفرع وشجرة العمل.
- فحص بنية الجداول الـ 81 والعروض الـ 30 ودوائر العلاقات من ملفات الترحيلات المعتمدة ومطابقتها لـ `SCHEMA_REFERENCE.md`.
- فحص دالة `sales_line_cost` وعرض `sales_register` وكشف مصيدة أداء N+1 RPC في كود الواجهة الحالي.
- إثبات غياب جداول أوامر الشراء وسندات صرف الموردين والورديات وخطوط الإنتاج.
- فحص محرك الكشوفات النقي `engine.ts` ونجاح اختباراته الوحدوية.

### ب. ما تعذر التحقق منه وأسبابه:
- **أوقات استجابة الاستعلامات الفعلية (Query Execution Plans - EXPLAIN ANALYZE):** نظراً للالتزام الصارم بعدم الاتصال بقاعدة بيانات الإنتاج الحقيقية، وعدم وجود بيانات تشغيلية حية ضخمة في بيئة التطوير، تم توثيق الفهارس الناقصة تحليلياً على أن يتم قياس الأداء الفعلي عبر خطط التنفيذ في مرحلة الاختبار والتنفيذ.

---

## 20. معايير قبول المرحلة الأولى وخارطة طريق الانتقال للتنفيذ

### معايير القبول المكتملة في هذا التقرير:
- [x] تم جلب وتدقيق أحدث نسخة من المستودع وتوثيق الـ commit بدقة.
- [x] تم تحليل وفهرسة جميع الجداول والعروض والعمليات دون المساس بقاعدة البيانات أو بيانات الإنتاج.
- [x] تم إعداد جدول جرد شامل لكافة التقارير المرشحة ومصادرها ومستويات تفاصيلها.
- [x] تم توثيق مصادر كل رقم وقواعد حساب المبيعات والتكاليف والمخزون والمطحنة.
- [x] تم تصميم النماذج الموحدة للفلاتر والأعمدة وعقد TypeScript الموحد.
- [x] تم وضع التصور الهيكلي لـ 7 شاشات تقارير متخصصة حسب مجالات العمل.
- [x] تم استبعاد التقارير المحاسبية والقوائم المالية وترحيلها لمرحلتها المخصصة.
- [x] تم إنشاء هذا الملف التوثيقي المرجعي في `docs/REPORTING_PHASE_1_DISCOVERY.md`.

### شروط إغلاق المرحلة الأولى وبدء المرحلة الثانية (Phase 2 Gates):
1. مراجعة هذه الوثيقة من قبل المطور واعتماد القرارات الستة في البند 18.
2. عدم كتابة أي كود برمجي جديد للتقارير قبل اعتماد هذا المستند كمرجع رسمي للمشروع.
3. صياغة "خطة التنفيذ المرحلية" (Phase 2 Implementation Plan) بحيث تقسم بناء الشاشات والعروض إلى حزم عمل منفصلة وقابلة للاختبار (مبيعات أولاً، مشتريات ثانياً، مخزون ثالثاً، مطحنة رابعاً).
