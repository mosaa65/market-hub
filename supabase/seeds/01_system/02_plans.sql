-- ============================================================================
-- 02_plans.sql — باقات الاشتراك
-- ============================================================================
--
-- ما هذا الملف؟
--   باقات الاشتراك التي تعرضها المنصة: أساسية، احترافية، مؤسسات.
--
-- لماذا هو ملف نظام (يُشغَّل تلقائيًا)؟
--   شاشة الاشتراكات تحتاج كتالوجًا تعرضه. بدونه تكون شاشة اختيار الباقة فارغة
--   ولا يستطيع أي عميل تفعيل وحداته.
--
-- ── العلاقة بالوحدات والاشتراكات ────────────────────────────────────────────
--   platform_modules     «ما يستطيع النظام فعله» — 14 وحدة
--   platform_plans       «ما الذي يُباع» — هذا الملف
--   tenant_subscriptions «ما الذي اشتراه هذا العميل فعلًا» — يُكتب من التطبيق
--
--   عمود `modules` في كل باقة يسرد رموز الوحدات التي تفتحها الباقة. الرموز
--   يجب أن تطابق `platform_modules.id` تمامًا، وإلا لا تُفعَّل الوحدة.
--
-- ── لماذا هذه البيانات عامة لا خاصة بعميل؟ ──────────────────────────────────
--   كل تثبيت للنظام يعرض نفس الباقات الثلاث. العميل يختار باقة أو يعدّلها في
--   لوحة المنصة، ولا يبدأ بباقة صمّاء بلا خيارات.
--
-- ── الأسعار ─────────────────────────────────────────────────────────────────
--   price_monthly رقم للعرض فقط؛ النظام لا يعالج دفعًا. '0.00' تعني باقة مجانية.
--   حدّ max_products = NULL يعني بلا سقف.
--
-- ثابت (Idempotent): ON CONFLICT على (id).
-- المرجع: supabase/docs/2026-10-12_guide_migrations-rules.md — القاعدة R-30.
-- ============================================================================

BEGIN;

INSERT INTO public.platform_plans
  (id, name, description, modules, max_users, max_warehouses, max_products, price_monthly, is_active)
VALUES

  -- ═══ الباقة الأساسية — الأنشطة الصغيرة ════════════════════════════════════
  ('starter',
   '{"ar":"الباقة الأساسية","en":"Starter"}'::jsonb,
   '{"ar":"للأنشطة الصغيرة: مستودع واحد، مبيعات ومخزون مبسّط","en":"Small businesses: one warehouse, basic sales and inventory"}'::jsonb,
   '{"core"}'::text[],
   1, 1, 500, '0.00', true),

  -- ═══ الباقة الاحترافية — المتاجر المتنامية ═════════════════════════════════
  ('professional',
   '{"ar":"الباقة الاحترافية","en":"Professional"}'::jsonb,
   '{"ar":"للمتاجر المتنامية: نقطة بيع، مشتريات، مرتجعات، تحصيلات ومصروفات","en":"Growing retail: POS, purchases, returns, payments and expenses"}'::jsonb,
   '{"core","pos","purchases","returns","payments","expenses"}'::text[],
   5, 1, 5000, '29.00', true),

  -- ═══ باقة المؤسسات — النظام كاملًا ═════════════════════════════════════════
  ('enterprise',
   '{"ar":"باقة المؤسسات المتكاملة","en":"Enterprise"}'::jsonb,
   '{"ar":"نظام ERP كامل: كل الوحدات، تعدد المستودعات، المحاسبة، التحليلات، وإدارة المطاحن","en":"Full ERP: all modules, multi-warehouse, accounting, analytics and milling"}'::jsonb,
   '{"advanced_accounting","analytics","audit","barcode","batches","core","expenses","loyalty","milling_operations","multi_warehouse","payments","pos","purchases","returns"}'::text[],
   50, 20, NULL, '99.00', true)

ON CONFLICT (id) DO NOTHING;

-- ── التحقق: كل وحدة تفتحها باقة يجب أن تكون موجودة فعلًا ────────────────────
-- لو أشارت باقة إلى وحدة غير مسجّلة، لن تُفعَّل تلك الوحدة أبدًا ويظهر نقص
-- صامت في الشاشات. نكشفه هنا بدل أن يكتشفه العميل لاحقًا.
DO $$
DECLARE
  v_bad text[];
BEGIN
  SELECT array_agg(DISTINCT m) INTO v_bad
    FROM public.platform_plans p
    CROSS JOIN LATERAL unnest(p.modules) AS m
   WHERE NOT EXISTS (SELECT 1 FROM public.platform_modules pm WHERE pm.id = m);

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'باقة تشير إلى وحدات غير مسجّلة في platform_modules: %. صحّح الرموز أو أضف الوحدة قبل الباقة.',
      array_to_string(v_bad, ', ');
  END IF;
END $$;

COMMIT;
