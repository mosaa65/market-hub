# تسليم العمل — نظام المطحنة ومحرك التكلفة والدفتر

> **التاريخ:** 2026-10-04
> **الفرع الأخير (والذي يُدمج):** `feat/production-to-ledger`
> **الهدف:** 16 استBranches، 26 migration، 181 فحص قبول — كل ما تبقّى موثّق هنا ليُكمَل غداً.

---

## 1. ✅ التحقق من الدمج — الجواب المباشر

**الفرع `feat/production-to-ledger` يُدمج في `main` بلا أي تعارض.** وقد تحققتُ من ذلك أربع طرق مستقلة:

| طريقة | النتيجة |
|---|---|
| `git merge-tree` مقابل `origin/main` | `EXIT 0` — نظيف |
| `git merge-tree` مقابل `origin/app` (فرع Vercel) | `EXIT 0` — نظيف |
| **دمج حقيقي** في worktree منفصل | `Fast-forward` — بلا تعارض، صفر علامات تعارض في الملفات |
| **بناء على نتيجة الدمج** | `npm run build` → **exit 0** |

وقبل أن أعتمد على `merge-tree` تحققتُ من **دلالته نفسها** في مستودع اختبار مصنوع فيه تعارض متعمَّد: أعاد `EXIT 1` مع إظهار الملفين المتعارضين. أي أن `EXIT 0` في حالتنا **ضمان لا مجاملة**.

### لا تحتاج دمج الفروع الـ14 السابقة

كل فرع **يحتوي** سابقه (تحققتُ بـ `git merge-base --is-ancestor` لكل واحد). دمج الفرع الأخير وحده يجلب العمل كاملاً:

```
fix/milling-intake-guard-and-grade-rls
  → feat/stock-positions-rls
    → feat/item-classification-costing-policy
      → feat/cost-engine
        → feat/production-orders
          → fix/milling-job-agreement-backfill
            → feat/production-ui
              → feat/milling-reports
                → feat/error-states
                  → feat/opening-balances-ui
                    → fix/legacy-items-and-standard-cost
                      → feat/general-ledger
                        → feat/invoice-to-ledger
                          → feat/purchase-to-ledger
                            → feat/production-to-ledger   ← ادمج هذا فقط
```

### سلامة الـ migrations على الفرع المدموج

- **26 ملفاً، ترتيب زمني صارم بلا قفزة واحدة**
- **صفر تطابق في الطوابع الزمنية**
- ⚠️ **لا تعدّل أي migration مطبَّقة أبداً** — الأسلوب المتبع هنا هو: تعديل الملف **للمستقبل** + migration تصحيحية جديدة supersede للمطبَّق. لو غيّرت `20261203020000` بعد تطبيقه على القاعدة، لن يُعاد تشغيله على جهازك ولا على أي بيئة أخرى.

### ⚠️ القرص ممتلئ — نظّفه قبل أي عمل

```
C:  510 GB مستخدم · ~150 MB حرّ فقط
```

أضفتُ هذا التحذير مرتين، وقد أدّى مرتين إلى فشل **فحص المتصفح** و**بناء نسخة الدمج**. احذف `node_modules` داخل أي worktree تجريبي فوراً بعد استخدامه (استخدم `cmd /c rmdir /s /q` إن رفض PowerShell الحذف بسبب junction). فراغ 2 غيغابايت على الأقل قبل العمل غداً.

---

## 2. ما بُني — قائمة كاملة

### المرحلة الأولى: إصلاحات حرجة في النظام القائم

| # | الفرع | ماذا |
|---|---|---|
| 1 | `fix/milling-intake-guard-and-grade-rls` | `milling_grain_grades` كانت بلا RLS — دور `anon` كان **يعدّل** حدود الرطوبة والشوائب التي يعتمد عليها فحص الاستلام. أُغلق، وأُلغي مسار استلام بلا فحص درجة |
| 2 | `feat/stock-positions-rls` | `stock_positions` عرض بلا `security_invoker` فكان يتجاوز RLS ويقرأ أي زائر أرصدة المخزون الحقيقية |

### المرحلة الثانية: أساس التكلفة

