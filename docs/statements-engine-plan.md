# خطة تطوير منظومة الكشوف — Market Hub (Vortex ERP)

> **⏩ حالة التنفيذ:** نُفِّذت المراحل **S1–S8** كاملة على الفرع `feat/unified-statement-engine`.
> راجع **[تقرير التنفيذ](statements-implementation-report.md)** للنتائج والتحقق.
> ✅ صفر تغيير في قاعدة البيانات · ✅ 81/81 اختبارًا · ✅ `npm run build` ينجح.
>
> ---

> **نوع المستند:** Implementation Plan (مراجعة وموافقة قبل التنفيذ)
> **النطاق:** نظام الكشوف والتقارير المرتبطة بالحسابات فقط
> **قيد إلزامي:** **صفر تغييرات على قاعدة البيانات** — لا جداول، لا أعمدة، لا migrations، لا RPC، لا RLS، لا constraints.
> **الحالة:** لا يوجد أي كود معدَّل في هذه المرحلة. هذا المستند للاعتماد فقط.

---

## 0. ملخص تنفيذي

المشروع يحتوي حاليًا على **ثلاث شاشات على الأقل تحسب أرصدة بنفسها وبطرق مختلفة**، بالإضافة إلى منطق محاسبي مبعثر داخل JSX:

| الشاشة                                         | مصدر الحساب                                                                     | النتيجة                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `_app.account-statement.tsx`                   | تجميع `sales_invoices` + `customer_payments` في المتصفح، أو `purchase_invoices` | لا يوجد Opening/Closing، الترتيب هشّ، المورد محسوب بمعادلة مختلفة |
| `_app.debts.tsx`                               | `customers.balance` (عمود مُخزَّن) + جدول فواتير/دفعات منفصل                    | عرض مزدوج وغير متطابق مع الكشف                                    |
| `_app.customers.tsx`                           | تجميع فواتير + دفعات بمنطق ثالث مختلف                                           | كشف ثالث بمخرجات مختلفة                                           |
| `_app.balance-sheet.tsx` / `trial-balance.tsx` | `customers.balance` + `suppliers.balance`                                       | تعتمد على الكاش القديم                                            |

النتيجة العملية: **نفس العميل يعطي رصيدًا مختلفًا حسب الشاشة**. الهدف من هذه الخطة هو توحيد كل ذلك خلف **Statement Engine** واحدة مصدرها **الدفتر الموجود أصلًا في المشروع: `public.customer_ledger`**، دون لمس قاعدة البيانات.

> **ملاحظة أساسية مهمة:** المشروع يحتوي **بالفعل** على دفتر محاسبي حقي: جدول `public.customer_ledger` (created في `20260912140000_customer_ledger_and_credit_rules.sql`) مع `entry_type IN ('sale','payment','return','adjustment','credit')`، و`debit`/`credit`، و`occurred_at`، و`source_key` فريد للتدقيق، وعرض `customer_ledger_balances`، ودالة `customer_ledger_balance(uuid)`. **هذا الجدول لا يُقرأ من أي شاشة في الواجهة حتى الآن** (تم التحقق بالبحث: صفر نتائج لـ `customer_ledger` داخل `src/`). أي أن 70% من العمل المطلوب هو **توصيل الواجهة بالدفتر الموجود**، وليس بناء نظام جديد.

---

## Phase 0 — Repository Audit (جرد المستودع)

### 0.1 الملفات التي تم فحصها فعليًا

| الملف                                                                       | الدور الحالي                                                               |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `src/routes/_app.account-statement.tsx`                                     | شاشة الكشف الحالية (عميل/مورد) + طباعة + CSV                               |
| `src/routes/_app.debts.tsx`                                                 | شاشة الديون + كشف حساب HTML مكتوب يدويًا داخل الدالة                       |
| `src/routes/_app.customers.tsx`                                             | بطاقة العميل + Activity + كشف ثالث مكتوب يدويًا                            |
| `src/routes/_app.payments.tsx`                                              | تسجيل الدفعات عبر `record_customer_payment`                                |
| `src/routes/_app.finance.tsx`                                               | لوحة مالية + مدينون/دائنون من `balance`                                    |
| `src/routes/_app.trial-balance.tsx`                                         | ميزان مراجعة تقديري من نفس الأعمدة المخزَّنة                               |
| `src/routes/_app.balance-sheet.tsx`                                         | ميزانية عمومية تقديرية                                                     |
| `src/routes/_app.income-statement.tsx`                                      | قائمة دخل تقديرية                                                          |
| `src/routes/_app.daily-journal.tsx`                                         | دفتر يومية مُشتق في المتصفح                                                |
| `src/routes/_app.reports.tsx`                                               | تقارير مبيعات/مخزون                                                        |
| `src/routes/_app.analytics.tsx`                                             | تحليلات                                                                    |
| `src/routes/_app.suppliers.tsx`                                             | قائمة الموردين                                                             |
| `src/routes/_app.sales-returns.tsx` / `_app.purchase-returns.tsx`           | المرتجعات                                                                  |
| `src/lib/pdf.ts`                                                            | `printReport` + `printFinancialStatement` + `openPrintWindow`              |
| `src/lib/excel-export.ts`                                                   | `exportToCSV` + `exportToHTMLTable`                                        |
| `src/lib/format.ts`                                                         | `money()` + كاش `company_settings` في localStorage                         |
| `src/lib/invoice-print.ts`                                                  | قوالب الفاتورة (thermal / standard / elegant) — نمط قابل للتكرار للكشوف    |
| `src/lib/catalog-modules.ts`                                                | **النمط المرجعي** لحفظ إعدادات: localStorage + مزامنة `company_settings`   |
| `src/routes/_app.settings.tsx`                                              | مركز الإعدادات + نمط `Switch`/`Field` القابل لإعادة الاستخدام              |
| `src/components/inama-soft-footer.tsx`                                      | هوية Inama Soft (شعار + هاتف)                                              |
| `src/components/app-shell.tsx`                                              | الشعار `logo_url` من `company_settings` مع fallback `/inama-soft-logo.ico` |
| `supabase/migrations/20260912140000_customer_ledger_and_credit_rules.sql`   | **الدفتر + views + دالة الرصيد**                                           |
| `supabase/migrations/20260801090000_harden_sales_and_customer_payments.sql` | `create_sale` + `record_customer_payment` (كتابة الدفتر)                   |
| `supabase/migrations/20260912120000_...` / `20260912123000_...`             | كتابة قيد `sale` في الدفتر                                                 |

### 0.2 أوامر البحث المستخدمة لاكتشاف بقية المنطق

```
customer_ledger | balance | ledger | debit | credit | payment
customer | supplier | representative | report | export | print | preview
statement | opening | closing | running
```

**الاكتشاف الحاسم:** `customer_ledger` موجود في SQL فقط، **غير مستخدم في أي ملف `src/`**.

---

## Phase 1 — Current Statement Analysis (كيف تعمل الكشوف الآن)

### A. كشف العميل الحالي — `_app.account-statement.tsx` (سطور 95–196)

```text
1) SELECT sales_invoices (كل الفواتير، بلا فلتر تاريخ، بلا فلتر حالة)
2) كل فاتورة → Debit = total  ← (بما فيها الفواتير النقدية المدفوعة كليًا!)
3) SELECT customer_payments (كل الدفعات)
4) كل دفعة → Credit = amount
5) items.sort(by date)
6) runningBalance += debit - credit    ← يبدأ من صفر دائمًا
7) netBalance = totalDebit - totalCredit
```

