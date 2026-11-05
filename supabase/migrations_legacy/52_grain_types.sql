-- ═══════════════════════════════════
-- E6 / M5 (rebuild-plan.md §1.2): أنواع الحبوب — البيانات المرجعية
--
-- المشكلة الموثقة: الحبوب تُختار من كتالوج المنتجات العادي
-- (fetchGrainItems تبحث في products بـ item_class=RAW_MATERIAL) فتختلط
-- الحبوب المرجعية بأصناف الشراء الحقيقية، ولا يوجد فاقد افتراضي ولا نسب
-- نواتج — الفاقد يُدخل يدوياً في كل عملية بلا أساس.
--
-- الحل: جدول مرجعي مستقل لأنواع الحبوب يوفّر:
--   • default_loss_rate_pct : نسبة فاقد افتراضية لكل نوع حبة.
--   • default_output_map    : نواتج افتراضية (JSONB: [{grain_type_id, ratio}])
--     قابلة للتعديل يدوياً لكل عملية (طبيعة كل طرقة حجر تختلف).
--   • ربط اختياري بمنتج الكتالوج الذي يمثّل هذا النوع في الشراء
--     (product_id) حتى تظل قائمة الشراء كما هي، بينما القوائم المرجعية
--     تقرأ من grain_types مباشرة.
--
-- ملاحظة: الترحيل لا يغيّر أي عملية قائمة — الجدول مرجعي فقط في هذه
-- المرحلة، والربط الكامل للعمليات يتم في الترحيلات التالية.
-- ═══════════════════════════════════

CREATE TABLE IF NOT EXISTS public.grain_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar text NOT NULL UNIQUE,
  name_en text,
  -- نسبة الفاقد الافتراضية (%) لهذا النوع من الحبوب
  default_loss_rate_pct numeric(5,2) NOT NULL DEFAULT 0
    CHECK (default_loss_rate_pct >= 0 AND default_loss_rate_pct <= 100),
  -- النواتج الافتراضية: [{product_id uuid, ratio numeric}] — النسب مجموعها <= 100
  default_output_map jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- ربط اختياري بمنتج الكتالوج الذي يمثّل هذه الحبة في الشراء
  representative_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  -- ملاحظات تشغيلية (مثلاً: يُطحن ناعماً — طرقة حجر رقم 2)
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- منع تكرار الاسم الإنجليزي عند وجوده
CREATE UNIQUE INDEX IF NOT EXISTS uq_grain_types_name_en
  ON public.grain_types (name_en) WHERE name_en IS NOT NULL;

-- فهرس القائمة النشطة (الاستعلام الأكثر تكراراً)
CREATE INDEX IF NOT EXISTS idx_grain_types_active
  ON public.grain_types (is_active, name_ar);

CREATE OR REPLACE FUNCTION public.grain_types_output_map_ratio_is_valid(p_output_map jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE
    WHEN jsonb_typeof(p_output_map) <> 'array' THEN false
    ELSE COALESCE((
      SELECT SUM((entry->>'ratio')::numeric)
      FROM jsonb_array_elements(p_output_map) AS entry
    ), 0) <= 100
  END;
$function$;

-- تحقق: مجموع نسب النواتج الافتراضية لا يتجاوز 100%
ALTER TABLE public.grain_types
  ADD CONSTRAINT grain_types_output_map_ratio_check
  CHECK (public.grain_types_output_map_ratio_is_valid(default_output_map));

-- ── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE public.grain_types ENABLE ROW LEVEL SECURITY;

-- القراءة: أي موظف مخوّل بعرض المحل
CREATE POLICY "grain_types_read" ON public.grain_types
  FOR SELECT TO authenticated
  USING (public.can_view_milling());

-- الكتابة الكاملة للخدمة (ترحيلات ودوال)
CREATE POLICY "grain_types_service_all" ON public.grain_types
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- الكتابة للعمليات: من يدير المحل (owner/manager/warehouse)
CREATE POLICY "grain_types_manage" ON public.grain_types
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

-- ── تحديث updated_at تلقائياً ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_grain_type_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_grain_types_touch
  BEFORE UPDATE ON public.grain_types
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_grain_type_updated_at();

-- ── بيانات أولية: الأنواع الشائعة في المطاحن المحلية ────────────────
-- الفاقد الافتراضي تقديري تشغيلي (يُعدَّل لكل عملية يدوياً)
INSERT INTO public.grain_types (name_ar, name_en, default_loss_rate_pct, default_output_map, notes)
VALUES
  ('قمح بُرّ', 'Bread Wheat', 2.00,
   '[{"label":"دقيق أبيض","ratio":78},{"label":"نخالة","ratio":20}]'::jsonb,
   'النوع الأكثر تداولاً — نسبة استخراج دقيق عالية'),
  ('قمح أسمر (دُرَة)', 'Durum Wheat', 2.50,
   '[{"label":"سميد","ratio":70},{"label":"دقيق أسمر","ratio":8},{"label":"نخالة","ratio":19}]'::jsonb,
   'يُستخرج منه السميد بشكل أساسي'),
  ('شعير', 'Barley', 3.00,
   '[{"label":"دقيق شعير","ratio":65},{"label":"نخالة شعير","ratio":32}]'::jsonb,
   'نسبة استخراج أقل — فاقد أعلى'),
  ('ذرة', 'Maize / Corn', 3.50,
   '[{"label":"دقيق ذرة","ratio":70},{"label":"نخالة ذرة","ratio":26}]'::jsonb,
   'يُطحن جافاً — حساس للرطوبة')
ON CONFLICT (name_ar) DO NOTHING;