| # | الفرع | ماذا |
|---|---|---|
| 3 | `feat/item-classification-costing-policy` | التصنيف الخماسي `item_class` (خام/نهائي/جانبي/خدمة/غير مخزني) + إعداد التكلفة العام على مستوى الشركة |
| 4 | `feat/cost-engine` | `item_cost_layers` + `item_cost_transactions` + `resolve_unit_cost`. **أصلح خطأً في محرك المخزون الأساسي** |
| 5 | `feat/milling-reports` | `milling_margin_report` (مع تمييز ACTUAL/REFERENCE) + `milling_inventory_report` (ملك المطحنة فقط) |

### المرحلة الثالثة: دورة الإنتاج والأرصدة

| # | الفرع | ماذا |
|---|---|---|
| 6 | `feat/production-orders` | `production_orders` + BOM + 5 دوال. **وأصلح مضاعفة تكلفة في محرك الإنتاج** |
| 7 | `feat/opening-balances` | قيد افتتاحي واحد بأقسامه الثمانية + توازن إجباري + عكس |
| 8 | `fix/milling-job-agreement-backfill` | ربط الأمرين القديمين بعقودهما بأثر رجعي (تحقّق من الفاتورة كبوابة) |
| 9 | `fix/legacy-items-and-standard-cost` | تصنيف 11 صنفاً قديماً + `standard_cost_readiness` |

### المرحلة الرابعة: الواجهات

| # | الفرع | ماذا |
|---|---|---|
| 10 | `feat/production-ui` | شاشة الإنتاج كاملة |
| 11 | `feat/opening-balances-ui` | شاشة القيد الافتتاحي مبنية حول الفرق |
| 12 | `feat/error-states` | أصلح **طبقة البيانات** (17 موقعاً كانت تبلع الخطأ) + حراس في 6 شاشات |

### المرحلة الخامسة: المحاسبة

| # | الفرع | ماذا |
|---|---|---|
| 13 | `feat/general-ledger` | دليل حسابات يمني + قيد مزدوج + ميزان مراجعة |
| 14 | `feat/invoice-to-ledger` | ترحيل فواتير المبيعات |
| 15 | `feat/purchase-to-ledger` | ترحيل فواتير المشتريات + حساب ضريبة مدخلات 1316 |
| 16 | `feat/production-to-ledger` | ترحيل أوامر الإنتاج عبر WIP — **وكشف خطأ تسعير قديم** |

---

## 3. ❗ الدروس التي تكلّف وقتاً — لا تُكرَّرها

### أ) `NULLS NOT DISTINCT` على أي عمود قابل للـ NULL داخل مفتاح فريد

العلة ظهرت **مرتين** في جدولين، وتسببت في **فشل صامت**:

```
inventory      → كل حركة صرف على رصيد شركة كانت تفشل (صامتاً)
item_cost_layers → كل استلام كان يُدرج صفاً جديداً بدل أن يجمع
```

`ON CONFLICT (أعمدة)` مع عمود `NULL` لا يتطابق أبداً، فيسقط إلى `INSERT`، فيصطدم بقيد أقوى.

### ب) جسم دالة SQL لا يُصرَّف إلا عند أول تنفيذ

`migration` ينجح، والجداول تُنشأ، والدالة **معطوبة كلياً** — ولا تكتشفها إلا أول استدعاء. **التحقق من تطبيق الـ migration لا يعني أن الـ migration صحيح.**

### ج) اختبار واحد للإعداد الافتراضي لا يلتقط خطأً في غير الافتراضي

مضاعفة تكلفة النخالة في الإنتاج كانت حيّة منذ بنائها، ولم تظهر إلا حين شغّل الاختبار `NET_REALISABLE_VALUE`:
- `REMAINDER_TO_PRIMARY` → حصة النخالة صفر → الفرعان غير قابلين للتمييز
- الاختبار الثاني كشف `416.67` ريال من تكلفة لم تُتكبَّد

**اعتمد اسأل دائماً: أي فرع آخر لم يمرّ به هذا الاختبار؟**

### د) علامات الترميز النصي

خطأ واحد `#` بدل `--` يُفشل ملف migration. PowerShell `Set-Content -Encoding UTF8` يضيف BOM يرفضه PostgreSQL — **استخدم `write` tool للملفات لا PowerShell**.

### هـ) لا تُحرّر ملفات الاختبار بـ PowerShell

