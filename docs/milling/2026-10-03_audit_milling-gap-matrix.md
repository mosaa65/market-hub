# مصفوفة فجوات تنفيذ نظام المطحنة — الحالة الدليلية

> **التاريخ:** 2026-10-02 (محدّث بعد تنفيذ دورتي العمل التاليتين)
> **الفروع المنفَّذة:**
> - `fix/milling-intake-guard-and-grade-rls` — G-01 · G-02
> - `feat/stock-positions-rls` — G-22
> - `feat/item-classification-costing-policy` — التصنيف الخماسي + إعداد التكلفة العام
> - `feat/cost-engine` — محرك التكلفة (متوسط متحرك / معياري)
> - `feat/production-orders` — دورة إنتاج المطحنة + إصلاح خطأ في محرك المخزون الأساسي
> - `feat/opening-balances` — الأرصدة الافتتاحية الشاملة
> - `fix/milling-job-agreement-backfill` — ربط الأوامر القديمة بعقودها بأثر رجعي
> - `feat/milling-reports` — تقرير التكلفة والهامش + مخزون المطحنة
> **قاعدة البيانات المفحوصة:** المشروع المرتبط في `supabase/.temp/project-ref` (PostgreSQL 17.6)
> **طريقة التحقق:** استعلامات قراءة حقيقية + محاكاة أدوار `anon` / `authenticated` / موظف حقيقي داخل معاملات مُلغاة (`scripts/mill-*.mjs`). لا "مكتمل" بلا دليل.
> **أدوات الفحص:** `scripts/db-run.mjs` (استعلام)، `scripts/db-apply.mjs` (تطبيق migration)، `scripts/mill-*.mjs` (فحوص).

---

## 0. خلاصة تنفيذي

نظام المطحنة **موجود ويعمل فعلياً** في قاعدة البيانات المرتبطة: 7 سندات استلام، أمرا طحن منجزة، 5 فحوص حبوب، 32 صنفاً ب.policy صريحة، و9 عروض تقارير تُرجع بيانات حقيقية. الفجوة ليست في "الوجود" بل في **السلامة والاكتمال**:

| # | الفجوة | الخطورة | الحالة |
|---|---|---|---|
| G-01 | `milling_grain_grades` بلا RLS → دور `anon` يعدّل ceilings الرطوبة والشوائب | 🔴 حرجة | ✅ **أُصلحت في هذا الفرع** |
| G-02 | حمل زائد لـ `create_milling_intake` بلا فحص درجة → مسار استلام بدون فحص فني | 🔴 حرجة | ✅ **أُصلحت في هذا الفرع** |
| G-03 | لا يوجد مسار **إنتاج ملك المطحنة** (أمر إنتاج، مخطط/فعلي، تكلفة إنتاج) | 🔴 حرجة | ✅ **منفَّذ** — `production_orders` + BOM + محرك التكلفة |
| G-04 | التقارير لا تعرض **أمانات العملاء** ولا **مخزون المطحنة** ولا **التكلفة/الهامش** | 🟡 عالية | ⬜ العروض موجودة，未经واجهة |
| G-05 | شاشات المطحنة لا تعرض فشل الاستعلام كخطأ (فارغ صامت) | 🟡 عالية | ⬜ غير منفذ — المتطلب 2 |
| G-06 | لا اختبارات قبول SQL للمطحنة (الملف الوحيد `item_model_acceptance.sql`) | 🟡 عالية | ⬜ غير منفذ |
| G-07 | `silo_or_location` نص حر | 🟢 متوسطة | ⬜ متأخر |
| G-08 | لا جدول صوامع/مواقع مُدارة | 🟢 متوسطة | ⬜ متأخر |
| G-10 | تصنيف خماسي (خام/نهائي/جانبي/خدمة/غير مخزني) | 🔴 أساس التكلفة | ✅ **منفَّذ** |
| G-11 | إعداد التكلفة عام على مستوى الشركة + سجل تغيّر | 🔴 أساس التكلفة | ✅ **منفَّذ** |

---

## 1. الجرد الفعلي (مستخرج من القاعدة، لا من التوثيق)

### 1.1 الجداول

`milling_intake_receipts` · `milling_jobs` · `milling_job_outputs` · `milling_service_agreements` · `milling_grain_grades` · `milling_delivery_notes` · `milling_delivery_items` · `milling_unit_conversions`

### 1.2 العروض (views) — كلها `security_invoker=true` ✅

