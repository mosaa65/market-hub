# خطة تطوير نظام المطحنة — الوثيقة المرجعية

> **الحالة:** وثيقة تصميم معتمدة — أساس المرجع لكل تعديل لاحق.
> **الفرع:** `feature/milling-industrial-flour-mill` (نظام المطحنة غير موجود في `app`).
> **قاعدةhack:** `supabase/migrations/` — الترتيب بالاسم الزمني.
> **المرجعية:** التحليل الاستكشافي الأول لنظام المطحنة ومنتج/خدمة ERP.

---

## 0. تنبيه تشغيلي

Vercel يبني فرع **`app`**، ونظام المطحنة في **`feature/milling-industrial-flour-mill`**.
**كل تعديل على المطحنة لا يصل الموقع حتى يُدمج في `app`.**

---

## 1. تحليل الوضع الحالي

### 1.1 نقاط القوة (تُحفظ ولا تُمس)

المحرك البرمجي مبني بمهنية عالية. هذه مزايا حقيقية:

| الميزة | التفصيل | الموقع |
|---|---|---|
| فصل أمانات العميل | صفر أثر على المخزون التجاري — قرار تصميمي صحيح | `create_milling_intake` |
| الوزن الصافي مشتق في الخادم | لا يُقبل من المتصفح، يُحسب دائماً `gross − tare` | `master_data:426` |
| تبعية الوزن الاسمي | يكشف عجز أوزان الأكياس بلا تسوية تلقائية | `master_data:432` |
| قفل against السحب المزدوج | `FOR UPDATE` على السند | `master_data:551` |
| ترحيل الأكياس منفصل | `kg_per_unit` في جدول مرجعي لا في الكود | `milling_unit_conversions` |
| الفاقد يُسجَّل ولا يمنع | القرار التجاري للمشغّل | `complete_milling_job` |
| منع التسليم الزائد | مع قفل صف الناتج | `process_milling_delivery:1057` |
| تدقيق كامل | كل حركة في `audit_logs` مع `stock_impact` | كل الدوال |
| UPSERT على الناتج | تصحيح في المكان بدل مضاعفة تُفسد الفاقد | `master_data:774` |
| فاتورة المطحنة = فاتورة مبيعات عادية | لا جدول موازٍ، مع `milling_job_id` للربط | `industrial:416` |

### 1.2 المشاكل المكتشفة

#### 🔴 P0-1 — `grain_type` نص حر وليس مرجعاً

الواجهة تستخدم مصفوفة ثابتة في الكود:

```tsx
// _app.milling.intake.tsx:103
const grainTypes = ["قمح صلب", "قمح بلدي", "قمح طري", "ذرة صفراء", "شعير", "شعير مجروش", "ذرة مجروشة"];
```

بينما القاعدة صممت `grain_product_id uuid REFERENCES products(id)` ليكون المرجع الصحيح.

**الأثر الفعلي في البيانات (من `backup-before-repair/milling_intake_receipts.json`):**

| السند | `grain_type` | `grain_product_id` |
|---|---|---|
| `IR-101` | `"قمح صلب مستورد"` | مرتبط ✅ |
| `IR-102` | `"قمح بلدي محلي (حبوب)"` | مرتبط ✅ |
| `IR-202610-0001` | `"قمح صلب"` | **`null`** ⚠️ |

**نفس الجنس الفيزيائي بطريقتين تسجيل.** مستحيل تمييز قمح صلب مستورد (1400) من صلب محلي (1350) — وهو فرق تسعيري جوهري.

#### 🔴 P0-2 — `silo_or_location` نص حر

```tsx
const silos = ["صومعة 1", "صومعة 2", ...];  // ثابتة في الواجهة
```
السند القديم: `"صومعة رقم 1 - أمانات"` — تنسيق مختلف. **لا تتبع_locations للأمانات بموثوقية.**

#### 🔴 P0-3 — لا يوجد "عقد طحن" قبل الأمر

نموذج الأمر (`_app.milling.jobs.tsx:661`) يسأل فقط:
```tsx
weight, feeBag, feeTon, extraction
```