- **مصدر البيانات:** الجداول الخام، لا الدفتر.
- **الفواتير:** كل الفواتير، بدون استثناء المرتجعات، وبدون استثناء الملغاة (`status = 'cancelled'`)، وبدون استثناء المدفوعة نقدًا.
- **المدفوعات:** `customer_payments` كما هي، بدون خصم أثر `sales_returns`.
- **Debit/Credit:** ثابتان (فاتورة = مدين، دفعة = دائن).
- **Running Balance:** `debit - credit` تراكمي من الصفر.
- **الترتيب:** `new Date(a.date)` فقط — عند تساوي التاريخ الترتيب غير مُعرَّف (فاتورة ودفعة نفس اليوم قد تظهر معكوسة).
- **Opening Balance:** ❌ غير موجود.
- **Closing Balance:** غير موجود كحقل؛ يُعرَض `netBalance` كـ «الرصيد المتبقي النهائي».
- **Returns:** ❌ غير مذكورة إطلاقًا → مرتجع المبيعات لا يظهر في الكشف أبدًا، لكنه يخصم من `customers.balance` → **فرق مؤكد**.
- **Partial payments:** تُعرض كدفعة مستقلة (صحيح)، لكن لا يوجد ربط يوضح أن الدفعة تخص الفاتورة إلا في `reference`.
- **Fully paid invoices:** تُعرض كمدين كامل + دائن كامل → تشويش بصري وتضخيم للمجاميع دون أثر على الرصيد.
- **فلتر التاريخ:** ❌ لا يوجد إطلاقًا.

### B. كشف المورد الحالي (نفس الملف، سطور 155–184)

```text
purchase_invoices → Debit = paid , Credit = total
```

- معادلة **معكوسة الاتجاه** عن العميل لكنها محسوبة بنفس `debit - credit` → الرصيد النهائي سالب بطبيعته.
- **دفعات الموردين غير موجودة كجدول** في قاعدة البيانات (لا `supplier_payments`) → ما يظهر كـ Debit هو `purchase_invoices.paid` فقط، وأي سداد لاحق على الحساب لا يمكن تسجيله.
- **مرتجعات المشتريات (`purchase_returns`) لا تظهر**، مع أنها تخصم من `suppliers.balance`.

### C. شاشة الديون — `_app.debts.tsx`

- الرصيد يُقرأ مباشرة من `customers.balance` (عمود cache).
- الفواتير تُعرض منفصلة، والدفعات منفصلة، و`printStatement()` (سطور 148–176) يبني **قالب HTML ثالث كامل** داخل الصفحة بمجاميع مختلفة (Total/Paid/Remaining بدل Debit/Credit/Balance).
- لا Opening Balance، ولا ترتيب زمني موحّد بين الفواتير والدفعات.

### D. بطاقة العميل — `_app.customers.tsx` (سطور 140–172 + 206+)

- منطق ثالث: `activity` = فواتير (kind=sale) + دفعات (kind=payment)، مُرتَّبة تنازليًا، والطباعة تُظهر `+amount` / `−amount` بدون رصيد تراكمي أصلاً.
- لا يستدعي `account-statement`، ولا يستخدم أي منطق مشترك.

### E. التقارير المحاسبية

`trial-balance` / `balance-sheet` / `income-statement` / `daily-journal` **كلها تحسب من الجداول الخام أو من أعمدة `balance` المخزَّنة**، وليست من الدفتر. لذلك أي إصلاح في الدفتر لن يظهر فيها تلقائيًا.

### F. مقارنة الاتجاه المحاسبي بين الشاشات

| المصدر                     | Debit                    | Credit           | دلالة الرصيد                           |
| -------------------------- | ------------------------ | ---------------- | -------------------------------------- |
| `customer_ledger`          | مديونية العميل (بيع آجل) | سداد/مرتجع       | `debit - credit > 0` = العميل مدين لنا |
| `account-statement` (عميل) | `invoice.total`          | `payment.amount` | متوافق لفظيًا لكن مصدره مختلف          |
| `account-statement` (مورد) | `invoice.paid`           | `invoice.total`  | **معكوس**                              |
| `debts`                    | —                        | —                | يعتمد `customers.balance`              |

> **الخلاصة:** لا يوجد «مصدر حقيقة» واحد. هناك 4 تعريفات مختلفة للرصيد.

---

## Phase 2 — المشاكل الحالية (تشخيص تفصيلي)

### 2.1 مشاكل معمارية

1. **منطق حسابي داخل React** — `loadStatement()` و`openDetail()` و`printStatement()` تحتوي على محاسبة، لا عرض.
2. **منطق مكرر 4 مرات** — كشف الحساب، الديون، بطاقة العميل، والطباعة اليدوية.
3. **عدم استخدام الدفتر** — `customer_ledger` موجود وموثّق ومُدقَّق (source_key) ومهجور من الواجهة.
4. **قالب طباعة مكتوب يدويًا داخل المكوّن** — في `debts.tsx` و`customers.tsx` سلسلة HTML ضخمة داخل سطر واحد (مستحيل صيانتها).
5. **لا فصل بين Engine و Template** — الشكل والبيانات في نفس المكان.

### 2.2 مشاكل دقة الأرقام (يجب التحقق منها قبل الإصلاح)

| #   | المشكلة                                                                                                                       | الأثر                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | فاتورة نقدية مدفوعة كليًا تظهر كمدين كامل في الكشف                                                                            | مجاميع مضخّمة، لكن الرصيد النهائي صحيح                                                           |
| 2   | **مرتجعات المبيعات لا تظهر في الكشف** لكنها تخصم من `customers.balance`                                                       | **اختلاف مؤكد بين الكشف وشاشة الديون**                                                           |
| 3   | ترحيل الدفتر التاريخي (`migration:sale:` سطر 64–69) يسجّل **`total - paid`** فقط                                              | فاتورة قديمة مدفوعة جزئيًا = قيد واحد بالمتبقي، وليس قيد بيع + قيد سداد → تاريخ الحركة غير مطابق |
| 4   | `record_customer_payment` يخصم `_amount` كاملًا من `customers.balance` (سطر 397)                                              | إذا كان جزء من الدفعة «دفعة مقدمة» (سطر 389–393) فقد يصبح الرصيد سالبًا                          |
| 5   | `create_sales_return` (النسخة الفعّالة) يخصم من الرصيد بـ `GREATEST(balance - total, 0)` **دون كتابة قيد `return` في الدفتر** | **الدفتر والرصيد المخزَّن يفترقان بعد أي مرتجع**                                                 |
| 6   | `create_purchase_return` لا يكتب أي دفتر                                                                                      | لا يوجد دفتر موردين أصلاً                                                                        |
| 7   | لا يوجد أي قيد `credit` أو `adjustment` يُكتب من أي مكان                                                                      | أنواع القيود المعرّفة غير مستخدمة                                                                |
| 8   | الفواتير بحالة `cancelled` تُدرَج في كشف الحساب                                                                               | مدين وهمي                                                                                        |
| 9   | `money()` يعتمد كاش localStorage للعملة                                                                                       | قالب الطباعة في نافذة جديدة قد يستخدم رمز عملة قديم                                              |

> **قرار مهم في الخطة:** المشاكل 3–7 هي مشاكل **كتابة** في قاعدة البيانات. الإصلاح الكامل لها يتطلب تعديل `create_sales_return` (أي تغيير Schema/RPC) وهو **ممنوع** في هذه المرحلة. لذلك نتعامل معها على مستويين:
>
> - **المستوى (أ) — داخل نطاقنا:** الـ Engine يحسب الافتتاحي والخِتامي من الدفتر، ويُظهر فرق التسوية إن وُجد.
> - **المستوى (ب) — خارج نطاقنا:** يُسجَّل كبند مخاطر (Risk) مع توصية بمطابقة/ترحيل يدوي لاحقًا (مثل استخدام شاشة كشف التسوية `customer_balance_reconciliation` الموجودة أصلاً).

---

## Phase 3 — Statement Engine Architecture

### 3.1 المبادئ