| العرض | التحقق | ملاحظة |
|---|---|---|
| `milling_customer_custody` | 3 صفوف | رصيد أمانات العميل: مستلم/مطحون/منتج/مسلَّم |
| `milling_output_balances` | 3 صفوف | رصيد نواتج كل عميل وناتج |
| `milling_service_money` | 2 صفوف | أجور الطحن: subtotal/paid/outstanding |
| `milling_revenue_report` | صفان | إيراد شهري بتفصيل البند |
| `milling_efficiency_report` | صفان | كفاءة/فاقد/مقابل متوقع + فحص تسعير |
| `milling_intake_health` | يعمل | رطوبة مقابل حد الدرجة، فجوة الأكياس |
| `milling_pricing_diagnostics` | يعمل | كشف تسعير مزدوج |
| `milling_agreements_view` | يعمل | العقود |
| `milling_grain_grades_view` | 5 صفوف | الفحوص |

### 1.3 الدوال (كلها `SECURITY DEFINER`)

`create_milling_intake` · `create_milling_agreement` · `create_milling_job` · `create_milling_job_v2` · `add_milling_output` · `complete_milling_job` · `cancel_milling_job` · `cancel_milling_intake` · `process_milling_delivery` · `issue_milling_service_invoice` · `issue_milling_service_invoice_v2` · `milling_match_grain_grade` · `milling_kg_per_unit` · `can_view_milling` · `can_operate_milling` · `repair_milling_dual_fee_jobs`

### 1.4 سياسة الصنف — محفوظة على `products` فعلياً ✅

الأعمدة موجودة على الجدول: `item_nature` · `inventory_policy` · `tracking` · `costing_method` · `is_sellable` · `is_purchasable` · `status` · `base_uom_id`/`sales_uom_id`/`purchase_uom_id`/`uom_conversions`.
التوزيع الفعلي: `GOOD+TRACKED` = 26 صنفاً، `SERVICE+UNTRACKED+costing NONE` = 6 خدمات.
الواجهة (`_app.products.tsx:2430+`) تربطها بحقول عربية وتكتبها في `products` — **ليست تفضيل متصفح**.

### 1.5 بيانات حية

`intakes=7` · `jobs=2 (COMPLETED)` · `agreements=0` · `grades=5` · `outputs=5` · `products=32`
⚠️ `agreements=0` بينما `jobs.agreement_id = NULL` للاثنين — السندان القديمان أُنشئا قبل مسار العقد. **مطلوب قرار ترحيل** (انظر G-09).

---

## 2. مصفوفة الفجوات بالطبقات

الحالة: ✅ دليل affirmative · ⚠️ جزئي/مكتمل بلا اختبار · ❌ غير موجود · ⬜ معلّق

