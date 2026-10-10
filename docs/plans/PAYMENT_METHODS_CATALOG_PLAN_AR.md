# خطة تنفيذ نظام طرق الدفع الموحّد (Payment Methods Catalog)

> **المشروع:** Market Hub / VORTEX ERP
> **الفرع:** `feat/payment-methods-catalog`
> **المبدأ الحاكم:** طرق الدفع الأساسية يجهّزها المطورون، والعميل يختار منها فقط — لا ينشئ ولا يرفع أيقونات.

---

## 1. نتيجة تحليل الوضع الحالي

### 1.1 أين تُعرَّف طرق الدفع حاليًا

| الطبقة | الموقع | الشكل |
| :-- | :-- | :-- |
| قاعدة البيانات | `supabase/migrations/20260621011940_*.sql` | `CREATE TYPE public.payment_method AS ENUM ('cash','card','bank_transfer','credit')` |
| قاعدة البيانات | `20260706120000`, `20260706121000`, `20260707021000` | `ALTER TYPE ... ADD VALUE 'mobile_money'` |
| قاعدة البيانات | `20260929030000` | قيمة `'split'` مستخدمة فعليًا في منطق الدفع المجزأ (بلا قيمة Enum صريحة) |
| الواجهة | `src/routes/_app.pos.tsx` | Union مضمّن `"cash" \| "card" \| "mobile_money" \| "bank_transfer" \| "credit"` + `<select>` |
| الواجهة | `src/routes/_app.purchase-pos.tsx` | Union مضمّن + `<select>` |
| الواجهة | `src/routes/_app.purchases.tsx` | Union مضمّن + 4 أزرار `cash/card/bank_transfer/credit` |
| الواجهة | `src/routes/_app.sales-invoice.tsx` | `type PaymentMethod` + `<select>` |
| الواجهة | `src/routes/_app.sales.tsx` | `pmLabel` + `pmIcon` (خريطة أسماء وأيقونات محلية) |
| الواجهة | `src/routes/_app.returns.tsx` / `_app.sales-returns.tsx` / `_app.purchase-returns.tsx` | `<Select>` بـ 4 قيم — **قيمة `bank` غير موجودة في الـEnum** (تعارض) |
| الواجهة | `src/components/vortex-ui/finance/vortex-collection-sheet.tsx` | `PaymentMethod = "cash" \| "transfer" \| "card" \| "mobile_money"` + `<select>` |
| الواجهة | `src/components/expenses/expense-form.tsx` | `<select>` بـ 4 قيم |
| الواجهة | `src/components/expenses/expense-detail-drawer.tsx` | `<select>` بـ 4 قيم |
| الواجهة | `src/routes/_app.milling.jobs.tsx` | `<select>` بقيمة `cash` فقط |
| الواجهة | `src/hooks/use-financial-posting.ts` | `PaymentMethodType` + خريطة تحويل مختلفة (`transfer` → `bank_transfer`) |
| الواجهة | `src/routes/_app.analytics.tsx`, `_app.dashboard.tsx`, `_app.debts.tsx`, `_app.payments.tsx`, `_app.account-statement.tsx` | خرائط تسميات متفرقة (عرض فقط) |

### 1.2 أين تُخزَّن

- `sales_invoices.payment_method` (enum)
- `purchase_invoices.payment_method` (enum)
- `expenses.payment_method` (enum، default `cash`)
- `customer_payments.payment_method` (enum)
- `sales_returns.refund_method` / `purchase_returns.refund_method` (enum)
- `customer_payment_splits.method` (enum) — تفصيل الدفع المجزأ لكل وسيلة
- البيانات التجريبية: `docs/seed/*.sql`, `supabase/seeds/demo/*.sql` تستخدم نفس القيم

### 1.3 هل هي Enum أم قيم ثابتة أم جداول؟

- **Enum في قاعدة البيانات** + **قيم ثابتة مكرّرة في الواجهة**. لا يوجد جدول كتالوج، ولا أي تخصيص للعميل.
- لا توجد طريقة لتعطيل طريقة دفع، ولا لترتيبها، ولا لتخصيصها حسب القسم.

### 1.4 الثغرات والتعارضات المكتشفة

| # | المشكلة | الموقع |
| :-- | :-- | :-- |
| 1 | قيمة `bank` في واجهة المرتجعات لا وجود لها في الـEnum ⇒ `_refund_method::payment_method` يفشل | `_app.sales-returns.tsx:448`, `_app.purchase-returns.tsx:446` |
| 2 | خريطة التحويل في التحصيل تُحوّل `card` و `mobile_money` إلى `bank_transfer` وتفقد حقيقتها | `_app.customers.tsx:645`, `_app.debts.tsx:102` |
| 3 | حرس `record_customer_payment` يرفض أي طريقة غير `cash/card/bank_transfer/mobile_money` | `20260801090000:296` |
| 4 | حرس `create_sale` يرفض ما عدا `cash/card/bank_transfer/credit/mobile_money/split` | `20260929030000:281` |
| 5 | حرس تفصيل الدفع المجزأ يرفض ما عدا `cash/card/bank_transfer/mobile_money/split` | `20260929030000:634` |
| 6 | `create_purchase` و `create_sales_return` و `create_purchase_return` لا تحرس الطريقة لكنها تصبّها في Enum ⇒ تفشل بقيم جديدة | `20260929040000` |
| 7 | محرك الترحيل المحاسبي يفرّق بين الطرق بـ `IN ('bank_transfer','card','mobile_money')` فقط ⇒ أي طريقة يمنية جديدة تُرحَّل خطأً إلى الصندوق | `20261202000000`, `20261202000100`, `20261202000200`, `20261203000000` |
| 8 | ارتفاع الحقول و`<select>` متكرر في 8 أماكن بصيغ مختلفة | متعدد |
| 9 | لا يوجد Picker موحّد؛ POS يعرض `<select>`، المشتريات تعرض أزرارًا، المرتجعات تعرض Radix Select | متعدد |

### 1.5 منطق خاص بالدفع المجزأ / المرتجعات / التحصيل (يجب عدم كسره)

