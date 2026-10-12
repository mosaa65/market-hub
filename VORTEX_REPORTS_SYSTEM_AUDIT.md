# تدقيق منظومة التقارير في VORTEX ERP

> تاريخ التدقيق: 2026-10-12 · المصدر المفحوص: `origin/main` عند `7dc41949` · فرع العمل: `audit/reports-system-2026-10-12`.
>
> تصنيف العبارات: **مؤكد** = مثبت من الكود/الـ SQL؛ **استنتاج** = نتيجة مباشرة من ذلك؛ **اقتراح** = عمل مستقبلي فقط. لم تُعدّل أي بنية تطبيق أو قاعدة بيانات في هذا التدقيق.

## 1. الملخص التنفيذي

المنظومة ليست طبقة تقارير واحدة متجانسة. توجد ثلاثة مستويات متوازية: (1) لوحات Dashboard/Analytics تحسب مؤشرات في المتصفح، (2) مركز التقارير المستخدم فعلياً `ReportsHubTab`، و(3) طبقة كشوف حسابات جيدة الفصل نسبياً (`statements`) ذات محرك نقي واختبارات. كما توجد طبقة تقارير بديلة أحدث (`OperationalReports` و`ProfitSalesReport` وغيرها) **غير موصولة بأي Route**؛ لذا ليست جزءاً من تجربة المستخدم الحالية.

**أهم النتائج المؤكدة:**

| المستوى | النتيجة |
|---|---|
| حرج | مركز التقارير ولوحتا Dashboard/Analytics وقائمة الدخل يجلبون فواتير البيع بلا استبعاد صريح للمسودة أو الملغاة؛ بينما Views SQL المرجعية تستبعدها. لذلك قد تتضخم المبيعات والكمية والربح وطرق الدفع. |
| حرج | تقرير الربح المستخدم فعلياً يطلب `sales_invoice_items.cost_price` في `ReportsHubTab:156`، لكن العمود غير موجود في تعريف جدول migration ولا في `src/integrations/supabase/types.ts:841-870`. خطأ PostgREST لا يُرفع في `loadData`، فتتحول تكلفة البنود إلى صفر في الحساب المحلي. |
| مرتفع | قائمة الدخل لا تخصم مرتجعات البيع ولا تفلتر الحالة (`_app.income-statement.tsx:61-123`)؛ أما «كشف الأرباح والمبيعات الأساسي» الفعلي فلا يخصم المصروفات أو المرتجعات ويعتمد تكلفة الصنف غير الموجودة. |
| مرتفع | الميزانية وميزان المراجعة ودفتر اليومية تقارير مشتقة من جداول تشغيلية وبحدود 2,000/3,000 صف، لا من `journal_entries`/`journal_lines` أو View `trial_balance` الموجودة. تسمية «متوازن بالكامل» لا تعد دليلاً على توازن دفتر الأستاذ. |
| مرتفع | المركز المستخدم يطبع بـ `window.print()` للصفحة الحالية (`reports-hub-tab.tsx:1215-1223`)؛ لا يبني مستند تقرير معزولاً ولا يضمن تطابق أعمدة/مجاميع الشاشة وPDF. «Excel» هو CSV UTF-8 وليس XLSX. |
| إيجابي | محرك كشف العميل/المورد/الخزينة يملك معادلات مركزية، ترتيباً حتمياً، كشف فرق مع الرصيد المخزن، و81 اختبار وحدة ناجحاً. طبقة الطباعة الموحدة تدعم A4/A5 و80/58mm وتملك اختبارات جيدة، لكنها غير مستخدمة في معظم تقارير المركز الحالي. |

لا يمكن تأكيد الأرقام الحية أو مخطط التنفيذ الفعلي للـ migrations أو خطط PostgreSQL أو فعالية RLS على قاعدة منشورة: لا توجد قاعدة بيانات حية ضمن نطاق التدقيق ولم تُشغّل اختبارات SQL.

## 2. النطاق والمنهجية وحدود التحقق

1. تم جلب `origin/main` وتبين أن HEAD والفرع المطلوب يطابقان `7dc41949`، ثم تم الفحص على الفرع المستقل المذكور أعلاه.
2. بحثت في `src/` و`supabase/migrations/` و`supabase/tests/` و`docs/`، وتتبعت Route → state/hook → Supabase/RPC → View/table حيث أمكن.
3. قُرئت الوثائق المتعلقة بالكشوف والطباعة والخطط؛ الوثيقة ليست دليلاً على التشغيل ما لم يطابقها الكود.
4. الملف `VORTEX_AI_DEVELOPMENT_RULES.md` مطلوب في الطلب لكنه **غير موجود** في شجرة المستودع بعد بحث Recursive؛ التزم هذا التدقيق بتعليمات `AGENTS.md` المتاحة.
5. لم تُكشف محتويات `.env` ولم تُجرَ أي كتابة أو migration أو اتصال ببيانات حقيقية.

التحقق المنفذ محلياً: `npm run build` نجح (مع تحذيرات حجم chunks وglob PWA)، ونجحت أوامر الاختبار المدرجة في القسم 11. لا يعني ذلك أن استعلامات Supabase أو PDF في متصفح حقيقي أو RLS قد نجحت.

## 3. البنية الحالية لمنظومة التقارير

