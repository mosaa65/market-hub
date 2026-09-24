# تقرير تنفيذ منظومة الكشوف الموحّدة — Market Hub

> **الفرع:** `feat/unified-statement-engine`
> **الحالة:** ✅ منفَّذ ومُتحقَّق منه بالبناء والاختبارات
> **قيد قاعدة البيانات:** ✅ **صفر تغيير** — تم التحقق (`git status supabase/` فارغ)
> **عدد الالتزامات:** 2

---

## 1. معيار النجاح — النتائج الفعلية

| #   | المعيار                              | الطريقة                     | النتيجة                                        |
| --- | ------------------------------------ | --------------------------- | ---------------------------------------------- |
| 1   | لا يوجد منطق حساب أرصدة داخل الشاشات | `grep 'runningBalance +=    | netBalance = totalDebit'`على`src/routes/*.tsx` | ✅ **صفر نتائج** |
| 2   | `npm run build` ينجح                 | `npm run build`             | ✅ `built in 12.60s` (3 مراحل)                 |
| 3   | اختبارات المحرّك خضراء               | `npm run test:statements`   | ✅ **81/81**                                   |
| 4   | صفر تغيير في قاعدة البيانات          | `git status supabase/`      | ✅ فارغ                                        |
| 5   | لا أخطاء ESLint في الملفات المعدّلة  | `npx eslint` على كل الملفات | ✅ صفر أخطاء                                   |
| 6   | TypeScript نظيف                      | `npx tsc --noEmit`          | ✅ لا أخطاء في كود الكشوف                      |
| 7   | الانتقال المباشر للمستند النهائي     | مراجعة المسار               | ✅ بلا شاشة معاينة                             |
| 8   | شارة فرق التسوية                     | قرار #1                     | ✅ ظاهرة في الجدول والبطاقة والطباعة           |
| 9   | وسم «سداد مرافق للفاتورة»            | قرار #2                     | ✅ مطبَّق لكشف المورد                          |
| 10  | كشف الخزينة/الصندوق                  | قرار #4                     | ✅ مبنيّ من الجداول الموجودة                   |
| 11  | قالب طباعة مستقل                     | قرار #5                     | ✅ `print.ts` + `print-styles.ts`              |
| 12  | `.ico` فقط بلا PNG جديد              | قرار #6                     | ✅ `/inama-soft-logo.ico`                      |

> **ملاحظة على `npm run lint` الشامل:** المستودع يحتوي **23,440** خطأ CRLF على الفرع الأساسي (نهايات أسطر Windows — مشكلة سابقة لا علاقة لها بالكشوف). بعد التعديلات انخفض العدد إلى **19,971**، لأن الملفات الجديدة كُتبت بـ LF. كل ملفات الكشوف تمرّ بصفر أخطاء.

---

## 2. ما تم بناؤه — طبقة المحرّك

| الملف                                     | الدور                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| `src/lib/statements/types.ts`             | العقد: `StatementRequest` · `StatementResult` · `LedgerEntry` · `StatementLayout` |
| `src/lib/statements/engine.ts`            | **المصدر الوحيد للأرصدة** — دالة نقية بلا React وبلا شبكة                         |
| `src/lib/statements/adapters/customer.ts` | قراءة `customer_ledger` + إثراء المراجع في نداءين (بلا N+1)                       |
| `src/lib/statements/adapters/supplier.ts` | اشتقاق حركات المورد + وسم «سداد مرافق للفاتورة»                                   |
| `src/lib/statements/adapters/cash.ts`     | كشف الخزينة من الدفعات والمشتريات والمصروفات                                      |
| `src/lib/statements/adapters/index.ts`    | سجل موحّد + توثيق الأنواع غير المدعومة (المندوب)                                  |
| `src/lib/statements/debts.ts`             | تجميع الديون من الحركات + أعمار FIFO                                              |
| `src/lib/statements/untyped.ts`           | طبقة قراءة معزولة للجداول الموجودة وغير المذكورة في `types.ts`                    |

### الطبقات

```text
adapters (قراءة)  →  engine (حساب نقي)  →  templates (وصف)  →  renderers (عرض/طباعة/CSV)
```

