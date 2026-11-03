# دليل قاعدة البيانات المحلية على Docker — Market Hub ERP

> **الملف:** `supabase/docs/2026-10-11_guide_local-database-docker.md`
> **الجمهور:** المبرمج الذي يريد تشغيل قاعدة بيانات محلية على جهازه
> **النطاق:** **البيئة المحلية فقط** (Docker). لا يشرح السحابة.
> **الدليل السحابي:** `supabase/docs/2026-10-10_guide_database-operations.md` — دليل منفصل،
> لإنشاء مشروع Supabase سحابي ونقل النظام لعميل. لا تخلط بينهما.

> **المسار المعتمد الحالي:** `supabase/docs/2026-10-23_guide_local-cloud-setup.md`.
> إذا خالف مثال تاريخي أدناه هذا الدليل، فاتبع مسار التشغيل الموحد.

هذا الملف مكتوب من تجربة تشغيل حقيقية على Windows، ويسجّل **كل عقبة ظهرت
فعلاً** وكيف حُلّت. اقرأه إذا أردت تشغيل قاعدة محلية، أو إذا واجهت خطأً من
الأخطاء المذكورة هنا.

---

## الفهرس

1. [ما هي القاعدة المحلية ولماذا](#1-ما-هي-القاعدة-المحلية-ولماذا)
2. [المتطلبات](#2-المتطلبات)
3. [التشغيل الأول خطوة بخطوة](#3-التشغيل-الأول-خطوة-بخطوة)
4. [ما يعمل وما لا يعمل بعد التشغيل](#4-ما-يعمل-وما-لا-يعمل-بعد-التشغيل)
5. [المشاكل التي واجهناها فعلاً](#5-المشاكل-التي-واجهناها-فعلاً)
6. [تشغيل الترحيلات والبذور محلياً](#6-تشغيل-الترحيلات-والبذور-محلياً)
7. [التحقق من سلامة البيانات](#7-التحقق-من-سلامة-البيانات)
8. [مرجع سريع](#8-مرجع-سريع)
9. [ربط المشروع المحلي من الطرفية — خطوة بخطوة](#9-ربط-المشروع-المحلي-من-الطرفية--خطوة-بخطوة)
10. [المسار المعتمد اليوم](#10-المسار-المعتمد-اليوم)

---

## 1. ما هي القاعدة المحلية ولماذا

`supabase start` يشغّل نسخة كاملة من منصة Supabase **على جهازك** داخل حاويات
Docker. لا اتصال بالإنترنت بعد التنزيل الأول، ولا يمسّ بيانات عملائك.

**لماذا نستخدمها؟** لأنها الطريقة الوحيدة الآمنة للتأكد أن الترحيلات والبذور
تُبنى من الصفر بلا أخطاء (`db reset`) قبل أن نلمس أي شيء سحابي.

الحاويات التي تُشغَّل (بحسب الخدمات المفعّلة في config المحلي):

| الحاوية | الوظيفة |
|---|---|
| `supabase_db_*` | **قاعدة Postgres — هذه ما يهمّنا** |
| `supabase_auth_*` | خدمة المصادقة |
| `supabase_rest_*` | PostgREST (واجهة REST) |
| `supabase_realtime_*` | البثّ اللحظي |
| `supabase_storage_*` | تخزين الملفات |
| `supabase_studio_*` | لوحة تحكم محلية |
| `supabase_kong_*` | البوابة |
| `supabase_inbucket_*` | بريد وهمي للاختبار |
| `supabase_pg_meta_*` | بيانات وصفية |
| `supabase_edge_runtime_*` | الدوال الحافة |
| `supabase_vector_*` | التحليلات |

---

## 2. المتطلبات

| الأداة | الحد الأدنى | كيف تتحقق |
|---|---|---|
| **Docker Desktop** | يعمل ويستجيب | `docker info --format "{{.ServerVersion}}"` |
| **Node.js** | 18+ (المُثبَّت لدينا 22.14.0) | `node --version` |
| **مساحة قرص** | ~3 غيغابايت للصور | — |
| **ذاكرة RAM** | ~4 غيغابايت متاحة | — |

**لا تحتاج** تثبيت Supabase CLI عالمياً. نستخدم `npx supabase` الذي يستعمل
النسخة في `node_modules` أو ينزّلها مؤقتاً.

### إن لم يعمل أمر ما في الطرفية

إن أعطت الطرفية `The term 'docker' is not recognized` أو مثله، فتأكد أن هذه
المسارات في PATH:

```
C:\Program Files\Docker\Docker\resources\bin
C:\Program Files\nodejs
C:\Program Files\Git\cmd
```

للتحقق:

```powershell
[Environment]::GetEnvironmentVariable("Path","User") -split ';' |
  Where-Object { $_ -match "Docker|nodejs|Git" }
```

> **إن كانت المسارات موجودة فعلاً** ومع ذلك لا تعمل الأوامر، فالسبب أن جلستك
> لم تُحدَّث بعد تعديل PATH. **أغلق نافذة الطرفية وافتح واحدة جديدة** — الجلسة
> الجديدة تقرأ PATH المحدّث. هذا ما حدث معنا بالضبط.

---

## 3. التشغيل الأول خطوة بخطوة

### الخطوة 1 — شغّل Docker Desktop

**لا تتخطَّ هذه الخطوة.** أي أمر `supabase` قبل أن يستجيب Docker سيفشل.

```powershell
docker info --format "{{.ServerVersion}}"
```

إن أعطى رقماً (مثل `29.7.2`) فالديمون جاهز. إن أعطى `error during connect`
فانتظر قليلاً وأعد المحاولة — Docker Desktop يستغرق ~دقيقة ليستجيب بعد فتحه.

### الخطوة 2 — شغّل القاعدة

```powershell
cd c:\Users\mousa\Desktop\project\market-hup
npx supabase start
```

**انتبه:** أول تشغيل **ينزّل نحو غيغابايت** من الصور، ويستغرق **عدة دقائق**.
قد تنتهي مهلة طرفيتك قبل أن ينتهي هو — لا يعني ذلك فشلاً، بل استمر في العمل.

**الأمر المفضل:**

```powershell
npm run db:local:start
```

للتحقق من عناوين الخدمات:

```powershell
npm run db:local:status
docker ps --filter "name=supabase_" --format "table {{.Names}}`t{{.Status}}"
```

> **إن ظهرت رسالة `The process cannot access the file ... because it is being
> used by another process`** فمعناه أن نسخة سابقة من `supabase start` لا تزال
> تكتب في السجل. لا تشغّل نسختين في آن واحد — انظر المشكلة 5.5.

### الخطوة 3 — تحقق من النجاح

عند الانتهاء تطبع الطرفية جدولاً فيه العنوان والمفاتيح:

```
│ URL │ postgresql://postgres:postgres@127.0.0.1:5432/postgres │
```

وتحقق من الحاويات:

```powershell
docker ps --format "{{.Names}}: {{.Status}}"
```

النتيجة السليمة: قاعدة البيانات وAuth وREST وGateway وStudio وStorage تعمل؛
قد تبقى خدمات اختيارية مثل imgproxy أو pooler متوقفة بحسب الإعداد.

```
supabase_db_kwzqvgdyadylwnvjghqn: Up X minutes (healthy)
supabase_auth_kwzqvgdyadylwnvjghqn: Up X minutes (healthy)
supabase_rest_kwzqvgdyadylwnvjghqn: Up X minutes
supabase_kong_kwzqvgdyadylwnvjghqn: Up X minutes (healthy)
```

### تسجيل الدخول المحلي

بعد `npm run db:local:rebuild`، حسابات التطوير الأربعة لها كلمات مرور وهويات
بريد وهاتف. كلمة مرور التطوير `Super#2004`. يمكن تسجيل الدخول بالبريد أو
بالهاتف للحساب التجريبي `+967772217218`؛ إعداد `auth.sms.test_otp` يثبت الرمز
المحلي على `123456` بلا إرسال SMS خارجي. لا تستخدم الحسابات أو الرمز في السحابة.

---

## 4. ما يعمل وما لا يعمل بعد التشغيل

| الخدمة | العنوان |
|---|---|
| API | `http://127.0.0.1:54321` |
| Database | `postgresql://postgres:postgres@127.0.0.1:5432/postgres` |
| Studio | `http://127.0.0.1:54323` |
| Inbucket (بريد) | `http://127.0.0.1:54324` |

> ⚠️ **المفاتيح المطبوعة افتراضية ومشتركة.** كلها للتطوير المحلي فقط. لا
> تستخدمها في أي بيئة حقيقية، وكل الخدمات مرتبطة بـ `0.0.0.0` فهي مرئية من
> شبكتك المحلية.

### الاتصال بقاعدة البيانات المحلية

كلمة المرور ثابتة: `postgres`. ولست بحاجة إلى `DATABASE_URL` معقّد:

```
postgresql://postgres:postgres@127.0.0.1:5432/postgres
```

---

## 5. المشاكل التي واجهناها فعلاً

هذا القسم هو **قلب هذا الملف**: كل مشكلة قابلناها بالحرف، وسببها، وحلّها.

### 5.1 `The term 'docker' is not recognized as the name of a cmdlet`

**الأعراض:** كل أوامر Docker وGit وNode تفشل بالرسالة نفسها، مع أنك تعرف
أنها مثبتة.

**السبب الحقيقي (مهم):** المسارات كانت **موجودة** في PATH على مستوى المستخدم
والنظام، لكن الجلسة الطرفية الحالية **لم تكن تحمّلها**. هذا ما حدث معنا —
والسبب أن بيئة تشغيل الوكيل كانت مُقيَّدة بـ PATH مختصر.

**الحل:**
```powershell
# تحقق هل المسار مكتوب فعلاً
[Environment]::GetEnvironmentVariable("Path","User") -split ';' |
  Where-Object { $_ -match "Docker|nodejs" }
```

إن كانت المسارات موجودة، فالعلاج **إعادة فتح الطرفية**، أو مؤقتاً في الجلسة
الحالية:

```powershell
$env:Path += ";C:\Program Files\Docker\Docker\resources\bin;C:\Program Files\Git\cmd"
```

**درس:** لا تظنّ المسار مفقوداً حتى تتحقق من `GetEnvironmentVariable`. غالباً
هو موجود والمشكلة في الجلسة.

### 5.2 `error during connect` / `Cannot connect to the Docker daemon`

**السبب:** Docker Desktop لم يبدأ بعد.

**الحل:** افتحه وانتظر حتى تصبح أيقونته خضراء، ثم:
```powershell
docker info --format "{{.ServerVersion}}"
```

### 5.3 `supabase start is already running` مع خدمات متوقفة

إذا قال `supabase start` إن البيئة تعمل، لكن `docker ps` يظهر قاعدة البيانات
فقط وبقية الخدمات `Exited`، أوقف حاويات هذا المشروع مع إبقاء volumes، ثم ابدأها:

```powershell
supabase stop --project-id kwzqvgdyadylwnvjghqn
npm run db:local:start
npm run db:local:status
```

لا تستخدم `--no-backup` أو تحذف Docker volumes. إذا أردت مطابقة schema مع
المigrations الحالية، استخدم `npm run db:local:rebuild`؛ هذا يمسح قاعدة Docker
بعد عبارة تأكيد، لكنه لا يستهدف السحابة.

### 5.4 `The '<' operator is reserved for future use`

**الأعراض:** حاولت تمرير ملف SQL إلى psql:
```powershell
docker exec -i supabase_db_xxx psql -U postgres -d postgres -f - < seed.sql
# The '<' operator is reserved for future use.
```

**السبب:** **PowerShell لا يدعم `<` أصلاً.** هذا عامل مخصص لـ Bash/cmd. ليس
خطأً في Docker ولا في psql — هو قيد في الصدفة نفسها.

**الحل — استخدم `docker cp`:**

```powershell
docker cp supabase\seeds\01_system\05_expense_categories.sql supabase_db_kwzqvgdyadylwnvjghqn:/tmp/seed.sql
docker exec supabase_db_kwzqvgdyadylwnvjghqn psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/seed.sql
```

هذه هي الطريقة التي استخدمناها فعلاً وهي الأكثر موثوقية.

### 5.5 `syntax error at or near ""` — علامة BOM تالفة

**الأعراض:** جرّبت البديل الأنبوبي فظهر:
```
ERROR:  syntax error at or near ""
LINE 1: -- ========================================================...
        ^
```

لاحظ الرمز الغريب `""` قبل التعليق.

**السبب:** الأمر الذي استخدمته كان:
```powershell
Get-Content file.sql -Raw | docker exec -i ...
```
`Get-Content -Raw` في PowerShell **يسبق المحتوى بعلامة BOM** (`U+FEFF`) عند
تمريره عبر الأنبوب. Postgres يراها حرفاً غريباً قبل `--` فيرفض السطر.

**الحل:** استخدم `docker cp` (المشكلة 5.3). فهو ينسخ الملف **بايتاً ببايت**
بلا إضافة أي شيء.

> **بديل جزئي:** إن أضفت تحويل ترميز صريحاً قد يُحَلّ الأمر، لكن `docker cp`
> أنظف وأضمن. لا تعتمد على الأنبوب في ملفات SQL.

### 5.6 `The process cannot access the file 'supabase-start.log' because it is being used by another process`

**السبب:** نسخة سابقة من `supabase start` لا تزال تعمل وتكتب في الملف.

**الحل:** لا تشغّل نسختين في آن واحد. تحقق:
```powershell
Get-Process -Name "supabase","node" -ErrorAction SilentlyContinue |
  Select-Object Name,Id,StartTime | Sort-Object StartTime -Descending
```

إن وُجدت نسختان، أوقف الوكيل القديم أو انتظر انتهاءه. **ملاحظة:** إن كان
`supabase start` يعمل في الخلفية فعلاً، فأنت لا تحتاج تشغيله مجدداً — فقط
راقب السجل:

```powershell
Get-Content supabase-start.log -Tail 10
```

### 5.7 حاوية `supabase_vector_*` تُعيد التشغيل باستمرار

**الأعراض:**
```
supabase_vector_kwzqvgdyadylwnvjghqn: Restarting (0) 47 seconds ago
```
مع تحذير في السجل:
```
WARNING: Analytics on Windows requires Docker daemon exposed on tcp://localhost:2375.
```

**السبب:** خدمة التحليلات تحتاج ديمون Docker مكشوفاً على منفذ TCP، وهو **غير
مفعّل افتراضياً على Windows**.

**الأثر: لا شيء يمسّ قاعدة بياناتك.** التحليلات فقط معطّلة. كل الحاويات الأخرى
تعمل سليمة، و`db reset` يعمل بلا مشكلة. **تجاهل هذا التحذير.**

**إن أردت إسكاته:** Docker Desktop ← Settings ← General ← فعّل
`Expose daemon on tcp://localhost:2375 without TLS` ← Apply & Restart.

> لا تفعل هذا على جهاز بعيد عن الثقة: كشف الديمون على TCP بلا TLS خطر أمني.

### 5.8 الطرفية "تتوقف" عند 120 ثانية

**الأعراض:** ينتهي الأمر برسالة `Command exceeded 120s and was terminated`.
أو بلا مخرجات إطلاقاً.

**السبب:** هذه **مهلة طرفيتك**، لا فشل الأمر. الصور ما زالت تُنزَّل، و`supabase
start` يعمل في الخلفية بحق.

**الحل:** شغّله مسجّلاً المخرجات إلى ملف (الخطوة 2)، وتابع بـ
`Get-Content supabase-start.log -Tail 10`. **لا تُعد التشغيل** — ستتعارض
النسختان (المشكلة 5.5).

### 5.9 `Cannot find project ref. Have you run supabase link?`

**الأعراض:** عند تشغيل `npx supabase migration list`.

**السبب:** هذا الأمر افتراضه مقارنة المحلي بالسحابي، وأنت لم تربط مشروعاً
سحابياً — وهذا **صحيح ومتوقّع** في العمل المحلي.

**الحل:** لمعرفة عدد الترحيلات المطبَّقة محلياً، استعلم القاعدة مباشرة:
```powershell
npx supabase db query "SELECT count(*) FROM supabase_migrations.schema_migrations;"
```

---

## 6. تشغيل الترحيلات والبذور محلياً

### 6.1 إعادة بناء القاعدة من الصفر

```powershell
npm run db:local:rebuild
```

هذا هو الأمر المعتمد الآن. يبدأ خدمات Docker، ويطلب كتابة
`RESET LOCAL kwzqvgdyadylwnvjghqn`، ثم يمحو **قاعدة Docker المحلية فقط** ويعيد
إنشاءها من جميع migrations الحالية (01–55)، ويشغّل بذور النظام، ثم يضيف عيّنة
المطحنة ويتحقق من أعداد الجداول والبيانات.

> ⚠️ **لا تشغّله على السحابة أبداً.** محلي فقط.

للتشغيل اليومي من دون حذف البيانات:

```powershell
npm run db:local:start
npm run db:local:status
```

لا تستخدم `supabase db reset --linked` لهذا المشروع. خياره `--linked` يستهدف
قاعدة السحابة المرتبطة، وليس Docker.

### 6.2 البذور وبيانات العينة

`supabase/config.toml` يشغّل بذور النظام الآمنة تلقائيًا. بيانات المطحنة
التجريبية لا تُشغّل تلقائيًا عند reset عام؛ سكربت `db:local:rebuild` يشغّلها
صراحةً بعد نجاح migrations. هذا يمنع تسريب منتجات وعملاء تجريبيين إلى قاعدة
عميل سحابية جديدة.

حسابات المنصة التجريبية الأربعة تستخدم كلمة مرور محلية واحدة `Super#2004`.
هذه الحسابات للتطوير، ولا تستخدمها في مشروع إنتاج. تفعيلها محليًا جزء من
إعادة البناء المحلية فقط.

إن احتجت تشغيل seed محلي يدويًا:

```powershell
supabase db query --local --file supabase/seeds/03_samples/sample-mill.sql
```

لا تشغّل هذا الملف على السحابة إلا لمشروع تجريبي قابل للمسح وبعد مراجعة
الدليل الموحد.

### ملاحظة تاريخية: البذور النظامية يدوياً

الخطوات التالية مخصصة فقط لتشخيص قاعدة قديمة؛ المسار الطبيعي هو السكربت أعلاه.

الترتيب **مقصود** — كل ملف يعتمد على ما قبله:

| # | الملف | لماذا هذا الترتيب |
|---|---|---|
| 1 | `01_modules.sql` | الوحدات أولاً |
| 2 | `02_plans.sql` | يفحص أن وحدات كل باقة مسجّلة في `platform_modules` |
| 3 | `03_chart_of_accounts.sql` | الحسابات |
| 4 | `04_units.sql` | الوحدات |
| 5 | `05_expense_categories.sql` | يحلّ الحساب **بالكود** من `accounts` |
| 6 | `06_platform_admins.sql` | حسابات المنصة (بلاها لا لوحة إدارية) |
| 7 | `07_document_numbering.sql` | إعداد الترقيم — محرّك 14 يقرأ منه |
| 8 | `08_payment_methods.sql` | طرق الدفع + إعداد المنشأة — الترحيل 16 وحرّاس الكتابة يقرؤون منه |
| 9 | `09_essential_partners.sql` | الشركاء النظاميون الأساسيون |

> لو شغّلت `05_expense_categories.sql` قبل `03_chart_of_accounts.sql` لما وجد
> الحساب، ولرفع فحصه الذاتي استثناءً. وكذلك `07` و`08` يفحصان نوع المستند وكود
> الحساب بعد أن يوجدا.

**الأمر الذي استخدمناه فعلاً (يعمل على Windows):**

```powershell
$ref = (docker ps --format "{{.Names}}" | Select-String "supabase_db_").ToString()
foreach ($f in @("01_modules","02_plans","03_chart_of_accounts","04_units","05_expense_categories","06_platform_admins","07_document_numbering","08_payment_methods","09_essential_partners")) {
  Write-Host "--- $f ---"
  docker cp "supabase\seeds\01_system\$f.sql" "${ref}:/tmp/$f.sql"
  docker exec $ref psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f "/tmp/$f.sql"
}
```

**النواتج المتوقعة:**

| الملف | الناتج |
|---|---|
| 01_modules | `INSERT 0 14` |
| 02_plans | `INSERT 0 3` |
| 03_chart_of_accounts | `INSERT 0 58` |
| 04_units | `INSERT 0 13` |
| 05_expense_categories | `INSERT 0 11` |
| 06_platform_admins | `INSERT 0 4` (بيانات تطوير محلية فقط) |
| 07_document_numbering | `INSERT 0 16` |
| 08_payment_methods | `INSERT 0 13` (+ 6 صفوف إعداد) |
| 09_essential_partners | شركاء نظاميين ثابتين |

> **`-v ON_ERROR_STOP=1` مهم:** يجعل psql يتوقف عند أول خطأ بدل أن يكمل
> ويطبع نجاحاً كاذباً.

---

## 7. التحقق من سلامة البيانات

### 7.1 الأعداد

```powershell
npx supabase db query "SELECT (SELECT count(*) FROM units) AS units, (SELECT count(*) FROM accounts) AS accounts, (SELECT count(*) FROM platform_modules) AS modules, (SELECT count(*) FROM platform_plans) AS plans, (SELECT count(*) FROM expense_categories) AS expense_cats;"
```

| البيان | المتوقع |
|---|---|
| الوحدات | 13 |
| الحسابات | 83 |
| وحدات النظام | 14 |
| الباقات | 3 |
| تصنيفات المصروف | 11 |
| طرق الدفع | 13 |
| إعداد المنشأة (طرق الدفع) | 6 |
| أنواع المستندات | 16 |

### 7.2 لا بيانات أعمال تسرّبت

القاعدة النظيفة يجب أن تكون **صفراً** في كل هؤلاء:

```sql
SELECT
  (SELECT count(*) FROM public.products)         AS products,   -- 0
  (SELECT count(*) FROM public.customers)        AS customers,  -- 0
  (SELECT count(*) FROM public.inventory)        AS inventory,  -- 0
  (SELECT count(*) FROM public.sales_invoices)   AS invoices,   -- 0
  (SELECT count(*) FROM public.company_settings) AS company;    -- 0
```

إن ظهر رقم غير صفر، فتسرّبت بيانات أعمال إلى ملفات النظام — وهذا خطأ.

### 7.3 ربط تصنيفات المصروف بحساباتها

التصنيفات تحمل `account_id`، فيجب ألّا يبقى تصنيف نشط بلا حساب:

```powershell
npx supabase db query "SELECT c.name_ar, a.code AS account_code, a.name_ar AS account_name FROM expense_categories c LEFT JOIN accounts a ON a.id = c.account_id ORDER BY c.sort_order;"
```

**النتيجة الصحيحة — 11 صفاً، وكلها بكود حساب:**

| التصنيف | الحساب |
|---|---|
| إيجارات | 5313 |
| رواتب وأجور | 5221 |
| كهرباء ومياه | 5311 |
| مواصلات ونقل | 5315 |
| صيانة وإصلاح | 5314 |
| تعبئة وتغليف | 5316 |
| اتصالات وإنترنت | 5312 |
| مصروفات مكتبية | 5317 |
| تسويق وإعلان | 5318 |
| أتعاب مهنية | 5319 |
| مصروفات أخرى | 5911 |

### 7.4 الثبات — شغّل الملف مرتين

كل ملف نظام يجب أن يُشغَّل مرتين بلا خطأ ولا تكرار:

```powershell
docker cp supabase\seeds\01_system\05_expense_categories.sql "${ref}:/tmp/seed05.sql"
docker exec $ref psql -U postgres -d postgres -f /tmp/seed05.sql   # INSERT 0 11
docker exec $ref psql -U postgres -d postgres -f /tmp/seed05.sql   # INSERT 0 0  ← صحيح
```

المرة الثانية تعطي `INSERT 0 0` أي «لا جديد». إن أعطت `INSERT 0 11` فقد
**تضاعفت** الصفوف، وإن رمت `duplicate key` فقد غاب `ON CONFLICT`.

### 7.5 المفتاح الأجنبي موجود بسلوكه الصحيح

```powershell
npx supabase db query "SELECT conname, confdeltype FROM pg_constraint WHERE conrelid = 'public.expense_categories'::regclass AND contype = 'f';"
```

يجب أن يظهر `expense_categories_account_id_fkey` بـ `confdeltype = n`
(أي `ON DELETE SET NULL`) — فحذف حساب لا يجوز أن يحذف التصنيف.

### 7.6 كل طريقة دفع لها حساب (مهمّ محاسبيًا)

كل روشة دفع — بما فيها كل محفظة بالاسم — يجب أن ترحّل إلى حسابها الخاص، وإلا
اختلطت الأرصدة فلا يمكن مطابقة كشف المحفظة مع دفتر الأستاذ.

```powershell
npx supabase db query "SELECT m.id, m.name_ar, public.payment_method_ledger_account(m.id) AS acct FROM public.payment_methods m ORDER BY m.sort_order;"
```

**النتيجة الصحيحة:**

| الطريقة | الحساب |
|---|---|
| cash | 1101 |
| credit | NULL (لا يُحصَّل) |
| bank_transfer · kuraimi_bank · card · cheque | 1111 |
| yemen_kuwait_bank | 1121 |
| jawali | 1131 |
| jaib | 1132 |
| floosak | 1133 |
| one_cash | 1134 |
| mobile_money | 1139 |
| split | 1101 |

> وهذا ما يمنع الخلل الذي رُصد: قبل الإصلاح كانت المحافظ الخمس كلها ترحّل
> إلى `1111` (البنك)، فلا يمكن مطابقة أي محفظة. راجع
> `DATABASE_AUDIT_AND_FIX_REPORT.md` القسم 4.

---

## 8. مرجع سريع

| الأمر | ما يفعله |
|---|---|
| `npm run db:local:start` | يشغّل البيئة المحلية دون مسح القاعدة |
| `npm run db:local:status` | يعرض عناوين الخدمات المحلية |
| `npm run db:local:rebuild` | **يمحو ويعيد بناء Docker محليًا فقط** بعد عبارة تأكيد |
| `supabase db query --local "<SQL>"` | ينفّذ استعلامًا محليًا فقط |
| `npm run db:cloud:push -- -ProjectRef <ref>` | يطلب تأكيد المشروع ثم يطبق migrations والبذور المرجعية الآمنة على السحابة؛ لا reset |
| `npx supabase login` | يدخل بحساب Supabase للسحابة |
| `docker ps --format "{{.Names}}: {{.Status}}"` | يعرض الحاويات |
| `docker logs <auth-container> --tail 50` | يعرض رموز OTP المطبوعة محلياً |
| `docker cp <ملف> <حاوية>:/tmp/x.sql` | ينسخ ملفاً للحاوية (بديل `<`) |
| `docker exec <حاوية> psql -U postgres -d postgres -f /tmp/x.sql` | يشغّل ملف SQL |

### القاعدة الحاكمة على Windows

> **لا تمرّر ملف SQL إلى psql عبر `<` ولا عبر أنبوب PowerShell.**
> استخدم `docker cp` ثم `docker exec ... -f`. هذان هما الطريق الذي لا يفشل.

---

## 9. ربط المشروع المحلي من الطرفية — خطوة بخطوة

هذا القسم يجيب سؤالك مباشرةً: كيف تربط مشروع `market-hup` بقاعدة Docker المحلية
من طرفية PowerShell، وما الأخطاء التي قد تعترض الطريق.

### 9.1 الشرط المسبق — الأداة تُستدعى بالشكل الصحيح

الأمر `supabase db reset` وحده يعمل **فقط** إن كان Supabase CLI مثبتًا عالميًا.
عندنا CLI مثبّت كـ devDependency في `node_modules` (النسخة **2.120.0**)، فالأصحّ
استدعاؤه عبر `npx` من جذر المشروع:

```powershell
cd c:\Users\mousa\Desktop\project\market-hup
npx supabase <الأمر>
```

كل أوامر هذا القسم مكتوبة بـ `npx` لأنها الطريقة التي تنجح دائمًا.

### 9.2 الخطوات — من الصفر إلى قاعدة جاهزة

```powershell
# 0) تأكد أن Docker يستجيب (يجب أن يعطي رقم إصدار)
docker info --format "{{.ServerVersion}}"

# 1) انتقل إلى جذر المشروع
cd c:\Users\mousa\Desktop\project\market-hup

# 2) شغّل البيئة المحلية (أول مرة: عدة دقائق لتنزيل الصور)
npm run db:local:start

# 3) اطبع العناوين فقط؛ لا يعرض المفاتيح
npm run db:local:status

# 4) أعد بناء Docker المحلي حتى migration 55 وأضف بيانات المطحنة
npm run db:local:rebuild

# 5) نفّذ استعلامًا للتأكد (راجع القسم 7)
supabase db query --local "SELECT count(*) FROM public.accounts;"   # 83
```

**ماذا يعني `db reset` بالضبط؟** يمحو قاعدة `postgres` المحلية، ثم يعيد بناءها
بتطبيق كل ملفات `migrations/` بالترتيب، ثم يشغّل تلقائيًا
`seeds/01_system/*.sql`. لا يمسّ أي شيء سحابي.

### 9.3 الوصول من التطبيق (ربط الواجهة بالقاعدة المحلية)

بعد `npx supabase status` تظهر قيم تُوضع في ملف `.env.local` بجذر المشروع:

```dotenv
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<anon key من supabase status>
SUPABASE_SERVICE_ROLE_KEY=<service_role key من supabase status>
```

`supabase status` يطبع هاتين الكلمتين (anon / service_role). لا تكتبهما يدويًا —
انسخهما من مخرج الأمر. ثم شغّل الواجهة:

```powershell
npm run dev
```

**الاتصال المباشر بـPostgres** (مثلًا لعميل SQL):

```
postgresql://postgres:postgres@127.0.0.1:5432/postgres
```

### 9.4 خطأ `'auth' has invalid keys: enable_phone`

**العَرَض الكامل — كما ظهر عندك:**

```
PS C:\Users\mousa\Desktop\project\market-hup> supabase db reset
failed to parse config: decoding failed due to the following error(s):

'auth' has invalid keys: enable_phone
Try rerunning the command with --debug to troubleshoot the error.
```

**السبب:** `supabase/config.toml` كان يحوي مفتاحًا لا يعرفه CLI 2.120. مخطط الإعداد
في هذا الإصدار **مُحكم الإغلاق (closed)**: أي مفتاح لا يعرفه داخل قسم يُرفض،
**ويمنع `db reset` و`start` كليهما** — فهو خطأ إعداد لا خطأ قاعدة.

**الحل:** لا تضف `enable_phone` إلى قسم `[auth]` ولا تضف مزود SMS وهميًا؛ مفاتيح
Auth غير المعروفة تمنع CLI من بدء الخدمات أو reset.

**الاختبار المحلي:** يفعّل `supabase/config.toml` الرقم التجريبي المحدد في
`[auth.sms.test_otp]` مع OTP ثابت `123456`، ويتيح تسجيل الدخول بالبريد والهاتف
للحساب التجريبي بلا إرسال SMS. قد يطبع CLI تحذيرًا لعدم وجود مزوّد SMS خارجي؛
تحقق من `/auth/v1/settings` وجرّب تسجيل الدخول بدل الاعتماد على التحذير وحده.
لا تضع مزودًا وهميًا، ولا تستخدم رقم/OTP التجربة في السحابة أو لحساب حقيقي.

تأكد أولًا من إعداد Auth في `/auth/v1/settings` ثم اختبر البريد والهاتف للحساب
التجريبي. OTP `123456` صالح محليًا للرقم المحدد فقط؛ لا ترسله ولا تستخدمه سحابيًا.

### 9.5 كيف تعرف أن كل شيء سليم؟

```powershell
# عدد الترحيلات المطبقة — 52 ملفًا حاليًا، وأعلى نسخة 55 (توجد فجوات ترقيم مقصودة)
supabase db query --local "SELECT count(*) AS migrations, max(version) AS latest FROM supabase_migrations.schema_migrations;"

# الجداول — 84 في المخطط المعتمد الحالي
supabase db query --local "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"

# لا جدول بلا RLS — المتوقع صفر صفوف
supabase db query --local "SELECT tablename FROM pg_tables WHERE schemaname='public' AND NOT rowsecurity;"

# صفر بيانات أعمال في قاعدة جديدة
supabase db query --local "SELECT (SELECT count(*) FROM public.products) AS products, (SELECT count(*) FROM public.company_settings) AS company;"
```

### 9.6 إن أردت ربط مشروع سحابي (لاحقًا)

العمل المحلي **لا يحتاج** `supabase link`. أما الربط السحابي فيحتاج:

```powershell
npx supabase login
npm run db:cloud:push -- -ProjectRef <project-ref>
```

> ⚠️ لا تشغّل `db reset` على مشروع سحابي أبدًا — العملية تُفقد البيانات.
> أمر السحابة يتحقق من معرف المشروع وconnection URL، ولا يزرع بيانات demo افتراضيًا.
> التفاصيل في `supabase/docs/2026-10-10_guide_database-operations.md`.

---

## 10. المسار المعتمد اليوم

الأوامر القديمة في أمثلة أو سجلات الأقسام السابقة توثّق محاولات تاريخية.
للتشغيل الحالي استخدم [الدليل الموحد المحلي والسحابي](2026-10-23_guide_local-cloud-setup.md).
المحلي يُبنى بـ`npm run db:local:rebuild`، والسحابي يُحدّث بـ
`npm run db:cloud:push -- -ProjectRef <ref>` فقط. لا يوجد أمر مشترك يعيد ضبط
القاعدتين معًا، عمداً.

---

## المراجع

| الملف | الدور |
|---|---|
| `supabase/docs/2026-10-10_guide_database-operations.md` | **الدليل السحابي** — مشروع جديد ونقل لعميل |
| `supabase/DATABASE_AUDIT_AND_FIX_REPORT.md` | تقرير تدقيق البيانات والإصلاحات الأخيرة |
| `supabase/docs/2026-10-12_guide_migrations-rules.md` | قانون الترحيلات والبيانات (ملزم) |
| `supabase/migrations/README.md` | الدليل المعماري للبنية |
| `supabase/seeds/README.md` | دليل البيانات |
| `supabase/SCHEMA_REFERENCE.md` | مرجع الجداول والدوال |