```text
Routes / صفحات
 ├─ Dashboard, Analytics, Income/Balance/Trial/Journal
 │    └─ React Query أو useEffect → Supabase tables/RPC → reduce/map داخل المتصفح
 ├─ /reports → redirect إلى /account-statement?tab=reports
 │    └─ ReportsHubTab (المسار الفعلي) → جداول Supabase → state محلي → CSV/window.print
 ├─ /account-statement?tab=statements
 │    └─ useStatement → adapters → customer_ledger أو مستندات مشتقة
 │         → buildStatement (pure) → HTML print/CSV
 └─ /milling/reports
      └─ React Query → milling_* reporting views → CSV محلي

PostgreSQL/Supabase
 ├─ جداول تشغيلية: sales_*, purchase_*, expenses/expense_*, inventory/stock_*, customers/suppliers
 ├─ دفتر: customer_ledger، journal_entries، journal_lines
 ├─ RPC: sales_line_cost، expense_summary، عمليات البيع/المرتجع…
 └─ Views: sales_register، purchase_register، inventory_valuation، trial_balance، وتقارير المطحنة
```

**مؤكد:** يوجد React 19 وTanStack Router/React Query وSupabase JS وTailwind/Radix وRecharts وjsPDF في `package.json`. لا يوجد backend تقارير منفصل ولا Materialized View ولا مهمة refresh ظاهرة في migrations الحالية. `12_reporting_views.sql` يعرّف Views مفيدة، لكن أغلب UI العام لا يقرأها؛ الاستثناءات المهمة inventory valuation وViews المطحنة.

## 4. جرد الشاشات والمكونات المشتركة

### 4.1 الشاشات والمسارات الفعلية

| الشاشة/الوظيفة | الملف (أسطر دالة) | الحالة | ملاحظات الاستخدام |
|---|---|---|---|
| إعادة توجيه التقارير | `src/routes/_app.reports.tsx:4-10` | منفذ | يوجّه إلى مركز الكشوف ولا يعرض تقريراً مستقلاً. |
| مركز الكشوف والتقارير | `src/routes/_app.account-statement.tsx:104-112, 564-571` | منفذ جزئياً | تبويب الكشوف يستخدم المحرك؛ تبويب التقارير يستدعي `ReportsHubTab`. |
| مركز الـ12 تقريراً | `src/components/statements/reports-hub-tab.tsx:54-66,137-364` | منفذ جزئياً | مصدر واجهة التقارير العامة الفعلي؛ تحميل/فرز/بحث وCSV، وطباعة الصفحة. |
| لوحة التحكم | `src/routes/_app.dashboard.tsx:223-335` | منفذ جزئياً | cache 3 دقائق، limits ثابتة وتجميع متصفح. |
| التحليلات المتقدمة | `src/routes/_app.analytics.tsx:116-389` | منفذ جزئياً | رسوم Recharts، cache دقيقة، وتجميع محلي. |
| قائمة الدخل | `src/routes/_app.income-statement.tsx:56-135` | منفذ جزئياً | PDF/CSV موجودان؛ المعادلات تحتاج تصحيحاً. |
| الميزانية العمومية | `src/routes/_app.balance-sheet.tsx:41-105` | منفذ جزئياً | لقطة حالية مشتقة، لا تاريخ/فروع. |
| ميزان المراجعة | `src/routes/_app.trial-balance.tsx:44-161` | منفذ جزئياً | يصنع حسابات اصطناعية من aggregates، رغم وجود `trial_balance` View. |
| دفتر اليومية | `src/routes/_app.daily-journal.tsx:53-155` | منفذ جزئياً | يصنع قيود عرض من بيع/شراء/مصروف، لا يقرأ الدفتر. |
| تقارير المطحنة | `src/routes/_app.milling.reports.tsx:46-144` | منفذ | views مخصصة، مؤشرات/جداول وCSV فقط. |
| كشف أمانات المطحنة | `src/routes/_app.milling.customer-statement.tsx` | منفذ؛ خارج الحسابات العامة | كشف عيني ومالي منفصلان بحسب واجهته. |
| مكونات التقارير البديلة | `operational-reports.tsx`, `profit-sales-report.tsx`, `purchases-report.tsx`, `debts-report.tsx` | موجودة غير مستخدمة | بحث الاستعمال لم يجد سوى `<ReportsHubTab>` في route؛ لا Route أو import يركب هذه المكونات. |

### 4.2 مكونات مشتركة وحالة تجربة المستخدم

| المكوّن | المسار | الاستعمال/الحالة |
|---|---|---|
| `PageHeader` | `src/components/page-header.tsx` | مستخدم على نطاق واسع لعناوين الصفحات، وليس قالب تقرير موحداً. |
| `VortexMetricCard` | `src/components/vortex-ui/finance/vortex-metric-card.tsx` | مستخدم في Dashboard/Analytics؛ بطاقات مؤشرات موحّدة بصرياً. |
| `DataTable` | `src/components/ui/data-table.tsx` | مستخدم في المخزون وشاشات تشغيلية؛ ليس هو جدول مركز التقارير، الذي يستخدم `Table` مباشر. |
| `ReportFilterMenu`/`ReportShell`/`ReportOutputButtons` | `src/components/statements/` | تصميم واعد للفلتر/الأعمدة/التصدير، لكنه مرتبط بالمكونات غير المستخدمة. |
| `ColumnVisibilityMenu` | `src/components/statements/column-visibility-menu.tsx` | يعمل للكشوف/المسار البديل؛ التفضيلات LocalStorage. |
| `Table`, `Button`, `Select`, `Input` | `src/components/ui/` | Radix/shadcn-style primitives؛ التصميم موحد جزئياً فقط. |
| `ResponsiveContainer`/Recharts | Analytics/Dashboard | رسوم موجودة، ولا توجد طبقة بيانات/filters مشتركة معها. |