1. **مصدر واحد للحساب** — كل رقم في أي كشف يخرج من دالة واحدة.
2. **قابل للاختبار** — لا React، لا `supabase` داخل دالة الحساب النقية.
3. **قابل للتنبؤ** — نفس المدخلات = نفس المخرجات، ترتيب حتمي.
4. **مستقل عن العرض** — القالب يستهلك `StatementResult` فقط.
5. **بلا تغيير قاعدة بيانات** — قراءة فقط من الجداول الموجودة.

### 3.2 الطبقات

```text
┌──────────────────────────┐
│  Layer 1 — Statement Adapters (قراءة فقط من Supabase)     │
│  customer · supplier · (cash · expense لاحقًا)           │
│  المخرج: LedgerEntry[] خام موحّد                          │
└───────────────────────────┬──────────────────────────────┘
                            ▼
┌──────────────────────────┐
│  Layer 2 — Statement Engine (نقي، Pure، بلا I/O)          │
│  buildStatement(request, entries) → StatementResult      │
│  opening · debit/credit · running · totals · closing     │
└───────────────────────────┬──────────────────────────────┘
                            ▼
┌──────────────────────────┐
│  Layer 3 — Presentation Model (تسميات/ترتيب/إخفاء)        │
│  resolveStatementLayout(result, settings) → LayoutModel  │
└───────────────────────────┬──────────────────────────────┘
                            ▼
┌──────────────────────────┐
│  Layer 4 — Renderers (نفس الموديل 3 مخرجات)               │
│  OnScreenView · printStatementHTML · statementToCSV      │
└──────────────────────────┘
```

### 3.3 الأنواع (أسماء مقترحة، مبنية على أسلوب المشروع)

```ts
// src/lib/statements/types.ts
export type StatementEntityType = "customer" | "supplier" | "cash";

export type StatementEntryKind =
  | "sale" // بيع آجل
  | "payment" // سداد / تحصيل
  | "return" // مرتجع
  | "adjustment" // تسوية
  | "opening"; // سطر اصطناعي للرصيد الافتتاحي (لا يُخزَّن)

export interface LedgerEntry {
  id: string; // مفتاح فريد مستقر: `${source}:${id}`
  occurredAt: string; // ISO
  kind: StatementEntryKind;
  debit: number; // ≥ 0
  credit: number; // ≥ 0
  reference: string | null; // رقم فاتورة/سند
  description: string | null;
  referenceId: string | null;
  referenceType: string | null;
  meta?: Record<string, unknown>; // payment_method، warehouse، ...
}

export interface StatementRequest {
  entityType: StatementEntityType;
  entityId: string;
  from?: string | null; // YYYY-MM-DD
  to?: string | null; // YYYY-MM-DD
  includeZeroRows?: boolean; // إظهار الفواتير المسددة كليًا (افتراضي: لا)
}

export interface StatementTransaction extends LedgerEntry {
  runningBalance: number;
  index: number;
}

export interface StatementResult {
  entityType: StatementEntityType;
  entity: StatementEntity | null; // الاسم/الهاتف/العنوان/الحد الائتماني
  period: { from: string | null; to: string | null; label: string };
  openingBalance: number;
  transactions: StatementTransaction[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  direction: "debit" | "credit"; // اتجاه الرصيد النهائي (مدين/دائن)
  integrity: {
    ledgerClosing: number; // من الدفتر مباشرة
    cachedBalance: number | null; // customers.balance
    difference: number | null; // الفرق
    hasGap: boolean;
  };
  generatedAt: string;
}
```

### 3.4 معادلة الحساب (موحّدة لكل الأنواع)

```text
openingBalance  = Σ(debit - credit)  لكل الحركات حيث occurredAt < from
periodDebits    = Σ debit  للحركات داخل [from, to]
periodCredits   = Σ credit للحركات داخل [from, to]
runningBalance  = openingBalance + Σ(debit - credit) حتى الصف الحالي
closingBalance  = openingBalance + periodDebits - periodCredits
```

**اتجاه كل نوع:**

| النوع       | معنى `debit`          | معنى `credit`           | إشارة الرصيد الموجب     |
| ----------- | --------------------- | ----------------------- | ----------------------- |
| عميل        | العميل مدين لنا       | سدّد / أرجع             | **مدين لنا** (له علينا) |
| مورد        | سدّدنا للمورد / مرتجع | المورد دائن لنا (توريد) | **دائن علينا**          |
| صندوق/خزينة | وارد                  | صادر                    | رصيد نقدي               |

> **لا نفرض** `debit - credit` على المورد إن كانت مخرجات الدفتر معكوسة؛ الاتجاه يُحدَّد في الـ Adapter لكل نوع (سطر واحد) ويُختبَر.

### 3.5 الترتيب الحتمي (Deterministic Ordering)

```ts
sort(
  (a, b) =>
    a.occurredAt.localeCompare(b.occurredAt) || // 1) التاريخ
    kindRank(a.kind) - kindRank(b.kind) || // 2) البيع قبل السداد في نفس اللحظة
    a.id.localeCompare(b.id), // 3) مفتاح ثابت
);
// kindRank: sale=0, return=1, payment=2, adjustment=3
```

هذا يحل مشكلة «الرصيد يختلف بين شاشتين» الناتجة عن الترتيب العشوائي عند تساوي التاريخ.

---

## Phase 4 — Data Mapping (بدون أي تغيير في قاعدة البيانات)

### 4.1 مصادر الحقيقة المتاحة

| Entity              | المصدر الأساسي (موجود)                                      | المصادر المساعدة                                                                                            | ملاحظات                                                                                  |
| ------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **العميل**          | `public.customer_ledger`                                    | `customers` (الاسم/الهاتف/العنوان/الحد)، `sales_invoices` (رقم الفاتورة)، `customer_payments` (طريقة الدفع) | ✅ جاهز 100%                                                                             |
| **المورد**          | `purchase_invoices` + `purchase_returns`                    | `suppliers`                                                                                                 | ⚠️ لا يوجد دفتر موردين — نبني طبقة `supplier_entries` من الفواتير والمرتجعات (قراءة فقط) |
| **المندوب**         | ❌ لا يوجد                                                  | —                                                                                                           | لا حقل مندوب/`sales_rep_id` ولا جدول مناديب → **خارج النطاق** (تفصيل في Phase 5)         |
| **الصندوق/الخزينة** | `customer_payments` + `purchase_invoices.paid` + `expenses` | —                                                                                                           | ممكن ككشف إضافي لاحق (اختياري)                                                           |

### 4.2 تحويل `customer_ledger` → `LedgerEntry[]`

```ts
// src/lib/statements/adapters/customer.ts
const { data } = await supabase
  .from("customer_ledger")
  .select(
    "id, entry_type, debit, credit, occurred_at, note, reference_id, reference_type, source_key",
  )
  .eq("customer_id", entityId)
  .order("occurred_at", { ascending: true })
  .order("id", { ascending: true });

// mapping مباشر:
// entry_type 'sale'       → kind 'sale'      (debit)
// entry_type 'payment'    → kind 'payment'   (credit)
// entry_type 'return'     → kind 'return'    (credit)
// entry_type 'adjustment' → kind 'adjustment'
// entry_type 'credit'     → kind 'adjustment'
```

**العناصر المُثرية (enrichment) — استدعاء إضافي واحد فقط:**

```ts
// جلب أرقام المراجع لكل الحركات في نداء واحد (لا N+1)
// reference_type = 'sales_invoice'  → sales_invoices.invoice_number
// reference_type = 'customer_payment' → sales_invoices.invoice_number عبر invoice_id
```

يُستخدم `note` الموجود في الدفتر كـ **البيان** الافتراضي، فلا حاجة لبناء بيان من بنود الفاتورة (وهو ما تفعله الشاشة الحالية وتُثقل به الاستعلام).

### 4.3 تحويل المورد → `LedgerEntry[]` (طبقة مُشتقّة، قراءة فقط)