### المعادلة الموحّدة (كل الأنواع)

```text
openingBalance = Σ(debit - credit)  قبل from
runningBalance = openingBalance + Σ(debit - credit) حتى الصف
closingBalance = openingBalance + totalDebit - totalCredit
direction      = debit(+ مدين) | credit(- دائن) | zero
```

**الترتيب الحتمي** يحل مشكلة اختلاف الرصيد عند تساوي التاريخ:

```text
occurredAt → kindRank(sale=0, return=1, payment=2, adjustment=3, expense=4) → id
```

---

## 3. اكتشاف مهم أثناء التنفيذ: `types.ts` متأخر عن الـ migrations

`src/integrations/supabase/types.ts` ملف **مولَّد** ولا يحتوي:

- جدول `customer_ledger` (موجود في migration `20260912140000`)
- عمود `company_settings.catalog_modules` (موجود في migration `20260915020000`)
- العرضان `customer_ledger_balances` و `customer_balance_reconciliation`

**الحل المُتّبع:** طبقة عزل واحدة في `src/lib/statements/untyped.ts` تقرأ باسم جدول صريح — بلا أي تعديل على قاعدة البيانات وبلا تعديل على الملف المولَّد. نفس الأسلوب المستخدم سابقًا في المشروع في `(supabase.from as any)("customer_payments")`.

**توصية:** إعادة توليد `types.ts` من Supabase في مهمة منفصلة، ثم حذف `untyped.ts` — لا يؤثر على سلوك الكشوف.

---

## 4. ما تم بناؤه — طبقة العرض

| الملف                                                | الدور                                                                                   |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `settings.ts`                                        | تخصيص الحقول (اسم/إظهار/ترتيب) + عناوين + رأس/تذييل — localStorage + مزامنة JSONB موجود |
| `templates.ts`                                       | 5 قوالب تستهلك نفس `StatementResult` بلا أي حساب                                        |
| `format.ts`                                          | تنسيق موحّد يُعيد استخدام `money()` الموجودة                                            |
| `print-styles.ts` · `print-sections.ts` · `print.ts` | قالب A4 مستقل: رأس + جهة + ملخص + سطر افتتاحي + تحذير تسوية + توقيعات + هوية Inama Soft |
| `export.ts`                                          | CSV + HTML يُعيدان استخدام `excel-export.ts` بلا تعديل                                  |

### المكوّنات

- `statement-document.tsx` — المستند النهائي (شاشة تطابق المطبوع)
- `statement-summary-cards.tsx` — افتتاحي · مدين · دائن · ختامي
- `statement-transactions-table.tsx` — الجدول + «تحميل المزيد» عند تجاوز 200 صف
- `statement-integrity-badge.tsx` — شارة الفرق (نمط مدمج وموسّع) + شارة الاشتقاق
- `statement-export-dialog.tsx` — Report Builder مبسّط يفصح عمّا سيُصدَّر
- `statement-settings-card.tsx` — بطاقة التخصيص داخل الإعدادات

### الخطّافات

- `use-statement.ts` — جلب + حساب + كاش بمفتاح الجهة
- `use-debts-overview.ts` — مصدر واحد لأرصدة الديون (`useDebtIndex` للفهرس السريع)

---

## 5. الفرق العملي قبل/بعد

### كشف العميل

| البند            | قبل                                         | بعد                           |
| ---------------- | ------------------------------------------- | ----------------------------- |
| المصدر           | `sales_invoices` + `customer_payments` خامة | `customer_ledger` (الدفتر)    |
| الرصيد الافتتاحي | ❌ غير موجود                                | ✅ محسوب من ما قبل الفترة     |
| الرصيد الختامي   | ❌ `netBalance` مضلِّل                      | ✅ `opening + D - C`          |
| المرتجعات        | ❌ لا تظهر أبدًا                            | ✅ تظهر من الدفتر             |
| الترتيب          | `new Date()` فقط                            | ✅ حتمي (تاريخ → نوع → معرّف) |
| فلتر التاريخ     | ❌ غير موجود                                | ✅ نطاقات جاهزة + مخصص        |
| الفواتير المسددة | تُضخّم المجاميع                             | ✅ مخفية افتراضيًا            |
| مكان الحساب      | داخل React                                  | ✅ محرّك نقي مختبَر           |

