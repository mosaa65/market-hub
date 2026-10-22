# ============================================================================

# (أ) نشط الآن — Supabase المحلي على Docker

# ============================================================================

#

# تشغيل القاعدة: npx supabase start

# إيقافها: npx supabase stop

# عرض المفاتيح: npx supabase status

#

# راجع supabase/LOCAL_DATABASE_DOCKER_GUIDE.md للتفاصيل والمشاكل الشائعة.

# ── واجهة التطبيق (تُقرأ في المتصفح) ────────────────────────────────────────

# بادئة VITE_ إلزامية لأي متغيّر يحتاجه كود الواجهة — بدونه لا يُمرَّر إلى

# حزمة المتصفح أصلاً.

#

# ملاحظة: معرّف المشروع محلياً لا معنى له (لا يوجد مشروع سحابي مرتبط)، لكنه

# يبقى موجوداً لأن الكود يقرؤه، وبلا قيمة يفشل فحص التهيئة.

VITE_SUPABASE_PROJECT_ID="local"
VITE_SUPABASE_URL="http://127.0.0.1:54321"
VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"

# ── الخادم (Server functions والـ middleware) ───────────────────────────────

# هذه لا تحتاج بادئة VITE_ لأنها لا تصل إلى المتصفح، بل تُقرأ على الخادم فقط.

SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_PUBLISHABLE_KEY=sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH

# المفتاح السري: يتجاوز RLS فيتصرّف كمشرف. يُقرأ في دوال الخادم فقط.

# ⚠️ لا تضع له بادئة VITE_ أبداً — ذاك يرسله إلى المتصفح بلا حماية.

SUPABASE_SECRET_KEY=your-local-supabase-secret-key-placeholder

# المفتاح السري بالاسم القديم الذي تتوقّعه بعض الملفات (client.server.ts

# و admin-create-user). نفس القيمة أعلاه، والغرض توافق الأسماء لا أكثر.

SUPABASE_SERVICE_ROLE_KEY=your-local-supabase-service-role-key-placeholder

# عنوان مفاتيح التحقق من الرموز (JWKS). محلياً الرموز موقّعة بـ HS256،

# والعنوان يبقى موجوداً للتوافق لكنه لا يُستخدم في هذه البيئة.

SUPABASE_JWKS_URL=http://127.0.0.1:54321/auth/v1/.well-known/jwks.json

# ── قاعدة البيانات — للاتصال المباشر فقط ────────────────────────────────────

# لا تُستخدم في المتصفح ولا في التطبيق، بل في أدوات سطر الأوامر فقط

# (تشغيل migrations، أو psql، أو النسخ الاحتياطي).

#

# محلياً كلمة المرور ثابتة ومعروفة: postgres

# العنوان محلي بالكامل، فلا بيانات اعتماد حقيقية هنا.

SUPABASE_DB_HOST=127.0.0.1
SUPABASE_DB_PORT=5432
SUPABASE_DB_NAME=postgres
SUPABASE_DB_USER=postgres
SUPABASE_DB_PASSWORD=postgres

# عنوان الاتصال الكامل — اختصار للاستخدام في psql:

# psql "$env:SUPABASE_DB_URL" -f supabase\seeds\01_system\03_chart_of_accounts.sql

SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres
