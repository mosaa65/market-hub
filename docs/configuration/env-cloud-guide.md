# ============================================================================

# (ب) محفوظ — الاستضافة السحابية ( Supabase Cloud)

# ============================================================================

#

# ⛔ كل ما تحت هذا السطر **معطّل حالياً**. لا يُقرأ لأنه مُعلَّق بـ #.

# ✅ عند الرجوع إلى السحابي: انسخ القيم التي تريدها إلى القسم (أ) أعلاه，

# ثم علّق القيم المحلية.

#

# ── بيانات المشروع السحابي ─────────────────────────────────────────────────

# معرّف المشروع (project ref) — يظهر في رابط لوحة التحكم:

# https://supabase.com/dashboard/project/kwzqvgdyadylwnvjghqn

# وعليه تُبنى كل العناوين السحابية.

#

# VITE_SUPABASE_PROJECT_ID="your-project-ref"

# VITE_SUPABASE_URL="https://your-project-ref.supabase.co"

# VITE_SUPABASE_PUBLISHABLE_KEY="your-anon-key"

#

# ── الخادم ──────────────────────────────────────────────────────────────────

# SUPABASE_URL=https://your-project-ref.supabase.co

# SUPABASE_PUBLISHABLE_KEY=your-anon-key

# SUPABASE_SECRET_KEY=your-secret-key-placeholder

# SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-placeholder

# SUPABASE_JWKS_URL=https://your-project-ref.supabase.co/auth/v1/.well-known/jwks.json

#

# ── قاعدة البيانات السحابية ─────────────────────────────────────────────────

# ⚠️ العنوان أدناه (`db.<ref>.supabase.co`) يعمل على **IPv6 فقط**، وكثير من

# الشبكات المحلية لا تدعمه فيفشل الاتصال بلا سبب واضح. إن حدث ذلك، استخدم

# Connection Pooler بدلاً منه (IPv4):

# Host: aws-0-<المنطقة>.pooler.supabase.com

# User: postgres.<project-ref>

# المنطقة في: لوحة التحكم ← Project Settings ← General ← Region.

#

# SUPABASE_DB_HOST=db.your-project-ref.supabase.co

# SUPABASE_DB_PORT=5432

# SUPABASE_DB_NAME=postgres

# SUPABASE_DB_USER=postgres

# SUPABASE_DB_PASSWORD=your-db-password-placeholder

# SUPABASE_DB_URL=postgresql://postgres:your-db-password-placeholder@db.your-project-ref.supabase.co:5432/postgres

#

# ── نشر الترحيلات على السحابة ───────────────────────────────────────────────

# بعد تفعيل القسم (أ) بقيم السحابة:

# npx supabase link --project-ref kwzqvgdyadylwnvjghqn ← مرة واحدة

# npx supabase db push ← تطبيق الترحيلات

# ثم شغّل ملفات seeds/01_system يدوياً (db push لا يشغّلها)

# راجع docs/DATABASE_OPERATIONS_GUIDE.md للتفاصيل الكاملة.