**لا يسأل: ماذا يريد العميل؟** الصنف؟ الدرجة؟ نوع الكيس؟ من يوفّر الأكياس؟
والناتج يُفترض `FLOUR_GRADE_1` افتراضياً (سطر 833) — **وهذه هي المشكلة التي وصفها المستخدم حرفياً.**

#### 🔴 P0-4 — الأجر يُحتسب مرتين

```sql
-- master_data:1257
IF v_fee_per_bag > 0 THEN ...   -- سطر
IF v_fee_per_bon > 0 THEN ...   -- سطر آخر
```
التعليق في الكود: *"الأكبر منهما — كلاهما يُحتسب"*. ليس bug برمجي، لكنه **سلوك فخّ** لأن الواجهة لا تشرح أيهما يُحتسب. والقيمتان 8/كيس و 150/طن موجودتان معاً كافتراضيين.

#### 🟡 P1-1 — حدود الرطوبة غير مُطبَّقة

النظام يسمح `0–100%`. عملياً القمح exceeding 14% رطوبة مرفوض فنياً في اليمن ويُرفض عند الاستلام.

#### 🟡 P1-2 — الصوامع ليست أصولاً حقيقية

لا يوجد جدول صوامع/مواقع منفصل — التمييز بين "صومعة" و"مستودع تجاري" غير موجود في البيانات.

#### 🟢 P2-1 — لا يوجد تقرير دخل أجور الطحن منفصل

`line_type = 'SERVICE'` متاح في التقارير، لكن لا شاشة عرض مخصصة.

---

## 2. التصميم المقترح للمطحنة

### 2.1 النموذج المفاهيمي

```
┌──────────────────────────────────────────────────────────────┐
│  النظام الأساسي (ERP)                                          │
│  customers · warehouses · products · sales_invoices            │
└──────────────────────┬───────────────────────────────────────┘
                       │
    ┌──────────────────┴───────────────────┐
    │                                      │
┌───▼──────────────────────┐  ┌────────────▼─────────────────┐
│  king's goods  (بضاعة)     │  │  Custody  (أمانات)            │
│  GOOD + TRACKED            │  │  ليست بضاعة ولا خدمة          │
│  • FG-*  نواتج تامة        │  │  zero stock impact            │
│  • PKG-* أكياس             │  │                              │
│  • RM-*  مواد خام للمطحنة   │  │                              │
└────────────────────────────┘  └──────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  SERVICE  (خدمات) — UNTRACKED دائماً، costing = NONE          │
│  SRV-MILL-*  طحن · SRV-CLEAN-* تنظيف · SRV-SEWING-* تعبئة     │
│  تُفوتر كـ sales_invoice عادية، لا تحرّك مخزون               │
└──────────────────────────────────────────────────────────────┘
```

**القاعدة الذهبية:** حبوب العميل ليست `GOOD` ولا `SERVICE` — هي **مادة مملوكة لطرف ثالث داخل حيازتنا**. هذا يُفسّر لماذا الطحن خدمة وليس بضاعة.

### 2.2 رحلة العميل — 6 مراحل

```
① الاستلام        ② التفاوض        ③ عقد الطحن
   intake             agreement         agreement
   grain_product_id   النتيجة المطلوبة   الأجر مثبّت
   moisture           الدرجة المتوقعة    صفر مخزون
   impurities
        │                 │                  │
        └─────────────────┴──────────────────┘
                              ↓
              ④ التنفيذ            ⑤ الإقفال
                 job                complete
                 يسحب من الأمانات     يحسب الفاقد
                 صفر مخزون           excess يُسجَّل
                              ↓
              ⑥ الفوترة            ⑦ التسليم
                 invoice              delivery
                 أجرة + أكياس        حسم رصيد الأمانات
                 (إنتاج + استنزاف)     إنValidatorInvariant: تسليم > إنتاج
```

### 2.3 البيانات المطلوبة في كل مرحلة