### كشف المورد

| البند          | قبل                                  | بعد                                |
| -------------- | ------------------------------------ | ---------------------------------- |
| المعادلة       | `debit=paid, credit=total` بلا تفسير | ✅ اتجاه موثَّق `Σcredit - Σdebit` |
| المرتجعات      | ❌ لا تظهر                           | ✅ `purchase_returns` مُدرَجة      |
| السداد المُدمج | غير مُعلَّم                          | ✅ وسم «سداد مرافق للفاتورة»       |
| الدفعة الزائدة | تُهمَل                               | ✅ سطر مستقل «دفعة زائدة»          |

---

## 6. القرارات الست — كما نُفِّذت

| #   | القرار                          | التنفيذ                                                                                  |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | شارة تحذير واضحة لفرق المرتجعات | `StatementIntegrityBadge` بنمطين + بطاقة تحذير في الطباعة تشرح السبب المرجّح             |
| 2   | قبول كشف المورد بوسم            | `SUPPLIER_PAID_TAG_AR = "سداد مرافق للفاتورة"` + شارة «بيانات مُشتقة» مع Tooltip         |
| 3   | `catalog_modules` كحاوية JSON   | `syncSettingsToCloud()` تقرأ الحاوية ثم تدمج مفتاح `statements` — لا تمسح إعدادات الفهرس |
| 4   | كشف الخزينة الآن                | `adapters/cash.ts` + تبويب «الخزينة والصندوق» في منشئ الكشف                              |
| 5   | قالب طباعة مستقل                | `print.ts` لا يستدعي `printReport` — يخدم سطر الافتتاحي ودلالة الاتجاه وهوية Inama Soft  |
| 6   | الاكتفاء بـ `.ico`              | `/inama-soft-logo.ico` كـ fallback عند غياب `logo_url` — بلا ملف صورة جديد               |

### هوية Inama Soft في الكشف

```text
Inama Soft · Mousa Gamil Al-Awadhi · Ibb, Yemen
هاتف: +967 772 217 218 · inma-soft.vercel.app
```

مصدرها `inama-soft-footer.tsx` الموجود (تصدير `INAMA_SOFT_BRAND`)، وتُعرض في تذييل الطباعة والمستند، وتُخفى بمفتاح `footer.showBrandFooter`.

---

## 7. الاختبارات

`npm run test:statements` → **81 تأكيدًا في 20 مجموعة** على المحرّك النقي:

1. كشف فارغ · 2. حركة واحدة · 3. الرصيد الافتتاحي · 4. ثابت `closing = opening + D − C` (5 سيناريوهات) · 5. توافق الرصيد التراكمي · 6. دفعة جزئية · 7. فاتورة مسددة كليًا · 8. مرتجع · 9. ترتيب حتمي عند تساوي التاريخ · 10. فلتر شامل الطرفين · 11. `from > to` · 12. دقة عشرية (`0.1+0.2−0.05 = 0.25`) · 13. اتجاه المورد · 14. فرق التسوية · 15. بلا فلتر · 16. الفهرسة · 17. أعمار FIFO والدفعة الزائدة · 18. ترتيب الأنواع · 19. تسمية الفترة · 20. استخراج اليوم

> **لماذا سكربت بدل إطار اختبار؟** المشروع لا يحتوي test runner (لا vitest/jest)، وإضافة اعتمادية جديدة خارج نطاق المهمة. السكربت صفري الاعتماديات ويعمل بأمر واحد.

---

## 8. الأداء

- **لا N+1:** الحركات في نداء واحد + أرقام المراجع في نداء ثانٍ.
- **الحساب في `useMemo`:** لا حساب داخل JSX.
- **كاش React Query** بمفتاح الجهة — لا إعادة جلب عند التنقل.
- **«تحميل المزيد»** عند تجاوز 200 صف، مع بقاء الرصيد محسوبًا على كل الحركات.
- **`thead { display: table-header-group }`** لتكرار الترويسة على كل صفحة طباعة.

