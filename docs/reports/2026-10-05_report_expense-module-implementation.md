# تقرير إنجاز توحيد وإعادة تنظيم نظام المصروفات
# Expense Module Consolidation & Modernization Report

> **المشروع:** Market-Hub ERP  
> **الفرع:** `feature/expense-module-consolidation`  
> **التاريخ:** 2026-10-05  
> **الصفة:** مهندس برمجيات Senior/Staff — أنظمة ERP والمحاسبة المالية  

---

## 1. الملخص التنفيذي (Executive Summary)

تم بنجاح إنجاز مشروع **إعادة تنظيم وتوحيد نظام المصروفات في Market-Hub** بالكامل. انتقل النظام من نموذج بدائي مشتت يعتمد على جدول أحادي مسطح (`public.expenses`) بدون دورة حياة محاسبية وبدون فصل بين المستند والدفعات، إلى **نظام ERP محاسبي موحد ومتكامل للمصروفات** يعتمد على نموذج المستند المالي الحقيقي (`expense_entries`, `expense_lines`, `expense_payments`, `expense_approvals`).

تم حل جميع التعارضات بين شاشة المالية (`/finance`) وسجل المصروفات (`/expenses`)، وتوحيد مصادر التقارير المالية وكشوف الحسابات ولوحة التحكم، مع توفير ترحيل آمن وتوافقي (Non-destructive Backfill) للبيانات التاريخية.

---

## 2. ما تم إنجازه تفصيليًا

### 2.1 التدقيق المعماري والتحليل الشامل (Phase 1)
- إنشاء وثيقة التدقيق الشاملة: `docs/EXPENSE_MODULE_AUDIT_AND_IMPLEMENTATION_PLAN.md`.
- فحص كامل لخريطة الاعتماد (Dependency Matrix) لكل ملف واستعلام في المشروع.
- تحليل الفروق المحاسبية بين:
  - المستند (Expense Entry) والدفعة (Payment).
  - طريقة الدفع (Payment Method) والحساب المالي (Financial Account / Treasury & Bank).
  - تاريخ الاستحقاق (Due Date) والمصروف المستحق والمتأخر (Overdue & Accrued).
  - الحالات المحاسبية (Draft -> Submitted -> Approved -> Posted -> Reversed).
  - التدفق النقدي الخارج (Cash Out) مقابل أساس الاستحقاق (Accrual Accounting).

### 2.2 ترقية قاعدة البيانات ودوال RPC (Phase 2 & Database Layer)
- ملف الميجريشن: `supabase/migrations/20261205000000_expense_module_consolidation.sql`:
  1. **إضافة الحساب المالي للدفعات (`account_id`):** ربط `public.expense_payments` بجدول الحسابات المالي (`public.accounts`) لتسجيل الصندوق أو البنك الفعلي الذي خرجت منه النقدية.
  2. **ترقية `post_expense` و `record_expense_payment`:** لدعم `p_account_id` المالي بجانب وسيلة الدفع مع الحفاظ على التوافق الخلفي.
  3. **تحديث `expense_lookups`:** لتضمين الحسابات المالية النشطة من الصناديق والبنوك (نوع `asset` وتحت `1101` أو `1102`).
  4. **إعادة تعريف `Overdue`:** احتساب المستندات المتأخرة بدقة بناءً على `due_date < CURRENT_DATE` مع وجود رصيد متبقي غير مسدد (`remaining_amount > 0.005`).
  5. **الترحيل الآمن والتلقائي (Backfill Migration):** نقل آلي ذري لأي سجلات قديمة في `public.expenses` غير مرحلة إلى `expense_entries` و `expense_lines` و `expense_payments` بحالة `POSTED` دون أي حذف للأصل ودون أي فقدان للبيانات.
  6. **حماية الجدول القديم:** إنشاء Trigger حماية يمنع أي عمليات كتابة أو حذف مباشرة على الجدول القديم لضمان بقائه أرشيفًا للقراءة التاريخية فقط.

### 2.3 الجسر المالي الموحد (Financial Bridge)
- إنشاء `src/lib/expenses/financial-bridge.ts`:
  - يوفر دوال موحدة ومفحوصة الأداء للتقارير ولوحات التحكم:
    - `fetchUnifiedExpenseMetrics(options)`: حساب إجمالي المصروفات المرحلة، التدفق النقدي الخارج الفعلي، المبالغ المعلقة، المبالغ المتأخرة، وإجمالي الضريبة.
    - `fetchUnifiedExpenseSummary(options)`: جلب ملخص المصروفات من `expense_summary` RPC مع التراجع الذكي في حال غياب الاتصال.
    - `fetchUnifiedExpenseItems(options)`: جلب بنود المصروفات للتقارير وقوائم الدخل.
    - `fetchRecentExpensesUnified(limit)`: جلب آخر المصروفات لصفحة المالية أو لوحة التحكم مباشرة من `list_expenses`.