| # | البند | قاعدة البيانات | RPC / RLS | الواجهة | الاختبار | الحكم |
|---|---|---|---|---|---|---|
| 1 | حقول سياسة الصنف محفوظة | ✅ 7 أعمدة على `products` | ✅ RLS على `products` | ✅ نموذج عربي كامل | ❌ | ✅ |
| 2 | نموذج الصنف يحفظ السياسة | — | — | ⚠️ `_app.products.tsx` يحفظها، بلا اختبار واجهة | ❌ | ⚠️ |
| 3 | `min_stock` + المستودع في النموذج | ✅ `min_stock` | ✅ | ✅ | ❌ | ⚠️ |
| 4 | بطاقات المخزون تُظهر فشل الاستعلام | — | — | ✅ `inventory.tsx:634-861` (نص صريح) | ❌ | ✅ |
| 5 | بطاقات المطحنة تُظهر فشل الاستعلام | — | — | ❌ `milling.tsx` و`milling.reports.tsx` بلا `isError` | ❌ | ❌ |
| 6 | استلام + فحص درجة + رطوبة | ✅ `grain_grade_id` | ⚠️ overload بلا فحص (✅ أُصلح) | ✅ | ❌ | ✅ بعد الإصلاح |
| 7 | نطاق التسليم + الوزن الصافي مشتق | ✅ | ✅ `gross−tare` في الخادم | ✅ | ❌ | ✅ |
| 8 | عقد خدمة بسعر واحد | ✅ `milling_service_agreements` + قيد `num_nonnulls(…) <= 1` | ✅ | ✅ نموذج العقد | ❌ | ✅ |
| 9 | طحن الغير: صفر أثر مخزون | ✅ | ✅ | ✅ | ❌ | ⚠️ |
| 10 | فاتورة أجرة + بنود أكياس/حياكة | ✅ `issue_milling_service_invoice_v2` | ✅ | ✅ | ❌ | ⚠️ |
| 11 | تسليم جزئي/كامل + منع التسليم الزائد | ✅ `process_milling_delivery` | ✅ | ✅ | ❌ | ⚠️ |
| 12 | كشف عيني ومالي للعميل | ✅ عرضان | ✅ `security_invoker` | ✅ `milling.customer-statement.tsx` | ❌ | ✅ |
| 13 | **إنتاج ملك المطحنة** | ❌ لا `production_orders` ولا BOM | ❌ | ❌ | ❌ | ❌ |
| 14 | تقرير إنتاج (مخطط/فعلي/استخلاص) | ❌ | ❌ | ❌ | ❌ | ❌ |
| 15 | تقرير مخزون (خام/تام/جانبي/تعبئة) | ✅ `milling_inventory_report` | ✅ | ⬜ | ✅ 16 فحصاً | ✅ |
| 17 | تقرير تجاري/مالي مع بيان "التكلفة مرجعية" | ✅ `milling_margin_report` + `cost_basis` | ✅ | ⬜ | ✅ 16 فحصاً | ✅ |
| 31 | 11 صنف قديم بلا رمز (تصنيف مُستنتج بلا دليل) | ⚠️ مُعلَّم في `item_classification_gaps` | ✅ | ⬜ | ✅ | ⚠️ **يحتاج قرارك** |
| 16 | تقرير أمانات العملاء | ✅ `milling_customer_custody` | ✅ | ✅ **معروض في التقارير** | — | ✅ |
| 17 | تقرير تجاري/مالي مع بيان "التكلفة مرجعية" | ⚠️ `milling_revenue_report` بلا تكلفة/هامش | — | ❌ | ❌ | ❌ |
| 18 | رسوم تخزين للغير كخدمة مستقلة | ⚠️ الصنف `SRV-STORAGE-DAY` موجود | ❌ لا RPC | ❌ | ❌ | ❌ |
| 19 | RLS على جداول المطحنة | ✅ 7 جداول RLS مفعّل | ✅ سياسات قراءة `authenticated` | — | ✅ فحص أدوار | ✅ |
| 20 | RLS على عروض التقارير | ✅ `security_invoker` | ✅ | — | ✅ | ✅ |
| 21 | RLS على `milling_grain_grades` | ❌ كان معطّلاً | ❌ `anon` يعدّل | ⚠️ الواجهة تقرأه كمرجع | ✅ probed | ✅ **أُصلح** |
| 22 | `stock_positions` بلا RLS | ❌ `relrowsecurity=false` | — | ⚠️ | ✅ probed | ✅ **أُصلح** |
| 23 | اختبار قبول SQL للمطحنة | ❌ | — | — | ❌ | ❌ |
| 24 | تصنيف خماسي محفوظ على `products` | ✅ `item_class` | ✅ | ⬜ شاشة الإعدادات | ✅ 18 فحصاً | ✅ |
| 25 | تبديل طريقة التكلفة مع سجل تاريخ | ✅ `company_costing_settings` + `costing_policy_history` | ✅ `owner/manager` فقط | ⬜ | ✅ | ✅ |
| 26 | فجوة التصنيف مرئية ومُبلَّغ عنها | ✅ `item_classification_gaps` = 0 صف | ✅ | — | ✅ | ✅ |
| 27 | محرك التكلفة نفسه (طبقات/تقييم) | ✅ `item_cost_layers` + `item_cost_transactions` | ✅ | ⬜ | ✅ 26 فحصاً | ✅ |
| 28 | دورة إنتاج المطحنة | ✅ `production_orders` + BOM + 5 دوال | ✅ | ⬜ شاشة الإنتاج | ✅ 33 فحصاً | ✅ |
| 29 | أرصدة افتتاحية شاملة (٨ أقسام) | ✅ `opening_balance_*` + توازن إجباري | ✅ | ⬜ | ✅ 23 فحصاً | ✅ |
| 30 | ربط الأوامر القديمة بعقودها | ✅ استعادة من بنود مطبَّقة | ✅ | — | ✅ تقارير سليمة | ✅ |
| 29 | **لا دفتر أعمدة في النظام** | ❌ لا `accounts` ولا `journal_entries` | — | — | — | ❌ قرار مطلوب |
| 30 | `inventory.ON CONFLICT` لا يطابق صف الشركة | ❌ كان يفشل كل صرف | ✅ أُصلح | — | ✅ | ✅ |

---

## 3. الأدلة قبل/بعد لأعلى فجوتين

### G-01 — `milling_grain_grades` بلا RLS

```
قبل:  set local role anon;
      update milling_grain_grades set max_moisture = 1 where id = (...);
      => ALLOWED (1 row)          ← تسريب تعديل ceilings الرطوبة/الشوائب

بعد:  => DENIED permission denied for table milling_grain_grades
      select count(*) as anon    => 0
      select count(*) as owner   => 5      (owner حقيقي f31d85f1-…)
```

### G-02 — overload بلا فحص