- **الدفع المجزأ:** `customer_payment_splits` + `create_sale(..., _payment_splits jsonb)`؛ الطريقة المسجّلة على الفاتورة = `split` عند تعدد الوسائل، أو وسيلة واحدة عند التفصيل بوسيلة واحدة.
- **المرتجعات:** `refund_method` يُسجَّل مباشرة، بدون حركة محاسبية تلقائية بعد.
- **التحصيل:** `record_customer_payment` يوزّع تلقائيًا على أقدم الفواتير المستحقة + يكتب في `customer_ledger`.
- **الدفع الآجل:** طريقة `credit` لها سلوك خاص (`paid = 0`، حالة الفاتورة `unpaid/partial`).

---

## 2. القرارات المعمارية

### 2.1 فصل مفاهيمي صارم

```text
payment_methods                      ← تعريف من المطورين (كاتالوج)
  id (stable text key)               ← 'cash', 'kuraimi_bank', 'jaib', ...
  name_ar / name_en
  icon_key                           ← مرجع مركزي لمكوّن أيقونة (ليس رابطًا ولا Base64)
  is_active                          ← يُدار من المطورين فقط (تعطيل طريقة على كل المنشآت)
  sort_order                         ← الترتيب الافتراضي بين المنشآت
  allowed_contexts text[]            ← السياقات التي يسمح المطورون بها
  ledger_kind                        ← 'CASH' | 'BANK' | 'WALLET' | 'CARD' | 'CREDIT' | 'OTHER'
  default_account_code               ← جاهزية مستقبلية للمحاسبة (nullable)
  is_credit_term / requires_reference
  legacy_values text[]               ← قيم الـEnum التاريخية المكافئة (توافق خلفي)

payment_method_settings              ← إعداد العميل لكل طريقة (Tenant Config)
  payment_method_id (FK)
  enabled
  sort_order                         ← ترتيب العرض للعميل
  enabled_contexts text[]            ← الأقسام المسموح بها للعميل
  default_account_id                 ← جاهزية مستقبلية
```

### 2.2 السياقات (Contexts)

`pos`, `sales`, `purchases`, `expenses`, `customer_collection`, `sales_returns`, `purchase_returns`

قابلة للتوسعة بإضافة قيمة نصية جديدة في الكتالوج + الترجمة فقط.

### 2.3 التوافق الخلفي (لماذا لا نكسر البيانات)

- **لا نحذف ولا نعدّل الـEnum.** كل قيم الـEnum الحالية (`cash, card, bank_transfer, credit, mobile_money, split`) مُثبَّتة أعلاه كـ`legacy_values` لطرق كتالوجية مكافئة.
- **الكتالوج يُخزَّن في جدول نصي جديد**، والـEnum يبقى كما هو ⇒ الفواتير القديمة والمدفوعات السابقة سليمة 100%.
- الـPickers تُنتج **نفس قيم الـEnum** التي تنتجها الواجهة اليوم ⇒ لا تغيير في `create_sale` / `record_customer_payment` / الـRLS.
- قيمة `bank` الشاذة في واجهة المرتجعات تُصلَّح إلى `bank_transfer` (وهذا إصلاح خطأ قائم لا تغيير سلوك).

### 2.4 جاهزية المحاسبة المستقبلية

- `ledger_kind` يُغني محرك الترحيل عن `IN ('bank_transfer','card','mobile_money')` الصريح.
- `default_account_code` حقل `text` NULL الآن يُملأ لاحقًا للربط بـ`public.accounts`.
- لا يُبنى أي GL/Journal/Chart of Accounts جديد — فقط الحقول الجاهزة.

### 2.5 الأداء و Caching

- مصدر واحد: `usePaymentMethods()` عبر React Query بمفتاح موحّد `["payment-methods","catalog"]` و `staleTime` طويل ⇒ طلب واحد لكل جلسة مهما تعدّدت أماكن الاستخدام.
- الأيقونات: مكوّن `PaymentMethodIcon` يستدعي `lucide-react` محليًا عبر `icon_key` ⇒ لا طلبات شبكة، لا Base64، لا تحميل خارجي، مع Fallback.
- التعديل من الإعدادات يُبطل المفتاح ⇒ تحديث فوري في كل الصفحات دون إعادة تحميل.

---

## 2.6 قرار التصميم النهائي: نسخة POS كما هي في main

**القرار:** المكوّن الموحّد هو `select` أصلي بنفس وصفة الفئات المستخدمة في نقطة البيع على `main`، حرفيًا — وليس إعادة تفسير لها:

| الخاصية | القيمة | مطابقة لـPOS |
| :-- | :-- | :-- |
| الارتفاع | `h-10` | ✅ |
| نصف القطر | `rounded-xl` | ✅ |
| الحدود | `border-border/80` | ✅ |
| الخلفية | `bg-surface` | ✅ |
| الخط | `text-xs font-semibold text-foreground` | ✅ |
| السهم | `ChevronDown` · `absolute end-3 h-4 w-4` · `text-muted-foreground` | ✅ |
| التركيز | `focus:border-primary focus:ring-2 focus:ring-primary/20` | ✅ |
| إخفاء سهم المتصفح | `appearance-none` | ✅ |

**لماذا `select` وليس بطاقات:** هو ما يستخدمه الكاشير فعلاً، ويدعم لوحة المفاتيح واللمس تلقائيًا، ويفتح مُنتقي النظام على الجوال، ويبقى صفًا واحدًا مهما كثرت الطرق المفعلة. شبكة البطاقات كانت ستُكبّر لوحة الدفع مع كل طريقة تُضاف — عكس ما يريده كاشير تحت ضغط الوقت.

**الإضافة الوحيدة:** أيقونة ثابتة في بداية الحقل (`start-3`) تُظهر شكل الطريقة المختارة، فيُعرف بنك الكريمي من شكله لا من قراءة اسمه. الأيقونة زخرفية — نص الخيار نفسه هو التسمية المقروءة لقارئ الشاشة.

**تسميات الخيارات:** تأتي من نفس مفاتيح `pos.pm.*` التي يشحنها النظام اليوم، فيبقى "نقدي" و"بطاقة" بمعناهما. أما المؤسسات المسمّاة (بنك الكريمي، جيب، فلوسك، ون كاش) فليس لها مفتاح، فتستخدم اسمها العربي من الكتالوج — وهذا ما يجعل عرضها ذا معنى أصلاً.

