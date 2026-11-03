# وحدة إدارة المصروفات — Expense Management Module

> **الحالة:** منفّذة. المرحلة 1 (قاعدة البيانات والأمن) و2 (الدوال الذرية) و3 (طبقة القراءة) و4 (ترحيل البيانات القديمة) و5 (الواجهة) مكتملة.

مرجع التصميم الكامل: [`EXPENSES_ERP_IMPLEMENTATION_PLAN.md`](./EXPENSES_ERP_IMPLEMENTATION_PLAN.md)

---

## 1. الملخّص

كانت المصروفات سابقًا **صفًا واحدًا** في `public.expenses`: مبلغ، تصنيف، طريقة دفع، تاريخ، ملاحظة. لا حالة، لا اعتماد، لا ترحيل، لا دفعات، ولا سجل تدقيق — وكان بإمكان أي موظف تعديل أو حذف أي صف مباشرة عبر واجهة Supabase.

الآن أصبحت **مستندًا محاسبيًا** كاملًا:

```
DRAFT → SUBMITTED → APPROVED → POSTED → PARTIALLY_PAID → PAID → CLOSED
                 ↘ REJECTED                 ↘ CANCELLED / REVERSED
```

مع بنود متعددة، ودفعات مستقلة، ومراكز تكلفة ومشاريع، وسجل زمني غير قابل للتعديل، وتجميع كل التقارير داخل PostgreSQL.

---

## 2. ما تغيّر — نظرة سريعة

| المفهوم | قبل | بعد |
|---|---|---|
| نموذج البيانات | صف واحد بمبلغ واحد | مستند (`expense_entries`) + بنود (`expense_lines`) + دفعات (`expense_payments`) |
| الحالة | لا توجد | enum بعشر حالات تفرضها قاعدة البيانات |
| التعديل | `UPDATE` مباشر من المتصفح | دالة ذرية تفحص الحالة والنسخة والدور |
| الحذف | `DELETE` مباشر | لا حذف بعد الإرسال؛ الإلغاء أو العكس |
| الاعتماد | غير موجود | خطوة واحدة مع منع اعتماد المُنشئ لمستنده |
| الترحيل المحاسبي | غير موجود | تثبيت المبالغ والتواريخ (لا يمكن تعديلها بعد الترحيل) |
| الدفع | حقل `payment_method` | صفوف دفعات بتاريخ ومصدر ومفتاح منع تكرار |
| مركز التكلفة والمشروع | غير موجودين | جداول مستقلة + ربط على مستوى البند |
| التقارير | `reduce()` في المتصفح | `SUM`/`GROUP BY` في PostgreSQL |
| الصلاحيات | `is_staff` فقط | مصفوفة أدوار `expense_can()` تُنفَّذ في قاعدة البيانات |
| الترحيل القديم | — | دالة قابلة لإعادة التشغيل مع مطابقة قبل/بعد |

---

## 3. ملفات قاعدة البيانات

### `supabase/migrations/20261001090000_expense_module_foundation.sql`

**الجداول الجديدة:**

| الجدول | الغرض |
|---|---|
| `expense_entries` | رأس المستند: الحالة، النوع، الأطراف، التواريخ، المبالغ، النسخة |
| `expense_lines` | البنود: تصنيف، كمية، سعر، صافي/ضريبة/إجمالي، أبعاد |
| `expense_payments` | الدفعات: مبلغ، تاريخ، طريقة، مصدر، مفتاح idempotency، العكس |
| `expense_approvals` | سجل الانتقالات (إضافة وقراءة فقط — لا تعديل) |
| `expense_attachments` | بيانات المرفقات (الملف في مخزن خاص — المرحلة التالية) |
| `expense_cost_centers` | مراكز التكلفة |
| `expense_projects` | المشاريع |

**إضافات على `expense_categories`:** `is_active` (أرشفة بدل الحذف)، `sort_order`، `notes`، `created_by`.

**دوال مساعدة:** `expense_round`, `expense_line_net`, `expense_line_tax`, `expense_settlement_status`.

**المحرّكات (Triggers):** مزامنة إجمالي المستند مع بنوده، اشتقاق المدفوع والحالة من الدفعات، ومنع تعديل الحقول المالية بعد الترحيل.

**الأمان:** قراءة لكل موظف نشط؛ لا يوجد `INSERT`/`UPDATE` مباشر للمستندات — كل التعديل عبر الدوال الذرية فقط.

### `supabase/migrations/20261001091000_expense_module_workflow_rpc.sql`

