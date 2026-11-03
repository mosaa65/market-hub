-- إعادة منح صلاحيات `authenticated` على جداول الخزينة وطرق الدفع التي
-- أسقطها مايكريشن 36 (`REVOKE ALL ON ALL TABLES`) ولم تشملها قائمة إعادة
-- المنح فيه (نمط مايكريشن 57 الذي أعاد جداول الأصول الثابتة فقط).
--
-- الأثر الظاهر قبل هذا الإصلاح: شاشات طرق الدفع/الخزائن/الحسابات البنكية
-- تفشل بـ 403 «permission denied» لأن السياسات (RLS) من migration 32
-- تمنح authenticated صلاحيات كاملة، لكن GRANT طبقة النفاذ كان مفقوداً.
--
-- idempotent: آمن لإعادة التشغيل.

GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cashboxes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_bank_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_methods TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_method_settings TO authenticated;

-- خدمة الخادم (Edge Functions / service_role) تحتاج النفاذ الكامل أيضاً.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cashboxes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_bank_accounts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_methods TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_method_settings TO service_role;