`$t.Replace(...)` كسر مراراً ملفات JS من UTF-8 إلى UTF-16. استخدم `edit` tool.

---

## 4. 🔴 ما تبقّى — مرتّب بالأولوية

### 4.1 ترحيل الرصيد الافتتاحي إلى الدفتر — **يحتاج قرارك**

آخر نوع مستند. ثلاثة أقسام لها حسابات (`STOCK`, `RECEIVABLE`, `PAYABLE`). وأربعة **لا تملك حساباً تُرحَّل إليه** لأنها مُسجَّلة فقط:

```
CASH · BANK · ASSET · LIABILITY
```

**السؤال 1:** حسابات نقدية وبنكية مفصّلة لكل مصرف؟ (1102 البنك الأهلي، 1113 مناحي كمر، …) — أرى نعم، للأرصدة اليومية حقيقية.
**السؤال 2:** أصول ثابتة تفصيلية أم حساب إجمالي؟ — أرى **إجمالي واحد**، فالأرشيف التفصيلي بلا سجل أصول حقيقي يسنده تخطيط للوهم.
**السؤال 3:** التزامات غير محدّدة أم تفصيل؟ — أرى غير محدّدة، مع إمكانية الإضافة لاحقاً.

> **توصيتي:** محدودة — حسابات نقدية وبنكية مفصّلة، أصول ثابتة بحساب واحد، التزامات غير محدّدة.

### 4.2 واجهة الدفتر — غير موجودة

`trial_balance` و`journal_entries` في القاعدة بلا شاشة. مطلوب:
- ميزان المراجعة (مرشَّح بالفترة)
- قائمة القيود مع ability التتبع من الفاتورة إلى السطر
- شاشة الإعداد (تبديل طريقة التكلفة، اعتماد المعايير)

### 4.3 واجهة التقارير التجارية — غير موجودة

`milling_margin_report` و`milling_inventory_report` في القاعدة بلا عرض. **الأهم:** عرض تحذير `cost_basis = REFERENCE` بشكل صريح في الواجهة لا في البيانات فقط.

### 4.4 قرارات محاسبية مؤجَّلة

| القرار | الافتراضي الحالي | ملاحظة |
|---|---|---|
| **نسبة الإهلاك** | لا يوجد حساب | 5611 موجود لكن `1491` غير قابل للترحيل المباشر إلا عبر إهلاك — **لا توجد آلية إهلاك بعد** |
| **نسبة ضريبة القيمة المضافة** | **صفر** | 2311 مستحقة (فاتورة) و 1316 مدخلات (شراء) — جاهزة، تنتظر نسبة |
| **تكلفة البضاعة المباعة** | متوسط الطبقة | ليس FIFO — موثّق في migration 20261202000000 |
| **أساس توزيع التكلفة المشتركة** | `REMAINDER_TO_PRIMARY` | النخالة بلا تكلفة، الدقيق يحمل الكل. البديلان جاهزان ومختبران |

### 4.5 بيانات تنتظر قراراً بشرياً

1. **11 صنفاً قديماً** (`LEGACY-BRAN-01..11`) — صنّفتها `BY_PRODUCT` بدليل أسماءها، لكن **وحداتها `NULL`** لأن الكميات مُدخلة بأكياس لا كيلوات. يحتاج أحدهم عدّ كيس وكيس 25 كيلو وتسجيل التحويل. **تأكد من التصنيف.**
2. **26 صنفاً بلا `standard_cost`** — `standard_cost_readiness` يعرض 7 بقيمة استرشادية من حركات فعلية، و19 تحتاج ميزانية يدوية. **إثبات قرار إداري لا هندسي.**
3. **`LEGACY-BRAN-03`**: تكلفة 13200 وبيع 12300 — خسارة 900 على كل كيس. بيانات لا حكم.

### 4.6 ما لم يُختبر بعد

- **واجهة الإنتاج لم تُختبر في متصفح** — تحتاج جلسة مسجّلة دخول. تحققتُ فقط أن التطبيق يقلع بلا أخطاء طرفية وأن المسارات تصل إلى بوابة الصلاحيات.
- **`npm run tsc --noEmit` يفشل بـ 5 أخطاء سابقة** في `_app.inventory.tsx` و`vite.config.ts` — خارج نطاق المطحنة، لم ألمسها. البناء نفسه `npm run build` ينجح.