---

## 3. الملفات المزمع إنشاؤها/تعديلها

### جديدة

| الملف | الغرض |
| :-- | :-- |
| `supabase/migrations/20261206000000_payment_methods_catalog.sql` | جداول الكتالوج + إعدادات العميل + RLS + Seed idempotent |
| `src/lib/payments/payment-methods.ts` | التعريف المركزي في الواجهة: المعرفات، السياقات، الأيقونات، التسميات، الألوان |
| `src/hooks/use-payment-methods.ts` | مصدر واحد + caching + تحديث معرفي |
| `src/components/ui/payment-method/payment-method-picker.tsx` | المكوّن الموحّد |
| `src/components/ui/payment-method/payment-method-icon.tsx` | الأيقونة المركزية + Fallback |
| `src/components/ui/payment-method/index.ts` | التصدير |
| `src/components/settings/sections/payment-methods-section.tsx` | شاشة الإعدادات |
| `supabase/tests/payment_methods_acceptance.sql` | فحوصات القبول |

### معدّلة

`_app.pos.tsx`، `_app.purchase-pos.tsx`، `_app.purchases.tsx`، `_app.sales-invoice.tsx`، `_app.returns.tsx`، `_app.sales-returns.tsx`، `_app.purchase-returns.tsx`، `vortex-collection-sheet.tsx`، `expense-form.tsx`، `expense-detail-drawer.tsx`، `_app.milling.jobs.tsx`، `settings-registry.ts`، `i18n.tsx`، `_app.sales.tsx`/`_app.purchases.tsx` (تسميات)، وميجريشنات الترحيل المحاسبي الأربعة.

---

## 4. خطوات التنفيذ

1. ميجريشن الكتالوج + الـSeed + RLS.
2. تعديل مجزّئات الحراسة في الـRPCs لتقرأ من الكتالوج بدل القائمة الصريحة.
3. تعديل محرك الترحيل ليستخدم `ledger_kind`.
4. `src/lib/payments/payment-methods.ts` (التعريف المركزي).
5. `usePaymentMethods` + الطبقة المخزّنة.
6. `PaymentMethodPicker` + `PaymentMethodIcon` بتصميم POS الحالي.
7. قسم الإعدادات.
8. تحويل كل الأقسام للمكوّن الموحّد.
9. الفحوصات: TypeScript, Lint, Build, SQL acceptance.
10. التقرير النهائي.

---

## 5. معايير القبول

- [x] لا طريقة دفع مكتوبة يدويًا داخل أي صفحة.
- [x] طريقة معطّلة لا تظهر في أي Picker.
- [x] تخصيص مستقل لكل قسم.
- [x] الطرق القديمة في الفواتير السابقة تُعرض بأسمائها الصحيحة.
- [x] `create_sale` / `record_customer_payment` / المرتجعات تعمل بلا تغيير في نتائجها.
- [x] طلب شبكة واحد لطرق الدفع مهما تعدّدت الشاشات.

---

# 6. مراجعة التنفيذ الفعلية — 2026-10-08

> مراجعة مبنية على قراءة الكود لا على الخطة. لكل بند: ✅ منفَّذ · ⚠️ منفَّذ بخلاف الخطة · ❌ لم يُنفَّذ.
> أوامر التحقق الفعلية: `npx eslint` على ملفات الميزة = **0 أخطاء**، و`tsc --noEmit` لا يحمل أي خطأ في ملفات طرق الدفع.

## 6.1 ما تم تنفيذه فعلاً

| # | البند | الحالة | الدليل |
| :-- | :-- | :-- | :-- |
| 1 | جداول الكتالوج + إعدادات المنشأة + RLS + Seed | ✅ | `supabase/migrations/20261208000000_payment_methods_catalog_unified.sql` (2242 سطرًا) |
| 2 | توسيع الـEnum مع `split` و `cheque` بشكل idempotent داخل معاملة | ✅ | القسم 1 من نفس الملف |
| 3 | حارس كتابة موحّد `resolve_writable_payment_method` بدل 5 قوائم مضمّنة | ✅ | القسم 6 |
| 4 | محرك الترحيل يقرأ `ledger_kind` لا قائمة النصوص | ✅ | القسم 8 (`ledger_account_code_for_payment_method`) |
| 5 | `create_sale` (3 نسخ) + `record_customer_payment` + `create_sales_return` + `create_purchase_return` | ✅ | القسم 7 |
| 6 | التعريف المركزي في الواجهة | ✅ | `src/lib/payments/payment-methods.ts` (446 سطرًا) |
| 7 | مصدر واحد + Caching | ✅ | `src/hooks/use-payment-methods.ts` — مفتاح واحد `["payment-methods","catalog"]`، `staleTime` 30 دقيقة |
| 8 | `PaymentMethodPicker` + `PaymentMethodIcon` بتصميم POS | ✅ | `src/components/ui/payment-method/*` — نفس وصفة `h-10 / rounded-xl / border-border/80 / bg-surface` |
| 9 | شاشة الإعدادات + تسجيلها في السجل | ✅ | `payment-methods-section.tsx` + `settings-registry.ts:85-93` |
| 10 | فحوصات القبول | ✅ | `supabase/tests/payment_methods_acceptance.sql` (10 مجموعات تحقق) |
| 11 | إصلاح قيمة `bank` الشاذة في المرتجعات | ✅ | اختفت من مسارات الكتابة؛ صارت النتيجة `bank_transfer` عبر الكتالوج |
| 12 | إصلاح خريطة التحصيل التي كانت تحوّل `card`/`mobile_money` إلى `bank_transfer` | ✅ | `toLegacyPaymentValue` في `_app.customers.tsx:651` و`_app.debts.tsx:106` |
| 13 | كل الأقسام المذكورة في الخطة تحوّلت للمكوّن الموحّد | ✅ | POS، purchase-pos، purchases، sales-invoice، sales-returns، purchase-returns، milling.jobs، vortex-collection-sheet، expense-form، expense-detail-drawer |

**خلاصة:** الأساس كاملٌ ومتماسك. لا يوجد أي مسار كتابة ما زال يحمل قائمة طرق مضمّنة، وتصميم الحارس/الـSeed/التوافق الخلفي مطابق للقرارات المعمارية في القسم 2.

