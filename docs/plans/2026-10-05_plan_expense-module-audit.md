# تدقيق شامل وخطة تنفيذ توحيد نظام المصروفات
# Expense Module Audit & Implementation Plan (Market-Hub ERP)

> **تاريخ التدقيق:** 2026-10-05  
> **الفرع:** `feature/expense-module-consolidation`  
> **المرجع التقني:** Market-Hub Enterprise Resource Planning (ERP) — Accounting & Expense Engine  
> **المستوى المعماري:** Staff / Principal Systems Architect

---

## 1. الوضع الحالي (Current State Assessment)

### 1.1 ما هو نظام المصروفات القديم؟ (Legacy System)
النظام القديم هو جدول مفرد مسطح `public.expenses` صُمم في البداية كـ Cash Log بدائي:
* **الهيكل:** حقل واحد للمبلغ (`amount numeric`), تصنيف (`category_id`), طريقة دفع (`payment_method`), تاريخ (`expense_date`), وملاحظة نصية (`note`).
* **العيوب البنيوية:**
  1. **غياب بنية المستند (Document Model):** لا يوجد فصل بين رأس المستند (Header) وبنوده (Lines). فاتورة الصيانة أو شراء المستلزمات تحوي بنودًا متعددة بأسعار وكميات وتصنيفات مختلفة وضريبة، والجدول القديم يدمجها في رقم إجمالي واحد.
  2. **غياب دورة الحياة (Lifecycle & Governance):** لا توجد حالات (Draft, Submitted, Approved, Rejected, Posted, Reversed). أي سجل يُحفظ يُعد نهائيًا، وأي مستخدم يملك صلاحية staff يمكنه حذفه عبر `DELETE FROM expenses` من المتصفح!
  3. **الخلط بين طريقة الدفع وحالة الدفع:** استخدام enum لطريقة الدفع يتضمن القيمة `'credit'`. هذا خلط شنيع بين "طريقة أداء الدفعة" (Cash, Bank) وبين "كون المصروف آجلًا مستحقًا لم يُدفع بعد" (Accrued Liability).
  4. **غياب كيان الدفعات (Payments Entity):** لا يدعم السداد الجزئي، ولا تعدد الدفعات، ولا تاريخ السداد الفعلي، ولا الحساب المالي المسدد منه.
  5. **انعدام سجل التدقيق (Audit Trail):** لا يمكن معرفة من أنشأ، من اعتمد، متى رُحِّل، أو تتبع التعديلات.

### 1.2 ما هو نظام المصروفات الجديد؟ (Unified Enterprise Module)
النظام الجديد مُهندس وفق أحدث معايير الـ ERP المحاسبي عبر المعمارية الموزعة:
* **الجداول الأساسية:**
  - `public.expense_entries`: رأس مستند المصروف (Reference فريد، الحالات المحاسبية، جهة الصرف Payee، التواريخ الثلاثة: الاقتصادي، الاستحقاق، الترحيل، الأبعاد: الفرع، مركز التكلفة، المشروع، المبالغ: الإجمالي، المدفوع، المتبقي كـ Generated Stored Column، الإصدار Version لمنع Concurrency Overwrite).
  - `public.expense_lines`: بنود المصروف التفصيلية (الكمية، سعر الوحدة، الصافي، معدل الضريبة، مبلغ الضريبة، الإجمالي، التصنيف، مركز التكلفة والمشروع لكل سطر).
  - `public.expense_payments`: سجل التدفقات النقدية الخارجة المرتبطة بالمستند (المبلغ، تاريخ الدفع، وسيلة الدفع، الحساب المالي، رقم المرجع، مفتاح منع التكرار Idempotency Key، وعلاقة العكس Reversal).
  - `public.expense_approvals`: سجل تاريخي غير قابل للتعديل (Immutable Log) لكل حركة حالة مع الفاعل والتاريخ والسبب.
  - `public.expense_attachments`: مرفقات المستند (الفواتير، السندات، الإيصالات) مرتبطة بالتخزين الآمن.
  - `public.expense_cost_centers` و `public.expense_projects`: أبعاد محاسبة التكاليف.