```ts
// src/lib/statements/adapters/supplier.ts
// 1) purchase_invoices  → kind 'sale'  (بمعنى: توريد)  credit = total  | debit = 0
//    + سطر إضافي اصطناعي للمدفوع: kind 'payment'  debit = paid
// 2) purchase_returns   → kind 'return'  debit = total
// 3) الرصيد = Σcredit - Σdebit   (اتجاه المورد)
```

**ملاحظة صريحة:** هذا الحل **يعمل** لكنه ليس مثاليًا — لأن `purchase_invoices.paid` قيمة تراكمية داخل الفاتورة، لا حركة سداد مؤرَّخة. أي أننا لا نعرف **تاريخ** كل سداد. البديل: عرض السداد بتاريخ الفاتورة مع وسم «سداد مرافق للفاتورة». أُدرِج هذا في قسم المخاطر كبند يحتاج قرارًا منك (انظر §Risks).

### 4.4 البيانات التي **لا يمكن** توفيرها من النظام الحالي

| البيانات                            | السبب                                                          |
| ----------------------------------- | -------------------------------------------------------------- |
| تاريخ كل سداد للمورد بشكل مستقل     | لا يوجد جدول سدادات موردين                                     |
| كشف حساب مندوب                      | لا يوجد كيان مندوب                                             |
| كشف حساب بنكي/صندوق تفصيلي          | لا يوجد جدول حركات خزينة                                       |
| تاريخ استحقاق الفاتورة (لعمر الدين) | لا يوجد حقل `due_date` → يُحسب عمر الدين من تاريخ الفاتورة فقط |
| مرتجع في دفتر العميل                | `create_sales_return` لا يكتب في `customer_ledger`             |

---

## Phase 5 — Statement Types (الكشوف الممكنة فعليًا)

| #   | الكشف                        | ممكن؟          | المصدر                                                      | الجهد |
| --- | ---------------------------- | -------------- | ----------------------------------------------------------- | ----- |
| 1   | **كشف حساب العميل**          | ✅             | `customer_ledger`                                           | منخفض |
| 2   | **كشف حساب المورد**          | ⚠️ ممكن بتحفّظ | `purchase_invoices` + `purchase_returns`                    | متوسط |
| 3   | **كشف حساب المندوب**         | ❌             | لا كيان مندوب                                               | —     |
| 4   | **كشف الديون / المستحقات**   | ✅             | `customer_ledger` مجمّعًا لكل عميل                          | متوسط |
| 5   | **كشف الحركة التفصيلي**      | ✅             | نفس الـ Engine                                              | منخفض |
| 6   | **كشف أعمار الديون (Aging)** | ✅             | `customer_ledger` + FIFO تخصيص                              | متوسط |
| 7   | **كشف الخزينة/الصندوق**      | ✅ اختياري     | `customer_payments` + `purchase_invoices.paid` + `expenses` | متوسط |
| 8   | **كشف مرتجعات العميل**       | ✅             | `sales_returns` (بدون دفتر)                                 | منخفض |

### 5.1 بخصوص كشف المندوب (نقطة إلزامية في طلبك)

بحثت بشكل مخصص عن `representative` / `sales_rep` / `salesman` / `مندوب` / `delegate` → **صفر نتائج** في `src/` وفي `supabase/`.
لا يوجد:

- عمود `sales_rep_id` في `sales_invoices` أو `customers`
- جدول مناديب أو مستخدمين مرتبطين بمبيعات
- نسبة عمولة أو حركة عهدة

**القرار:** لا نضيف كشف مندوب في هذه المرحلة. إضافته تعني إضافة عمود/جدول = مخالفة صريحة للقيد. لكن الـ Engine يُصمَّم بحيث `entityType` قابل للتوسّع، فإذا أُضيف كيان المندوب لاحقًا يكفي كتابة `adapter` واحد (ملف واحد) بدون تعديل القالب أو الواجهة.

---

## Phase 6 — Statement UI (تعديلات الشاشات)

### 6.1 شاشة الكشوف الجديدة `_app.account-statement.tsx`

**المطلوب:** تصبح **منشئ كشف (Statement Builder)** لا شاشة عرض. لا تحتوي أي منطق حسابي.

```text
┌─ إنشاء كشف ───────────────────────────────┐
│ نوع الكشف:  ( ) حساب عميل   ( ) حساب مورد   ( ) الديون     │
│ الجهة:      [ بحث/اختيار ]                                 │
│ من تاريخ:   [____]   إلى تاريخ: [____]   [آخر 30 يوم] [الكل]│
│ خيارات:     [x] تضمين الحركات المسددة   [x] إظهار الرصيد الافتتاحي│
│ القالب:     [ مفصّل ▾ ]                                    │
│                              [ إنشاء الكشف ]  ← زر أساسي    │
└────────────────────────────┘
```

- زر **«إنشاء الكشف»** → يحسب عبر الـ Engine → **ينتقل مباشرة إلى مستند الكشف النهائي** (Phase 8).
- إزالة جدول المعاينة الحالي من هذه الشاشة (نقل المسؤولية إلى `StatementDocument`).
- الحفاظ على `?customerId=` في الـ search params (روابط `customers.tsx` و`debts.tsx` و`payments.tsx` تعتمد عليه).
- الحفاظ على `ModuleGuard moduleId="payments"`.

### 6.2 شاشة الديون `_app.debts.tsx`

- حذف `printStatement()` (سطور 148–176) بالكامل.
- زر «كشف حساب» → `navigate({ to: "/account-statement", search: { customerId, autoGenerate: "1" } })`.
- الأرصدة: تبقى من `customers.balance` للعرض السريع، مع **شارة تحقق** صغيرة عند وجود فرق مع الدفتر (`integrity.hasGap`).
- المجاميع (`totals`) تبقى كما هي لكن مصدرها `useDebtsOverview()` hook جديد (استعلام واحد).

### 6.3 بطاقة العميل `_app.customers.tsx`

- حذف `printCustomerStatement()` اليدوي.
- زر «كشف الحساب» → نفس وجهة `debts.tsx`.
- الـ `activity` list تُستبدل بـ `useStatement` (نفس المصدر، نفس الأرقام).

### 6.4 `_app.payments.tsx`

- يبقى كما هو وظيفيًا (تسجيل دفعات).
- يضاف زر «عرض كشف الحساب» بعد نجاح الدفعة → ينقل مباشرة للمستند النهائي (مهم: المستخدم يريد أن يرى أثر الدفعة فورًا).

### 6.5 المكوّنات المشتركة

| مكوّن                        | نوع         | الغرض                            |
| ---------------------------- | ----------- | -------------------------------- |
| `StatementBuilderForm`       | جديد        | نموذج الفلاتر                    |
| `StatementDocument`          | جديد        | مستند الكشف النهائي (شاشة)       |
| `StatementSummaryCards`      | جديد        | الرصيد الافتتاحي/مدين/دائن/ختامي |
| `StatementTransactionsTable` | جديد        | جدول الحركات                     |
| `StatementIntegrityBadge`    | جديد        | شارة فرق التسوية                 |
| `useStatement()`             | جديد (hook) | جلب + حساب                       |
| `useDebtsOverview()`         | جديد (hook) | تجميع الديون                     |

---

## Phase 7 — Final Statement Template (قالب الكشف النهائي)

### 7.1 تصميم المستند