**الفلاتر والتزامن:**

- `ReportsHubTab` يملك نطاقاً زمنياً مشتركاً لكل التقرير المختار، presets، بحثاً وفرزاً محليين (`:368-381`, `:385+`). لا توجد pagination، ولا فلتر شركة/فرع/مستودع/حالة موحد. النطاق يزامن بيانات الجدول وCSV غالباً لأنه يبنيهما من نفس arrays؛ لا يزامن مع Dashboard أو Analytics.
- الكشوف تستخدم `useStatement` وفلاتر فترة/صفوف صفرية/أعمدة (`_app.account-statement.tsx:171-202,253-261`)؛ نتيجة المحرك هي مصدر البطاقات والجدول وHTML/CSV، وهي أفضل حالة تطابق.
- التحليلات تستخدم اختيار 7/14/30/90 يوماً فقط. ليس لها تصدير، ولا فلاتر حالة أو فرع، والرسوم/البطاقات تتشارك الـmemo نفسه.
- توجد حالات loading وempty في مركز التقارير (`reports-hub-tab.tsx:964-1004`) وحالة error في Analytics (`_app.analytics.tsx:423-435`). لكن `ReportsHubTab.loadData` يطبع الخطأ في console فقط (`:355-358`) ولا يعرض error، فيمكن أن يظهر empty كأنه لا بيانات.
- الجداول الواسعة تستخدم overflow أفقي في بعض الصفحات؛ مركز التقارير يستخدم `Table` واسعاً بلا pagination. لا يوجد فحص بصري/جهاز صغير منفذ ضمن هذا التدقيق.

## 5. تحليل المؤشرات والمعادلات ومصادر البيانات

### 5.1 القواعد التي يمكن اعتمادها حالياً

| المؤشر/الكشف | التنفيذ الفعلي | الحكم |
|---|---|---|
| رصيد كشف العميل | `customer_ledger` → `toLedgerEntry` → `buildStatement` | جيد نسبياً؛ `opening=Σ قبل الفترة`، و`closing=opening+debit-credit` في `engine.ts:9-15,157-235`. الرصيد المخزن للتحقق فقط. |
| رصيد المورد | فواتير شراء/مرتجعات + فصل `paid` المضمن | جزئي؛ `supplier.ts:62-135,205-236` يصفه صراحة كمشتق، وتاريخ السداد اللاحق غير متاح لأنه `paid` تراكمي في الفاتورة. |
| الخزينة | تحصيلات العملاء + `purchase_invoices.paid` + مصروفات قديمة/دفعات مصروف | جزئي؛ `cash.ts:223-343`، لا يفصل حسابات مالية أو طرق دفع على خزائن مستقلة. |
| المصروف المعترف به/المدفوع/المتأخر | `fetchUnifiedExpenseStats` → `expense_summary`، ثم fallback | قوي نسبياً؛ التعريف الصريح في `financial-bridge.ts:4-18`، لكن لا اختبار DB هنا. |
| تكلفة السطر | `sales_line_cost` | موجود ومركزي في SQL: حركة ISSUE الفعلية ثم Standard فقط، وإلا `NULL` (`06_sales...sql:1053-1100`). |
| تقييم المخزون | `inventory_valuation` | موجود؛ يقتصر على ملكية الشركة/المخزون المتعقب، ويضع `valuation_is_reference_based` لغير STANDARD (`12_reporting_views.sql:698-712`). |

### 5.2 المعادلات في الواجهات والمشكلات