```
قبل:  select oid::regprocedure from pg_proc where proname='create_milling_intake';
      => نسختان: 14 وسيطاً (بلا grade) و15 وسيطاً (مع grade)

بعد:  => نسخة واحدة فقط:
      create_milling_intake(uuid,uuid,text,uuid,uuid,numeric,integer,numeric,numeric,numeric,numeric,text,text,text,text)
```

### نطاق التسريب عبر `anon` (مسجَّل للقرار G-22)

`anon` يملك SELECT على 72 من 77 جدولاً (منحة Supabase الافتراضية). **الاستعلام يعيد 0 صفوف** لمعظمها بسبب RLS/سياسات، لكن `stock_positions` تحديداً بلا RLS ويسمح بـ SELECT لـ `anon` → يحتاج قراراً: تفعيل RLS أم تقييد المنحة. **لم أُنفّذه لأنه يمس وحدات ERP خارج المطحنة.**

---

## 4. ما أُصلح في هذا الفرع

**Migration:** `supabase/migrations/20261003060000_milling_grade_rls_and_intake_signature_guard.sql`

1. `REVOKE INSERT/UPDATE/DELETE … FROM anon` + `ENABLE ROW LEVEL SECURITY` + سياسة قراءة واحدة `is_staff(auth.uid())` على `milling_grain_grades`. لا توجد سياسة كتابة إطلاقاً → كل كتابة مرفوضة عدا `service_role`.
2. `DROP FUNCTION` للحمل الزائد 14-وسيطاً من `create_milling_intake` (لا مستدعٍ شرعي له؛ الواجهة ترسل المعامل في `src/lib/milling/index.ts:261`).
3. `REVOKE ALL … FROM anon` على الدالة الباقية.

**غير مدمر:** لا حذف ولا تعديل لأي سند أو أمر أو فاتورة أو رصيد.

**أدوات فحص دائمة (مضافة):** `scripts/db-run.mjs`, `scripts/db-apply.mjs`, `scripts/mill-*.mjs` (7 ملفات) — تشغَّل بأمر واحد ولا تطبع أي سر.

### نتائج التحقق

| الفحص | النتيجة |
|---|---|
| `node scripts/db-apply.mjs …20261003060000….sql` | `APPLIED OK` |
| `npm run build` | ✅ exit 0 (كان يفشل قبل: `vite-plugin-pwa` غير مثبّت رغم وجوده في `package.json` — أُعيد التثبيت) |
| `npx tsc --noEmit` | 5 أخطاء **سابقة** لا علاقة لها بالمطحنة (`_app.inventory.tsx:770,776` · `vite.config.ts` ×3 — انظر G-10) |
| `git diff --check` | نظيف (تحذير CRLF لملف مولّد) |
| فحص أدوار قبل/بعد | ✅ كما في §3 |

---

## 5. الخطوات التالية مرتبة بالخطورة

| الأولوية | البند | الحجم | Requires قرار تجاري؟ |
|---|---|---|---|
| 1 | G-03 مسار إنتاج ملك المطحنة (أمر إنتاج، مخطط/فعلي، فاقد بسبب، تكلفة، إضافة للمخزون) + تقرير الإنتاج | كبير | نعم — قاعدة التكلفة (متوسط متحرك أم معياري) |
| 2 | G-06 اختبار قبول SQL (10 سيناريوهات من التوجيه) | متوسط | لا |
| 3 | G-05 حالة خطأ صريحة في شاشات المطحنة الأربع | متوسط | لا |
| 4 | G-04/G-16/G-17 عرض أمانات ومخزون وتكلفة/هامش في شاشة التقارير مع وسم "مرجعي" | متوسط | نعم — هل التكلفة مرجعية أم فعلية افتراضياً |
| 5 | ~~G-09 ترحيل الأمرين القديمين إلى عقد~~ | صغير | ✅ **تم** — استُعيدت من بنود مطبَّقة |
| 6 | ~~G-22 قرار RLS لـ `stock_positions`~~ | صغير | ✅ **تم** — `security_invoker` + سحب صلاحية anon |
| 7 | G-07/G-08 جدول صوامع مُدار | متوسط | لا |

**توقّفت عند G-05/G-06 ولم أنفذهما في نفس الفرع** حفاظاً على صغر الفرع القابل للمراجعة؛ وكلاهما لا يتطلب قراراً تجارياً وسيكون الفرع التالي.

### G-10 — أخطاء بناء سابقة (منفصلة عن المطحنة)

`tsc --noEmit` يفشل في 5 مواضع على `main` قبل هذا الفرع (`inventory.tsx` مقارنة `lang`، و`vite.config.ts` بعد تثبيت الحزمة). البناء نفسه `npm run build` ينجح. لم ألمسها لأنها خارج نطاق المطحنة.