| المرحلة | الحقول الإلزامية |
|---|---|
| **① الاستلام** | `customer_id`, `store_id`, `grain_product_id` (مرجع لا نص), `bag_size_kg`, `intake_bag_count`, `gross/tare/net`, `moisture`, `impurities` |
| **② التفاوض** | النتيجة المطلوبة (نوع + درجة), الكمية, نوع الكيس, مصدر الأكياس, طريقة التسليم |
| **③ العقد** | `service_product_id`, `price_basis` (BAG\|TON), `agreed_price`, `expected_extraction`, `allowed_loss` |
| **④ التنفيذ** | `input_weight_kg`, `input_bag_count`, مرجع العقد |
| **⑤ الإقفال** | `produced_weight_kg`, `produced_bag_count` لكل ناتج — يحسب الباقي |
| **⑥ الفوترة** | `price_basis` المختار → سطر واحد فقط |
| **⑦ التسليم** | `delivered_bags`, `delivered_weight_kg` لكل ناتج |

---

## 3. الفجوات بين الوضع الحالي والتصميم

| # | الفجوة | الوضع الحالي | التصميم |
|---|---|---|---|
| G1 | نوع الحبوب | نص حر | `grain_product_id` مرجع إلزامي |
| G2 | الموقع | نص حر | مرجع إلى صومعة مُدارة |
| G3 | نوع الخدمة | غير موجود | العقد يسجل نوع الخدمة |
| G4 | الدرجة المطلوبة | افتراضي `FLOUR_GRADE_1` | صريحة في العقد |
| G5 | مصدر الأكياس | يُسأل عند الناتج | يُحدد في العقد |
| G6 | أساس التسعير | `bag` أو `ton` أو كلاهما | **واحد فقط** |
| G7 | سعر مثبّت | إدخال حر لكل أمر | `agreed_price` في العقد |
| G8 | حدود الرطوبة | 0–100 | حد أقصى من الفحص النوعي |
| G9 | تقرير طحن | غير موجود | تقرير دخل أجور |

---

## 4. خطة التعديلات — بالترتيب

### 🔴 المرحلة 0 — فحص أنواع الحبوب (P0)

**migration: `20261003000000_milling_grain_grades.sql`**
- جدول `milling_grain_grades` (مرجع)
- `ALTER milling_intake_receipts` ← `grain_grade_id`
- دالة `milling_match_grain_grade(product_id, moisture, impurities)`
- هجرة الـ 3 سندات المفقودة

**واجهة:** استبدال `const grainTypes = [...]` بقائمة من القاعدة.

### 🔴 المرحلة 1 — عقد الطحن (P0)

**migration: `20261003010000_milling_service_agreements.sql`**
- جدول `milling_service_agreements`
- `milling_jobs.agreement_id`
- دالة `create_milling_agreement(...)`

**واجهة:** نموذج قبل الأمر في `_app.milling.jobs.tsx`.

### 🟡 المرحلة 2 — التسعير (P1)

**migration: `20261003020000_milling_pricing_basis.sql`**
- `price_basis` CHECK ('BAG','TON')
- دالة ترحيل تحوّل `fee_per_bag + fee_per_ton > 0` إلى `VIOLATION`
- تحديث `issue_milling_service_invoice` لسطر واحد

### 🟡 المرحلة 3 — الواجهات (P1)

- `_app.milling.intake.tsx` — قائمة مرجعية + تحقق الرطوبة
- `_app.milling.jobs.tsx` — نموذج العقد

### 🟢 المرحلة 4 — التقارير (P2)

**migration: `20261003030000_milling_reports.sql`**
- `milling_revenue_report`

---

## 5. تغييرات قاعدة البيانات

### 5.1 `milling_grain_grades`

```sql
CREATE TABLE public.milling_grain_grades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  grade_code varchar(30) NOT NULL,        -- HARD_IMPORT, LOCAL, SOFT, CORN, BARLEY
  grade_name_ar varchar(120) NOT NULL,
  origin varchar(60),                     -- IMPORTED / LOCAL
  max_moisture numeric(5,2) NOT NULL,      -- الحد الفني (ق��ح ~14)
  max_impurities numeric(5,2) NOT NULL,
  default_bag_size_kg numeric(6,2) NOT NULL DEFAULT 50,
  default_service_sku varchar(50),
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (product_id, grade_code)
);
```

### 5.2 `milling_service_agreements`

