# دليل السكربتات التشغيلية الحية (Active Operational Scripts)

هذا المجلد يحتوي حصراً على السكربتات التشغيلية الأساسية والمدعومة لنظام Market Hub وإدارة قواعد البيانات.

## السكربتات الأساسية المعتمدة:

| السكربت | وظيفته | البيئة المستهدفة | الأمر المكافئ |
| :--- | :--- | :--- | :--- |
| `start-site.ps1` | فحص المتطلبات، تشغيل السوبابيز المحلي، وتشغيل خادم الويب وفتح المتصفح | محلي | `start-market-hup.bat` |
| `db-local-rebuild.ps1` | إعادة بناء قاعدة بيانات Docker المحلية وتطبيق الترحيلات والبذور وعينات المطحنة | محلي (Docker) | `npm run db:local:rebuild` |
| `apply-local-migrations.ps1` | تطبيق الترحيلات الجديدة على قاعدة Docker محلية **دون مسح** بيانات العميل | محلي (Docker) | `npm run db:local:migrate` |
| `db-local-status.ps1` | عرض عناوين API، Studio، والمنافذ لقاعدة بيانات Docker المحلية | محلي (Docker) | `npm run db:local:status` |
| `push-cloud.ps1` | رفع الترحيلات الجديدة والبذور المرجعية الآمنة إلى مشروع Supabase السحابي | سحابي (Cloud) | `npm run db:cloud:push` |
| `apply-cloud-seeds.mjs` | مساعد سكربت السحابة لتطبيق بذور النظام المرجعية دون بيانات تجريبية | سحابي (Cloud) | داخلي (يستدعيه push-cloud) |
| `local_backup.ps1` | أخذ نسخة احتياطية من قاعدة بيانات Docker وحفظها في مجلد backups | محلي (Docker) | يدوي أو عبر `db-control.bat` |
| `verify-backup.ps1` | التحقق من صحة واكتمال النسخ الاحتياطية | محلي | يدوي |
| `functions-local-start.ps1` | تشغيل دوال الحافة (Edge Functions) محلياً | محلي | `npm run db:functions:start` |
| `update-supabase-types.mjs` | تحديث ملف أنواع TypeScript المستخرجة من جداول Supabase | محلي/سحابي | يدوي |

> **تنبيه:** يمكنك تنفيذ كافة هذه العمليات بسهولة تامة عن طريق تشغيل `db-control.bat` في جذر المشروع.
