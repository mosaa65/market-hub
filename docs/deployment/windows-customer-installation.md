# تثبيت Vortex لعميل على Windows باستخدام Docker

هذا الدليل يشرح إنشاء تثبيت جديد ومستقل على جهاز العميل. قاعدة البيانات والملفات وحاويات التطبيق تبقى على جهازه، ولا تتصل نسخة التطبيق تلقائيًا بقاعدة التطوير أو Supabase السحابية.

> **حدود هذا المسار:** الإعداد الحالي مخصص لتشغيل التطبيق على جهاز Windows واحد وفتحه من `http://localhost:3001`. لا يستطيع موظفون على أجهزة أخرى الوصول إليه. هذا الدليل لا يجهز استضافة عامة أو شبكة LAN. كما أن التشغيل دون إنترنت ممكن بعد إكمال تنزيل الصور والاعتماديات أول مرة؛ البريد الخارجي والتحديثات والتكاملات التي تتطلب الإنترنت لن تعمل دون اتصال.

## 1. ما الذي سيُنشأ؟

- حاوية التطبيق المبنية بوضع الإنتاج.
- مكدس Supabase ذاتي الاستضافة: Auth وREST وStorage والدوال وPostgreSQL.
- قاعدة بيانات جديدة، ترحيلات الأساس الـ17، وبذور النظام المشتركة فقط.
- حساب مالك للمنشأة يُنشأ مرة واحدة بكلمة مرور يختارها العميل.
- تشغيل الحاويات تلقائيًا عند بدء Docker Desktop، مع إبقاء البيانات في مجلدات Docker الدائمة.

لا يُنشأ تلقائيًا مستخدمو منصة الدعم، ولا منتجات أو عملاء أو فواتير عيّنة. بيانات `sample-mill.sql` للعرض والاختبار فقط، ولا تُشغّل على بيانات العميل. أنواع الحبوب والمرجعيات المشتركة للطحن موجودة في البذور النظامية، أما منتجات العميل فيُدخلها بنفسه.

## 2. المتطلبات على جهاز العميل

جهّز جهاز Windows حديثًا، واتركه يعمل أثناء استخدام التطبيق. ثبّت:

1. **Docker Desktop** وشغّله باستخدام Linux containers. لا يتطلب هذا المسار تثبيت Ubuntu يدويًا.
2. **Git for Windows**؛ يوفر Git Bash الذي يستدعيه سكربت تهيئة Supabase.
3. **Node.js 22** وnpm؛ يحتاجهما تثبيت اعتماديات المشروع وأدوات Supabase المحلية.
4. اتصال إنترنت أثناء التجهيز الأول لتنزيل اعتماديات npm وصور Docker وإعداد Supabase الرسمي المثبّت بالمشروع.

يحتاج Docker Compose إصدار `2.24.4` أو أحدث. سكربت التهيئة يتحقق من الإصدار ويتوقف إذا كان أقدم. تأكد من توفر مساحة تخزين كافية؛ صور Supabase وبيانات PostgreSQL ستستهلك مساحة ملحوظة.

## 3. الحصول على ملفات إصدار العميل

استخدم نسخة إصدار معتمدة من مستودع المشروع، عبر Git خاص أو حزمة إصدار جهزتها الشركة. لا تنسخ مجلد التطوير كاملًا من جهاز المطور، ولا تنقل مجلد قاعدة تطوير أو `node_modules` أو ملفات أسرار مطور آخر.

مثال عند استخدام Git، مع استبدال العنوان بمستودع الشركة:

```powershell
New-Item -ItemType Directory -Force C:\Vortex | Out-Null
Set-Location C:\Vortex
git clone <رابط-مستودع-الشركة> market-hup
Set-Location C:\Vortex\market-hup
```

إذا سلّمت الشركة حزمة إصدار بدل Git، فكّها في مجلد ثابت مثل `C:\Vortex\market-hup` وافتح PowerShell داخله. لا تضع المشروع داخل مجلد مؤقت أو OneDrive متزامن؛ مجلدات بيانات Docker مهمة ويجب أن تبقى على الجهاز.

## 4. تثبيت اعتماديات المشروع وبدء Docker

افتح Docker Desktop وانتظر حتى يظهر أن المحرك يعمل، ثم من PowerShell في مجلد المشروع:

```powershell
npm ci
docker version
docker compose version
```

يجب أن ينجح `npm ci` دون أخطاء، وأن يعرض `docker version` معلومات المحرك والعميل. إذا كان Docker Desktop غير جاهز، لا تتابع.

## 5. إنشاء إعداد Supabase المحلي ومفاتيح هذا العميل

نفّذ:

```powershell
npm run db:selfhosted:bootstrap:local
```

ينشئ الأمر إعدادًا رسميًا محليًا في `deploy/supabase-stack/`، ويولّد مفاتيح خاصة بهذا التثبيت، ويجهز:

- `deploy/supabase-stack/.env`
- `deploy/.env.local-production`
- ملفات Compose الخاصة بالتشغيل المحلي ووظائف Supabase

ثم يقيّد صلاحية ملفات البيئة على Windows. لا يطبع المفاتيح، ولا يبدأ الحاويات، ولا يطبق ترحيلات. لا تنسخ هذين الملفين إلى Git أو البريد أو مستودع عام، ولا تستبدلهما بملفات جهاز آخر.

السكربت يرفض الكتابة فوق ملفات موجودة كي لا يمحو إعدادًا أو أسرارًا سابقًا. إذا ظهرت هذه الرسالة، توقف؛ افحص التثبيت الموجود وخذ نسخة آمنة قبل اتخاذ قرار إعادة التهيئة.

## 6. فحص إعداد Docker قبل تنزيل الصور

نفّذ من جذر المشروع في PowerShell:

```powershell
docker compose --project-name supabase --env-file deploy/supabase-stack/.env `
  -f deploy/supabase-stack/docker-compose.yml `
  -f deploy/supabase-stack/docker-compose.local-production.override.yaml config --quiet

docker compose --env-file deploy/.env.local-production `
  -f deploy/compose.production.yaml `
  -f deploy/compose.local-production.override.yaml config --quiet
```

إذا انتهى الأمران بلا أخطاء، فالإعداد قابل للقراءة. لا تستخدم `docker compose config` من دون `--quiet` عند مشاركة المخرجات؛ قد يتضمن العرض الكامل قيمًا سرية.

## 7. تنزيل صور Supabase وتشغيل قاعدة جديدة

يحتاج تنزيل الصور إلى الإنترنت. نزّلها مرة واحدة:

```powershell
docker compose --project-name supabase --env-file deploy/supabase-stack/.env `
  -f deploy/supabase-stack/docker-compose.yml `
  -f deploy/supabase-stack/docker-compose.local-production.override.yaml pull
```

ثم شغّل Supabase وانتظر صحة الخدمات:

```powershell
docker compose --project-name supabase --env-file deploy/supabase-stack/.env `
  -f deploy/supabase-stack/docker-compose.yml `
  -f deploy/supabase-stack/docker-compose.local-production.override.yaml up -d --wait

docker compose --project-name supabase --env-file deploy/supabase-stack/.env `
  -f deploy/supabase-stack/docker-compose.yml `
  -f deploy/supabase-stack/docker-compose.local-production.override.yaml ps
```

يجب أن تكون الخدمات بحالة `healthy` أو `running` حسب الخدمة. المنافذ المنشورة مربوطة إلى `127.0.0.1`: API على `8000` وPostgreSQL على `5433`. لا تغيّرها إلى `0.0.0.0` لفتحها على الشبكة.

## 8. إنشاء المخطط وبذور النظام لأول مرة فقط

بعد أن تصبح خدمات Supabase سليمة، نفّذ:

```powershell
npm run db:selfhosted:push:local
```

يتحقق السكربت من أن الهدف هو قاعدة Docker المحلية على `127.0.0.1:5433`، وأن المخطط `public` وسجل الترحيلات فارغان. يعرض dry-run ثم يطلب تأكيدًا بكتابة:

```text
APPLY SELF-HOSTED MIGRATIONS
```

بعد تطبيق الترحيلات، يطلب تأكيدًا آخر للبذور بكتابة:

```text
SEED SELF-HOSTED PRODUCTION
```

يطبق خط الأساس الحالي من `001` إلى `017` وبذور `01_system` المحددة فقط، ولا ينفذ `reset`. إذا وجد جداول أو ترحيلات سابقة، فسيرفض التنفيذ؛ لا تحاول تجاوز الحماية ولا تمسح قاعدة العميل. هذا الأمر **للإنشاء الأول على قاعدة فارغة**، وليس أمر تحديث لقاعدة قائمة.

## 9. إنشاء حساب المالك

أنشئ مالك المنشأة قبل تسجيل الدخول:

```powershell
npm run db:selfhosted:owner:local
```

أدخل بريد المالك واسمه، ثم كلمة مرور من 16 إلى 128 حرفًا وأعد إدخالها للتأكيد. حقل كلمة المرور مخفي. لا تستخدم كلمة مرور قصيرة؛ Node.js يتحقق من الطول قبل إنشاء الحساب. الأداة ترفض العمل إذا كان في قاعدة التطبيق ملف مستخدم أو دور موجود، كي لا تمنح ملكية إضافية عن طريق الخطأ.