```sql
CREATE TABLE public.milling_service_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES warehouses(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  intake_receipt_id uuid REFERENCES milling_intake_receipts(id),
  grain_grade_id uuid REFERENCES milling_grain_grades(id),

  -- المطلوب (الجديد)
  requested_output_type milling_output_type,   -- الدرجة المطلوبة
  output_bag_size_kg numeric(6,2) NOT NULL DEFAULT 50,
  bags_source varchar(20) NOT NULL DEFAULT 'CUSTOMER'
    CHECK (bags_source IN ('CUSTOMER','MILL')),
  delivery_mode varchar(20) NOT NULL DEFAULT 'FULL'
    CHECK (delivery_mode IN ('FULL','PARTIAL')),

  -- التسعير (قاعدة واحدة)
  service_product_id uuid REFERENCES products(id),
  price_basis varchar(10) CHECK (price_basis IN ('BAG','TON')),
  agreed_price numeric(12,2) CHECK (agreed_price >= 0),

  expected_extraction_rate numeric(5,2) NOT NULL DEFAULT 80,
  allowed_loss_percentage numeric(5,2) NOT NULL DEFAULT 2,

  agreed_at timestamptz NOT NULL DEFAULT now(),
  agreed_by uuid REFERENCES auth.users(id),
  notes text
);
```

**قاعدة التسعير:**
```sql
CHECK (
  (price_basis = 'BAG'  AND agreed_price IS NOT NULL AND agreed_price > 0)
  OR (price_basis = 'TON' AND agreed_price IS NOT NULL AND agreed_price > 0)
  OR price_basis IS NULL
)
```

### 5.3 ترحيل `milling_jobs`

```sql
ALTER TABLE milling_jobs ADD COLUMN agreement_id uuid
  REFERENCES milling_service_agreements(id);
ALTER TABLE milling_jobs
  ADD CONSTRAINT milling_jobs_price_basis_single CHECK (num_nonnulls(
    milling_fee_per_bag, milling_fee_per_ton) <= 1);
```

---

## 6. تغييرات الواجهات

### 6.1 `_app.milling.intake.tsx`
- **حذف:** `const grainTypes = [...]` و `const silos = [...]`
- **إضافة:** `useQuery(["milling","grain-grades"])` من جدول `milling_grain_grades`
- **إضافة:** تنبيه عند تجاوز `max_moisture` للمنتج المختار
- **حفظ:** كل الحقول الحالية كما هي

### 6.2 `_app.milling.jobs.tsx`
- **إضافة:** خطوة "عقد الطحن" قبل إنشاء الأمر
- **حقول:** نوع الخدمة، الدرجة المطلوبة، سعة الكيس، مصدر الأكياس، أساس السعر
- **إزالة:** الحقلين handeled يدوياً عند الفوترة

---

## 7. تغييرات منطق الأعمال

| القاعدة | الدالة |
|---|---|
| فحص الرطوبة عند الاستلام | `create_milling_intake` + `milling_match_grain_grade` |
| عقد قبل أمر | `create_milling_agreement` |
| سحب من رصيد العقد | `create_milling_job` يتحقق من `agreement_id` |
| سعر واحد | `issue_milling_service_invoice` يستخدم `price_basis` |

**قاعدة عدم التغيير:**
- `create_milling_intake` — يُضاف الفحص فقط
- `complete_milling_job` — لا يُمس
- `process_milling_delivery` — لا يُمس
- `create_sale` — لا يُمس

---

## 8. خطة ترحيل البيانات

### 8.1 السندات الثلاثة القائمة
| السند | المطلوب |
|---|---|
| `IR-101`, `IR-102` | مرتبطة بالفعل ✅ لا مساس |
| `IR-202610-0001` (`grain_product_id = null`) | ربط يدوي بـ `RM-WHEAT-HARD` |

### 8.2 تسعير غير متسق
**قبل تطبيق قيد `price_basis`:**
```sql
SELECT job_number, milling_fee_per_bag, milling_fee_per_ton
FROM milling_jobs
WHERE milling_fee_per_bag > 0 AND milling_fee_per_ton > 0;
```
لكل نتيجة → **قرار تجاري مطلوب** (أي أساس يُعتمد). لا تُهاجَر آلياً.