```text
╔══════╗
║  [شعار المنشأة]            كشف حساب عميل                    [شعار Inama]║
║  محل العدادات وقطع الغيار    كشف حركة حساب تفصيلي              Inama Soft║
║  صنعاء — اليمن 🇾🇪            الفترة: 01/01/2026 — 31/03/2026    📞 772217218║
║  📞 777123456 · الرقم الضريبي: 300-XYZ-001                                ║
╠══════╣
║  بيانات الحساب                          │  ملخص الفترة                     ║
║  الاسم:  أحمد محمد                      │  الرصيد الافتتاحي    12,500.00 ﷼ ║
║  الهاتف: 777000111                      │  إجمالي المدين        45,000.00 ﷼ ║
║  العنوان: صنعاء — شارع تعز              │  إجمالي الدائن        30,000.00 ﷼ ║
║  الحد الائتماني: 100,000.00 ﷼           │  الرصيد الختامي      27,500.00 ﷼ ║
║  الحالة: مدين                           │  (مدين — له علينا)               ║
╠══════╣
║ # │ التاريخ    │ المرجع   │ نوع العملية │ البيان          │  مدين  │ دائن │ الرصيد  ║
║───┼────────────┼──────────┼─────────────┼─────────────────┼────────┼──────┼─────────║
║ — │ 2026-01-01 │ —        │ رصيد افتتاحي│ رصيد ما قبل الفترة│    —   │   —  │ 12,500  ║
║ 1 │ 2026-01-08 │ INV-1042 │ فاتورة بيع  │ بيع آجل          │ 15,000 │   —  │ 27,500  ║
║ 2 │ 2026-01-12 │ RCP-0031 │ سداد        │ تحصيل نقدي       │    —   │ 5,000│ 22,500  ║
║ 3 │ 2026-02-02 │ SR-0007  │ مرتجع بيع   │ مرتجع بضاعة      │    —   │ 2,500│ 20,000  ║
╠══════╣
║  الإجماليات                               │  45,000.00 │ 37,500.00 │ 20,000.00 ║
╠══════╣
║  ملاحظات: .......................................................         ║
║                                                                          ║
║  المراجع والمدقق ──────   المحاسب المسؤول ──────   المدير العام ──────    ║
║                                                                          ║
║  طُبع بواسطة Market Hub · صدر بتاريخ 2026-03-31 14:20   ·  صفحة 1 من 1   ║
║  Powered by Inama Soft · 📞 +967 772 217 218 · inma-soft.vercel.app      ║
╚══════╝
```

### 7.2 الأعمدة الفعلية (بناءً على البيانات المتاحة)

| العمود           | المصدر                             | إظهار افتراضي                 |
| ---------------- | ---------------------------------- | ----------------------------- |
| `#`              | تسلسل                              | ✅ دائم                       |
| `التاريخ`        | `occurred_at`                      | ✅                            |
| `المرجع`         | `invoice_number` / `return_number` | ✅                            |
| `نوع العملية`    | `entry_type` مُترجَم               | ✅                            |
| `البيان`         | `customer_ledger.note`             | ✅                            |
| `مدين`           | `debit`                            | ✅                            |
| `دائن`           | `credit`                           | ✅                            |
| `الرصيد`         | `runningBalance`                   | ✅                            |
| `طريقة الدفع`    | `customer_payments.payment_method` | ⬜ اختياري                    |
| `المستودع`       | عبر الفاتورة                       | ⬜ اختياري                    |
| `الكمية/الأصناف` | ❌ لا يُدرج                        | يُزحم القالب بلا قيمة محاسبية |

### 7.3 ترويسة المنشأة + هوية Inama Soft

**الترويسة** تأتي من `company_settings` الموجود:
`name`, `legal_name`, `logo_url`, `address`, `phone`, `email`, `tax_number`, `currency_symbol`.

**هوية Inama Soft في التذييل** (كما طلبت) — تُبنى من نفس بيانات `inama-soft-footer.tsx` الموجودة أصلاً:

```text
Inama Soft · Mousa Gamil Al-Awadhi · Ibb, Yemen
📞 +967 772 217 218 · 🌐 inma-soft.vercel.app
```

- الشعار: `/inama-soft-logo.ico` (موجود في `public/`)، ويُستخدم كـ `fallback` عندما `company_settings.logo_url` فارغ — نفس منطق `app-shell.tsx` سطر 495.
- **ملاحظة تقنية:** ملف `.ico` يظهر في المتصفح لكنه غير موثوق في PDF المطبوع على بعض الطابعات. توصية: إضافة `public/inama-soft-logo.png` (ملف صورة جديد، ليس DB) واستخدامه في القالب مع fallback إلى `.ico`.

### 7.4 القوالب الافتراضية

| القالب               | المحتوى                                                             | لمن             |
| -------------------- | ------------------------------------------------------------------- | --------------- |
| `detailed` (افتراضي) | كل الأعمدة الأساسية + الرصيد الافتتاحي كسطر + توقيعات               | الكل            |
| `compact`            | تاريخ · مرجع · بيان · مدين · دائن · رصيد (بدون نوع عملية/طريقة دفع) | الطباعة السريعة |
| `customer`           | detailed + الحد الائتماني + الحالة الائتمانية                       | العملاء         |
| `supplier`           | detailed باتجاه المورد (`له` / `عليه` معكوسة)                       | الموردين        |
| `debts`              | جدول مستحقات مجمّع (بدون حركات)                                     | متابعة التحصيل  |

> **قاعدة صارمة:** كل هذه القوالب **استهلاك لنفس `StatementResult`**. القالب = `columns[] + labels + header/footer flags` فقط. لا حساب داخلها إطلاقًا.

---

## Phase 8 — Export Flow (الانتقال المباشر للمستند النهائي)

### 8.1 التدفق الحالي (يُلغى)

```text
اختيار → Generate → Preview Screen (جدول داخل الصفحة) → طباعة نافذة جديدة
```

### 8.2 التدفق الجديد (إلزامي)

```text
StatementFilters
      ↓
[ إنشاء الكشف ]
      ↓
navigate({ to: "/statements/$entityType/$entityId", search: {...} })
      ↓
StatementDocument  ←  مستند الكشف النهائي (شاشة كاملة)
      ↓
[طباعة / PDF]  [تصدير CSV]  [تعديل الفلاتر]
```

**نقاط التنفيذ:**

1. **مسار جديد** `src/routes/_app.statements.$entityType.$entityId.tsx` يعرض `StatementDocument` مباشرة.
2. الفلاتر تُنقل في الـ search params (`from`, `to`, `template`, `includeZero`, `autoGenerate`) → **الرابط قابل للمشاركة وإعادة التحميل** بدون إعادة اختيار.
3. **لا شاشة Preview منفصلة.** المستند النهائي هو أول شاشة بعد الضغط على الزر.
4. `autoGenerate=1` (قادم من `customers` / `debts` / `payments`) → يحسب فورًا بلا أي خطوة وسيطة.
5. أزرار الطباعة/التصدير تعيش **داخل** المستند، لا في الصفحة السابقة.

### 8.3 ترقية واجهة التصدير إلى Report Builder مبسط

بدل زر `Export`، لوحة تصدير تفصح عن كل شيء:

```text
┌─ تصدير الكشف ───────────────────┐
│ ما سيصدر:    كشف حساب عميل — أحمد محمد          │
│ الفترة:      01/01/2026 — 31/03/2026             │
│ عدد الحركات: 18 حركة                             │
│ القالب:      مفصّل  [ تغيير ]                    │
│ الأعمدة:     ☑ تاريخ ☑ مرجع ☑ بيان ☑ مدين ...    │
│ الصيغة:      ( ) طباعة A4  ( ) PDF  ( ) CSV     │
│                    [ تصدير ]                     │
└──────────────────┘
```

- يُعاد استخدام `printReport` الموجود في `src/lib/pdf.ts` (يحتوي ترويسة/توقيعات/تذييل جاهزة) — مع تمرير `company` و`columns` و`totalsRow`.
- يُعاد استخدام `exportToCSV` الموجود في `src/lib/excel-export.ts` بلا تعديل.
- إضافة `footerBrand` اختياري إلى `ReportPrintData` في `pdf.ts` لعرض هوية Inama Soft في المستندات المطبوعة (تعديل إضافي صغير، لا يكسر أي مستدعٍ قائم).