إذا فشل الأمر بعد إنشاء مستخدم Auth وقبل إسناد الدور، لا تكرر المحاولة مباشرة. افحص المستخدم في Auth وجدول `user_roles` أولًا.

## 10. بناء نسخة التطبيق وتشغيلها

ابنِ التطبيق بعد اكتمال تهيئة قاعدة البيانات والمالك:

```powershell
docker compose --env-file deploy/.env.local-production `
  -f deploy/compose.production.yaml `
  -f deploy/compose.local-production.override.yaml build app
```

ثم شغّل التطبيق:

```powershell
docker compose --env-file deploy/.env.local-production `
  -f deploy/compose.production.yaml `
  -f deploy/compose.local-production.override.yaml up -d --wait app
```

تحقق من الحاوية وافتح التطبيق:

```powershell
docker compose --env-file deploy/.env.local-production `
  -f deploy/compose.production.yaml `
  -f deploy/compose.local-production.override.yaml ps

Invoke-WebRequest http://localhost:3001
```

افتح `http://localhost:3001`، وسجّل الدخول بحساب المالك. جرّب إنشاء موظف من شاشة المستخدمين، ثم راجع صلاحياته. قبل تسليم الجهاز، تحقق من بيانات المنشأة والعملة والإعدادات والمنتجات التي أدخلها العميل، ولا تترك بيانات عرض أو حسابات مطور.

## 11. التشغيل اليومي والإيقاف

يبدأ Docker Desktop عند تسجيل دخول Windows، وتعود الحاويات التي تستخدم `restart: unless-stopped` تلقائيًا. لذلك يجب إبقاء الجهاز موصولًا بالطاقة وعدم إغلاق Docker Desktop إذا كان مطلوبًا استمرار الخدمة.

لعرض الحالة:

```powershell
docker compose --env-file deploy/.env.local-production `
  -f deploy/compose.production.yaml `
  -f deploy/compose.local-production.override.yaml ps

docker compose --project-name supabase --env-file deploy/supabase-stack/.env `
  -f deploy/supabase-stack/docker-compose.yml `
  -f deploy/supabase-stack/docker-compose.local-production.override.yaml ps
```

لإيقاف الخدمات مؤقتًا مع الاحتفاظ بالحاويات والبيانات:

```powershell
docker compose --env-file deploy/.env.local-production `
  -f deploy/compose.production.yaml `
  -f deploy/compose.local-production.override.yaml stop

docker compose --project-name supabase --env-file deploy/supabase-stack/.env `
  -f deploy/supabase-stack/docker-compose.yml `
  -f deploy/supabase-stack/docker-compose.local-production.override.yaml stop
```

لإعادتها، استخدم `up -d --wait` بالأعلام نفسها المذكورة في القسمين 7 و10. لا تستخدم `down -v` أو `reset` أو تحذف مجلدات Docker؛ قد تمحو قاعدة العميل وملفاته.

## 12. تحديث التطبيق بعد إصدار جديد

خذ نسخة احتياطية أولًا، ثم حدّث ملفات المشروع إلى إصدار معتمد. إذا كان التثبيت Git ولم توجد تعديلات محلية:

```powershell
git pull
npm ci
```

أعد بناء صورة التطبيق وأعد إنشاء حاويته:

```powershell
docker compose --env-file deploy/.env.local-production `
  -f deploy/compose.production.yaml `
  -f deploy/compose.local-production.override.yaml build app

docker compose --env-file deploy/.env.local-production `
  -f deploy/compose.production.yaml `
  -f deploy/compose.local-production.override.yaml up -d --no-deps --wait app
```

هذا يكفي لتحديث **كود التطبيق فقط**. إذا احتوى الإصدار على ملفات ترحيل جديدة، فتوقف قبل تحديث قاعدة العميل: أمر `db:selfhosted:push:local` الحالي يرفض قاعدة غير فارغة ومصمم للإنشاء الأول. لا تشغّل `reset` ولا تطبق ملفات SQL يدويًا على بيانات العميل. يلزم إصدار ترحيل تحديثي معتمد ومجرّب على نسخة احتياطية قبل نقل تلك التغييرات إلى العميل.

## 13. النسخ الاحتياطي والاستعادة