---

## 9. المخاطر المتبقية (خارج نطاق التنفيذ)

| #   | المخاطرة                                                                                                                               | الحالة                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| R1  | مرتجعات المبيعات تُخصم من `customers.balance` ولا تُقيَّد في `customer_ledger` — إصلاحها يتطلب تعديل `create_sales_return` = **ممنوع** | 🟡 مُدارة: الشارة تكشف الفرق، وتقرير `customer_balance_reconciliation` موجود للمطابقة |
| R2  | ترحيل الدفتر التاريخي يسجّل `total − paid` كقيد واحد                                                                                   | 🟡 مُوثَّق: البيان «ترحيل رصيد الفواتير السابقة» ظاهر في الكشف                        |
| R3  | `types.ts` المولَّد متأخر عن الـ migrations                                                                                            | 🟡 معزول في `untyped.ts` — يُحذف بعد إعادة التوليد                                    |
| R4  | لا يوجد دفتر موردين                                                                                                                    | 🟢 مقبول مع وسم صريح (قرار #2)                                                        |
| R5  | كشف المندوب غير ممكن                                                                                                                   | 🟢 موثَّق: لا كيان مندوب؛ المحرّك قابل للتوسّع بـ adapter واحد لاحقًا                 |

---

## 10. الملفات — الحالة النهائية

### جديد (20 ملفًا)

```text
src/lib/statements/{types,engine,format,settings,templates,debts,company,untyped,export}.ts
src/lib/statements/{print,print-styles,print-sections}.ts
src/lib/statements/adapters/{index,customer,supplier,cash}.ts
src/lib/statements/__tests__/engine.test.ts
src/hooks/{use-statement,use-debts-overview}.ts
src/components/statements/statement-{document,summary-cards,transactions-table,integrity-badge,export-dialog,settings-card}.tsx
src/routes/_app.statements.$entityType.$entityId.tsx
```

### معدَّل (7 ملفات)

```text
src/routes/_app.account-statement.tsx   ← منشئ كشف (حُذف loadStatement كاملًا)
src/routes/_app.debts.tsx               ← حُذف printStatement، الأرصدة من الدفتر
src/routes/_app.customers.tsx           ← حُذف printCustomerStatement
src/routes/_app.payments.tsx            ← زر الكشف + إجراء بعد الدفعة
src/routes/_app.settings.tsx            ← بطاقة تخصيص الكشوف
src/lib/modules.tsx                     ← تسجيل المسار الجديد
package.json                            ← سكربت test:statements
```

### غير معدَّل (كما في الخطة)

```text
supabase/**            ← 🚫 صفر تغيير (تم التحقق)
src/lib/pdf.ts         ← لم يُلمس: قالب الكشوف مستقل كما اخترت (قرار #5)
src/lib/excel-export.ts · format.ts · invoice-print.ts · catalog-modules.ts  ← مُعاد استخدامها
public/inama-soft-logo.ico  ← مُستخدَم كما هو (قرار #6)
```

---

## 11. الخطوات التالية المقترحة (اختيارية — خارج ما نُفِّذ)

1. **S9 الطباعة للمورد** — إضافة وسم «سداد مرافق للفاتورة» كعمود اختياري في جدول الطباعة عند تفعيله من الإعدادات.
2. **S10 توصيل التقارير** — `trial-balance` / `balance-sheet` / `finance` بـ `useDebtsOverview` بدل الأعمدة المخزَّنة، لتوحيد مصدر الأرصدة في كل النظام.
3. **كشف أعمار الديون المستقل** — المحرّك `buildAging()` جاهز ومختبَر؛ يحتاج فقط شاشة تعرضه.
4. **إعادة توليد `types.ts`** من Supabase ثم حذف `untyped.ts`.
5. **إصلاح R1** (قيد المرتجعات في الدفتر) — يتطلب قرارًا بتعديل `create_sales_return`، وهو مستثنى صراحة في هذه المرحلة.
