# نشر Vortex ERP وSupabase ذاتيًا عبر Docker

هذا النشر يشغّل تطبيق Vortex وSupabase ذاتية الاستضافة على **خادم Linux إنتاجي مستقل**. تبقى حاويات `supabase start` المحلية للتطوير كما هي ولا تُحوّل أو تُحذف.

إذا كان المقصود تشغيل نسخة محلية خاصة على جهاز Windows الحالي عبر Docker Desktop، اتبع [دليل قاعدة الإنتاج المحلية](../docs/deployment/2026-11-04-local-production-docker-runbook.md). هذا مسار منفصل عن نشر Linux والنطاقات العامة الموضح في بقية هذا الملف، ويُدار من PowerShell دون الحاجة إلى Ubuntu أو WSL.

> لا تستخدم جهاز Windows الحالي كخادم عام للشركات. يلزم خادم Linux دائم، ونطاقان يشيران إليه، ونسخ احتياطية خارج الخادم. إعداد Supabase الذاتي يحمّلك مسؤولية تحديث PostgreSQL وتأمينه ومراقبته واستعادة نسخه الاحتياطية.

## المتطلبات

- خادم Linux مع Docker Engine وDocker Compose Plugin حديث (Compose 2.24.4 أو أحدث لدعم `!override`).
- RAM لا تقل عن 4 GB؛ يوصى بـ8 GB أو أكثر، وقرص SSD بسعة 80 GB أو أكثر لتشغيل خدمات Supabase براحة.
- نطاق التطبيق مثل `erp.example.com` ونطاق API مثل `api.example.com`، وكلا سجلّي DNS يشيران إلى عنوان الخادم.
- المنافذ العامة `80/tcp` و`443/tcp` و`443/udp` فقط. PostgreSQL ومجمع الاتصالات لا يُنشران على الإنترنت؛ لوحة Studio تمر عبر بوابة HTTPS وتتطلب مصادقة.
- Git وPython 3 وNode.js/npm على الخادم لتجهيز Supabase وتشغيل الترحيلات.