### 8.3 خطة الرجوع
كل migration تحوي `ROLLBACK` في رأسها (نمط المشروع القائم).

---

## 9. خطة الاختبار

| # | الاختبار | النتيجة المتوقعة |
|---|---|---|
| T1 | استلام برطوبة > الحد | `RAISE EXCEPTION` |
| T2 | استلام بدون `grain_grade_id` | مرفوض |
| T3 | عقد بأساس BAG و TON معاً | مرفوض |
| T4 | أمر بدون عقد | مرفوض |
| T5 | تسعير | سطر واحد فقط |
| T6 | أمانات العميل | صفر حركة مخزون |
| T7 | Faud >允許 | يُسجَّل ولا يمنع |
| T8 | تسليم > إنتاج | مرفوض |
| T9 |Invoice عادية | لم تتأثر |
| T10 | رولباك | البنية سليمة |

---

## 10. القرارات التجارية — مُحسومة

| # | القرار | القرار المُعتمد |
|---|---|---|
| **Q1** | الأجر عند وجود أساسين | **أساس واحد فقط** (BAG أو TON). البيانات الحالية تجريبية → يُصحَّح ويُحذف الخاطئ بلا قلق |
| **Q2** | تجاوز حد الرطوبة | **تنبيه فقط** — لا يمنع الحفظ (قرار المستخدم). يبقى الاستBlocking متاحاً لاحقاً |
| **Q3** | أجرة التعبئة | **الخياران معاً**: بند تعبئة مستقل + بند طحن. الواجهة تعرضهما منفصلين والقاعدة `include_sewing` |
| **Q4** | `IR-202610-0001` (بدون مرجع) | **ربط تلقائي بأقرب درجة مطابقة** من نص `grain_type` = "قمح صلب" → `RM-WHEAT-HARD` |

### 10.1 تفاصيل Q3 — الخياران
فاتورة أمر الطحن تحتوي **أك��ر بند**:
1. `SRV-MILL-*` — أجرة الطحن (أساس واحد فقط: BAG أو TON)
2. `SRV-SEWING-BAG` — أجرة تعبئة وحياكة، تُحتسب فقط عند `bags_source = 'MILL'`
3. `PKG-*` — تكلفة الأكياس الموردة (خطGoods، يستنزاف المخزون)

كل بند مستقل، والتحكم عبر `include_packaging` / `include_sewing` في دالة الفوترة.

---

## 11. مبدأ التنفيذ

1. **لا تُغيّر** أي جزء صحيح موجود.
2. **لا تؤثر** على باقي وحدات ERP.
3. **راجع** كل تعديل مقابل دورة العمل الجديدة.
4. **توقّف** عند قرار تجاري غير واضح.

---

## سجل التغييرات

| التاريخ | المرحلة | الحالة |
|---|---|---|
| 2026-10-03 | بناء الوثيقة المرجعية | ✅ |
| 2026-10-03 | المرحلة 0 — `20261003000000_milling_grain_grades.sql` | ✅ |
| 2026-10-03 | المرحلة 1 — `20261003010000_milling_service_agreements.sql` | ✅ |
| 2026-10-03 | المرحلة 2 — `20261003020000_milling_pricing_basis.sql` | ✅ |
| 2026-10-03 | المرحلة 3 (تقارير) — `20261003030000_milling_reports.sql` | ✅ |
| 2026-10-03 | الواجهات — الاستلام + أمر الطحن + مكتبة agreements.ts | ✅ |
| 2026-10-03 | التحقق: `tsc --noEmit` نظيف · `npm run build` = 0 | ✅ |
| 2026-10-03 | المرحلة 4 — `20261003040000_milling_grain_grade_wiring.sql` (توصيل الفحص + RLS العقود) | ✅ |
| 2026-10-03 | ربط بطاقة الخدمة تلقائياً بأساس التسعير (إنهاء `serviceProductId: null`) | ✅ |
| 2026-10-03 | شاشة التقارير — `_app.milling.reports.tsx` | ✅ |
| 2026-10-03 | `invoiceJobV2` في المكتبة (فاتورة بسطر واحد + بند تعبئة) | ✅ |
| 2026-10-03 | التحقق النهائي: `tsc --noEmit` نظيف · `npm run build` = 0 | ✅ |
| 2026-10-03 | زر الفوترة ← `invoiceJobV2` + خيار بند التعبئة (قرار Q3) | ✅ |
| 2026-10-03 | شاشة التقارير في القائمة الجانبية (`app-shell.tsx`) | ✅ |
| 2026-10-03 | بانر العقد في تفاصيل الأمر + عرض أجرة بأساس واحد | ✅ |