---

## Phase 9 — Statement Customization Settings (بدون Schema جديد)

### 9.1 آلية الحفظ — إعادة استخدام النمط الموجود

المشروع يستخدم **نمطًا قائمًا ومجرَّبًا** في `src/lib/catalog-modules.ts`:

```ts
localStorage  ←→  company_settings.catalog_modules  (عمود jsonb موجود)
```

**نعيد استخدامه حرفيًا:**

```ts
// src/lib/statement-settings.ts
const STORAGE_KEY = "vortex_statement_settings_v1";
// يُحفظ محليًا فورًا + يُزامَن إلى company_settings عبر عمود JSONB موجود
```

**الخيارات المتاحة بدون أي تغيير Schema (مرتَّبة بالأفضلية):**

| الخيار | الوصف                                                                                                           | المخاطرة                          | التوصية      |
| ------ | --------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------ |
| **أ**  | `localStorage` فقط                                                                                              | صفر — لا يلمس DB                  | ✅ المرحلة 1 |
| **ب**  | `localStorage` + مزامنة إلى `company_settings.catalog_modules` بوصفه حاوية JSON عامة (إضافة مفتاح `statements`) | منخفضة — العمود موجود و`jsonb` حر | ✅ المرحلة 2 |
| **ج**  | إضافة عمود `statement_settings jsonb`                                                                           | ❌ **ممنوعة**                     | 🚫           |

**قرار الخطة:** نبدأ بـ (أ) ثم (ب). إن اعترضت على استخدام `catalog_modules` كحاوية، نبقى على (أ) ونُصدِّر/نستورد الإعدادات كملف JSON يدويًا.

### 9.2 ما يمكن تخصيصه

| المجموعة             | الخيار                                                                                                                                         | مثال                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **أسماء الحقول**     | `labels.debit` → «مدين» أو «له»                                                                                                                | `{ debit: "مدين", credit: "دائن", balance: "المتبقي" }`                |
| **إظهار/إخفاء**      | `visible.reference`, `visible.description`, `visible.kind`, `visible.paymentMethod`, `visible.phone`, `visible.address`, `visible.creditLimit` | ✔/✘                                                                    |
| **ترتيب الأعمدة**    | `columnOrder: string[]` (سحب وإفلات)                                                                                                           | `["date","reference","kind","debit","credit","balance","description"]` |
| **اسم الكشف**        | `reportTitles.customer` / `.supplier` / `.debts`                                                                                               | «كشف حساب عميل» أو «كشف حركة حساب العميل»                              |
| **الرأس**            | إظهار الشعار، إظهار الاسم القانوني، إظهار الرقم الضريبي، إظهار العنوان/الهاتف، نص سطر إضافي                                                    | ✔/✘                                                                    |
| **التذييل**          | إظهار الإجماليات، إظهار الرصيد الختامي، إظهار التوقيعات، إظهار التذييل التقني، نص الملاحظات الافتراضي، إظهار هوية Inama Soft                   | ✔/✘                                                                    |
| **القالب الافتراضي** | `defaultTemplate`                                                                                                                              | `detailed`                                                             |
| **العملة**           | `currencySymbolOverride`                                                                                                                       | `﷼` (الافتراضي من `company_settings`)                                  |

### 9.3 مكان الواجهة

بطاقة جديدة **«تخصيص الكشوف»** داخل `_app.settings.tsx` — تُبنى بنفس مكوّنات الصفحة الموجودة (`Card`, `Switch`, `Field`, أزرار الاختيار المقسّمة) وتُقيَّد بـ `canEdit` الموجود.

---

## Phase 10 — Refactoring (توحيد المنطق المكرر)

### 10.1 خريطة الإحلال

```text
_app.account-statement.tsx  →  Statement Engine   (حذف loadStatement كاملًا)
_app.debts.tsx              →  Statement Engine   (حذف printStatement كاملًا)
_app.customers.tsx          →  Statement Engine   (حذف printCustomerStatement + activity)
_app.balance-sheet.tsx      →  useDebtsOverview   (اختياري — لاحقًا)
_app.trial-balance.tsx      →  useDebtsOverview   (اختياري — لاحقًا)
_app.finance.tsx            →  useDebtsOverview   (اختياري — لاحقًا)
```

### 10.2 مواضع الحساب التي ستُوحَّد

| الموقع                                                      | الأسطر  | الإجراء                             |
| ----------------------------------------------------------- | ------- | ----------------------------------- |
| `account-statement.tsx` `loadStatement()`                   | 95–196  | **حذف**                             |
| `account-statement.tsx` `totalDebit/totalCredit/netBalance` | 199–201 | **حذف** (تأتي من `StatementResult`) |
| `debts.tsx` `printStatement()`                              | 148–176 | **حذف**                             |
| `debts.tsx` `totals` useMemo                                | 130–137 | **نقل** إلى `useDebtsOverview`      |
| `customers.tsx` `openCustomer()`                            | 140–172 | **استبدال** بـ `useStatement`       |
| `customers.tsx` `printCustomerStatement()`                  | 206+    | **حذف**                             |

### 10.3 ما لا يُلمس في هذه المرحلة

- `pos.tsx`, `sales.tsx`, `purchases.tsx` (منطق إنشاء، خارج نطاق الكشوف)
- `create_sale`, `record_customer_payment`, `create_sales_return` (RPC — ممنوع تعديلها)
- أي جدول أو migration

---

## Phase 11 — Testing

### 11.1 Unit Tests (على الـ Engine النقي — بلا شبكة)

`src/lib/statements/__tests__/engine.test.ts`

| #   | الحالة                 | المُتوقع                                                                     |
| --- | ---------------------- | ---------------------------------------------------------------------------- |
| 1   | كشف فارغ               | `opening=0, totalDebit=0, totalCredit=0, closing=0, transactions=[]`         |
| 2   | حركة واحدة مدين        | `opening=0, closing=amount`                                                  |
| 3   | Opening Balance        | حركة قبل `from` + حركة داخلة → الافتتاحي = صافي ما قبل الفترة                |
| 4   | Closing Balance        | `closing === opening + totalDebit - totalCredit` (invariant يُختبر لكل حالة) |
| 5   | Running Balance        | آخر `runningBalance === closingBalance` دائمًا                               |
| 6   | دفعة جزئية             | تظهر كدائن، والرصيد ينقص بالمقدار الصحيح                                     |
| 7   | فاتورة مسددة كليًا     | `includeZeroRows=false` → لا تظهر؛ الرصيد لا يتأثر                           |
| 8   | مرتجع                  | يظهر كدائن ويخصم من الرصيد                                                   |
| 9   | حركتان بنفس التاريخ    | الترتيب حتمي: البيع قبل السداد، ثم `id`                                      |
| 10  | فلتر تاريخ             | حركة خارج الفترة لا تُحتسب في المدين/الدائن                                  |
| 11  | `from > to`            | نتيجة فارغة + لا انفجار                                                      |
| 12  | قيم عشرية              | لا أخطاء تقريب (rounding) عند 2 منازل                                        |
| 13  | اتجاه المورد           | الرصيد موجب = دائن علينا                                                     |
| 14  | `integrity.difference` | يظهر صحيحًا عند وجود فرق مع `customers.balance`                              |

### 11.2 Integration Tests

- `customer → adapter → engine`: بيانات حقيقية (Supabase محلي) لعميل فيه بيع + سداد + مرتجع → مطابقة الرصيد مع `customer_ledger_balance(customer_id)`.
- `supplier → adapter → engine`: مطابقة الرصيد مع `suppliers.balance` (مع تسجيل الفرق المتوقع).
- `settings → layout`: تغيير تسمية «مدين» → يظهر في الشاشة والطباعة و CSV.
- `export → template`: `printReport` يستقبل أعمدة القالب المخصصة فعلاً.
- `debts → statement`: رصيد شاشة الديون = `closingBalance` (مع شارة الفرق عند عدم التطابق).