راجع [دليل Supabase الرسمي للاستضافة عبر Docker](https://supabase.com/docs/guides/self-hosting/docker) و[متطلبات الخادم](https://supabase.com/docs/guides/self-hosting/docker#system-requirements). لا تستخدم حزمة `supabase start` المحلية كخدمة إنتاج.

## تجهيز Supabase الإنتاجية

من نسخة المشروع على خادم Linux، نفّذ مرة واحدة:

```sh
bash deploy/bootstrap-self-hosted-supabase.sh erp.example.com api.example.com
```

يحمّل السكربت إعداد Docker الرسمي المثبّت على الإصدار `self-hosted/v0.8.3`، وينشئ أسرارًا جديدة على الخادم، ويضبط عناوين التطبيق وAPI. كما ينشئ `deploy/.env.production` بمفتاحي النشر والسر الخادمي المطابقين للمكدس، ويضبط الملفين على صلاحية `600`. لا يطبع الأسرار ولا يبدأ الحاويات، ويرفض الكتابة فوق إعداد موجود. مجلد `deploy/supabase-stack/` وملفات البيئة مستثناة من Git ومن سياق بناء صورة التطبيق.

يعطّل الإعداد التسجيل العام، والتأكيد التلقائي للبريد والهاتف، والمستخدمين المجهولين. لا تفتح تسجيل المستخدمين قبل اختيار طريقة تحقق وإعدادها. اضبط SMTP حقيقيًا قبل الاعتماد على رسائل دعوة المستخدمين أو استعادة كلمات المرور؛ إعداد البريد الافتراضي مخصص للتطوير.

راجع سجلات DNS قبل التشغيل، ثم من مجلد `deploy/supabase-stack`:

```sh
docker compose --project-name supabase --env-file .env -f docker-compose.yml -f docker-compose.production.override.yaml config --quiet
docker compose --project-name supabase --env-file .env -f docker-compose.yml -f docker-compose.production.override.yaml up -d --wait
```

شبكة Supabase الداخلية اسمها `supabase_default`. لا ينشر ملف التعديل API gateway أو مجمع الاتصالات على منافذ المضيف، ويربط PostgreSQL بـ`127.0.0.1:5433` فقط لاستخدام الترحيلات والنسخ الاحتياطي من الخادم نفسه. لا تفتح هذا المنفذ في جدار الحماية.

## إعداد التطبيق وCaddy

أنشأ سكربت التهيئة `deploy/.env.production` من مفاتيح المكدس الذاتي. راجع أسماء النطاقات والهدف دون طباعة الملف أو نسخ السر إلى الطرفية:

```sh
grep -E '^(APP_DOMAIN|SUPABASE_DOMAIN|VITE_SUPABASE_TARGET|SUPABASE_TARGET|SUPABASE_URL)=' deploy/.env.production
```

يكون `VITE_SUPABASE_TARGET` و`SUPABASE_TARGET` مساويين لـ`docker`، ويكون عنوان الخادم داخل شبكة Docker هو `http://api-gw:8000`. مفتاح النشر العام يدخل في حزمة المتصفح، بينما `SUPABASE_SECRET_KEY` يبقى خاصًا ببيئة الخادم ويتجاوز RLS؛ لا تضعه في متغير `VITE_*` أو وسيطة بناء، ولا تشاركه. يتطلب تغيير النطاقين إعادة تهيئة مدروسة للملفين؛ لا تستبدل أسرار مكدس قائم.

تحقق من الإعداد ثم ابنِ التطبيق وشغّله من جذر المستودع:

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.production.yaml config --quiet
docker compose --env-file deploy/.env.production -f deploy/compose.production.yaml build app
docker compose --env-file deploy/.env.production -f deploy/compose.production.yaml up -d
```

Caddy يخدم التطبيق وAPI على النطاقين عبر HTTPS، ويوجه API إلى بوابة Supabase عبر شبكة Docker الخاصة. لا تُنشر منافذ `3000` أو `5432` أو `5433` أو `6543` أو `8000` للعامة.

## تطبيق الترحيلات والبذور النظامية

**الدفع إلى استضافة ذاتية قائمة معطّل حاليًا.** أصبح `supabase/migrations/`
خط أساس لإنشاء قواعد جديدة، وليس سجل تحديث للقواعد القائمة. سيوقف
`npm run db:selfhosted:push` نفسه عمدًا حتى تُراجع خطة انتقال سجل كل بيئة.

لإنشاء قاعدة Docker المحلية الجديدة فقط على Windows، اتبع
[`runbook المحلي`](../docs/deployment/2026-11-04-local-production-docker-runbook.md)
واستخدم:

```powershell
npm run db:selfhosted:push:local
```

لا ينفذ هذا الإجراء `reset`، ويشترط قاعدة محلية فارغة، ويستبعد حسابات مسؤولي
المنصة وبيانات العينات.

## التشغيل والصيانة

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.production.yaml ps
docker compose --env-file deploy/.env.production -f deploy/compose.production.yaml logs -f app proxy
```

- اختبر نسخًا احتياطية خارج الخادم واستعادة فعلية لقاعدة البيانات وملفات Storage قبل تشغيل الشركات.
- ضع مراقبة وتنبيهات، وحدّث صور Supabase وفق إصدارات متوافقة، واحتفظ بإمكانية الرجوع.
- لا تنفّذ `down -v` أو `reset.sh` على الإنتاج؛ كلاهما قد يحذف بيانات دائمة.
- `restart: unless-stopped` يعيد تشغيل الحاويات ولا يوفر وحده نسخًا احتياطيًا أو تعافيًا من تعطل الخادم.

هذا يجهز ملفات وخطوات النشر. لم يبدأ أي حاوية إنتاجية ولم تُنشأ قاعدة إنتاجية على جهاز التطوير؛ يلزم تنفيذ التهيئة على خادم Linux عام بعد توفير النطاقين.
