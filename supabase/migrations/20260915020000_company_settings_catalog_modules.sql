-- ==========================================================
-- 20260915020000_company_settings_catalog_modules.sql
-- Persist Industry & Catalog Modules in company_settings
-- ==========================================================

ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS catalog_modules jsonb NOT NULL DEFAULT '{
    "profile": "spare_parts",
    "enableMakesAndModels": true,
    "enableOrigins": true,
    "enableQualityGrades": true,
    "enableBrands": true,
    "enableUnits": true
  }'::jsonb;

COMMENT ON COLUMN public.company_settings.catalog_modules IS 'إعدادات تفعيل موديولات الفهرسة حسب نوع النشاط التجاري (قطع غيار/بقالة/تجزئة/مخصص)';