أنشئ نسخة قاعدة قبل التحديثات المهمة، واحفظها خارج مجلد المشروع:

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $env:USERPROFILE "MarketHubBackups\$stamp"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
docker exec supabase-db pg_dump -U postgres -d postgres -Fc -f "/tmp/market-hub-$stamp.dump"
docker cp "supabase-db:/tmp/market-hub-$stamp.dump" (Join-Path $backupDir "database.dump")
docker exec supabase-db rm -f "/tmp/market-hub-$stamp.dump"
Copy-Item -Recurse "deploy/supabase-stack/volumes/storage" (Join-Path $backupDir "storage")
Copy-Item "deploy/supabase-stack/.env" (Join-Path $backupDir "supabase-stack.env")
Copy-Item "deploy/.env.local-production" (Join-Path $backupDir "app.env")
Get-FileHash (Join-Path $backupDir "database.dump") -Algorithm SHA256
```

النسخة تشمل PostgreSQL وملفات Storage وإعدادات الأسرار اللازمة لاستعادة **هذا التثبيت**. تعامل مع المجلد كله كسر حساس: لا ترسله بالبريد ولا ترفعه إلى Git، وضع نسخة مشفرة على قرص أو وسيط منفصل عن جهاز العميل. لا تعد قاعدة من dump فوق قاعدة مستخدمة قبل تحديد الهدف وأخذ نسخة جديدة وتجربة الاستعادة على قاعدة معزولة.

## 14. هل يمكن فتح التطبيق لأجهزة الموظفين؟

حاليًا لا. `localhost` يعني جهاز العميل نفسه، والمنافذ `3001` و`8000` و`5433` مربوطة إلى loopback عمدًا. لا تفتح المنافذ مباشرة في Windows Firewall ولا تغيّر الربط إلى كل واجهات الشبكة؛ ذلك لا يوفّر HTTPS أو مصادقة نقل مناسبة.

إذا أراد العميل عدة أجهزة، يلزم اعتماد تصميم وصول منفصل: HTTPS بشهادة موثوقة على كل جهاز أو VPN مُدار، عنوان ثابت، وضبط Auth وCORS والجدار الناري. حتى يُنفذ ذلك ويُختبر، استخدم النسخة على جهاز واحد فقط.

## 15. أعطال شائعة

| الرسالة أو الحالة | السبب المعتاد | الإجراء |
| --- | --- | --- |
| `Docker Desktop CLI is not available` | Docker Desktop غير مثبت أو غير مبدوء | شغّل Docker Desktop وانتظر جاهزية المحرك. |
| `Git Bash was not found` | Git for Windows غير مثبت | ثبّت Git for Windows وأعد فتح PowerShell. |
| `Refusing to overwrite existing ...` | إعداد أو بيانات محلية موجودة | لا تحذفها؛ حدد هل هذا تثبيت قائم وخذ نسخة قبل أي تعديل. |
| متغيرات البيئة مطلوبة من Compose | خطوة bootstrap لم تكتمل أو الملفات غير موجودة | أعد فحص وجود الملفات دون طباعة محتواها. لا تكتب أسرارًا عشوائية. |
| فشل `pull` أو `npm ci` | اتصال أو DNS أو مساحة | أصلح الاتصال والمساحة ثم أعد الأمر؛ Docker يحتفظ عادة بالطبقات التي اكتملت. |
| الترحيلات ترفض لأن قاعدة البيانات غير فارغة | الأمر خاص بقاعدة جديدة | لا تستخدم reset؛ هذه قاعدة عميل أو إعداد سبق تشغيله. |
| كلمة مرور المالك أقل من 16 حرفًا | شرط أداة إنشاء المالك | استخدم كلمة أطول وأعد إدخالها. |
| التطبيق لا يفتح على `localhost:3001` | التطبيق أو Supabase غير سليمين، أو المنفذ مستخدم | افحص `ps` للمكدسين وسجلات `app`، ولا تغيّر الهدف إلى السحابة كحل تلقائي. |

## قائمة التسليم للعميل

- [ ] جهاز Windows وDocker Desktop وGit وNode.js جاهزة.
- [ ] ملفات البيئة أُنشئت لهذا العميل وحُميت على Windows.
- [ ] كل خدمات Supabase سليمة.
- [ ] الترحيلات `001–017` وبذور النظام طُبقت على قاعدة فارغة.
- [ ] حساب المالك أنشئ بكلمة مرور يملكها العميل.
- [ ] التطبيق يفتح، وتسجيل الدخول وإضافة موظف تجريبية نجحا.
- [ ] لا توجد بيانات demo أو بيانات عميل آخر.
- [ ] نسخة احتياطية مشفرة خارج الجهاز جُهزت، وخطة استعادة اختُبرت.
- [ ] العميل يعرف أن الوصول الحالي من جهاز واحد فقط، وأن الإنترنت مطلوب للتنزيل والتحديثات.
