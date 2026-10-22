# دليل تشغيل قاعدة البيانات — Market Hub ERP

> **الملف:** `docs/DATABASE_OPERATIONS_GUIDE.md`
> **الجمهور:** من يدير قاعدة البيانات أو ينقل النظام لعميل جديد
> **المتطلبات المسبقة:** قراءة `supabase/MIGRATIONS_RULES.md`

هذا الدليل يشرح **كل أمر تحتاجه**، ومتى تستخدمه، وما يفعله بالضبط. لا يفترض
معرفة سابقة بـ Supabase أو PostgreSQL.

---

## الفهرس

1. [المفاهيم الأساسية](#1-المفاهيم-الأساسية)
2. [الإعداد الأول للمشروع](#2-الإعداد-الأول-للمشروع)
3. [إنشاء قاعدة بيانات جديدة من الصفر](#3-إنشاء-قاعدة-بيانات-جديدة-من-الصفر)
4. [تشغيل ملفات البيانات (Seeds)](#4-تشغيل-ملفات-البيانات-seeds)
5. [نقل النظام إلى عميل جديد](#5-نقل-النظام-إلى-عميل-جديد)
6. [النسخ الاحتياطي والاسترجاع](#6-النسخ-الاحتياطي-والاسترجاع)
7. [استكشاف الأخطاء](#7-استكشاف-الأخطاء)
8. [مرجع الأوامر](#8-مرجع-الأوامر)
9. [أخطاء لا تفعلها](#9-أخطاء-لا-تفعلها)

---

## 1. المفاهيم الأساسية

### البنية مقابل البيانات

|             | البنية (Schema)                    | البيانات (Data)               |
| ----------- | ---------------------------------- | ----------------------------- |
| **أين**     | `supabase/migrations/`             | `supabase/seeds/`             |
| **ما هي**   | الجداول، الأعمدة، الدوال، السياسات | الصفوف: حسابات، وحدات، منتجات |
| **تتغير؟**  | نادرًا، وبترحيل جديد               | كثيرًا                        |
| **مشتركة؟** | نفسها لكل عميل                     | مختلفة لكل عميل               |

**القاعدة الذهبية:** البنية في الترحيلات، والبيانات في الـ seeds. **لا تخلط.**

### الثلاث بيئات

| البيئة                   | الغرض            | من يستخدمها |
| ------------------------ | ---------------- | ----------- |
| **محلية** (Local)        | تطوير واختبار    | المبرمج     |
| **تجريبية** (Staging)    | اختبار قبل النشر | الفريق      |
| **إنتاجية** (Production) | عميل حقيقي       | العميل      |

**لا تُشغّل أبدًا** ملفًا تجريبيًا على بيئة إنتاجية.

---

## 2. الإعداد الأول للمشروع

### 2.1 تثبيت الأدوات

```bash
# Node.js — لتشغيل التطبيق والـ seeds
node --version        # يجب 18 أو أحدث

# Supabase CLI — لإدارة قاعدة البيانات
npm install -g supabase
supabase --version

# psql — لتشغيل ملفات SQL مباشرة
psql --version
```

إن لم يكن `psql` مثبتًا، ثبّت PostgreSQL، أو استخدم محرر SQL في لوحة Supabase.

### 2.2 الملفات المطلوبة في المشروع

```
supabase/
├── config.toml          ← إعدادات المشروع ومسارات الـ seeds
├── migrations/          ← 13 ملف بنية
├── seeds/               ← البيانات
└── MIGRATIONS_RULES.md  ← القانون
```

### 2.3 ملف المتغيرات `.env`

يحتوي مفاتيح الاتصال. **لا يُرفع إلى المستودع أبدًا.**

```bash
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_PUBLISHABLE_KEY=eyJ...
SUPABASE_DB_PASSWORD=...
```

---

## 3. إنشاء قاعدة بيانات جديدة من الصفر

### 3.1 الطريقة الأولى: Supabase محلي (للتطوير)

```bash
# ابدأ Docker أولًا، ثم:
supabase start
```

سيطبع لك عناوين لوحة التحكم المحلية وقاعدة البيانات.

**لبناء المخطط والبيانات معًا:**

```bash
supabase db reset
```

**ما يفعله هذا الأمر بالضبط:**

| الخطوة | ما يحدث                                       |
| ------ | --------------------------------------------- |
| 1      | يحذف قاعدة البيانات المحلية **بالكامل**       |
| 2      | ينشئ قاعدة فارغة                              |
| 3      | يطبّق كل ملف في `migrations/` بالترتيب الرقمي |
| 4      | يطبّق ملفات `seeds/01_system/*.sql`           |

> ⚠️ **`db reset` يحذف كل شيء.** لا تشغّله على إنتاج أبدًا.

### 3.2 الطريقة الثانية: مشروع Supabase سحابي جديد

**الخطوة 1 — أنشئ المشروع** من [supabase.com](https://supabase.com):
New Project ← اختر المنطقة الأقرب لعميلك.

**الخطوة 2 — اربط المشروع محليًا:**

```bash
supabase link --project-ref <معرف-المشروع>
```

المعرف في رابط لوحة التحكم:
`https://supabase.com/dashboard/project/**abcdefghijk**`

**الخطوة 3 — طبّق الترحيلات:**

```bash
supabase db push
```

**ما يفعله:** يطبّق ملفات `migrations/` الجديدة فقط على القاعدة السحابية.

> ⚠️ **`db push` لا يُشغّل الـ seeds.** البيانات تُشغَّل يدويًا (القسم 4).

**الخطوة 4 — شغّل بيانات النظام:**

```bash
psql "$DATABASE_URL" -f supabase/seeds/01_system/01_modules.sql
psql "$DATABASE_URL" -f supabase/seeds/01_system/02_plans.sql
psql "$DATABASE_URL" -f supabase/seeds/01_system/03_chart_of_accounts.sql
psql "$DATABASE_URL" -f supabase/seeds/01_system/04_units.sql
psql "$DATABASE_URL" -f supabase/seeds/01_system/05_expense_categories.sql
```

أو شغّل كل الملفات بأمر واحد (PowerShell):

```powershell
Get-ChildItem supabase\seeds\01_system\*.sql | Sort-Object Name | ForEach-Object {
  Write-Host "تشغيل: $($_.Name)"
  psql "$env:DATABASE_URL" -f $_.FullName
}
```

أو Bash:

```bash
for f in supabase/seeds/01_system/*.sql; do psql "$DATABASE_URL" -f "$f"; done
```

### 3.3 متى يستخدم كل أمر؟

| الحالة                   | الأمر                                  |
| ------------------------ | -------------------------------------- |
| قاعدة محلية جديدة        | `supabase db reset`                    |
| قاعدة سحابية جديدة       | `supabase db push` ثم الـ seeds يدويًا |
| تعديل ملف migration قديم | **ممنوع** — أنشئ migration جديدًا      |
| إعادة بناء كاملة محليًا  | `supabase db reset`                    |

---

## 4. تشغيل ملفات البيانات (Seeds)

### 4.1 الأنواع الأربعة

| المجلد        | يُشغَّل                    | متى                    |
| ------------- | -------------------------- | ---------------------- |
| `01_system/`  | **تلقائيًا** في `db reset` | لا تفعل شيئًا محليًا   |
| `02_company/` | يدويًا                     | مرة لكل عميل جديد      |
| `03_samples/` | يدويًا                     | عند الحاجة لبيانات عرض |
| `04_tests/`   | من الاختبارات              | آليًا                  |

### 4.2 تشغيل ملف واحد

**PowerShell:**

```powershell
psql "$env:DATABASE_URL" -f supabase\seeds\03_samples\sample-mill.sql
```

**Bash / Linux / macOS:**

```bash
psql "$DATABASE_URL" -f supabase/seeds/03_samples/sample-mill.sql
```

**أو من لوحة Supabase:** SQL Editor ← الصق محتوى الملف ← Run.

### 4.3 ملفات النظام — بالترتيب

الترتيب **مقصود**، كل ملف يعتمد على ما قبله:

```bash
psql "$DATABASE_URL" -f supabase/seeds/01_system/01_modules.sql
psql "$DATABASE_URL" -f supabase/seeds/01_system/02_plans.sql
psql "$DATABASE_URL" -f supabase/seeds/01_system/03_chart_of_accounts.sql
psql "$DATABASE_URL" -f supabase/seeds/01_system/04_units.sql
psql "$DATABASE_URL" -f supabase/seeds/01_system/05_expense_categories.sql
```

**لماذا هذا الترتيب؟** لأن `02_plans.sql` يفحص أن كل وحدة تفتحها الباقة مسجّلة
في `platform_modules` — والوحدات في `01`. لو عكست الترتيب، يفشل الملف برسالة:

```
باقة تشير إلى وحدات غير مسجّلة في platform_modules: ...
```

### 4.4 التحقق بعد التشغيل

```sql
-- في محرر SQL
SELECT 'الوحدات'  AS البيان, count(*) FROM public.units
UNION ALL SELECT 'الحسابات',   count(*) FROM public.accounts
UNION ALL SELECT 'وحدات النظام', count(*) FROM public.platform_modules
UNION ALL SELECT 'الباقات',     count(*) FROM public.platform_plans
UNION ALL SELECT 'تصنيفات المصروف', count(*) FROM public.expense_categories;
```

**الأرقام المتوقعة:**

| البيان          | العدد |
| --------------- | ----- |
| الوحدات         | 13    |
| الحسابات        | ~52   |
| وحدات النظام    | 14    |
| الباقات         | 3     |
| تصنيفات المصروف | 10    |

### 4.5 هل البيانات صحيحة؟

هذا فحص مهم — يجب أن يكون **صفرًا** في قاعدة جديدة:

```sql
SELECT
  (SELECT count(*) FROM public.products)         AS المنتجات,   -- 0
  (SELECT count(*) FROM public.customers)        AS العملاء,     -- 0
  (SELECT count(*) FROM public.inventory)        AS المخزون,     -- 0
  (SELECT count(*) FROM public.sales_invoices)   AS الفواتير,    -- 0
  (SELECT count(*) FROM public.company_settings) AS هوية_الشركة; -- 0
```

إن ظهر أي رقم غير صفر، فمعنى ذلك أن بيانات أعمال تسرّبت إلى ملفات النظام.

---

## 5. نقل النظام إلى عميل جديد

### 5.1 الخطوات بالترتيب

```
1. أنشئ مشروع Supabase جديد للعميل
2. اربطه: supabase link --project-ref <المعرف>
3. طبّق البنية: supabase db push
4. شغّل بيانات النظام (6 ملفات من 01_system)
5. أنشئ حساب المالك الأول (قسم 5.2)
6. أنشئ المستودع الأول من شاشة المستودعات
7. أدخل الأرصدة الافتتاحية إن وُجدت (قسم 5.3)
8. العميل يحرّر هوية شركته من شاشة الإعدادات
```

> **الخطوة 4 تُنشئ أيضًا حسابات المنصة** (سوبر أدمن ودعم) من
> `06_platform_admins.sql` — لأن `db push` لا يشغّل البذور، شغّل هذا الملف
> يدويًا. وهو **للنظام لا للعميل**، وغيّر كلمات مروره فور التسليم.

### 5.2 إنشاء المالك الأول — **بلا كلمات مرور في ملفات**

كان المخطط يوفّر مُشغّلًا يرقّي **أول من يسجّل** إلى مالك تلقائيًا
(`bootstrap_first_owner`). **أُزيل** لأنه كان يمنح دورًا على أساس من سجّل
أولًا لا على أساس قرار: فيصبح أول مسجّل — عميلًا كان أو حسابًا تجريبيًا
متروكًا — مالكًا للنشر، ولا يمكن سحب الدور لاحقًا لأن القاعدة كانت في
المُشغّل لا في البيانات.

اليوم يُمنح دور المالك **صراحةً**:

1. أنشئ المستخدم من التطبيق أو بدالة `admin-create-user`.
2. امنحه الدور من صاحب صلاحية منحه — سوبر أدمن عبر شاشة المستخدمين.

وبذلك لا تدخل أي كلمة مرور إلى المستودع، والدور قابل للسحب لأنه صف في
`user_roles` لا قاعدة مخفيّة.

### 5.3 الأرصدة الافتتاحية

إن كان للعميل أرصدة سابقة (مخزون، ذمم، نقدية)، استخدم قالب العميل:

```bash
cp supabase/seeds/02_company/customer-template.sql.example acme-2026.sql
# عدّل الأرقام والمعرفات
psql "$DATABASE_URL" -f acme-2026.sql
```

> ⚠️ **أبقِ الملف المعبّأ خارج المستودع.** أضف `seeds/02_company/*.sql` إلى
> `.gitignore`.

### 5.4 ما لا يجب فعله عند نقل النظام

| ❌ لا تفعل                               | لماذا                           |
| ---------------------------------------- | ------------------------------- |
| تشغيل `sample-mill.sql` على قاعدة العميل | يُدخل منتجات وهمية في دفاتره    |
| تشغيل `db reset` على الإنتاج             | يحذف كل شيء                     |
| وضع كلمة مرور في ملف                     | تبقى في تاريخ المستودع          |
| نسخ بيانات عميل آخر                      | ممنوع قانونيًا ومحاسبيًا        |
| تشغيل `db push` على قاعدة مبنية          | يحاول إنشاء كائنات موجودة فيفشل |

---

## 6. النسخ الاحتياطي والاسترجاع

### 6.1 نسخة كاملة من البنية والبيانات

```bash
supabase db dump -f backup-$(date +%Y%m%d).sql
```

### 6.2 البنية فقط

```bash
supabase db dump --schema public -f schema-backup.sql
```

### 6.3 البيانات فقط

```bash
supabase db dump --data-only -f data-backup.sql
```

### 6.4 استرجاع نسخة

```bash
psql "$DATABASE_URL" -f backup-20261008.sql
```

> ⚠️ **الاسترجاع لا يحذف ما هو موجود.** إن أردت استرجاعًا نظيفًا، أنشئ قاعدة
> جديدة ثم استرجع فيها.

### 6.5 متى تأخذ نسخة؟

- **قبل** أي `db push` على الإنتاج
- **قبل** تشغيل أي ملف بيانات
- **قبل** أي `supabase db reset` على قاعدة فيها بيانات تهمّك
- **دوريًا** — أسبوعيًا على الأقل للإنتاج

---

## 7. استكشاف الأخطاء

### 7.1 `duplicate key value violates unique constraint`

**السبب:** ملف بيانات يُشغَّل مرتين بلا `ON CONFLICT`.

**الحل:** كل ملف يجب أن ينتهي إدخالاته بـ:

```sql
ON CONFLICT (name) DO NOTHING;   -- أو (code) أو (sku)
```

### 7.2 `relation "X" does not exist`

**السبب:** استعلام أو دالة تشير إلى جدول لم يُنشأ.

**الحل:** تأكد أن كل الترحيلات طُبّقت:

```bash
supabase migration list
```

### 7.3 `function "is_staff" does not exist`

**السبب:** سياسة RLS تعمل قبل تعريف الدالة.

**الحل:** الدوال في الملف `02` والسياسات في الملف `13`. تحقق من الترتيب.

### 7.4 `violates foreign key constraint`

**السبب:** ملف بيانات يحتوي معرّف UUID ثابتًا من قاعدة أخرى.

**الحل:** حلّ المعرّف بالاسم لا بالرقم:

```sql
-- ❌ خطأ
VALUES ('ac4a1521-8e10-47ee-8da1-8c4aa7dcc645', ...)

-- ✅ صحيح
SELECT (SELECT id FROM public.categories WHERE name = 'Wheat')
```

### 7.5 `column "X" is of type text[] but expression is of type jsonb`

**السبب:** مصفاة Postgres كُتبت كنص.

**الحل:**

```sql
VALUES ('{"core","pos"}'::text[])   -- مع التحويل الصريح
```

### 7.6 فشل `db reset` بلا رسالة واضحة

**الحل:** طبّق كل ملف منفردًا لتعرف أين يفشل:

```bash
for f in supabase/migrations/*.sql; do
  echo "=== $f ==="
  psql "$DATABASE_URL" -f "$f" || break
done
```

### 7.7 الاتصال بقاعدة Supabase يفشل من الشبكة المحلية

**السبب:** عنوان `db.<ref>.supabase.co` يعمل على IPv6 فقط، وكثير من الشبكات لا
تدعمه.

**الحل:** استخدم **Connection Pooler** (IPv4):

```
Host:     aws-0-<المنطقة>.pooler.supabase.com
Port:     5432
User:     postgres.<project-ref>
Database: postgres
```

المنطقة تجدها في: لوحة التحكم ← Project Settings ← General ← Region.

---

## 8. مرجع الأوامر

### أوامر Supabase

| الأمر                     | ما يفعله                      | خطير؟           |
| ------------------------- | ----------------------------- | --------------- |
| `supabase start`          | يشغّل البيئة المحلية          | لا              |
| `supabase stop`           | يوقفها                        | لا              |
| `supabase status`         | يعرض عناوين ومفاتيح محلية     | لا              |
| `supabase db reset`       | **يحذف ويعيد البناء محليًا**  | ⚠️ **نعم**      |
| `supabase db push`        | يطبّق الترحيلات على السحابة   | متوسط           |
| `supabase db pull`        | يسحب البنية من السحابة        | ⚠️ يعدّل ملفاتك |
| `supabase migration list` | يعرض المطبَّق وغير المطبَّق   | لا              |
| `supabase db dump`        | نسخة احتياطية                 | لا              |
| `supabase link`           | يربط المشروع                  | لا              |
| `supabase db diff`        | يعرض الفرق بين Local والسحابة | لا              |

### أوامر psql

| الأمر                                  | ما يفعله        |
| -------------------------------------- | --------------- |
| `psql "$DATABASE_URL" -f file.sql`     | يشغّل ملف       |
| `psql "$DATABASE_URL" -c "SELECT ..."` | يشغّل أمرًا     |
| `psql "$DATABASE_URL"`                 | جلسة تفاعلية    |
| `\dt`                                  | يعرض الجداول    |
| `\d table_name`                        | يعرض أعمدة جدول |
| `\q`                                   | خروج            |

### أوامر npm

| الأمر           | ما يفعله              |
| --------------- | --------------------- |
| `npm run dev`   | يشغّل التطبيق للتطوير |
| `npm run build` | بناء الإنتاج          |
| `npm run lint`  | فحص الكود             |

### متغيّر `DATABASE_URL`

صيغته:

```
postgresql://postgres.<ref>:<كلمة-المرور>@aws-0-<المنطقة>.pooler.supabase.com:5432/postgres
```

**PowerShell:**

```powershell
$env:DATABASE_URL = "postgresql://postgres.xxxx:pass@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres"
```

**Bash:**

```bash
export DATABASE_URL="postgresql://postgres.xxxx:pass@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres"
```

---

## 9. أخطاء لا تفعلها

| ❌ لا تفعل                         | ⚠️ النتيجة                   |
| ---------------------------------- | ---------------------------- |
| `supabase db reset` على الإنتاج    | **حذف كل بيانات العميل**     |
| `supabase db push` على قاعدة مبنية | أخطاء «already exists»       |
| تشغيل `03_samples/` على عميل       | منتجات وهمية في دفاتره       |
| كلمة مرور في ملف seed              | تبقى في تاريخ المستودع للأبد |
| تعديل migration مطبَّق             | يكسر تتبّع Supabase          |
| وضع بيانات أعمال في `01_system`    | كل عميل يستلمها              |
| نسخ بيانات عميل لعميل آخر          | ممنوع قانونيًا               |
| تخطي النسخ الاحتياطي قبل تغيير     | لا سبيل للرجوع               |

### القاعدة الحاكمة

> **عند الشك، خُذ نسخة احتياطية أولًا.**
> النسخة الاحتياطية تستغرق دقيقة، والاسترجاع من خطأ يستغرق أيامًا.

---

## 10. المراجع

| الملف                                           | الدور                            |
| ----------------------------------------------- | -------------------------------- |
| `supabase/MIGRATIONS_RULES.md`                  | قانون الترحيلات والبيانات (ملزم) |
| `supabase/migrations/README.md`                 | الدليل المعماري للبنية           |
| `supabase/SCHEMA_REFERENCE.md`                  | مرجع الجداول والدوال             |
| `supabase/seeds/README.md`                      | دليل البيانات                    |
| `supabase/SEEDS_AND_REFERENCE_REFACTOR_PLAN.md` | خطة تنظيم البيانات               |
| `supabase/SYSTEM_DATA_AUDIT_PLAN.md`            | خطة تدقيق بيانات النظام          |