| الدالة | الدور |
|---|---|
| `create_expense` | إنشاء مستند كامل (رأس + بنود) في معاملة واحدة |
| `update_expense` | تعديل مسودة/مرفوض فقط، مع فحص النسخة |
| `submit_expense` | الإرسال للاعتماد بعد التحقق من الاكتمال |
| `decide_expense` | اعتماد أو رفض (مع منع اعتماد المُنشئ لمستنده) |
| `post_expense` | الترحيل، مع خيار السداد الفوري في نفس المعاملة |
| `record_expense_payment` | دفعة كاملة/جزئية، منع تجاوز المتبقي ومنع التكرار |
| `cancel_expense` | إلغاء ما قبل الترحيل بشرط وجود سبب |
| `reverse_expense` | إنشاء مستند عكسي معاكس (الأصل لا يُعدَّل) |
| `reverse_expense_payment` | عكس دفعة بصف معاكس مرتبط |
| `close_expense` | الإقفال بعد السداد الكامل |

### `supabase/migrations/20261001092000_expense_module_read_layer.sql`

| الدالة | الدور |
|---|---|
| `list_expenses` | صفحة واحدة مع كل الفلاتر، ترقيم **keyset** |
| `expense_detail` | رأس + بنود + دفعات + سجلات + مرفقات + **الصلاحيات** في نداء واحد |
| `expense_summary` | أرقام البطاقات محسوبة في SQL |
| `expense_report` | تقرير مُجمَّع (تصنيف/شهر/مستودع/مركز تكلفة/مشروع/جهة/حالة) |
| `expense_lookups` | كل قوائم النموذج والفلاتر في نداء واحد |
| `save_expense_category` / `delete_expense_category` | إدارة التصنيفات (أرشفة تلقائية عند الاستخدام) |
| `save_expense_dimension` | إدارة مراكز التكلفة والمشاريع |

### `supabase/migrations/20261001093000_expense_module_legacy_bridge.sql`

- `expense_legacy_reconciliation` — عرض مطابقة يعرض كم صفًا رُحّل وفرق الإجمالي **قبل** التنفيذ.
- `migrate_legacy_expenses(mode, from, to, batch, dry_run)` — ترحيل **قابل لإعادة التشغيل**:
  - آمن للتكرار (الصفوف المرحّلة تُتخطى عبر فهرس فريد على `legacy_expense_id`).
  - `mode = 'draft'` (الافتراضي) / `'unpaid'` / `'paid'`.
  - **يرفض تفسير `credit` كمدفوع** حتى في وضع `paid`.
  - `dry_run = true` ينفّذ كل العمل ثم يُلغيه، فيتحقق فعلًا قبل الكتابة.

---

## 4. ملفات الواجهة

```
src/lib/expenses/
  types.ts          عقود الأنواع المطابقة للـ SQL
  query-keys.ts     مفاتيح الكاش، بيانات الحالات، وأدوات المال والتاريخ

src/hooks/use-expenses.ts
  useExpenseLookups / useExpenseList / useExpenseDetail / useExpenseSummary / useExpenseReport
  useExpenseMutations  (create/update/submit/decide/post/pay/cancel/reverse/close)
  useExpenseRealtime   (اشتراك ضيّق + إبطال مُجمَّع)
  useExpenseCategoryMutations

src/components/expenses/
  expense-register.tsx        السجل: شريط الأدوات، الفلاتر السريعة، الجدول، الاختصارات، التصدير
  expense-summary-cards.tsx   بطاقات الملخص الخمس (تعمل كفلاتر بنقرة واحدة)
  expense-filter-sheet.tsx    درج الفلاتر المتقدم (VortexFilterSheet)
  expense-form.tsx            نموذج الإنشاء/التعديل بأربعة أقسام
  expense-detail-drawer.tsx   التفاصيل: البنود، الدفعات، السجل الزمني، وأزرار الدورة
  expense-status-badge.tsx    شارات الحالة والسداد

src/routes/_app.expenses.tsx  صفحة `/expenses`
```

**تم تعديله في المشروع القائم:**
- `src/lib/modules.tsx` — إضافة `/expenses` إلى وحدة `expenses` مع الإبقاء على `/finance`.
- `src/components/app-shell.tsx` — عنصر تنقّل جديد «المصروفات».
- `src/lib/i18n.tsx` — ~100 مفتاح ترجمة (عربي/إنجليزي).
- `src/components/ui/data-table.tsx` — إضافة الخاصية `rowProps` لتتبّع التمرير (بدون كسر أي جدول قائم).
- `src/lib/statements/adapters/cash.ts` — كشف الخزينة يقرأ الآن **الدفعات الفعلية** وليس `expenses.amount`، ويستثني الصفوف المرحّلة لمنع الاحتساب المزدوج.
- `src/routes/_app.finance.tsx` — زر للوصول إلى السجل الجديد.

---

## 5. قرارات التصميم المهمّة