## 6.2 المخالفات: ما نُفِّذ بخلاف الخطة

| # | البند | الخطة تقول | المنفَّذ | الأثر |
| :-- | :-- | :-- | :-- | :-- |
| A | اسم ملف الميجريشن | `20261206000000_payment_methods_catalog.sql` | `20261208000000_payment_methods_catalog_unified.sql` | لا أثر — أنظف من الخطة لأنه ملف واحد بدل ملف + تعديلات لاحقة |
| B | العمود `legacy_values text[]` | جمع | مفرد `legacy_ids text[]` | لا أثر وظيفي؛ لكنه يفسّر سبب قراءة الواجهة `legacy_values?.[0]` |
| C | عدد الطرق في الفهرسة | 11 طريقة | 12 طريقة (أُضيف `cheque`) | إضافة مشروعة، لكنها **غير موثّقة في الخطة** |
| D | **إخفاء خانة المدى في الواجهة** | 12 طريقة كاملة | `PAYMENT_METHOD_CATALOG` = 11 فقط | ⚠️ انظر 6.3 |

## 6.3 الثغرات المتبقية (بترتيب الخطورة)

### 🔴 1. طريقة `cheque` موجودة في قاعدة البيانات وغائبة عن الواجهة
- الميجريشن يزرع `cheque` (شيك، `BANK`، يتطلب مرجعًا) ويرفع عدّ الفحص إلى 12.
- `PAYMENT_METHOD_CATALOG` في الواجهة **لا يحتوي `cheque`**.
- في المقابل `fetchPaymentMethods` يجلب الصفوف من قاعدة البيانات → تُنتج `legacyValue = 'cheque'`.
- **النتيجة:** عند تشغيل الميجريشن تظهر «شيك» تلقائيًا في كل منتقي (`isFallback = false`)، لكن:
  - لا أيقونة مخصّصة لها مسبقًا (تسقط على `bank-transfer` لأن `iconKey = 'bank-transfer'` — يعمل، لكنه غير مقصود)؛
  - لا تسمية من `pos.pm.*`؛
  - سلوك `legacyValue` في الواجهة مبنى على `legacy_ids[0]`، لذا أي ترتيب مستقبلي يقلب العمود يعطّل التحويل.
- **الإصلاح:** إضافة `cheque` إلى `PAYMENT_METHOD_CATALOG` بنفس قيمها في الـSeed.

### 🔴 2. `_app.milling.jobs.tsx` يمرّر معرّف كتالوج لا قيمة Enum
- المنتقي يعيد `'kuraimi_bank'`, `'jaib'` … (معرّفات كتالوج).
- يُمرَّر كما هو إلى `invoiceJobV2({ paymentMethod })` → `issue_milling_service_invoice_v2` → `create_sale(_payment_method, …)`.
- `resolve_writable_payment_method` يحلّ المعرّف ويعيد القيمة المخزّنة → **يعمل**، لكن كل شاشة أخرى تحوّل عبر `toLegacyPaymentValue` قبل الإرسال.
- **النتيجة:** عدم اتساق في العقد، وهشاشة عند أي تغيير لاحق. `_app.milling.jobs.tsx` لا يستورد `toLegacyPaymentValue` إطلاقًا.
- **الإصلاح:** `const dbMethod = toLegacyPaymentValue(paymentMethod)` في `InvoiceDialog`، أو التحويل داخل `invoiceJobV2`.

### 🟠 3. `use-financial-posting.ts` لم يُعدَّل — يحمل خريطة تحويل قديمة
- السطر 64-71: `if (method === "transfer" || method === "bank_transfer") dbMethod = "bank_transfer"` وإلا `cash`.
- نوع `PaymentMethodType` القديم (`"transfer"` ما زال موجودًا).
- في مسار العميل هذا **لا يضر** حاليًا لأن `record_customer_payment` تحلّ القيمة عبر الكتالوج (و`transfer` غير معرّف → تُرفض).
- لكنه في مسار المورد يُكتب مباشرة في `supplier_payments.payment_method` → أي معرّف كتالوج يُكتب خامًا في العمود.
- **الإصلاح:** تمرير `toLegacyPaymentValue(method)` في المسارين، وتقليص `PaymentMethodType`.

### 🟠 4. مسار المصروفات لا يحوّل المعرّف قبل الـRPC
- `expense-form.tsx:380` و`expense-detail-drawer.tsx:807` يمرّران `paymentMethod` كما خرج من المنتقي (معرّف كتالوج).
- `use-expenses.ts:454,493` يمرّره إلى `p_post_expense` / `p_record_expense_payment` بلا تحويل.
- **الأثر المؤكَّد:** أي معرّف جديد (`kuraimi_bank`) سيُرفض من الـRPC بخطأ تحويل، لأن هاتين الدالتين تأخذان `public.payment_method` ولم تُعدَّلا في الميجريشن الموحّد.
- **الإصلاح:** تحويل عبر `toLegacyPaymentValue` قبل الـRPC في `use-expenses.ts`.

### 🟡 5. مرشّح شاشة المشتريات يقارن قيم Enum بحالة المعرّف
- `_app.purchases.tsx:245,1117,1254`: `paymentMethod` تبدأ `"bank_transfer"` وتُرسل كما هي، والمرشّح `r.payment_method !== filters.payment_method`.
- المنتقي يخزّن معرّف كتالوج في التفاصيل، والفلاتر بقيم Enum → تعارض عند إضافة طرق جديدة.
- \*\*الإصلاح:\*\*استخدام `toLegacyPaymentValue` عند الإرسال ومقارنة موحّدة في الفلترة.

### 🟡 6. `split` لا يُعرض في أي منتقي (مقصود، لكن بلا إغلاق)
- `split` ليس وسيلة يختارها الكاشير — قرار صحيح. لكن لا يوجد مسار مسجَّل يضيف الدفعة المجزأة عبر الكتالوج في شاشة المبيعات، ما يعني أن الـSeed لقيمة `split` تخدم العرض التاريخي فقط.
- يستحق بندًا صريحًا في الخطة: «`split` للعرض والتسمية فقط، ولا يُقدَّم كخيار».