### 1.3 ما الصفحات التي تستخدم كل نظام؟
| الصفحة / المسار | النظام المستخدم | طبيعة الاستخدام الحالي |
| :--- | :--- | :--- |
| `src/routes/_app.expenses.tsx` | **النظام الجديد** | واجهة إدارة المصروفات المتكاملة (Register, Filters, Summary, Detail Drawer, New/Edit Dialog) وتستخدم دوال RPC الجديدة بالكامل. |
| `src/routes/_app.finance.tsx` | **النظام القديم (خطر)** | لا تزال تقرأ من `public.expenses` مباشرة، وتُدخل عبر `insert({ amount, category_id, ... })` في `public.expenses`، وتحذف بـ `delete()`، وتحسب التدفق النقدي بشكل خاطئ! |
| `src/routes/_app.dashboard.tsx` | **النظام القديم** | تستعلم `supabase.from("expenses").select("amount,created_at")` لإظهار إجمالي المصروفات في بطاقة الإحصائيات. |
| `src/routes/_app.analytics.tsx` | **النظام القديم** | تستعلم `supabase.from("expenses")` لحساب المصروفات اليومية والشهرية ورسوم Recharts البيانية. |
| `src/routes/_app.balance-sheet.tsx` | **النظام القديم** | تحسب النقدية بالصندوق بخصم `expensesTotal` المسحوب من جدول `expenses` القديم. |
| `src/routes/_app.income-statement.tsx` | **النظام القديم** | تستعلم `supabase.from("expenses").select("amount")` لحساب مجمل وصافي الربح في الفترة. |
| `src/routes/_app.trial-balance.tsx` | **النظام القديم** | تضع `expensesTotal` في حساب المدين للمصروفات في ميزان المراجعة. |
| `src/routes/_app.daily-journal.tsx` | **النظام القديم** | تقرأ من `expenses` لعرض اليومية العامة. |
| `src/lib/statements/adapters/cash.ts` | **مختلط** | يقرأ من `expenses` ومن `expense_payments` و `expense_entries` في محاولة جزئية سابقة لربطهما. |
| `src/components/statements/operational-reports.tsx` | **النظام القديم** | تقارير التشغيل تقرأ `expenses`. |
| `src/components/statements/profit-sales-report.tsx` | **النظام القديم** | تقرير الأرباح والمبيعات يقرأ `expenses`. |

### 1.4 الـ RPCs والـ Hooks والـ Types الحالية
* **الـ RPCs المنفذة بقاعدة البيانات:**
  - `list_expenses`: سرد مفلتر للمستندات مع مؤشرات ترقيم الصفحات (Keyset Pagination) وحساب المجاميع.
  - `expense_detail`: جلب المستند الكامل برأسه، بنوده، دفعاته، اعتماداته، مرفقاته، وصلاحيات الفاعل (`can_edit`, `can_post`, `can_pay`, `can_reverse`).
  - `expense_summary`: ملخص إحصائي دقيق (المجموع الكلي، المدفوع، المعلق، المستحق المتأخر، بحسب الفترة والفرع).
  - `expense_lookups`: جلب قوائم التصنيفات، الموردين، الموظفين، الفروع، مراكز التكلفة، والمشاريع دفعة واحدة.
  - `create_expense`: إنشاء مسودة مستند جديد وبنوده ذرّيًا مع حساب الأرقام.
  - `update_expense`: تعديل مسودة مع التحقق من رقم النسخة Version لمنع التضارب.
  - `submit_expense`: إرسال المسودة للاعتماد.
  - `decide_expense`: اعتماد (Approve) أو رفض (Reject) المستند مع منع اعتماد المنشئ لمستنده بنفسه.
  - `post_expense`: الترحيل المالي وتثبيت الحقول المالية، مع خيار الدفع الفوري `p_pay_now`.
  - `record_expense_payment`: تسجيل دفعة مستقلة مع التحقق من عدم تجاوز المبلغ المتبقي، ومنع التكرار بـ Idempotency Key.
  - `cancel_expense`: إلغاء المستند قبل الترحيل.
  - `reverse_expense`: عكس المستند المرحل بمستند تعويضي مطابق في الاتجاه المعاكس دون مسح الأصل.
  - `reverse_expense_payment`: عكس دفعة مالية بقيد تعويضي.
  - `close_expense`: إقفال المستند بعد اكتمال سداده بالكامل.
  - `migrate_legacy_expenses`: دالة الترحيل المعزولة لنقل السجلات القديمة إلى المستندات الجديدة.