**1. `/finance` لم يُحذف.** هذه الصفحة تعرض الذمم والموردين أيضًا؛ استبدالها في خطوة واحدة يضع تقريرين غير متعلقين في نفس المخاطرة. الصفحة الجديدة هي الموطن، والقديمة تعمل وتربط إليها.

**2. لا `INSERT`/`UPDATE` مباشر على المستندات.** `USING (is_staff(...))` لا تستطيع التعبير عن «الاعتماد من غير المُنشئ» لأنه شرط يخصّ صفّين. لذلك كل تعديل دالة ذرية، وهذا ما يجعل آلة الحالات حقيقية لا زخرفية.

**3. المبالغ تُشتق في قاعدة البيانات.** العميل يرسل الإجمالي كما كتبه المحاسب على الورقة، والصافي/الضريبة يُحسبان في `expense_write_lines`. النتيجة: لا يمكن أن يتباين الرأس مع البنود.

**4. الترقيم keyset لا OFFSET.** `OFFSET 50000` يجعل قاعدة البيانات تمرّ على 50 ألف صف وتتجاهلها. المؤشر `(expense_date, id)` يقرأ الصفحة المطلوبة فقط، فيبقى الأداء ثابتًا مع ملايين السجلات.

**5. Realtime لا يدمج الصفّ.** حمولة `postgres_changes` لا تحتوي الأسماء المربوطة (`supplier_name`, `primary_category`)، فدمجها يُفرغ الأعمدة حتى إعادة التحميل التالية. البديل: إبطال مُجمَّع (400ms) وإعادة جلب — طلب واحد لكل دفعة تغييرات، وصحيح دائمًا.

**6. الصلاحيات تأتي من قاعدة البيانات.** `expense_detail` يُعيد `can_edit`, `can_approve`, `can_post`… فلا يمكن أن يظهر زر لعملية يرفضها الخادم.

**7. `credit` لا يُفسَّر أبدًا كمدفوع.** الجدول القديم لا يميّز بين «دُفع نقدًا» و«اشتُري آجلًا»، والتخمين أسوأ من عدم الفعل. لذلك `migrate_legacy_expenses` يطلب الوضع صراحةً ويسجّله في سجل التدقيق.

---

## 6. التطبيق

طبّق ملفات الترحيل بالترتيب:

```bash
supabase db push
# أو يدويًا بالترتيب:
# 20261001090000_expense_module_foundation.sql
# 20261001091000_expense_module_workflow_rpc.sql
# 20261001092000_expense_module_read_layer.sql
# 20261001093000_expense_module_legacy_bridge.sql
```

ثم راجع المطابقة **قبل** أي كتابة:

```sql
SELECT * FROM public.expense_legacy_reconciliation;
```

ثم تجربة بلا كتابة:

```sql
SELECT * FROM public.migrate_legacy_expenses('draft', NULL, NULL, 500, true);
-- يُطلق استثناء DRY RUN يحمل الإحصاءات — لا يُكتب شيء
```

ثم الترحيل الفعلي:

```sql
SELECT * FROM public.migrate_legacy_expenses('draft', NULL, NULL, 500, false);
```

**التراجع:**

```sql
DELETE FROM public.expense_entries WHERE legacy_expense_id IS NOT NULL;
-- الحذف يتسلسل إلى البنود والدفعات والسجلات.
-- جدول public.expenses لم يُمسّ إطلاقًا.
```

---

## 7. ما لم يُنفَّذ بعد

مذكور صراحةً حتى لا يُفترض وجوده:

- **قيود اليومية المحاسبية.** لا يوجد `chart_of_accounts` أو `journal_entries` في المشروع؛ الترحيل يثبّت المستند لكنه لا ينشئ قيدًا مزدوجًا. هذه المرحلة التالية ومعتمدة على جدول حسابات لم يُبنَ بعد.
- **مرفقات الملفات.** الجدول والسياسات جاهزة؛ يتبقى ربط مخزن Supabase الخاص و`Storage policies`.
- **المصروفات المتكررة.** التصميم موثّق في الخطة (§13) ولم يُنفَّذ.
- **تعويضات الموظفين.** النوع `EMPLOYEE` والأطراف مدعومة، لكن لا يوجد ربط بالأجور لأن بنية HR غير موجودة.
- **شاشات التقارير.** دوال التجميع (`expense_report`, `expense_summary`) جاهزة ومستخدَمة في الواجهة، لكن صفحات `daily-journal` و`trial-balance` و`income-statement` ما زالت تحسب في المتصفح كما كانت — لم أغيّر سلوكها لأن ربطها بمنطق «مرحّل» يتطلب تسوية الرصيد التاريخي أولًا.