### 2.4 توحيد شاشة المالية `/finance`
- تعديل `src/routes/_app.finance.tsx`:
  - إزالة الاستعلام المباشر من `public.expenses`.
  - اعتماد `fetchUnifiedExpenseMetrics` لحساب إجمالي المصروفات وحساب التدفق النقدي الخارج الحقيقي (`Cash Out = purchase payments + actual expense payments`).
  - تحديث جدول "آخر المصروفات" ليعتمد على مستندات النظام الجديد مع إظهار المرجع، الحالة، إجمالي المستند، والمبلغ المتبقي.
  - استبدال Dialog إضافة المصروف القديم بـ `UnifiedQuickExpenseDialog`:
    - التحقق الصارم من الحقول (التصنيف، الوصف، المبلغ).
    - استدعاء `create_expense` متبوعًا بـ `post_expense` عند السداد الفوري أو الترحيل.
    - دعم اختيار الحساب المالي (الخزينة/البنك) من شجرة الحسابات.
    - إمكانية فتح المستند في سجل المصروفات `/expenses` لمنع ازدواجية الوظائف.

### 2.5 تحسين واجهة المصروفات ومبدأ التدرج (Progressive Disclosure)
- تعديل `src/components/expenses/expense-form.tsx`:
  - تطبيق مبدأ "بسيط افتراضيًا، متقدم عند الحاجة": الحقول الأساسية واضحة ومباشرة.
  - إخفاء خيارات `RECURRING` و `ADVANCE` غير المكتملة محاسبيًا من واجهة المستخدم، مع الحفاظ عليها في النموذج البرمجي.
  - إتاحة اختيار الحساب المالي (الخزينة أو البنك) من قائمة الحسابات عند تفعيل السداد الفوري.
  - معالجة حالات الاستحقاق والدفع الجزئي بدقة.
- تعديل `src/components/expenses/expense-detail-drawer.tsx`:
  - دعم اختيار الحساب المالي عند تسجيل دفعات لاحقة.
  - إيضاح المصطلحات المحاسبية بدقة ومنع أي لبس للمشغل.

### 2.6 توحيد كافة الشاشات والتقارير ولوحات التحكم
تم فحص وتحديث كل من:
1. `src/routes/_app.dashboard.tsx`: توحيد بطاقة إجمالي المصروفات من `fetchUnifiedExpenseMetrics`.
2. `src/routes/_app.analytics.tsx`: توحيد الرسم البياني والإحصائيات الشهرية واليومية للمصروفات من المستندات المرحلة.
3. `src/routes/_app.balance-sheet.tsx`: احتساب النقدية بالصندوق والتزامات المصروفات المستحقة غير المسددة (`expensePayables`).
4. `src/routes/_app.income-statement.tsx`: احتساب المصروفات التشغيلية وفق أساس الاستحقاق المحاسبي (المصروفات المرحلة بالفترة).
5. `src/routes/_app.trial-balance.tsx`: توجيه رصيد المصروفات في ميزان المراجعة من المستندات المرحلة.
6. `src/routes/_app.daily-journal.tsx`: قراءة الحركات اليومية من المستندات المرحلة.
7. `src/components/statements/operational-reports.tsx`: قراءة بنود المصروفات من `expense_lines` و `expense_entries`.
8. `src/components/statements/profit-sales-report.tsx`: قراءة إجمالي مصروفات الفترة من المستندات المرحلة.

---

## 3. التحقق والاختبار (Verification & Build Check)

1. **فحص الـ TypeScript (`npx tsc --noEmit`):**
   - تم التحقق من خلو المشروع تمامًا من أي خطأ تجميعي (0 Errors).
2. **بناء المشروع للإنتاج (`npm run build`):**
   - اكتمل البناء بنجاح تام وتم توليد حزم العميل والخادم وNitro دون أي أخطاء.
3. **التأكد من مبدأ مصدر الحقيقة الواحد:**
   - لا يوجد أي مسار في واجهة المستخدم يكتب الآن إلى جدول `public.expenses`.
   - جميع العمليات تتم عبر RPCs النظام الموحد (`create_expense`, `post_expense`, `record_expense_payment`).

---

## 4. الفروع والالتزامات (Git Commits & Push)

- العمل تم بالكامل على فرع الميزة المنفصل: `feature/expense-module-consolidation`.
- لم يتم المساس بفرع `main` وفقًا للتعليمات الصارمة.