* **الـ Hooks الحالية:**
  - `src/hooks/use-expenses.ts`: يحوي `useExpenseList`, `useExpenseDetail`, `useExpenseSummary`, `useExpenseLookups`, `useExpenseReport`, `useExpenseMutations`, `useExpenseRealtime`.
* **الـ Types الحالية:**
  - `src/lib/expenses/types.ts`: تعرف كافة العقود البيانية (`ExpenseStatus`, `ExpenseEntryType`, `ExpensePayeeType`, `ExpenseListRow`, `ExpenseDetail`, `ExpenseLine`, `ExpensePayment`, `ExpenseApproval`).

### 1.5 هل توجد عمليات لا تزال تكتب مباشرة إلى `public.expenses`؟
**نعم، وبشكل حرج جدًا!**
في صفحة `src/routes/_app.finance.tsx`:
1. دالة `saveExpense()` (السطر 146):
   ```typescript
   await supabase.from("expenses").insert({
     category_id: form.category_id,
     amount: Number(form.amount),
     payment_method: form.payment_method as any,
     expense_date: form.expense_date,
     note: form.note || null,
   });
   ```
2. دالة `delExpense()` (السطر 171):
   ```typescript
   await supabase.from("expenses").delete().eq("id", id);
   ```
هذا يخلق تباينًا كاملًا: المصروف المُدخل من `/finance` لا يظهر في `/expenses`، ولا يمر بأي رقابة أو اعتماد، ويخترق قواعد البيانات المالية، وإذا حُذف يُحذف نهائيًا دون أثر!

---

## 2. خريطة الاعتماد والترحيل (Dependency Matrix)

| الملف (File) | الوظيفة (Function) | المصدر الحالي (Current Source) | هل يُنقل للنظام الجديد؟ | المخاطر واستراتيجية المعالجة |
| :--- | :--- | :--- | :--- | :--- |
| `src/routes/_app.finance.tsx` | صفحة المالية وإضافة المصروف السريع وعرض الذمم والمؤشرات | `public.expenses` (قراءة وكتابة وحذف) | **نعم — إلزامي وفوري** | كسر تجربة المستخدم إن تغير النموذج؛ الحل: إعادة صياغة نافذة الإضافة السريعة لتستدعي `create_expense` وتُرحل بـ `post_expense` فوريًا إذا اختار المستخدم السداد الآن، وتحديث جدول المصروفات الأخير ليقرأ من `list_expenses`. |
| `src/lib/statements/adapters/cash.ts` | كشف حساب الصندوق والتدفقات النقدية للمطحنة | استعلام مزدوج (`expenses` + `expense_payments`) | **نعم — توحيد كامل** | خطر احتساب المصروف مرتين (Double Counting)؛ الحل: الاعتماد الحصري على `expense_payments` للمصروفات المدفوعة فعليًا، وتجاهل السجلات القديمة المعادة ترحيلها. |
| `src/routes/_app.dashboard.tsx` | بطاقة إجمالي المصروفات في لوحة التحكم | `expenses.select("amount,created_at")` | **نعم** | بطء الاستعلام أو تباين الأرقام؛ الحل: استخدام `expense_summary` أو الاستعلام عن `expense_entries` في حالة `POSTED` وما بعدها، واحتساب المصروف الحقيقي. |
| `src/routes/_app.analytics.tsx` | تحليلات المصروفات، المخططات البيانية اليومية والشهرية | `expenses.select("amount,created_at,category_id")` | **نعم** | تعطل الرسوم البيانية؛ الحل: الاستعلام من `expense_entries` و `expense_lines` لتوفير نفس بنية البيانات مع دقة أعلى بكثير. |
| `src/routes/_app.balance-sheet.tsx` | الميزانية العمومية والنقدية بالصندوق | `expenses.select("amount")` | **نعم** | خطأ في رصيد النقدية (Cash on Hand)؛ النقدية الخارجة يجب أن تُخصم من الدفعات النقدية المسددة فعليًا (`paid_amount`) وليس من إجمالي الالتزام الآجل! |
| `src/routes/_app.income-statement.tsx` | قائمة الدخل والأرباح | `expenses.select("amount")` | **نعم** | المفهوم هنا استحقاقي (Accrual): المصروفات المعترف بها للفترة هي `POSTED` (total_amount)، بينما القديم كان يجمع أي سطر عشوائي. |
| `src/routes/_app.trial-balance.tsx` | ميزان المراجعة | `expenses.select("amount")` | **نعم** | تباين ميزان المراجعة؛ ربط المصروفات بالحسابات المدينة في شجرة الحسابات (`5xxx`). |
| `src/routes/_app.daily-journal.tsx` | دفتر اليومية العامة | `expenses` | **نعم** | عرض سندات المصروفات المرحلة برقم المستند `reference`. |
| `src/components/statements/operational-reports.tsx` | التقارير التشغيلية | `expenses` | **نعم** | استبدال مصدر البيانات بـ `expense_entries` المرحلة. |
| `src/components/statements/profit-sales-report.tsx` | تقرير أرباح المبيعات والمصروفات | `expenses` | **نعم** | استبدال مصدر البيانات بـ `expense_entries` المرحلة. |

