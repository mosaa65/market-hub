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
