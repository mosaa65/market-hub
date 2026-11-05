-- ============================================================================
-- 12_milling_reference.sql — shared reference values for milling workflows
-- ============================================================================
-- Grain types are reusable reference choices. This file contains no customer,
-- product, stock, or sample transaction rows.

BEGIN;

INSERT INTO public.grain_types (
  name_ar, name_en, default_loss_rate_pct, default_output_map, notes
)
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

INSERT INTO public.expense_cost_centers (code, name, name_ar, is_active)
SELECT 'MILLING-SERVICE', 'Milling service', 'خدمة الطحن', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.expense_cost_centers
  WHERE upper(coalesce(code, '')) = 'MILLING-SERVICE'
     OR name_ar = 'خدمة الطحن'
);

COMMIT;