### 🟡 7. دالة التحويل `paymentMethodLabel` تعرف `credit` فقط من الانعكاس
- `paymentMethodLabel('credit')` تنتهي في `CATALOG_BY_LEGACY` (FIFO يكسر التعادل بـ`sortOrder`)، وهذا مضبوط لأن `credit` الاسم الأدنى.
- لكنها **لا تعرف `cheque`** بنفس السبب الوارد في البند 1.
- كما أن `_app.sales.tsx` لم تُحوَّل بالكامل: لا تزال تحتفظ بـ`pmIcon` بمفتاح `switch` يدوي (`Banknote`, `CreditCard`, `Landmark`, `Clock`…).
- **الإصلاح الأفضل:** استبدال `pmIcon` بـ`PaymentMethodIcon`.

### 🟡 8. `PaymentMethodChip` مُصدَّر ولا يُستعمل
- مكوّن قراءة مكتمل في `payment-method-picker.tsx:186` ومُصدَّر في `index.ts`، لكنه غير مُستدعى في أي شاشة.
- الشاشات تُكرّر تسمية العرض محليًا بدلًا منه: `_app.sales.tsx`، `_app.purchases.tsx`، `_app.payments.tsx`، `_app.debts.tsx`، `_app.account-statement.tsx`، و`_app.sales-returns.tsx:205` (يطبع `r.refund_method` خامًا!).

### 🟠 9. `_app.sales-returns.tsx:205` يعرض القيمة الخام
- الجدول يطبع `{r.refund_method ?? "cash"}` نصًّا — أي أن مستخدمًا يرى `bank_transfer` بدل «تحويل بنكي»، و`mobile_money` بدل «محوظة إلكترونية».
- هذا بالضبط ما تمنعه معايير القبول، وهو باقٍ فعلاً.

### 🟡 10. نوع المولّد `types.ts` متأخّر
- `src/integrations/supabase/types.ts` لا يعرف `payment_methods` ولا `payment_method_settings`.
- السبب أن الميجريشن لم يُطبَّق على المشروع بعد. هذا يفسّر استخدام `db` المكتوب يدويًا في الهوك.

### 🟡 11. التخزين المؤقت لا يُنظَّف عند تغيير الجلسة
- مفتاح `["payment-methods","catalog"]` غير مدرج في `SESSION_VARIANT_PREFIXES` (`src/lib/query-keys.ts:103`).
- الأثر ضعيف (الطريقة عامة لكل المنشآت)، لكن التخصيص (تفعيل/تعطيل) **خاص بالمنشأة** ويمكن أن يتسرّب بين جلسات مختلفة على نفس المتصفح.

## 6.4 ما لم يُنفَّذ صراحةً من الخطة

| البند | الحالة | ملاحظة |
| :-- | :-- | :-- |
| تحويل `_app.analytics.tsx` / `_app.dashboard.tsx` / `_app.account-statement.tsx` لتقرأ من الكتالوج | ❌ | الثلاثة لا تزال تحمل خريطة محلية (`_app.analytics.tsx:1150`, `_app.dashboard.tsx:71`, `_app.account-statement.tsx:418`) — تُسقط `mobile_money` و`cheque` |
| تحويل `_app.payments.tsx` / `_app.debts.tsx` | ❌ | لا تزال تسمية عرض محلية (`_app.payments.tsx:221`, `_app.debts.tsx:216`) |
| `src/lib/statements/format.ts:116` | ❌ | خريطة ثالثة تُستخدم في التقارير والتصدير عبر `reports-export.ts` |
| `_app.sales.tsx` — إزالة `pmIcon` اليدوي | ⚠️ جزئي | التسمية من الكتالوج، الأيقونة لا |
| `_app.milling.jobs.tsx` — الملف كان `<select>` بقيمة `cash` فقط | ⚠️ جزئي | تحوّل إلى المنتقي، لكن بلا تحويل معرّف (البند 2 أعلاه) |
| ربط `default_account_code` بحساب فعلي | ❌ متوقّع | مؤجّل بحسب القسم 2.4 (جاهزية فقط) — ليس نقصًا |

## 6.5 خطة الإغلاق المقترحة (مرتبة)

1. **إضافة `cheque` إلى `PAYMENT_METHOD_CATALOG`** بنفس `allowedContexts / ledgerKind / requiresReference` الواردة في الـSeed.
2. **إصلاح مسار الطحن:** `toLegacyPaymentValue` في `_app.milling.jobs.tsx` أو داخل `invoiceJobV2`.
3. **إصلاح مسار المصروفات:** تحويل المعرّف قبل `p_post_expense` / `p_record_expense_payment`.
4. **تعديل `use-financial-posting.ts`:** إزالة خريطة `transfer` والاعتماد على `toLegacyPaymentValue`، وإدراج `cheque` في `PaymentMethodType` أو حذف النوع القديم.
5. **إصلاح `_app.sales-returns.tsx:205`** ليعرض عبر `paymentMethodLabel`، وتبنّي `PaymentMethodChip` في جداول العرض.
6. **تحويل `_app.analytics.tsx` / `_app.dashboard.tsx` / `_app.account-statement.tsx` / `_app.payments.tsx` / `_app.debts.tsx` / `statements/format.ts`** إلى `paymentMethodLabel`.
7. **إصلاح فلترة `_app.purchases.tsx`** لتقارن القيمة المخزّنة.
8. **إضافة المفتاح إلى `SESSION_VARIANT_PREFIXES`** أو تصنيفه كمفتاح عام مستثنى صراحةً.
9. **تحديث `types.ts`** بعد تطبيق الميجريشن، وإضافة ملاحظة الإغلاق في `docs/plans`.
10. **إغلاق معايير القبول** المذكورة في القسم 5 أعلاه — بعضها مُعلَّم `[x]` وهو غير مستوفٍ عمليًا (البند 1 من معايير القبول: «لا طريقة دفع مكتوبة يدويًا داخل أي صفحة» غير صحيح حتى الآن).

---

# 7. طبقة التأليف — العميل يسمّي ويضيف، والمنصة تشرف (2026-10-09)

> هذا القسم يوسّع القرار المعماري في 2.1. الأساس لم يتغيّر: **الـEnum والقيمة المخزّنة ونوع الحساب تبقى محسومة من الكتالوج** — والتغيير أن **التسمية والأيقونة ملك المنشأة**، وأن **طريقة جديدة تُضاف من الإعدادات** بلا ترحيل.