| المؤشر | المصدر والمعادلة الفعلية | الحالة والمشكلة | تحقق صحيح مقترح |
|---|---|---|---|
| إجمالي المبيعات/Dashboard | `Σ sales_invoices.total`، و`Σ paid` في `_app.dashboard.tsx:303-307` | **عالي:** لا filter status (`:229-233`)؛ limits on items/clients/inventory. | قارن مع View/RPC يستبعد `draft,cancelled,returned` وفق سياسة الإيراد، وبنفس الفترة/الفرع. |
| Analytics total revenue | `Σ sales.total` (`_app.analytics.tsx:339-347`) | **عالي:** نفس غياب الحالة؛ الربح يستعمل `products.cost * qty` (`:191-197`) لا تكلفة ISSUE الفعلية. | مصدر server-side يستخدم `sales_line_cost` أو cost-posting، ويعلن basis. |
| P&L (قائمة الدخل) | `netRevenue=Σ subtotal-Σ discount`; `gross=netRevenue-Σ sales_line_cost`; `net=gross-postedExpenses` (`income:75-123`) | **عالي:** لا يستبعد status ولا يطرح returns؛ الضرائب مستبعدة من revenue بحكم المعادلة، وهو جائز محاسبياً إن كان مقصوداً لكنه غير موثق. N+1 RPC لكل سطر. | حالات confirmed/postable فقط، ناقص returns المقبولة، وعقد واضح للتعامل الضريبي؛ RPC تجميعي. |
| «كشف الأرباح والمبيعات الأساسي» المستخدم | `Σ item.total - Σ (item.cost_price*qty)` (`reports-hub-tab.tsx:169-216`) | **حرج:** `sales_invoice_items.cost_price` غير موجود في migration/types، الأخطاء صامتة؛ لا discounts/returns/expenses ولا حالة فواتير. | استبداله بمنطق P&L موحد بعد إصلاحه، لا ترميم formula ثانية. |
| profit-sales البديل | يخصم discounts/returns ويطلب `sales_line_cost` | غير مستخدم، وفيه خطأ مؤكد: select `total_amount` ثم يجمع `row.amount` (`profit-sales-report.tsx:66-69,151-164`) فيصبح المصروف صفر. |
| متوسط الفاتورة/عدد الفواتير | Analytics: `Σ total / sales.length`، وعدد rows (`analytics.tsx:339-385`) | جزئي؛ يرث مشكلة الحالات والحدود، ولا تفريق invoice/credit note. | invoice status policy + count server-side. |
| المرتجعات | جدول عرض يجمع `sales_returns` و`purchase_returns` (`reports-hub-tab.tsx:303-332`) | منفذ ككشف مستقل؛ لا يستبعد status ولا يربطه بحساب كل P&L/Dashboard. | معيار «مرتجع منشور/نافذ» موحد وربط صافي البيع والتكلفة والمخزون. |
| الخصومات والضرائب | أعمدة على الفاتورة والبند (`06_sales...sql:23-26,40-44`) | موجودة بالبيانات؛ لا توجد قاعدة report مشتركة. بعض التقارير تستعمل total وبعضها subtotal-discount. | DTO مركزي: gross, invoice discount, tax, return, net-before/after-tax. |
| الذمم والعملاء/الموردون | `loadDebtsOverview` يحسب من ledger/اشتقاق المورد (`debts.ts:96-180`) | جيد في الطبقة غير الموصولة؛ المركز المستخدم يجلب `balance` المخزن (`reports-hub-tab.tsx:253-287`). | وصل المركز إلى `loadDebtsOverview` مع شارة gap/aging. |
| المحصل حسب طريقة الدفع | `Σ sales.paid` حسب `payment_method` (`reports-hub-tab.tsx:450-477`) | جزئي؛ split لا يُحل إلى `customer_payment_splits` هنا، والحالات غير مفلترة. | تجميع جدول split/سندات التحصيل، مع فصل الفاتورة/التحصيل والـcash/bank account. |
| المخزون/القيمة والحركة | stock quantities من `company_stock_positions` أو `inventory`; الحركة من `stock_movements` | جزئي؛ كشف الحركة محدود 300 صف (`reports-hub-tab.tsx:290-300`)، و«إجمالي القيمة» في كشف الصنف = `sale_price*stock` (`:2437-2488`) وليس تكلفة. | `inventory_valuation` للقيمة المحاسبية وpagination/CSV كامل من server. |

**سياسة التكلفة المؤكدة:** قاعدة البيانات تعرّف `MOVING_AVERAGE` و`STANDARD` (`05_products...sql:583-592,1728-1747`). `sales_line_cost` يعتمد تكلفة حركة ISSUE المسجلة أولاً، ثم Standard المصرح فقط، ولا يخمّن Moving Average عند غياب أثر الحركة. هذه سياسة سليمة؛ الواجهات التي تقرأ `products.cost`/`cost_price` تتجاوزها.

**العملات والفروع:** `money()` وCompany Profile يوفران رمز عملة، لكن لم أجد في تقارير البيع/التحليلات تجميعاً حسب currency أو تحويل عملة. معظم جداول البيع لا تعرض company/branch id، وViews تحتوي أحياناً `company_id=1` ثابتاً (`12_reporting_views.sql:618-621`). يمكن القول إن تعدد المستودعات حاضر في البيانات، لكن لا توجد فلترة فرع موحّدة؛ دعم تعدد العملات/الفروع في التقارير **غير مثبت**.

## 6. الخدمات والاستعلامات والأداء والصلاحيات

### 6.1 نقاط القوة

- `useStatement` يفصل الجلب عن الحساب والتخطيط، ويستخدم React Query (مصدر 30 ثانية، ملف الشركة 5 دقائق) في `use-statement.ts:90-149`.
- `buildStatement` نقي، يقرب إلى منزلتين ويعطي ترتيباً حتمياً (`engine.ts:43-113`)، ويتحقق من فرق cache (`:215-264`).
- `expense_summary` خلف `financial-bridge.ts:29-93` يعيد تعريفات موحدة مع fallback واضح.
- عمليات المخزون/بيع البيانات الأساسية في SQL تستعمل RPC؛ `create_sale` يقفل صف inventory ويفرض سياسة الصنف (`06_sales...sql:310-435`).
- توجد RLS على الجداول في `13_foreign_keys_and_grants.sql` وسياسات `is_staff`/الأدوار، وللمصروفات صلاحيات أدق (`:526-536`).

### 6.2 الضعف والأداء

| الحالة | الدليل | الأثر |
|---|---|---|
| تجميع browser واسع | Dashboard/Analytics/ReportsHub يحمّلون صفوفاً ثم `reduce/map` | حمل شبكة وذاكرة وتباين المعادلات؛ لا reuse للتصدير أو الشاشة. |
| truncation صامت | Dashboard: 500/1000/2000 (`dashboard.tsx:235-247`)، Analytics: 1000–3000 (`analytics.tsx:121-157`)، Balance/Trial: 2000/3000 (`balance-sheet.tsx:43-67`) | النتائج ناقصة عندما تتجاوز الحدود، بلا banner «تم اقتطاع النتائج». |
| N+1 | `Promise.all(soldLines.map(rpc sales_line_cost))` في P&L (`income-statement.tsx:96-109`) | طلب لكل بند، مهلة/ضغط محتمل؛ لا batch أو cancellation. |
| لا pagination في التقارير | معظم `ReportsHubTab` يجلب الكل؛ الحركات فقط `.limit(300)` | سجل غير كامل وحساب totals/export غير مكتمل للحركة. |
| أخطاء غير ظاهرة | `ReportsHubTab` لا يفحص `*.error` ويكتفي `console.error` | بيانات فارغة/صفرية قد توهم بأنها صحيحة. |
| ازدواج طبقات | المركز المستعمل مقابل مكونات `ReportShell` غير المستخدمة | تكلفة صيانة ومعادلات/قوالب مختلفة. |
| فهارس غير كافية للتقارير | توجد فهارس product/customer/payment/expense، لكن لم يظهر فهرس مركب `sales_invoices(created_at,status)` أو `purchase_invoices(created_at,status)` في migrations | لا يمكن إثبات الخطة دون DB؛ احتمال scans عند فلاتر الفترة/الحالة. |

