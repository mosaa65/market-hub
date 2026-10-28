# نشر Vortex ERP وSupabase ذاتيًا عبر Docker

هذا النشر يشغّل تطبيق Vortex وSupabase ذاتية الاستضافة على **خادم Linux إنتاجي مستقل**. تبقى حاويات `supabase start` المحلية للتطوير كما هي ولا تُحوّل أو تُحذف.

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

يحمّل السكربت إعداد Docker الرسمي المثبّت على الإصدار `self-hosted/v0.8.3`، وينشئ أسرارًا جديدة على الخادم، ويضبط عناوين التطبيق وAPI. لا يطبع الأسرار ولا يبدأ الحاويات. مجلد `deploy/supabase-stack/` وملف `.env` داخله مستثنيان من Git ومن سياق بناء صورة التطبيق.

يعطّل الإعداد التسجيل العام، والتأكيد التلقائي للبريد والهاتف، والمستخدمين المجهولين. لا تفتح تسجيل المستخدمين قبل اختيار طريقة تحقق وإعدادها. اضبط SMTP حقيقيًا قبل الاعتماد على رسائل دعوة المستخدمين أو استعادة كلمات المرور؛ إعداد البريد الافتراضي مخصص للتطوير.

راجع سجلات DNS قبل التشغيل، ثم من مجلد `deploy/supabase-stack`:

```sh
docker compose --project-name supabase --env-file .env -f docker-compose.yml -f docker-compose.production.override.yaml config --quiet
docker compose --project-name supabase --env-file .env -f docker-compose.yml -f docker-compose.production.override.yaml up -d --wait
```

شبكة Supabase الداخلية اسمها `supabase_default`. لا ينشر ملف التعديل API gateway أو مجمع الاتصالات على منافذ المضيف، ويربط PostgreSQL بـ`127.0.0.1:5433` فقط لاستخدام الترحيلات والنسخ الاحتياطي من الخادم نفسه. لا تفتح هذا المنفذ في جدار الحماية.

## إعداد التطبيق وCaddy

أنشئ `deploy/.env.production` من النموذج، ثم أدخل القيم على الخادم محليًا:

```sh
cp deploy/app.production.env.example deploy/.env.production
chmod 600 deploy/.env.production
```

- `APP_DOMAIN`: نطاق التطبيق.
- `SUPABASE_DOMAIN`: نطاق API.
- `VITE_SUPABASE_URL`: `https://` متبوعًا بنطاق API.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: قيمة `SUPABASE_PUBLISHABLE_KEY` من إعداد Supabase الذاتي.
- `SUPABASE_URL`: `http://api-gw:8000`، عنوان داخلي بين حاويات Docker.
- `SUPABASE_SERVICE_ROLE_KEY`: قيمة `SUPABASE_SECRET_KEY` من إعداد Supabase الذاتي. هذا سر خادمي يتجاوز RLS؛ لا تضعه في متغير `VITE_*` ولا تشاركه.

تحقق من الإعداد ثم ابنِ التطبيق وشغّله من جذر المستودع:

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.production.yaml config --quiet
docker compose --env-file deploy/.env.production -f deploy/compose.production.yaml build app
docker compose --env-file deploy/.env.production -f deploy/compose.production.yaml up -d
```

Caddy يخدم التطبيق وAPI على النطاقين عبر HTTPS، ويوجه API إلى بوابة Supabase عبر شبكة Docker الخاصة. لا تُنشر منافذ `3000` أو `5432` أو `5433` أو `6543` أو `8000` للعامة.

## تطبيق الترحيلات والبذور النظامية

بعد أن تصبح Supabase الإنتاجية سليمة، ومن جذر المشروع على خادم Linux، ثبّت الاعتماديات مرة واحدة ثم شغّل:

```sh
npm ci
npm run db:selfhosted:push
```

يطلب الأمر تأكيدًا صريحًا، ثم يطبق الترحيلات المعلقة فقط، وبعدها يزرع البيانات النظامية الثابتة. لا ينفذ reset ولا يحذف بيانات قاعدة البيانات. لا يزرع حسابات مسؤولي التطوير أو بيانات المطحنة التجريبية؛ أنشئ حسابات الإنتاج بكلمات مرور جديدة، واستخدم بيانات العيّنات في بيئة اختبار منفصلة.

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