## 7.1 ما كان ناقصًا في الخطة

الخطة قالت: «العميل لا ينشئ صفوفاً هنا؛ يختار ويفعّل فقط.» وهذا صحيح تمامًا لـ**عائلة التحصيل** — لكنه أنتج ثغرة عملية: منشأة تتعامل مع شركة صرافة محلية أو محفظة جديدة لم يكن لها أي مسار. النتيجة كانت أن العميل يكتب اسم المؤسسة داخل **ملاحظة الفاتورة**، فيضيع الاسم من التقارير ومن كل شاشة دفع.

## 7.2 القرار الجديد

| الطبقة | من يملكها | ما يتغيّر |
| :-- | :-- | :-- |
| `id` | المطورون (يُشتق تلقائيًا للعميل) | ثابت أبديًا؛ لا يأتي من المتصفح |
| `legacy_id` — القيمة المخزّنة | المطورون | **مجمّدة** على أي صف نظامي |
| `ledger_kind` — عائلة الحساب | المطورون | **مجمّدة**؛ تُشتق للعميل من `legacy_id` |
| `name_ar` / `name_en` | **المنشأة** | تعديل حر — صاحب المنشأة والمدير والسوبر أدمن |
| `icon_key` | **المنشأة** | تعديل حر من **قائمة مغلقة** — لا رفع ولا رابط |
| `sort_order` / `enabled` / `enabled_contexts` | المنشأة | كما كان |

**القاعدة في جملة:** الاسم والأيقونة لك. الحساب والقيمة المخزّنة للنظام. تعديل الاسم لا يحرّك قرشًا من البنك إلى الصندوق.

## 7.3 كيف توجد طريقة جديدة على Enum مغلق

الطريقة الجديدة **لا توسّع الـEnum**. تُعلن عن القيمة التي تُسوّى عليها:

```text
«شركة الأمين للصرافة»  →  legacy_id = 'bank_transfer'  →  BANK   →  الحساب 1111
«محفظة أم فلوس»        →  legacy_id = 'mobile_money'   →  WALLET →  الحساب 1111
```

وهذا **قيد حقيقي يجب قوله بصراحة**: المستند يخزّن `bank_transfer`، واسم المؤسسة يعيش في الكتالوج وفي المرجع الذي كتبه الكاشير.
مقابله: **لا شيء تاريخي يتحرك، ولا ترحيل بيانات لازمة، وفاتورة أمس تُرصّد كما هي اليوم.**

## 7.4 منع تصعيد الصلاحيات — الحمايات الفعلية

| # | الحماية | الموضع |
| :-- | :-- | :-- |
| 1 | صف نظامي: يُمنع تغيير `ledger_kind`, `legacy_id`, `is_system`, `is_active`, `legacy_ids` | `payment_methods_authoring_guard()` trigger |
| 2 | حذف صف نظامي ممنوع دائمًا — يُعطَّل بدلًا من ذلك | `payment_methods_delete_guard()` trigger |
| 3 | `INSERT` مباشر من الواجهة ممنوع؛ الإنشاء عبر RPC فقط | سياسة RLS `payment_methods tenant insert` |
| 4 | `DELETE` عبر PostgREST لسوبر أدمن المنصة فقط | سياسة RLS `payment_methods platform delete` |
| 5 | عائلة الحساب لا تأتي من العميل أبدًا — تُشتق من `legacy_id` | `create_tenant_payment_method()` |
| 6 | `split` و `credit` غير متاحين كقيم للإنشاء | نفس الدالة |
| 7 | حذف طريقة مستخدمة في مستندات قائمة → يُرفض برسالة عربية | `remove_tenant_payment_method()` |
| 8 | التعديلات كلها في `audit_logs` مع قبل/بعد ومن عدّلها | كل RPC |

**ملاحظة تصميم:** `can_author_payment_methods()` تشمل `owner` و`manager` و`is_platform_superadmin`. لا تُستخدم `is_platform_admin` وحدها هنا لسببين: (أ) `is_platform_admin` تحتاج قراءة `platform_admins` داخل سياسة، وهو ما يجعل سوبر أدمن بلا دور منشأة يفشل في الكتابة؛ (ب) المدير في هذا المشروع يدير الإعدادات فعلًا، وحصرها في المالك كان سيخرج عن العُرف القائم بلا مبرر.

## 7.5 الملفات

### جديد
| الملف | الغرض |
| :-- | :-- |
| `supabase/migrations/20261208000001_payment_methods_tenant_authoring.sql` | الأعمدة + الحمايات + 3 RPCs + تحديث `payment_method_legacy_id` و`catalog_view` |
| `src/components/ui/payment-method/payment-method-identity-editor.tsx` | تعديل الاسم والأيقونة + استعادة الاسم الأصلي |
| `src/components/ui/payment-method/add-payment-method-dialog.tsx` | إضافة طريقة: الاسم + الأيقونة + «كيف تُحصَّل؟» + الأقسام |

### معدّل
`payment-methods.ts` (12 طريقة بعد إضافة `cheque`، 19 أيقونة مباحة، `paymentMethodLabel` بطبقة overrides، `hasAuthoredIdentity`)
`use-payment-methods.ts` (`isSystem`/`isAuthored`، `usePaymentMethodOverrides`، 3 mutations)
`payment-method-picker.tsx` (التسمية تفرّق بين مفتاح POS والاسم المكتوب)
`payment-methods-section.tsx` (زر إضافة + محرر هوية + حذف + شارات)
`payment_methods_acceptance.sql` · الخطة · 10 ملفات إصلاح من القسم 6.

## 7.6 الثغرات المرصودة في القسم 6 — تم إغلاقها