### 6.3 الصلاحيات والنطاق

`ModuleGuard` (`src/lib/modules.tsx:685-710`) حارس اشتراك/ميزة، لا حارس دور. `/reports` يحرس `analytics` ثم يوجّه إلى صفحة تحرس `payments` (`_app.reports.tsx:7-9`, `_app.account-statement.tsx:108-110`)؛ هذا تضارب وصول محتمل. Route registry يعلن أدواراً للملاحة، لكنه ليس بديلاً عن إنفاذ route direct أو RLS. RLS القراءة العامة للعديد من جداول التقارير هي `is_staff(auth.uid())` (مثلاً sales `13_foreign...sql:784-790`، purchases `:743-759`، inventory `:556-562`)؛ المصروفات تقيد أكثر. لا يوجد دليل من هذا الكود على عزل tenant/branch في استعلامات التقارير، لذلك لا يجوز ادعاؤه.

## 7. تحليل PDF وExcel والطباعة وملفات الورق

| السطح | التنفيذ | الحالة |
|---|---|---|
| CSV المتوافق مع Excel | `src/lib/excel-export.ts:4-104` | منفذ: UTF-8 BOM، RTL، أرقام ASCII؛ **ليس XLSX** ولا تنسيق/صيغ/ورقات Excel أصلية. |
| HTML/PDF تقارير مالية | `src/lib/pdf.ts:276-617` | موجود: HTML A4 بطباعة المتصفح؛ jsPDF/autoTable للـinvoice (`:158-274`). الاسم «Download PDF» لا يثبت أن كل تقرير ينشئ ملف PDF. |
| طباعة كشف الحساب | `src/lib/statements/print.ts:183-239` | منفذ: يبني HTML من نفس `StatementResult`؛ أفضل تطابق شاشة/طباعة. |
| طباعة التقرير العامة المعزولة | `src/lib/print/report-print.ts:1-223` + `src/lib/reports/reports-export.ts` | موجود ومختبر، لكن `ReportsHubTab` لا يستدعيه؛ يستعمل `window.print`. |
| محرك الطباعة الموحد | `src/lib/printing/engine.ts:80-220` | منفذ للمستندات الموحدة؛ يضيف `paperCss`، ويتعامل مع browser/pdf/thermal. |
| الورق | `src/lib/printing/paper.ts:1-65` | A4/A5 وحراري 80/58 mm معرفة مركزياً. |
| معاينة الفاتورة/المستند | `src/components/luxury-print-preview-modal.tsx:108-717` | منفذة مع RTL وخيارات الورق، للمستندات لا لمركز التقارير. |
| ESC/POS مباشر | `printing/engine.ts:190-215`, `docs/PRINTING_REMAINING_ISSUES.md` | البايتات/transport موجودة لكن تحتاج Local Print Agent؛ لا إرسال مباشر من المتصفح من دون agent. |

الإيجابيات: CSS الموحد يستخدم A4، RTL، `thead { display: table-header-group }` و`break-inside: avoid` في `report-print.ts:103-168`; القوالب الرسمية تستخدم A4 وheader مكرر (`printing/formal.ts:7-40`). Company profile المركزي موثق ومختبر. السلبيات: `pdf.ts` يكرر محرك HTML وCSS وخطوط Google، و`ReportsHubTab` يطبع واجهة التطبيق بما فيها toolbar؛ لذلك لا ضمان لترويسة/هوية/هوامش/صفوف متعددة الصفحة أو تطابق totals. لا يوجد قالب PDF/Excel موحد لكشوف المشتريات والمرتجعات والمخزون ضمن المركز الفعلي.

الوثائق تطابق وجود محرك الطباعة الموحد، وتصرح بحد ESC/POS؛ لكنها أقدم/أوسع من التوصيل الحالي. `docs/PRINTING_SYSTEM_AUDIT_AND_PLAN.md:67-87` نفسه يوثق عدم توحيد jsPDF وHTML، وهو ما لا يزال ظاهراً. ادعاءات «منفذ ومتحقق» في `docs/reports/statements-implementation-report.md:4,34` تدعم وجود الاختبارات، لكنها لا تحل محل تشغيلنا أو اختبار DB.

## 8. جرد التقارير بحسب الوحدات