---

## 5. كيف تبدأ غداً

### الاتصال بقاعدة البيانات

```powershell
cd c:\Users\mousa\Desktop\project\market-hup
$env:PATH="C:\Program Files\nodejs;C:\Program Files\Git\cmd;$env:PATH"
```

⚠️ **المضيف المباشر لا يُحلّ** في شبكتك — السكربتات تكتشف ذلك تلقائياً وتتحوّل إلى الـ pooler.

```powershell
# فحص سريع
& 'C:\Program Files\nodejs\node.exe' scripts\db-run.mjs "select count(*) from trial_balance"

# تطبيق migration
& 'C:\Program Files\nodejs\node.exe' scripts\db-apply.mjs supabase\migrations\<FILE>.sql
```

### كل اختبارات القبول الثمانية

```powershell
foreach ($s in 'accept-general-ledger','accept-invoice-ledger','accept-purchase-ledger',
               'accept-production-ledger','accept-production','accept-cost-engine',
               'accept-opening-balances','accept-commercial-reports',
               'accept-item-class-costing','accept-stock-rls') {
  $r = & 'C:\Program Files\nodejs\node.exe' "scripts\$s.mjs" 2>&1 | Select-Object -Last 1
  Write-Output "$s → $r"
}
```

**كل اختبار يعمل داخل معاملة مُلغاة** — لا يترك بيانات اختبارية. راجع بعده:

```powershell
& 'C:\Program Files\nodejs\node.exe' scripts\db-run.mjs @"
select (select count(*) from products where sku like 'PROBE%') probes,
       (select count(*) from journal_entries) entries,
       (select count(*) from inventory) inventory_rows
"@
```

### الترحيل للـ main

```powershell
git checkout main
git pull
git merge --no-ff feat/production-to-ledger
npm install && npm run build
```

**لا تستخدم `-X ours` ولا `-X theirs`** — لا حاجة إليها، الدمج نظيف. ولا تستخدم force push ولا تعِد كتابة تاريخ المنشور.

---

## 6. مبادئ لا تُكسر (من التوجيه الأصلي)

1. **فصل أمانات العميل عن مخزون الشركة** — حبوب العميل ونواتج طحنه أمانة. `inventory.owner_type` يفصلهما، والإنتاج يقرأ `owner_id IS NULL` حصراً.
2. **لا شراء وهمي، ولا تسوية مخزون تُسجَّل كمشتريات** — الرصيد الافتتاحي يُرحَّل بحركة `OPENING`.
3. **الفارق لا يختفي** — الفرق غير المفسَّر يُسجَّل فاقداً بسبب، ولا يُبتلع في متوسط.
4. **لا تسليم أكثر من الناتج**، ولا سعر مزدوج ل basis واحد.
5. **الضريبة صفر افتراضياً** — لا نسب مخترعة في أي مكان.
6. **نسبة الاستخلاص تُسجَّل ولا تُفرض** — لا يوجد حد افتراضي في أي مكان.
7. **`inventory` القيد الحالي لا يُمس** — بقرار صريح منك.
8. **لا تُعدّل migration مطبَّقة** — أضف migration تصحيحية.
9. **لا تكسر تاريخ Git المنشور.**

---

## 7. قائمة الملفات المهمة

| الملف | لماذا |
|---|---|
| `docs/plans/MILLING_GAP_MATRIX.md` | مصفوفة الفجوات بالحالة الدليلية (محدّثة جزئياً) |
| `supabase/migrations/` | 26 ملفاً — **الترتيب الزمني هو المعنى** |
| `scripts/accept-*.mjs` | 10 مجموعات قبول — **شغّلها بعد كل تغيير** |
| `scripts/db-run.mjs` / `db-apply.mjs` | استعلام وتطبيق |
| `src/lib/milling/index.ts` | طبقة بيانات المطحنة — **تبلع الأخطاء بعد 080000؟ لا، صُحّحت** |
| `src/lib/production/index.ts` | طبقة بيانات الإنتاج |
| `src/lib/opening-balances/index.ts` | طبقة بيانات الأرصدة |
| `src/components/milling/milling-ui.tsx` | `QueryErrorState` / `QueryErrorGuard` مشتركان |