### 11.3 Regression Tests

| الميزة             | معيار النجاح                                                   |
| ------------------ | -------------------------------------------------------------- |
| المبيعات / POS     | إنشاء فاتورة ينجح، الدفتر يُكتب كما كان                        |
| الدفعات            | `record_customer_payment` يعمل، الرصيد يتحدّث                  |
| المرتجعات          | لا تغيير في السلوك                                             |
| العملاء / الموردين | CRUD سليم                                                      |
| التقارير           | `reports`, `analytics`, `trial-balance` تفتح بلا أخطاء console |
| التصدير            | CSV يفتح في Excel بالعربية سليم                                |
| `npm run lint`     | يمر بصفر أخطاء جديدة                                           |

---

## Phase 12 — Performance

| البند                  | الحل                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| لا N+1                 | جلب الحركات في نداء واحد، وتجميع أرقام المراجع في نداء واحد ثانٍ                              |
| لا جلب زائد            | استعلام `customer_ledger` مفلتر بـ `customer_id` + `occurred_at` و`select` صريح (لا `*`)      |
| لا حساب ثقيل في render | الـ Engine يُنفَّذ داخل `useMemo` أو في hook، لا داخل JSX                                     |
| pagination             | الحركات تُعرض أول 500 صف، مع «تحميل المزيد» إذا لزم (الـ Engine يبقى يحسب الكل للرصيد)        |
| Opening Balance        | يُحسب من مصفوفة الحركات المُجلَبة (لا استعلام منفصل) — يقلل الرحلات                           |
| caching                | `useQuery` بمفتاح `['statement', entityType, entityId, from, to]` لمنع إعادة الجلب عند التنقل |
| طباعة كبيرة            | `@page` + `thead` يتكرر تلقائيًا على كل صفحة في قالب الطباعة (CSS موجود في `pdf.ts`)          |

---

## Phase 13 — Risks & Mitigations (المخاطر)

| #   | المخاطرة                                                                                                   | الخطورة   | التخفيف                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **مرتجعات المبيعات لا تُكتب في `customer_ledger`** → رصيد الدفتر يختلف عن `customers.balance` بعد أي مرتجع | 🔴 عالية  | الإصلاح الكامل يحتاج تعديل RPC = **ممنوع**. الحل: عرض `integrity.hasGap` + شارة تحذير، واستخدام شاشة `customer_balance_reconciliation` الموجودة أصلاً للمطابقة. **يحتاج قرارك.** |
| R2  | ترحيل الدفتر التاريخي يسجّل `total - paid` كقيد بيع واحد → تاريخ الحركة غير مطابق للفاتورة                 | 🟠 متوسطة | توثيق واضح؛ في الكشوف القديمة يظهر القيد بتاريخ الفاتورة مع البيان «ترحيل رصيد الفواتير السابقة» (موجود فعلاً في `note`)                                                         |
| R3  | `customers.balance` قد يصبح سالبًا (دفعات مقدمة)                                                           | 🟠 متوسطة | الـ Engine يعتمد الدفتر لا الكاش؛ يُعرض الفرق                                                                                                                                    |
| R4  | لا يوجد دفتر موردين → كشف المورد مُشتق من `purchase_invoices.paid` بلا تاريخ سداد                          | 🟠 متوسطة | قبول مؤقت + وسم «سداد مرافق للفاتورة» + توثيق القيد                                                                                                                              |
| R5  | `.ico` غير موثوق في PDF                                                                                    | 🟡 منخفضة | إضافة `public/inama-soft-logo.png` (ملف صورة، ليس DB) + fallback                                                                                                                 |
| R6  | مسار `_app.statements.$entityType.$entityId` جديد → تحديث `routeTree.gen.ts` تلقائيًا                      | 🟡 منخفضة | TanStack Router يولد الملف آليًا عند التشغيل                                                                                                                                     |
| R7  | المستخدمون معتادون على شاشة المعاينة القديمة                                                               | 🟡 منخفضة | الانتقال المباشر مطلوب صريحًا في المتطلبات + زر «تعديل الفلاتر» في المستند                                                                                                       |
| R8  | العملة من كاش localStorage قد تكون قديمة في نافذة الطباعة                                                  | 🟡 منخفضة | تمرير `currency` صريحًا من `company_settings` إلى قالب الطباعة                                                                                                                   |

---

## Phase 14 — Rollout (ترتيب تنفيذ آمن)

| المرحلة | المحتوى                                                                             | قابلة للتراجع؟                   |
| ------- | ----------------------------------------------------------------------------------- | -------------------------------- |
| **S1**  | `src/lib/statements/types.ts` + `engine.ts` (نقي) + اختبارات الوحدة                 | ✅ لا يلمس أي شاشة               |
| **S2**  | `adapters/customer.ts` + `adapters/supplier.ts`                                     | ✅ ملفات جديدة فقط               |
| **S3**  | `useStatement()` hook + `useDebtsOverview()`                                        | ✅ غير مستخدمة بعد               |
| **S4**  | `StatementDocument` + `StatementTransactionsTable` + `StatementSummaryCards`        | ✅ غير موصولة                    |
| **S5**  | مسار `_app.statements.$entityType.$entityId.tsx`                                    | ✅ مسار جديد معزول               |
| **S6**  | إعادة بناء `_app.account-statement.tsx` كمنشئ كشف                                   | ⚠️ الشاشة الأساسية — اختبار مكثف |
| **S7**  | توصيل `debts.tsx` و `customers.tsx` و `payments.tsx`                                | ✅ حذف كود ميت                   |
| **S8**  | `statement-settings.ts` + بطاقة الإعدادات في `settings.tsx`                         | ✅ افتراضيات آمنة                |
| **S9**  | تحسين قالب الطباعة + هوية Inama Soft + `public/inama-soft-logo.png`                 | ✅                               |
| **S10** | (اختياري) توصيل `trial-balance` / `balance-sheet` / `finance` بـ `useDebtsOverview` | ✅                               |

**بوابات الجودة قبل كل مرحلة:** `npm run lint` يمر + اختبارات الوحدة خضراء + لا خطأ console في الشاشة المعدّلة.

---

## Phase 15 — File-by-File Plan