---

## 3. التحليل المالي والمفاهيمي (Financial & Accounting Architecture)

المشروع في وضعه السابق وقع في خلط كبير بين المفاهيم المحاسبية. فيما يلي الضوابط المعيارية المعتمدة:

### 3.1 المصروف (Expense) مقابل الدفعة (Payment)
* **المصروف (Expense):** هو تحقق عبء مالي/تكلفة اقتصادية في فترة معينة، وينشئ التزامًا (Liability) إن لم يُسدد فورًا.
* **الدفعة (Payment):** هي حركة تدفق نقدي خارج (Cash Outflow) لتسوية ذلك الالتزام كليًا أو جزئيًا.
* **الخلط الحالي:** كان النظام القديم يعتبر إنشاء سجل مصروف يعني تلقائيًا صرف نقدية!
* **التصحيح:** المصروف يُسجل في `expense_entries`. الدفعة تُسجل كحدث مستقل في `expense_payments`. إذا كان المصروف آجلًا (`DUE`)، فإنه لا يؤثر على الصندوق إطلاقًا حتى تسجيل دفعة.

### 3.2 وسيلة الدفع (Payment Method) مقابل الحساب المالي (Financial Account)
* **وسيلة الدفع (Payment Method):** هي آلية التحويل (CASH نقدي، BANK_TRANSFER تحويل بنكي، CARD بطاقة شبكة، WALLET محفظة إلكترونية، CHEQUE شيك).
* **الحساب المالي (Financial Account):** هو الصندوق أو الحساب البنكي الفعلي في شجرة الحسابات (مثل: `1101 النقدية بالصندوق`، `1111 البنك الأهلي اليمني`، `1121 بنك اليمن الدولي`، أو صناديق الفروع).
* **الخلط الحالي:** كان النموذج يعتمد على نص حر عشوائي يكتبه المستخدم في `account_label`.
* **التصحيح:** تمييز قاطع بين وسيلة الدفع `payment_method` كـ Enum موحد، وبين ربط الدفعة بحساب مالي (Financial Account / Treasury Account) مسجل في شجرة الحسابات (`public.accounts`) التي أنشأتها ميجريشن `20261201000000_general_ledger.sql`.

### 3.3 تاريخ الاستحقاق (Due Date) ومفهوم المتأخر (Overdue)
* **غير مدفوع (Unpaid):** مستند مرحل (`POSTED`) ولم يُدفع منه شيء (`paid_amount = 0`).
* **مدفوع جزئيًا (Partially Paid):** مستند مرحل تم سداد جزء منه (`paid_amount > 0` و `remaining_amount > 0.005`).
* **مدفوع بالكامل (Paid):** مستند مرحل تم سداده بالكامل (`remaining_amount <= 0.005`).
* **متأخر (Overdue):** مستند تنطبق عليه الشروط الثلاثة معًا:
  1. مرحل `POSTED` أو `PARTIALLY_PAID`.
  2. يملك `due_date IS NOT NULL` و `due_date < CURRENT_DATE`.
  3. يملك رصيدًا متبقيًا `remaining_amount > 0.005`.
* **الخلط السابق:** بعض الواجهات كانت تفحص `expense_date < today` بدلاً من `due_date`، مما جعل المصروفات الفورية تظهر كأنها "متأخرة" بمجرد مرور يوم على تسجيلها!