| # | الثغرة | الحالة |
| :-- | :-- | :-- |
| 1 | `cheque` غائبة عن الواجهة | ✅ أُضيفت بالأيقونة `FileCheck2` وقيمة `cheque` صريحة |
| 2 | مسار الطحن يمرّر معرّف كتالوج | ✅ `toLegacyPaymentValue` داخل `invoiceJobV2` |
| 3 | المصروفات لا تُحوّل المعرّف | ✅ التحويل في `use-expenses.ts` (المساران) |
| 4 | `use-financial-posting.ts` بخريطة `transfer` قديمة | ✅ حُذفت؛ `PaymentMethodType` صار معرّف كتالوج صريحًا |
| 5 | `_app.sales-returns.tsx` يعرض القيمة الخام | ✅ `PaymentMethodChip` |
| 6 | 4 خرائط تسميات محلية | ✅ كلها من الكتالوج (`analytics` · `dashboard` · `account-statement` · `statements/format`) + `payments` · `debts` |
| 7 | فلترة المشتريات تقارن Enum بحالة المعرّف | ✅ الإرسال عبر `toLegacyPaymentValue` |
| 8 | مفتاح الطرق خارج تنظيف الجلسة | ✅ أُضيف `payment-methods` إلى `SESSION_VARIANT_PREFIXES` |
| 10 | واجهة الـ`split` بلا إغلاق | ⏳ **متبقٍ** — انظر 7.8 |
| 11 | `types.ts` لا يعرف الجدولين | ⏳ **متبقٍ** — بعد تطبيق الترحيل على المشروع |

## 7.7 فجوة مقصودة: أثر الطباعة

`luxury-print-preview-modal.tsx:83-84` يقرأ `layout.payment` كنص **جاهز** من قالب الطباعة، لا كقيمة مخزّنة. لذلك **اسم الطريقة المعدّل لا يظهر في معاينة الطباعة** ما لم يكن القالب يقرأ الاسم من الـ`meta` نفسها.

**الإصلاح المقترح (لم يُنفَّذ):** تمرير `paymentMethodLabel(meta.paymentMethod, lang)` عند بناء `layout` بدلًا من تمرير النص الخام، أو توسيع `layout.payment` ليقبل مفتاحًا بدل نص. لم أنفّذه لأن `layout` مشترك بين كل القوالب، وتغييره يستحق مراجعة مستقلة.

## 7.8 ما يتبقّى صراحةً

1. **`split`:** لم يُغلق بند 6.4.6 — لا يوجد قرار مكتوب بأن `split` **للعرض والتسمية فقط** ولا يُقدَّم كخيار في أي منتقي. القرار مطبَّق فعليًا في الكود (`allowedContexts: ['pos','sales']` ولا منتقي يعرضه) لكنه غير موثَّق كقرار.
2. **`types.ts`:** يعتمد على تطبيق الترحيل ثم `supabase gen types`. حتى ذلك الحين يعمل الهوك عبر `db` موثّق يدويًا، وهو نفس النهج المستخدم في وحدة الطحن.
3. **التحقق من قاعدة البيانات:** لم يُنفَّذ أي SQL فعليًا على قاعدة بيانات حقيقية — لا `psql` ولا `supabase` على الجهاز. الملفات مراجَعة سطريًا، وصياغة plpgsql تحقّقت يدويًا من تعارض أسماء المعاملات مع الأعمدة (أُصلحت في 4 مواضع)، لكن **التشغيل الفعلي لفحوصات القبول ما زال مطلوبًا** قبل الإنتاج.
4. **مفتاح `POS` في الاختبار البشري:** تسميات `pos.pm.*` لم تُختبر بصريًا مع طرق جديدة.

## 7.9 التحقق المنفَّذ
| الفحص | النتيجة |
| :-- | :-- |
| `npx tsc --noEmit` | الأخطاء 3 فقط وكلها **سابقة وغير متعلقة** (`luxury-print-preview-modal.tsx` · `universal-print-preview.tsx` · `vite.config.ts`) |
| `npx eslint` على 17 ملفًا | **0 مشكلة** |
| فحوصات القبول SQL | ⏳ لا يمكن تشغيلها على هذا الجهاز |

---

# 8. إغلاق مرحلي لخطة التكامل المالي (2026-10-09)

> نُفِّذت التغييرات التطبيقية أدناه كإغلاق جزئي آمن. هذا **ليس إعلان اكتمال الربط المحاسبي**: لا تزال هوية الطريقة المختارة غير محفوظة على كثير من المستندات التاريخية/الجديدة، والحساب الفعلي للمنشأة لا يمرّ بعد إلى جميع مسارات الترحيل.

## 8.1 ما تغيّر في هذه المرحلة
- شاشة إعداد طرق الدفع أصبحت تستخدم `TableToolbar` القياسي، والبحث بالاسم/المعرّف/عائلة التسوية/السياق، وفلاتر التفعيل والملكية والعائلة والسياق، والفرز، وعرض الشبكة والقائمة والجدول، وإجراء إضافة واحداً في الـToolbar. تبقى إعادة الترتيب تغييرات مسودة تحفظ وتُراجع قبل الكتابة.
- رُبطت ملفات SVG المحلية المؤكدة لفلوسك وون كاش وجيب عبر سجل مغلق بمعرّف الطريقة، مع fallback إلى أيقونة عائلة الحساب عند فشل تحميل الأصل. لم يُسنَد `purple-wallet.svg` إلى مزود لأن README لا يحدد هويته. README ينص كذلك على أن الملفات المحوّلة من صور مقدمة لا تمنح حق الاستخدام التجاري.
- حُوّلت طريقة التحصيل في `use-financial-posting` بقيمة ENUM من الدليل المركزي بدلاً من خريطة `transfer => bank_transfer` وإلا `cash`؛ وضُبطت أنواع العمليات المقبولة لتقتصر على التحصيل وتسجيل دفع المورد المدعومين في هذا hook. تمرير المرجع يُفحص من فواصل الأسطر، لكنه يبقى في عمود الملاحظات القديم ولا يعد حقلاً مرجعياً مستقلاً.
- عند فشل قراءة إعدادات المنشأة، يعرض مصدر طرق الدفع حالة fallback وتحذيرها بدلاً من اعتبار قائمة الإعدادات الافتراضية قراءة ناجحة.
- أُضيف اختبار وحدة لمعرّفات/قيم التوافق والشيك و`split` وأصول SVG المعروفة، إضافة إلى أمر `npm run test:payment-methods`.