| الوحدة | التقرير/الوظيفة | المصدر/الفلاتر | العرض/التصدير | الاكتمال |
|---|---|---|---|---|
| Dashboard | مبيعات، محصل، مصروفات، ذمم، نقص مخزون، top products/payment pie | آخر 30/14 يوماً؛ بلا status/branch | بطاقات ورسوم، بلا export | جزئي وخطر دقة |
| Analytics | يومي/فئة/علامة/ساعة/عملاء/مخزون/مصروفات | days فقط، tables مباشرة | Recharts، بلا export | جزئي |
| المركز | الأكثر مبيعاً، سجل بيع، طرق دفع، مخزون منخفض، ربح ومبيعات | Sales/items/products | Table+CSV+طباعة صفحة | جزئي؛ cost/status |
| المركز | مشتريات، ذمم، فواتير عميل، حركة مخزون، مرتجعات، مصروفات، كشف صنف | جداول تشغيلية وفترة | Table+CSV+طباعة صفحة | جزئي؛ limits/فلاتر/إخراج |
| العملاء/الموردون/الخزينة | كشف حساب، ageing/فرق cached balance | adapters + engine؛ فترة/أعمدة/zero rows | table+CSV+HTML print/share | منفذ جزئياً؛ المورد/الخزينة مشتقان |
| محاسبة متقدمة | P&L، balance sheet، trial balance، daily journal | جداول تشغيلية/RPC؛ P&L بفترة، البقية لقطة/يوم | HTML print+CSV | جزئي/غير مرجعي كدفتر |
| المخزون | inventory page وmovement report، inventory valuation view | warehouse في الشاشة، الفترة للحركة | DataTable/CSV للمركز | جزئي؛ no central valuation report |
| المصروفات | expense screen، expense report، bridge | statuses posted…، date | table/CSV في مسارات مختلفة | بيانات الأساس جيدة؛ العرض مكرر |
| المدفوعات | payment mix، cash statement | `paid` وcustomer payments | CSV/statement print | جزئي؛ split/account reconciliation |
| المطحنة | كفاءة، صحة السند، تشخيص التسعير | `milling_efficiency_report`, `milling_intake_health`, `milling_pricing_diagnostics` | tables + CSV | منفذ؛ لا PDF/فترة ظاهرة |
| التدقيق | audit route/CSV | audit logs | ليس تقريراً مالياً | خارج محور الحساب |

الفجوات ذات الأولوية: تقرير صافي بيع مرجعي، P&L قائم على posting/cost/returns، ميزان مراجعة من View/دفتر، كشف خزينة حسب الحساب وطريقة الدفع، تقارير branch/warehouse وaging موصولان، وتصدير PDF/XLSX موحد. لا يُقترح تقرير مكرر قبل استبدال أو وصل الموجود.

## 9. مصفوفة المشكلات المكتشفة

| ID | أولوية | نوع الدليل | المشكلة والأثر | المسار/الأسطر |
|---|---|---|---|---|
| R-01 | حرج | مؤكد | فواتير draft/cancelled لا تستبعد في عدة مصادر، خلاف Views SQL؛ يفسد الإيراد/الربح/الدفع. | `dashboard:229-233`, `analytics:122-127`, `income:61-71`, مقابل `12_reporting_views.sql:301,396,566` |
| R-02 | حرج | مؤكد | تقرير الربح الفعلي يطلب عمود `cost_price` غير موجود لبند بيع؛ error صامت وتكلفة 0. | `reports-hub:154-181`; schema `06_sales...:36-49`; types `types.ts:841-870` |
| R-03 | مرتفع | مؤكد | P&L لا يطرح sales returns ولا يعالج query errors؛ N+1 cost RPC. | `income:61-135` |
| R-04 | مرتفع | مؤكد | Balance/Trial/Journal ليست تقارير دفتر أستاذ؛ تصنع cash/equity/accounts محلياً، مع cap. | `balance-sheet:43-105`, `trial-balance:44-161`, `daily-journal:60-152`; View موجود `12_reporting_views.sql:623-647` |
| R-05 | مرتفع | مؤكد | تقرير الأرباح البديل غير موصول، وفوق ذلك يجمع `amount` رغم طلب `total_amount`. | `profit-sales-report:66-69,151-164` + بحث الاستخدام |
| R-06 | مرتفع | مؤكد | لا pagination وlimits تقطع النتائج بلا إعلام؛ movement limit 300. | `reports-hub:290-300`, Dashboard/Analytics lines المذكورة |
| R-07 | مرتفع | مؤكد | مركز التقارير يخفي أخطاء الاستعلام في console ويعرض empty/zero. | `reports-hub:355-358,964-1004` |
| R-08 | متوسط | مؤكد | شاشة/CSV/PDF لا تتشارك pipeline واحداً؛ الطباعة window.print للواجهة. | `reports-hub:1215-1223` مقابل `report-print.ts` |
| R-09 | متوسط | مؤكد | الذمم في المركز تستخدم `balance` cached بدلاً من engine الموجود، فلا تظهر reconciliation/aging. | `reports-hub:253-287`; `debts.ts:1-150` |
| R-10 | متوسط | مؤكد | الصلاحية route تعتمد modules، وRLS العامة staff؛ لا scope branch/tenant أثبته في UI. | `modules.tsx:685-710`, `13_foreign...:784-790` |
| R-11 | متوسط | استنتاج مدعوم | لا composite indexes ظاهرة لفلاتر date+status؛ تحتاج `EXPLAIN` على DB قبل migration. | فهارس `06_sales...:135-143`, queries أعلاه |
| R-12 | منخفض | مؤكد | «Excel» تسمية مضللة نسبياً: الناتج CSV، ولا XLSX/PDF downloadable موحد لكل report. | `excel-export.ts:4-10,49-104` |
| R-13 | منخفض | مؤكد | تكرار مكونات تقارير غير مستعملة يزيد الانحراف. | ملفات `src/components/statements/*report*.tsx`؛ بحث JSX usage |