### 3.4 حدود الترحيل `POSTED` ومفهوم الأستاذ العام (General Ledger Boundary)
* في وحدة المصروفات، `POSTED` تعني: **"الاعتراف بالمستند رسميًا وتثبيت أرقامه المحاسبية ومنع تعديله أو حذفه"**.
* لا يجوز إيهام المستخدم بأن المستند أنشأ قيدًا في اليومية العامة العامة (Journal Entry) ما لم يتم استدعاء محرك الترحيل المزدوج `post_journal_entry` وربطه بحسابات الأستاذ العام.
* لذلك، يتم توضيح المصطلح في الواجهة كـ "مرحّل محاسبيًا في سجل المصروفات"، مع تجهيز الحقول لربط الأستاذ العام المستقبلي.

### 3.5 التدفق النقدي الخارج (Cash Out) مقابل إجمالي المصروفات (Accrual Expense)
* **قاعدة الإيرادات والمصروفات (قائمة الدخل):** تعتمد على أساس الاستحقاق (Accrual) = إجمالي المصروفات المرحلة في الفترة بغض النظر عن سدادها.
* **قائمة التدفقات النقدية (Cash Flow):** تعتمد على الأساس النقدي الحقيقي = **مجموع الدفعات النقدية المسجلة فعليًا في `expense_payments` خلال الفترة**.
* لا يجوز مساواة المصروف بالـ Cash Out إذا لم يحدث تدفق نقدي فعلي!

---

## 4. تحليل الواجهات وسهولة الاستخدام (UX & ERP Interface Analysis)

### 4.1 شاشة المالية `/finance`
* **المشكلة الحالية:** زر "مصروف جديد" يفتح Dialog بدائي جدًا يُسجل مباشرة في الجدول القديم المعزول. جدول "آخر المصروفات" يعرض السجلات القديمة فقط ولديه زر حذف مباشر للأصل.
* **الحل المعماري:**
  - توحيد واجهة `/finance` لتستدعي نفس الـ RPCs الخاصة بالنظام الموحد (`create_expense` و `post_expense`).
  - عرض آخر المصروفات من `list_expenses` بالنظام الجديد، مع إظهار رقم المرجع (`EXP-2026-xxxx`)، الحالة، إجمالي المبلغ، والمبلغ المتبقي، ومنع زر الحذف للأصل بعد الترحيل، واستبداله برابط لمعاينة المستند في سجل المصروفات التفصيلي.
  - إصلاح بطاقات الـ KPIs المالية (Revenue, Purchases, Expenses, Net Profit, Receivables, Payables, Cash In, Net Cash) لتعكس الأرقام الحقيقية الموحدة.

### 4.2 شاشة المصروفات `/expenses`
* **مبدأ "Simple by default, Advanced when needed":**
  - **الحقول الأساسية للمستخدم العادي:** التاريخ، التصنيف، الوصف، المبلغ الإجمالي، هل هو مدفوع الآن أم آجل، وسيلة الدفع / الصندوق عند السداد، والجهة المستفيدة.
  - **الحقول المتقدمة (تظهر عند الطلب Progressive Disclosure):**
    - مركز التكلفة (Cost Center)
    - المشروع (Project)
    - المستودع (Warehouse)
    - المعالجة الضريبية (Tax Mode: شامل / غير شامل / معفى)
    - تفصيل البنود المتعددة (Multi-line breakdown)
* **أنواع القيود (Entry Types):**
  - `DIRECT`: مدعوم بالكامل ومباشر.
  - `SUPPLIER`: مدعوم مع اختيار المورد.
  - `EMPLOYEE`: مدعوم مع اختيار الموظف كعهدة/استرداد.
  - `RECURRING` (المتكرر): لا يوجد حاليًا محرك جدولة آلي (Cron / Recurrence engine). سيتم إخفاؤه من واجهة المستخدم العادية لمنع تضليل المشغل بميزة غير مكتملة، مع الإبقاء على الـ Enum في قاعدة البيانات للتوسعات القادمة.
  - `ADVANCE` (السلف): لا تمثل مجرد نوع مصروف بل دورة محاسبية كاملة (صرف سلفة -> تسوية -> إرجاع متبقي). سيتم إخفاؤها من واجهة تسجيل المصروف العادي إلى حين اكتمال دورة السلف، منعًا للارتباك.

---

## 5. تحليل قاعدة البيانات والترحيل الآمن (Database & Safe Migration Strategy)