## 13. الأخطاء الحرجة التي اكتُشفت أثناء التنفيذ

### 13.1 `_grain_grade_id` كان يُرسَل ويُتجاهل صامتاً
migration `20261003000000` أضافت عمود `grain_grade_id`، والواجهة كانت ترسله إلى RPC `create_milling_intake`. لكن دالة `20260930120100` **لا تحتوي هذا المعامل** — وPostgREST يتجاهل المعاملات غير المعروفة في استدعاء الدوال.

**النتيجة:** سند يُحفظ بلا فحص، بلا خطأ، بلا تحذير. يبدو ناجحاً وهو ناقص.

**الإصلاح:** `20261003040000_milling_grain_grade_wiring.sql` يعيد تعريف الدالة بتوقيعها الكامل مع المعامل — والفحص صار إلزامياً، و`grain_type` صار يُشتق من الفحص لا من المتصفح.

> هذا نمط خطأ يستحق الانتباه في المشروع كله: أي معامل ترسله الواجهة يجب أن يكون موجوداً في توقيع الدالة، وإلا يُهمل بصمت.

### 13.2 جدول العقود كان بلا سياسات RLS
`milling_service_agreements` جدول جديد — وRLS مفعّل افتراضياً على الجداول الجديدة، فبلا سياسة SELECT لا يرى المتصفح شيئاً. `20261003040000` يضيف السياسة (قراءة لموظفي المصنع، كتابة عبر RPC فقط).

### 13.3 أسماء الدوال لا تتطابق مع توقيعاتها
`CREATE OR REPLACE FUNCTION` لا يغيّر التوقيع — فتعدد التعريفات أنشأ دوالاً متمايزة لا واحدة محدّثة. `20261003040000` يعيد تعريف التوقيع **النهائي** لكل دالة مرة واحدة.

### 13.4 أخطاء عمود في تقرير الإيرادات (2026-10-03)
`milling_revenue_report` في `20261003030000` كان يشير إلى ثلاثة أعمدة غير موجودة:

| ما كان مكتوبًا | الصحيح | السبب |
|---|---|---|
| `si.store_id` | `si.warehouse_id` | جدول الفواتير يستعمل `warehouse_id` |
| `a.job_number` | `a.id` | جدول العقود بلا عمود `job_number` |
| `'returned'` في تصفية الحالة | ليس من تعداد `invoice_status` | التعداد: `draft`/`confirmed`/`paid`/`partial`/`cancelled` |

### 13.5 تحديث الإجماليات كان يمس فواتير غير متأثرة
تصحيح إجمالي الفاتورة بعد حذف بند كان يطابق **كل** فاتورة مرتبطة بأمر مطحنة، حتى التي لم يُحذف منها شيء. الآن يقتصر على الفواتير التي حُذف منها بند فعلاً.

### 13.6 أخطاء كشفها التحقق الفعلي على قاعدة البيانات (2026-10-03)
المراجعة بالعين لا تكفي. بعد تنفيذ الـ migrations على قاعدة البيانات الحقيقية، ظهرت أخطاء لم تكن مرئية في الكود:

| # | الخطأ | السبب | الإصلاح |
|---|---|---|---|
| 1 | `null value in column milling_fee_per_ton` | العمود `NOT NULL DEFAULT 0` — تصفيره بـ `NULL` مستحيل | `= 0` بدل `= NULL` |
| 2 | `create_milling_agreement` قديمة 12 وسيطا باقية | `CREATE OR REPLACE` لا يغيّر التوقيع، و`010000` كان يعرف 12 بينما `040000` يعرف 13 | توحيد التوقيع على 13 في الملفين، وكلاهما بـ `text` لا `varchar` |
| 3 | `column c.name_ar does not exist` | جدول `customers` **بلا** `name_ar` — العمود الوحيد `name`. أما `warehouses` و`products` فعلاً فيه `name_ar` | `c.name` في ثلاثة مواضع |
| 4 | `syntax error at or near ""` | PowerShell `Set-Content -Encoding UTF8` يضيف BOM ترفضه PostgreSQL | `strip-bom.mjs` — الملف يُقرأ ويُعاد كتابته بلا BOM |
| 5 | `column "stock_effect" must appear in GROUP BY` | عمود منقول بلا تجميع في تقرير الإيرادات | `GROUP BY 1..12` |
| 6 | سندان بلا فحص | مطابقة `grain_type` بالقيمة `"قمح صلب"` كانت غير موجودة في القائمة | migration `050000` يوسّع القائمة |
| 7 | بنود الفاتورة الزائدة باقية | شرط الحذف اعتمد `fee_per_ton > 0` وهو مُصفَّر قبله | معيار محايد: الكمية = الأطنان بينماexists بند بالأكياس |

> **الدرس الأهم:** `psql` كشف 7 أخطاء لم يرها TypeScript ولا linter ولا القراءة. أي migration يجب التحقق منها على قاعدة بيانات حقيقية، لا الاكتفاء بسلامة البناء.

---

## 14. ملخص ما تم تنفيذه

### قاعدة البيانات (5 migrations جديدة)

| الملف | المحتوى |
|---|---|
| `20261003000000_milling_grain_grades.sql` | `milling_grain_grades` + `grain_grade_id` + `milling_match_grain_grade` + زرع 5 فحوص من أصناف RM-* القائمة + هجرة السندات اليتيمة |
| `20261003010000_milling_service_agreements.sql` | `milling_service_agreements` + `create_milling_agreement` + `create_milling_job_v2` + `milling_agreements_view` |
| `20261003020000_milling_pricing_basis.sql` | قيد `milling_jobs_single_fee_basis` + `repair_milling_dual_fee_jobs` + `issue_milling_service_invoice_v2` + تشخيص التسعير |
| `20261003030000_milling_reports.sql` | `milling_revenue_report` + `milling_efficiency_report` + `milling_intake_health` |
| `20261003040000_milling_grain_grade_wiring.sql` | توصيل `grain_grade_id` بالمحرك + جعل الفحص إلزامي + RLS للعقود |

### الواجهات
- **`src/lib/milling/agreements.ts`** (جديد، 306 سطر) — طبقة وصول منفصلة، لم نمسّ `index.ts` القائم.
- **`_app.milling.intake.tsx`** — استُبدلت `const grainTypes` الثابتة بقائمة مرجعية من `milling_grain_grades_view`؛ اختيار الدرجة يضبط `grainType` + سعة الكيس تلقائياً؛ بانر فحص الرطوبة.
- **`_app.milling.jobs.tsx`** — حُذف حقلا الأجر اليدويان؛ أُضيف نموذج عقد كامل (الدرجة المطلوبة، وصف الطلب، مصدر الأكياس، طريقة التسليم، أساس التسعير، السعر المتفق عليه) + معاينة الأجرة التقديرية؛ الحفظ ينشئ العقد ثم الأمر عبر `create_milling_job_v2`.

### ما لم يُمَس (قاعدة عدم التغيير)
`complete_milling_job` · `process_milling_delivery` · `add_milling_output` · `create_sale` · محرك المخزون · وحدات ERP الأخرى.

### الأثر على الحالة الحالية
- `grain_type` صار مشتقاً من `grain_grade_id` — لم يعد حقلاً حراً.
- أمر الطحن لا يُنشأ بلا عقد مُسجّل بدرجة الطلب وسعر واحد.
- الفاتورة التجريبية `MJ-501`: البند الزائد (سعر الكيس على كمية الطن) يُحذف بمعيار بنيوي، والإجمالي يُصحّح.
- الأجر لا يُحتسب مرتين — قيد على مستوى قاعدة البيانات لا على الواجهة.