## 10. مصفوفة تغطية المحاور الستة

| المحور | ما تحقق | ما لم يمكن إثباته/الفجوة |
|---|---|---|
| 1. المكونات | جرد route/components، filters/loading/empty/error والاستجابة من الكود | سلوك بصري فعلي على هاتف أو قارئ شاشة لم يختبر |
| 2. الحسابات | تتبع أهم المعادلات وSQL cost/expense/stock | أرصدة حية، دقة historical posting، عملات متعددة |
| 3. الخدمات | تتبع الواجهة إلى Supabase/RPC وcache/RLS/indexes | EXPLAIN، latency، execution plan، deployment schema |
| 4. الإخراج | HTML/jsPDF/CSV/paper/thermal/docs | إخراج طابعة حقيقية أو PDF binary لكل route |
| 5. الوحدات | جرد reports والتداخل ومركز الاستخدام | لا تقارير غير موجودة في الشجرة أو خدمات خارج المستودع |
| 6. الاختبارات | فحص و تشغيل unit/source tests وبناء | SQL/DB integration، E2E browser، تطابق binary PDF/XLSX |

## 11. خطة الاختبارات الحالية والمفقودة

### المنفذ فعلاً في هذا التدقيق

| الأمر | النتيجة | ما يغطيه |
|---|---|---|
| `npm run test:statements` | 81/81 ناجح | math/period/order/integrity للـengine النقي. |
| `npm run test:reports-export` | 32/32 ناجح | DTO export/print لأعلى المنتجات/المبيعات/الدفع/low stock وA4 RTL. لا يستدعي ReportsHub الفعلي. |
| `npm run test:print-engine` | 3 ناجح | engine قوالب. |
| `npm run test:unified-printing` | 86 ناجح | engine/settings/paper موحد. |
| `npm run test:transports` | 93 ناجح | transport/ESC-POS. |
| `npm run test:company-profile` | 46 ناجح | profile والقراءات المركزية. |
| `npm run test:payment-methods`, `route-registry`, `column-registry`, `communication` | ناجحة | مساندة فقط. |
| `npm run build` | ناجح | type/bundle production؛ لا يفحص بيانات Supabase الفعلية. |

### الموجود ولم يشغل

`supabase/tests/item_model_acceptance.sql` و`payment_methods_acceptance.sql` موجودان؛ لم يشغلا لأنهما يحتاجان قاعدة PostgreSQL/Supabase صالحة وfixtures. الأول يغطي بعض `inventory_valuation` و`purchase_register`، وليس مطابقة تقارير الشاشة/PDF/CSV.

### الاختبارات المطلوبة قبل إصلاح/إطلاق التقارير

1. **وحدة:** fixture موحد يثبت gross/net/tax/discount/partial return/cancel/draft/split payment، ويقارن DTO شاشة/CSV/print.
2. **تكامل DB:** أنشئ بيانات مع invoice confirmed/paid/partial/draft/cancelled/returned وreturn جزئي؛ قارن RPC/View source with API totals. اختبر `sales_line_cost` لمخزون tracked/service/standard/missing cost.
3. **تصدير:** parser CSV للتحقق من الأرقام، واختبار HTML/PDF DOM للـheader/footer/period/rows/totals؛ عند إدخال XLSX افحص cells numerically.
4. **صلاحية ونطاق:** مستخدم accountant/cashier/warehouse/non-staff، company/branch/warehouse وdirect URL، مع توقع 403/صفوف معزولة.
5. **أداء:** 10k/100k invoice lines؛ EXPLAIN ANALYZE للـRPC/views، pagination cursor، وقياس وقت/ذاكرة browser. لا تقبل cap صامتاً.
6. **E2E:** Playwright/Cypress: filter → screen total → CSV → print HTML، على RTL وmobile، empty/error/retry.

## 12. التصميم المعماري المستهدف المقترح

يحافظ التصميم على `Statement Engine` و`financial-bridge` وViews/printing engine بدلاً من استبدالها:

```text
Report definition (id, filters, entitlement, columns)
       ↓
Report service / RPC read model (server-side)
  ├─ canonical eligibility: status, company/branch/warehouse, date
  ├─ canonical measures: gross, discount, tax, return, net, COGS, expense
  └─ paged rows + totals + dataAsOf + costBasis + warnings
       ↓
Shared ReportResult DTO / query key
  ├─ Screen Table/Charts/KPI
  ├─ CSV/XLSX builder
  └─ report-print HTML/PDF builder
```

لا تنقل حساب الرصيد من `buildStatement`. انقل فقط الحسابات المتفرقة إلى read models/RPCs مبنية على posting/views. اجعل status policy صريحاً لكل metric، وارجع warning إن كانت cost unknown أو valuation reference-based. استعمل cursor pagination مع totals من الاستعلام، لا `limit` واجهة. اقتران access scope يجب أن يكون في RLS/RPC، لا navigation فقط.

## 13. خطة التنفيذ المستقبلية المرحلية (لا تُنفذ الآن)