### 5.1 وضع البيانات والجدول القديم
* جدول `public.expenses` القديم يحوي السجلات التاريخية المسجلة قبل إطلاق النظام الجديد.
* تم مسبقًا بناء دالة الترحيل الذرية القابلة للإعادة `public.migrate_legacy_expenses(p_mode, p_from, p_to, p_batch_size, p_dry_run)` في ميجريشن `20261001093000_expense_module_legacy_bridge.sql`.
* **استراتيجية الحفظ ومنع الفقدان:**
  1. لن يتم حذف جدول `public.expenses` نهائيًا في هذه المرحلة، حفاظًا على السلامة التاريخية ومنعًا لأي كسر غير متوقع.
  2. إنشاء ميجريشن جديدة تقوم بتشغيل الترحيل التلقائي لجميع السجلات القديمة غير المرحلة حتى تاريخ اليوم إلى `expense_entries` و `expense_lines` و `expense_payments` (بحالة `POSTED` و `PAID` إن كانت مسددة نقدًا/بنكًا، وبحالة `POSTED` بدون دفعات إن كانت `credit`).
  3. إنشاء Trigger حماية يمنع أي عمليات كتابة (`INSERT` أو `UPDATE` أو `DELETE`) مباشرة على جدول `public.expenses`، وتوجيه المشغلين للنظام الجديد، أو إعادة توجيه القراءة/الكتابة بشفافية تامة.
  4. تحديث الـ Views والتقارير لتقرأ من `expense_entries` و `expense_payments`.

---

## 6. خطة التنفيذ المنهجية (Action Plan)

1. **المرحلة الأولى: ميجريشن قاعدة البيانات (Database Migration)**
   - إنشاء ميجريشن Supabase جديدة آمنة:
     - ترحيل آلي للسجلات القديمة عبر `migrate_legacy_expenses('paid', p_dry_run => false)`.
     - دعم ربط الدفعات بحساب مالي حقيقي من شجرة الحسابات (`financial_account_id` كحقل اختياري يربط بـ `public.accounts(id)` مع الحفاظ على التوافق).
     - ضمان دقة حساب `Overdue` على مستوى قاعدة البيانات في دالة `expense_summary`.
     - وضع حماية تمنع الكتابة المباشرة القديمة غير المقصودة.
2. **المرحلة الثانية: توحيد صفحة المالية (`/finance`)**
   - تحديث `src/routes/_app.finance.tsx`:
     - استبدال `saveExpense` و `delExpense` بدوال النظام الموحد.
     - ربط جدول "آخر المصروفات" بالنظام الموحد `list_expenses`.
     - تصحيح احتساب `Cash Out` و `Expenses Total` ليعتمد على الدفع الفعلي والأساس المالي الصحيح.
3. **المرحلة الثالثة: تحسين واجهة إضافة المصروف (`ExpenseFormDialog`)**
   - تطبيق مبدأ "بسيط افتراضيًا، متقدم عند الحاجة".
   - إخفاء خيارات `RECURRING` و `ADVANCE` غير المكتملة في واجهة المستخدم لمنع الخلط.
   - إتاحة اختيار الحساب المالي (الصندوق / البنك) عند السداد الفوري بجانب وسيلة الدفع.
4. **المرحلة الرابعة: توحيد التقارير ولوحة التحكم وكشوف الحسابات**
   - تحديث `src/routes/_app.dashboard.tsx` و `src/routes/_app.analytics.tsx` و `src/lib/statements/adapters/cash.ts` و `src/routes/_app.balance-sheet.tsx` و `src/routes/_app.income-statement.tsx`.
   - التأكد التام من تطابق الأرقام بين شاشة المالية وسجل المصروفات والتقارير.
5. **المرحلة الخامسة: الاختبارات والتوثيق والتحقق النهائي**
   - اختبار إنشاء المصروفات المباشرة، الآجلة، المجزأة، المسددة.
   - اختبار التصدير (Export) للمتصفح وللخادم.
   - تشغيل الـ Linter واختبارات الـ Statements والتحقق من عدم وجود أي خطأ برمجي أو تراجع.
   - كتابة تقرير الإنجاز النهائي `docs/EXPENSE_MODULE_IMPLEMENTATION_REPORT.md` وتحديث `README.md`.
