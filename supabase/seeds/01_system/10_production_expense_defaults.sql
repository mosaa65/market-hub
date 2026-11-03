-- ============================================================================
-- 10_production_expense_defaults.sql — إعدادات إنتاج افتراضية آمنة
-- ============================================================================
-- يضيف مركز إنتاج واحدًا وتصنيفات منفصلة للتكاليف التي قد تدخل في التحويل.
-- لا تُؤهل التصنيفات العامة مثل الرواتب والإيجار والنقل؛ لأنها قد تشمل الإدارة
-- أو البيع أو نقل المشتريات. كل تصنيف افتراضي هنا مخصص للإنتاج فقط، ولا يُرحّل
-- إلى المخزون إلا الجزء الفعلي الذي يخصصه المستخدم للتشغيلة.
-- المواد المخزنية (ومنها أكياس التعبئة الموجودة في المخزون) تُصرف كمدخل إنتاج،
-- ولا تسجل مرة أخرى كمصروف تعبئة.
-- ============================================================================

BEGIN;

INSERT INTO public.expense_cost_centers (code, name, name_ar, is_active)
SELECT 'PROD', 'Production', 'الإنتاج', true
WHERE NOT EXISTS (
  SELECT 1
    FROM public.expense_cost_centers cc
   WHERE upper(btrim(coalesce(cc.code, ''))) = 'PROD'
      OR lower(btrim(coalesce(cc.name, ''))) = 'production'
      OR lower(btrim(coalesce(cc.name_ar, ''))) IN ('الإنتاج', 'الانتاج')
);

-- أسماء منفصلة تمنع خلط بند المنشأة العام بالتكلفة المباشرة للإنتاج.
-- ترتيب الحسابات وخرائطها ثابتة في دليل الحسابات النظامي.
INSERT INTO public.expense_categories (
  name, name_ar, sort_order, is_active, account_id, production_cost_eligible, notes
)
SELECT v.name, v.name_ar, v.sort_order, true, a.id, true, v.notes
  FROM (VALUES
    (
      'أجور عمالة الإنتاج المباشرة',
      'أجور عمالة الإنتاج المباشرة',
      120,
      '5211',
      'أجور العاملين المباشرة في التشغيل فقط، مع توزيعها على مركز الإنتاج حسب ساعات أو كمية العمل.'
    ),
    (
      'طاقة ووقود الإنتاج',
      'طاقة ووقود الإنتاج',
      130,
      '5311',
      'الجزء المستهلك في التشغيل فقط. وزّع الطاقة المشتركة على أساس موثق، ولا تحمل استخدام الإدارة أو البيع.'
    ),
    (
      'تعبئة مستهلكة للإنتاج (غير مخزنية)',
      'تعبئة مستهلكة للإنتاج (غير مخزنية)',
      140,
      '5316',
      'استخدمه للمواد المستهلكة التي لا تُدار في المخزون فقط. إذا كانت العبوات أصنافًا مخزنية فلتصرف كمواد للتشغيلة.'
    ),
    (
      'حصة الإنتاج من إيجار المنشأة',
      'حصة الإنتاج من إيجار المنشأة',
      150,
      '5313',
      'لا تخصص إلا حصة الإنتاج وفق توزيع منتظم والطاقة العادية؛ يبقى الجزء غير المخصص مصروف فترة.'
    ),
    (
      'حصة الإنتاج من صيانة المعدات',
      'حصة الإنتاج من صيانة المعدات',
      160,
      '5314',
      'خصص أعمال ومرافق الإنتاج فقط وفق أساس ثابت وموثق؛ لا تحمل صيانة المكاتب أو الأصول غير الإنتاجية.'
    ),
    (
      'Production direct labour',
      'أجور عمالة الإنتاج المباشرة',
      120,
      '5211',
      'أجور العاملين المباشرة في التشغيل فقط، مع توزيعها على مركز الإنتاج حسب ساعات أو كمية العمل.'
    ),
    (
      'Production energy and fuel',
      'طاقة ووقود الإنتاج',
      130,
      '5311',
      'الجزء المستهلك في التشغيل فقط. وزّع الطاقة المشتركة على أساس موثق، ولا تحمل استخدام الإدارة أو البيع.'
    ),
    (
      'Production packaging consumed',
      'تعبئة مستهلكة للإنتاج (غير مخزنية)',
      140,
      '5316',
      'استخدمه للمواد المستهلكة التي لا تُدار في المخزون فقط. إذا كانت العبوات أصنافًا مخزنية فلتصرف كمواد للتشغيلة.'
    ),
    (
      'Production facility rent allocation',
      'حصة الإنتاج من إيجار المنشأة',
      150,
      '5313',
      'لا تخصص إلا حصة الإنتاج وفق توزيع منتظم والطاقة العادية؛ يبقى الجزء غير المخصص مصروف فترة.'
    ),
    (
      'Production equipment maintenance allocation',
      'حصة الإنتاج من صيانة المعدات',
      160,
      '5314',
      'خصص أعمال ومرافق الإنتاج فقط وفق أساس ثابت وموثق؛ لا تحمل صيانة المكاتب أو الأصول غير الإنتاجية.'
    )
  ) AS v(name, name_ar, sort_order, account_code, notes)
  JOIN public.accounts a
    ON a.code = v.account_code
   AND a.account_type::text = 'EXPENSE'
   AND a.is_active
   AND a.is_postable
ON CONFLICT (name) DO UPDATE
   SET name_ar = EXCLUDED.name_ar,
       sort_order = EXCLUDED.sort_order,
       is_active = true,
       account_id = EXCLUDED.account_id,
       production_cost_eligible = true,
       notes = EXCLUDED.notes;

-- التصنيفات العامة الافتراضية لا تصلح وحدها لإثبات أن التكلفة إنتاجية.
-- التصنيفات الجديدة أعلاه هي مسار التخصيص الافتراضي الواضح.
UPDATE public.expense_categories
   SET production_cost_eligible = false
 WHERE name IN (
   'Rent', 'Salaries', 'Utilities', 'Transport', 'Maintenance', 'Packaging',
   'Internet', 'Office', 'Marketing', 'Professional', 'Other'
 );

DO $verify$
DECLARE
  v_missing text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.expense_cost_centers
     WHERE is_active
       AND (upper(btrim(coalesce(code, ''))) = 'PROD'
         OR lower(btrim(coalesce(name, ''))) = 'production'
         OR lower(btrim(coalesce(name_ar, ''))) IN ('الإنتاج', 'الانتاج'))
  ) THEN
    RAISE EXCEPTION 'تعذر إعداد مركز تكلفة الإنتاج الافتراضي';
  END IF;

  SELECT array_agg(v.name)
    INTO v_missing
    FROM (VALUES
      ('Production direct labour'),
      ('Production energy and fuel'),
      ('Production packaging consumed'),
      ('Production facility rent allocation'),
      ('Production equipment maintenance allocation')
    ) AS v(name)
    LEFT JOIN public.expense_categories c ON c.name = v.name
   WHERE c.id IS NULL OR c.account_id IS NULL OR NOT c.production_cost_eligible;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'إعداد تصنيفات تكلفة الإنتاج غير مكتمل: %', array_to_string(v_missing, ', ');
  END IF;
END;
$verify$;

COMMIT;