| الملف                                                        | الإجراء                     | السبب                                                                        |
| ------------------------------------------------------------ | --------------------------- | ---------------------------------------------------------------------------- |
| `src/lib/statements/types.ts`                                | **Create**                  | أنواع `StatementRequest` / `StatementResult` / `LedgerEntry`                 |
| `src/lib/statements/engine.ts`                               | **Create**                  | دالة الحساب النقية — **المصدر الوحيد للأرصدة**                               |
| `src/lib/statements/adapters/customer.ts`                    | **Create**                  | قراءة `customer_ledger` → `LedgerEntry[]`                                    |
| `src/lib/statements/adapters/supplier.ts`                    | **Create**                  | اشتقاق حركات المورد من الفواتير والمرتجعات                                   |
| `src/lib/statements/format.ts`                               | **Create**                  | تنسيق التواريخ/الأرقام/تسميات أنواع القيود                                   |
| `src/lib/statements/__tests__/engine.test.ts`                | **Create**                  | اختبارات الوحدة                                                              |
| `src/lib/statement-settings.ts`                              | **Create**                  | إعدادات التخصيص (localStorage + مزامنة JSONB موجود)                          |
| `src/lib/statement-templates.ts`                             | **Create**                  | تعريف القوالب الخمسة (أعمدة + تسميات + أعلام)                                |
| `src/hooks/use-statement.ts`                                 | **Create**                  | جلب + حساب + caching                                                         |
| `src/hooks/use-debts-overview.ts`                            | **Create**                  | تجميع الديون لشاشة الديون والتقارير                                          |
| `src/components/statements/statement-builder-form.tsx`       | **Create**                  | نموذج الفلاتر                                                                |
| `src/components/statements/statement-document.tsx`           | **Create**                  | مستند الكشف النهائي (شاشة)                                                   |
| `src/components/statements/statement-transactions-table.tsx` | **Create**                  | جدول الحركات                                                                 |
| `src/components/statements/statement-summary-cards.tsx`      | **Create**                  | بطاقات الملخص                                                                |
| `src/components/statements/statement-integrity-badge.tsx`    | **Create**                  | شارة فرق التسوية                                                             |
| `src/components/statements/statement-export-dialog.tsx`      | **Create**                  | لوحة التصدير (Report Builder مبسط)                                           |
| `src/components/statements/statement-settings-card.tsx`      | **Create**                  | بطاقة التخصيص داخل الإعدادات                                                 |
| `src/routes/_app.statements.$entityType.$entityId.tsx`       | **Create**                  | **المستند النهائي — أول شاشة بعد الإنشاء**                                   |
| `src/routes/_app.account-statement.tsx`                      | **Modify**                  | تحويلها لمنشئ كشف + حذف منطق الحساب والجدول                                  |
| `src/routes/_app.debts.tsx`                                  | **Modify**                  | حذف `printStatement` + استخدام `useDebtsOverview`                            |
| `src/routes/_app.customers.tsx`                              | **Modify**                  | حذف كشف الطباعة اليدوي + استخدام `useStatement`                              |
| `src/routes/_app.payments.tsx`                               | **Modify**                  | إضافة زر «عرض الكشف» بعد الدفعة                                              |
| `src/routes/_app.settings.tsx`                               | **Modify**                  | إضافة بطاقة «تخصيص الكشوف»                                                   |
| `src/lib/pdf.ts`                                             | **Modify**                  | إضافة `footerBrand` اختياري + دعم شعار في الترويسة (إضافي، لا يكسر مستدعيًا) |
| `src/lib/i18n.tsx`                                           | **Modify**                  | مفاتيح ترجمة جديدة للكشوف والقوالب                                           |
| `src/lib/format.ts`                                          | **Reuse**                   | `money()` كما هي                                                             |
| `src/lib/excel-export.ts`                                    | **Reuse**                   | `exportToCSV()` كما هي                                                       |
| `src/lib/invoice-print.ts`                                   | **Reuse**                   | النمط المرجعي للقوالب (لا تعديل)                                             |
| `src/lib/catalog-modules.ts`                                 | **Reuse**                   | النمط المرجعي لحفظ الإعدادات (لا تعديل)                                      |
| `src/components/inama-soft-footer.tsx`                       | **Reuse**                   | مصدر بيانات هوية Inama Soft (شعار/هاتف/عنوان)                                |
| `src/components/app-shell.tsx`                               | **No Change**               | لا علاقة                                                                     |
| `src/routes/_app.returns.tsx`                                | **No Change**               | مجرد redirect                                                                |
| `src/routes/_app.balance-sheet.tsx`                          | **No Change** (S10 اختياري) | خارج النطاق المباشر                                                          |
| `src/routes/_app.trial-balance.tsx`                          | **No Change** (S10 اختياري) | خارج النطاق المباشر                                                          |
| `src/routes/_app.finance.tsx`                                | **No Change** (S10 اختياري) | خارج النطاق المباشر                                                          |
| `src/routes/_app.daily-journal.tsx`                          | **No Change**               | دفتر يومية مختلف الغرض                                                       |
| `src/routes/_app.analytics.tsx` / `_app.reports.tsx`         | **No Change**               | تقارير غير حسابية                                                            |
| `src/integrations/supabase/types.ts`                         | **No Change**               | لا تغيير Schema = لا إعادة توليد                                             |
| `supabase/**`                                                | **No Change** 🚫            | **ممنوع منعًا باتًا**                                                        |
| `public/inama-soft-logo.png`                                 | **Create**                  | أصل صورة للطباعة (ليس DB)                                                    |

> **تأكيد صريح:** كل بنود **Create** هي ملفات كود/أصول فقط. **لا جدول، لا عمود، لا migration، لا RPC، لا RLS.**

---

## Phase 16 — الممنوعات (Non-Negotiables)

🚫 إنشاء migrations أو تعديل Schema
🚫 إضافة جداول/أعمدة/علاقات/constraints
🚫 تعديل `create_sale` / `record_customer_payment` / `create_sales_return` / `create_purchase_return`
🚫 إنشاء دفتر جديد — `customer_ledger` كافٍ
🚫 تكرار منطق الكشف في أي شاشة
🚫 بناء نظام محاسبي من الصفر
🚫 إعادة بناء المشروع أو تغيير UI خارج نطاق الكشوف
🚫 اختراع حقول غير موجودة أو إضافة بيانات وهمية
🚫 كشف حساب مندوب (لا يوجد كيان مندوب)

---

## Phase 17 — معيار النجاح

```text
قاعدة البيانات الحالية (بلا تغيير)
        ↓
customer_ledger / purchase_invoices + purchase_returns
        ↓
Statement Engine موحّد (دالة نقية واحدة)
        ↓
StatementResult مُطبَّع
        ↓
مكوّنات عرض قابلة لإعادة الاستخدام
        ↓
قالب كشف قابل للتخصيص (5 قوالب)
        ↓
طباعة / PDF / CSV
```

```text
واجهة المستخدم:
فلاتر الكشف → [إنشاء الكشف] → المستند النهائي مباشرة → طباعة/PDF/تصدير
```

```text
الإعدادات:
Settings → تخصيص الكشوف
   ├── أسماء الحقول
   ├── إظهار/إخفاء الحقول
   ├── ترتيب الأعمدة
   ├── اسم التقرير
   ├── خيارات الرأس
   └── خيارات التذييل (يشمل هوية Inama Soft)
```

**مؤشرات قبول قابلة للقياس:**

1. رصيد كشف الحساب = رصيد شاشة الديون لنفس العميل (أو ظهور شارة فرق مفسّرة).
2. لا يوجد أي `reduce((a, i) => a + i.debit ...)` داخل أي ملف `routes/`.
3. زر «إنشاء الكشف» ينقل مباشرة إلى المستند النهائي — بلا شاشة معاينة وسيطة.
4. تغيير تسمية «مدين» في الإعدادات يظهر في الشاشة والطباعة و CSV.
5. `npm run lint` يمر + كل اختبارات الوحدة خضراء.
6. `supabase/migrations/` بلا أي ملف جديد.

---

## Phase 18 — قرارات تحتاج موافقتك قبل التنفيذ

| #   | القرار                                                        | الخيارات                                         |
| --- | ------------------------------------------------------------- | ------------------------------------------------ |
| 1   | **R1 — فرق المرتجعات:** نعرض شارة فرق أم نُخفي الفرق؟         | (أ) شارة تحذير واضحة ✅ موصى به · (ب) صامت       |
| 2   | **كشف المورد:** نقبله مُشتقًا بلا تاريخ سداد دقيق؟            | (أ) نعم مع وسم ✅ · (ب) نؤجل كشف المورد          |
| 3   | **حفظ الإعدادات:** نستخدم `catalog_modules` كحاوية JSON؟      | (أ) نعم ✅ · (ب) localStorage فقط                |
| 4   | **كشف الخزينة/الصندوق:** ضمن النطاق؟                          | (أ) لاحقًا · (ب) الآن                            |
| 5   | **قالب الطباعة:** نبني قالب كشوف مخصص أم نوسّع `printReport`؟ | (أ) نوسّع `printReport` ✅ · (ب) قالب جديد مستقل |
| 6   | **إضافة `public/inama-soft-logo.png`**                        | (أ) نعم ✅ · (ب) الاكتفاء بـ `.ico`              |

---

**بانتظار موافقتك على القرارات أعلاه لبدء التنفيذ من S1.**