| المرحلة | الهدف/المشكلات | ملفات محتمل تأثرها | مهام/تبعيات ومخاطر |
|---|---|---|---|
| P0: تثبيت الحقيقة | معالجة R-01..R-05 قبل أي تحسين UI | migrations جديدة فقط بعد قرار، `12_reporting_views.sql`, `reports-hub`, `income-statement`, `trial-balance`, `daily-journal` | اعتماد تعريف net sales/tax/returns وperiod؛ fixtures DB؛ خطر تغيير أرقام منشورة، لذا shadow compare أولاً. |
| P1: read models | مصدر server-side موحد وpaged | `src/lib/reports/` جديد، typed Supabase، RPC/views، hooks | تعريف DTO وquery keys وscope؛ لا تغيّر engine statements أو sales posting. |
| P2: وصل المركز | استبدال ReportsHub المتفرق لا إضافة مركز آخر | `reports-hub-tab.tsx`, `account-statement.tsx`, أو نقل مكونات ReportShell بعد اختيار واحد | إزالة dead code تدريجياً بعد E2E؛ حافظ على routes/deep links. |
| P3: المالية/المخزون | P&L/Balance/Trial/Journal مرجعية | routes accounting، `financial-bridge`, ledger views | استخدم journal/view للدفتر وvaluation policy؛ لا تعرض equity مشتقة كقيد دفتر. |
| P4: الإخراج | PDF/CSV/XLSX موحد وتطابق | `reports-export.ts`, `report-print.ts`, `excel-export.ts`, printing | DTO واحد للشاشة والإخراج؛ XLSX library بعد تحديد متطلبات؛ لا تكسر طباعة invoice الموحدة. |
| P5: performance/security | فهارس/EXPLAIN/scope UX | migrations بعد القياس، RLS/RPC، routes | لا تضف index بلا EXPLAIN؛ اختبر roles/branch/tenant وretry/timeout. |

## 14. معايير القبول والتحقق لكل مرحلة

| المرحلة | معايير القبول |
|---|---|
| P0 | جدول fixture يثبت أن draft/cancelled لا تدخل، والمرتجع/الخصم/الضريبة لا يحسب مرتين؛ مقارنة قبل/بعد موثقة لكل metric. |
| P1 | request واحد paged لا يجلب الصفوف كاملة؛ totals وrows من نفس snapshot؛ `dataAsOf`, status policy, costBasis ظاهرة؛ RLS يعيد scope الصحيح. |
| P2 | كل تقرير ظاهر له loading/empty/error/retry؛ direct URL محمي؛ لا مكون تقرير ميت أو formula مزدوجة؛ mobile table قابل للاستخدام. |
| P3 | P&L/Balance/Trial/Journal يطابقون مصدر ledger المعتمد في fixtures؛ trial debits=credits حقيقياً لا بالتعريف المحلي؛ no unknown cost silent. |
| P4 | الشاشة وCSV وHTML/PDF تستخدم ReportResult ذاته؛ tests تقارن totals/rows/filters؛ Arabic RTL/header repeated/multi-page معتمد بصرياً. |
| P5 | EXPLAIN وload tests ضمن SLO متفق؛ لا truncation صامت؛ اختبارات role/company/branch/warehouse ناجحة؛ monitoring للأخطاء/timeout. |

## 15. الملفات والمسارات المرجعية

### الواجهة والمنطق

- `src/routes/_app.dashboard.tsx:223-335`
- `src/routes/_app.analytics.tsx:116-389`
- `src/routes/_app.account-statement.tsx:104-112,253-385,564-571`
- `src/components/statements/reports-hub-tab.tsx:54-66,137-364,750-962,1204-1223,1986-2081`
- `src/hooks/use-statement.ts:74-150`
- `src/lib/statements/engine.ts:9-15,157-284`
- `src/lib/statements/adapters/customer.ts:181-241`
- `src/lib/statements/adapters/supplier.ts:62-135,205-315`
- `src/lib/statements/adapters/cash.ts:223-343`
- `src/lib/statements/debts.ts:1-180`
- `src/lib/expenses/financial-bridge.ts:1-93`
- `src/routes/_app.income-statement.tsx:56-135`
- `src/routes/_app.balance-sheet.tsx:41-105`
- `src/routes/_app.trial-balance.tsx:44-161`
- `src/routes/_app.daily-journal.tsx:53-155`
- `src/routes/_app.milling.reports.tsx:46-144`

### الإخراج والاختبارات والبيانات

- `src/lib/excel-export.ts:4-104`
- `src/lib/pdf.ts:1-19,158-274,276-617`
- `src/lib/print/report-print.ts:1-223`
- `src/lib/printing/{engine.ts,paper.ts,settings.ts,adapters.ts}`
- `src/lib/reports/__tests__/reports-export.test.ts`
- `src/lib/statements/__tests__/engine.test.ts`
- `src/lib/printing/__tests__/{unified-printing.test.ts,transports.test.ts,company-profile.test.ts}`
- `supabase/migrations/06_sales_and_returns.sql:11-49,340-435,581-697,1053-1100`
- `supabase/migrations/09_expenses.sql`
- `supabase/migrations/12_reporting_views.sql:293-338,497-712`
- `supabase/migrations/13_foreign_keys_and_grants.sql:459-536,743-805`
- `supabase/tests/{item_model_acceptance.sql,payment_methods_acceptance.sql}`
- `docs/{UNIFIED_PRINTING_SYSTEM.md,PRINTING_SYSTEM_AUDIT_AND_PLAN.md,PRINTING_REMAINING_ISSUES.md,reports/statements-implementation-report.md,plans/statements-engine-plan.md}`

### خاتمة تحقق التسليم

هذا التقرير يصف ما أمكن إثباته من المصدر عند commit المحدد، ولا يدعي نجاح اختبار قاعدة بيانات أو صحة أرصدة إنتاج. التغيير المقصود الوحيد في فرع التدقيق هو هذا الملف؛ يجب فحص `git status` و`git diff --check` قبل commit التوثيقي المنفصل.