## 8.2 تحقق محلي وفجوات معروفة
- ما زالت جداول العملاء/الموردين والمبيعات/المرتجعات القديمة تخزّن `payment_method` من نوع ENUM، ولا تحتفظ بصورة موحدة بـ`payment_method_id` لكل دفع/تخصيص؛ لذلك لا يجوز نسبة بنك محدد لسجل قديم يملك فقط `bank_transfer`.
- رغم وجود عمود `payment_method_settings.default_account_id`، فإن hook لا يستخدمه في واجهة الإعداد أو تدفق الكتابة/الترحيل المالي (الاستعلام الحالي لا يقرأه). كما أن `payment_method_ledger_account()` في migration تستعمل أكواداً افتراضية (`1101`/`1111`) ولا تتحقق من وجود حساب فعلي صالح للمنشأة. هذا **ليس** ربطاً بحساب دليل مالي حقيقي، ولا يثبت توازن كل مسارات القيود.
- حفظ الموردين ما زال إدراجاً مباشراً في `supplier_payments`، وبعض التحصيلات/الفواتير تُكتب مباشرة إلى جداول، ومسارات offline لا تزال تحمل enums قديمة ولا تمرر هوية الطريقة أو الحساب/التقسيم بشكل عام. ينبغي عدم ترقية هذا العمل إلى إطلاق محاسبي قبل forward migration غير هدّامة، ومراجعة تعارضات الإصدارات، وتصميم RPC ذرّي يحفظ معرف الطريقة والحساب وتخصيصات الدفع وسجل التدقيق، ثم اختباره على قاعدة محلية/نسخة معزولة.
- تكرار بادئة `20261009000000` لملف payment authoring وملف تنظيف بيانات، وتكرار `20261204000000` في ملفين آخرين؛ لم يتوفر سجل Supabase البعيد لإثبات التطبيق، لذلك لم يعدّل أي migration تاريخي ولم ينفذ `db push` أو SQL على بيئة مرتبطة.

## 8.3 جدول تدقيق المسارات المرصودة
| المسار | السياق والعملية | ما يصل إلى التخزين | الحساب/RPC | الحالة |
| :-- | :-- | :-- | :-- | :-- |
| `PaymentMethodPicker` والكتالوج المركزي | اختيار في POS/مبيعات/مشتريات/مصروفات/تحصيل/مرتجعات | معرّف الكتالوج داخل الواجهة؛ معظم حدود ENUM تحول إلى `legacyValue` | حسب RPC الشاشة؛ لا يُحفظ id في كل جدول | جزئي؛ API اختيار موحد لكن التخزين يفقد هوية المزود |
| `record_customer_payment` | تحصيل وربط دفعة بفواتير/دفعة مقدمة | `customer_payments.payment_method` كـENUM | RPC يوزع التحصيل على الفواتير ويكتب دفتر العميل؛ لا يتلقى account id أو payment id | متوافق للقديم، جزئي للجديد |
| `useFinancialPosting` المورد | دفع المورد | تحويل مركزي إلى ENUM ثم إدراج مباشر في `supplier_payments` | لا يثبت مسار قيد ذرياً في هذه الدعوة، ولا يحتفظ بمعرف الحساب | compatibility adapter جزئي |
| مصروفات `use-expenses` | مصروف/تسديد مصروف | adapter يحول قيمة الواجهة إلى ENUM | RPC المصروف الحالي؛ لا يوجد account id موحد على مستوى هوية طريقة الدفع | legacy-compatible؛ يلزم تتبع حسابات كل RPC قبل تعديلها |
| الطحن `invoiceJobV2` | فاتورة أجرة خدمة | يحول catalog id إلى ENUM عند حد RPC | `issue_milling_service_invoice_v2` ثم محرك المبيعات | adapter مقصود؛ هوية المزود لا تبقى على المستند |
| مرتجعات المبيعات/المشتريات | اختيار وكتابة/قراءة طريقة الرد | `refund_method` ENUM، العرض يمر من chip/formatter المركزي | حارس سياق المرتجع؛ لا يضيف القيد العكسي تلقائياً بمجرد قيمة الطريقة | العرض موحد؛ الترجيع المحاسبي غير مثبت هنا |
| الدفع المجزأ | POS ومبيعات | القيمة الإجمالية `split` وتفاصيل `customer_payment_splits.method` التاريخية | إيداع RPC البيع ومحرك القيود | `split` تسمية للقراءة/نتيجة تعدد tender فقط، ليس خياراً في picker؛ ضرورة التحقق من جميع payloads الفعلية |
| المصروف/التحصيل offline | queue/cache محلي | أنواع حمولة محدودة إلى ENUM، دون catalog id وحساب موحد | مزامنة queue إلى RPC/INSERT قديم | غير موحد؛ لم يتم الادعاء بحفظ هوية الطريقة عند offline |
| التقارير وكشف الحساب والطباعة | قراءة/export | يستعمل formatter مركزي في المسارات التي جرى تدقيقها؛ historic enum يعطي الاسم العام canonical | بلا كتابة أو ترحيل | قراءة متوافقة؛ لا يمكن استنتاج اسم مزود غير محفوظ |
| إعدادات الدفع | البحث/فلترة/ترتيب/عرض/إنشاء/تعطيل/إعادة تسمية | `payment_method_settings` وRPC التأليف | `default_account_id` لا يتم إعداده أو استخدامه فعلياً من الشاشة ولا يُقرأ من hook | UI إدارة محسّنة؛ ربط الحساب منتظر |

## 8.4 تعليمات النشر والتعليق
- لا تنفّذ migrations ولا acceptance SQL على قاعدة مرتبطة، ولا تصالح إصدارات migration الملتبسة، قبل جرد سجل التطبيق محلياً وعن بعد ونسخة احتياطية تخص قاعدة الهدف وموافقة صريحة.
- استيراد أصول العلامات المحلية من الملفات الموجودة لا يمنح ترخيصاً أو إذناً تجارياً. راجع المالك والحقوق قبل استخدام إنتاجي/تجاري.
- يظل التحقق البصري RTL/LTR عبر المتصفح، واختبار PostgreSQL acceptance، واختبار المحاسبة والتكرار/العكس، والتجهيز الرسمي لأنواع Supabase بعد نشر مصرح به، أعمالاً معلقة لا يدّعي هذا التوثيق تنفيذها.
