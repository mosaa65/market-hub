-- ============================================================================
-- 26_accounting_phase4_coa_hierarchy_accruals.sql
--
-- المرحلة الرابعة — المهمة T-25:
-- ضبط شجرة الحسابات (parent_id) والحسابات التجميعية (is_postable = false)
-- وتدقيق حسابات الاستحقاق (Accruals) ودوال استعراض الهيكل الشجري.
--
-- معايير السلامة والجودة:
-- 1. إضافة الحسابات التجميعية (1000..5000) مع is_postable = false لمنع الترحيل المباشر.
-- 2. ربط parent_id لكافة الحسابات الفرعية القائمة دون تغيير أكوادها أو تكسير الترحيل.
-- 3. توفير حسابات الاستحقاق المتكاملة: 2221 (مصروفات مستحقة)، 2231 (إيرادات مقدمة)، 1231 (إيرادات مستحقة القبض).
-- 4. توفير دالة get_chart_of_accounts_tree() لاستخراج الشجرة الهرمية وأرصدتها التجميعية.
-- ============================================================================

BEGIN;

-- ── 1. إدراج الحسابات الرئيسية التجميعية (المستوى 1: الجذور) ───────────────
INSERT INTO public.accounts (code, name_ar, account_type, is_system, is_postable, notes)
VALUES
  ('1000', 'الأصول',               'ASSET',     true, false, 'حساب رئيسي تجميعي (المستوى الأول) — الأصول'),
  ('2000', 'الخصوم والالتزامات',    'LIABILITY', true, false, 'حساب رئيسي تجميعي (المستوى الأول) — الخصوم والالتزامات'),
  ('3000', 'حقوق الملكية',         'EQUITY',    true, false, 'حساب رئيسي تجميعي (المستوى الأول) — حقوق الملكية'),
  ('4000', 'الإيرادات',            'REVENUE',   true, false, 'حساب رئيسي تجميعي (المستوى الأول) — الإيرادات'),
  ('5000', 'المصروفات',            'EXPENSE',   true, false, 'حساب رئيسي تجميعي (المستوى الأول) — المصروفات')
ON CONFLICT (code) DO UPDATE SET
  is_postable = false,
  account_type = EXCLUDED.account_type;


-- ── 2. إدراج الحسابات التجميعية الفرعية (المستوى 2) وربطها بالجذور ──────────
-- (أ) الأصول
INSERT INTO public.accounts (code, name_ar, account_type, parent_id, is_system, is_postable, notes)
VALUES
  ('1100', 'النقدية والأرصدة بالبنوك وما في حكمها', 'ASSET', (SELECT id FROM public.accounts WHERE code = '1000'), true, false, 'حساب تجميعي للأموال النقدية والمصرفية والمحافظ'),
  ('1200', 'المدينون والذمم المدينة التجارية',     'ASSET', (SELECT id FROM public.accounts WHERE code = '1000'), true, false, 'حساب تجميعي لذمم العملاء ومستحقات النشاط'),
  ('1300', 'المخزون وبضاعة النشاط',                 'ASSET', (SELECT id FROM public.accounts WHERE code = '1000'), true, false, 'حساب تجميعي لجميع أصناف المخزون وضريبة المدخلات'),
  ('1400', 'الأصول الثابتة',                        'ASSET', (SELECT id FROM public.accounts WHERE code = '1000'), true, false, 'حساب تجميعي للأصول الرأسمالية ومجمعات إهلاكها'),
  ('1500', 'المصروفات والأصول المؤجلة والمدفوعة مقدماً', 'ASSET', (SELECT id FROM public.accounts WHERE code = '1000'), true, false, 'حساب تجميعي للمصروفات المدفوعة مقدماً والعقود المؤجلة')
ON CONFLICT (code) DO UPDATE SET
  parent_id = (SELECT id FROM public.accounts WHERE code = '1000'),
  is_postable = false;

-- (ب) الخصوم
INSERT INTO public.accounts (code, name_ar, account_type, parent_id, is_system, is_postable, notes)
VALUES
  ('2100', 'الذمم الدائنة والموردون وأمانات العملاء', 'LIABILITY', (SELECT id FROM public.accounts WHERE code = '2000'), true, false, 'حساب تجميعي للموردين والتزامات الأمانات'),
  ('2200', 'الالتزامات المستحقة والقروض قصيرة الأجل',  'LIABILITY', (SELECT id FROM public.accounts WHERE code = '2000'), true, false, 'حساب تجميعي لمستحقات المصروفات والإيرادات المؤجلة'),
  ('2300', 'الالتزامات الضريبية والضريبة المضافة',     'LIABILITY', (SELECT id FROM public.accounts WHERE code = '2000'), true, false, 'حساب تجميعي لضريبة المخرجات وصافي التسوية الضريبية')
ON CONFLICT (code) DO UPDATE SET
  parent_id = (SELECT id FROM public.accounts WHERE code = '2000'),
  is_postable = false;

-- (ج) حقوق الملكية
INSERT INTO public.accounts (code, name_ar, account_type, parent_id, is_system, is_postable, notes)
VALUES
  ('3100', 'رأس المال والمسحوبات الشخصية',          'EQUITY', (SELECT id FROM public.accounts WHERE code = '3000'), true, false, 'حساب تجميعي لرأس المال وحسابات الشركاء'),
  ('3900', 'الأرباح والنتائج المالية المتراكمة',      'EQUITY', (SELECT id FROM public.accounts WHERE code = '3000'), true, false, 'حساب تجميعي للأرباح المحتجزة ونتيجة النشاط الجارية')
ON CONFLICT (code) DO UPDATE SET
  parent_id = (SELECT id FROM public.accounts WHERE code = '3000'),
  is_postable = false;

-- (د) الإيرادات
INSERT INTO public.accounts (code, name_ar, account_type, parent_id, is_system, is_postable, notes)
VALUES
  ('4100', 'إيرادات المبيعات والنشاط التشغيلي',      'REVENUE', (SELECT id FROM public.accounts WHERE code = '4000'), true, false, 'حساب تجميعي لإيراد المبيعات والخدمات'),
  ('4900', 'إيرادات وأرباح أخرى غير تشغيلية',        'REVENUE', (SELECT id FROM public.accounts WHERE code = '4000'), true, false, 'حساب تجميعي للإيرادات المتنوعة وفروق العملة')
ON CONFLICT (code) DO UPDATE SET
  parent_id = (SELECT id FROM public.accounts WHERE code = '4000'),
  is_postable = false;

-- (هـ) المصروفات
INSERT INTO public.accounts (code, name_ar, account_type, parent_id, is_system, is_postable, notes)
VALUES
  ('5100', 'تكلفة البضاعة والمبيعات',               'EXPENSE', (SELECT id FROM public.accounts WHERE code = '5000'), true, false, 'حساب تجميعي لتكلفة المبيعات المباشرة'),
  ('5200', 'أجور ورواتب ومنافع العاملين',            'EXPENSE', (SELECT id FROM public.accounts WHERE code = '5000'), true, false, 'حساب تجميعي للعمالة المباشرة والإدارية'),
  ('5300', 'المصروفات التشغيلية والخدمية',           'EXPENSE', (SELECT id FROM public.accounts WHERE code = '5000'), true, false, 'حساب تجميعي لطاقة ومياه وإيجارات وصيانة التشغيل'),
  ('5400', 'المصروفات الإدارية والعمومية',           'EXPENSE', (SELECT id FROM public.accounts WHERE code = '5000'), true, false, 'حساب تجميعي للمصروفات الإدارية والعمومية والمكتبية'),
  ('5600', 'الإهلاك والاستهلاك للأصول',              'EXPENSE', (SELECT id FROM public.accounts WHERE code = '5000'), true, false, 'حساب تجميعي لإهلاك الأصول الثابتة'),
  ('5900', 'فاقد وتلف ومصروفات أخرى',                'EXPENSE', (SELECT id FROM public.accounts WHERE code = '5000'), true, false, 'حساب تجميعي للفاقد والخسائر التشغيلية الأخرى')
ON CONFLICT (code) DO UPDATE SET
  parent_id = (SELECT id FROM public.accounts WHERE code = '5000'),
  is_postable = false;


-- ── 3. تدقيق وضمان وجود حسابات الاستحقاق المتوازنة (Accruals) ───────────────
-- أصل متداول: إيرادات مستحقة القبض (Accrued Revenue Receivable)
INSERT INTO public.accounts (code, name_ar, account_type, parent_id, is_system, is_postable, notes)
VALUES (
  '1231',
  'إيرادات مستحقة القبض',
  'ASSET',
  (SELECT id FROM public.accounts WHERE code = '1200'),
  true,
  true,
  'أصل متداول: إيرادات تحققت للنشاط ولم يتم تحصيلها أو فوترتها بعد.'
)
ON CONFLICT (code) DO UPDATE SET
  parent_id = (SELECT id FROM public.accounts WHERE code = '1200'),
  is_postable = true;

-- التزام متداول: مصروفات مستحقة الدفع (Accrued Expenses Payable)
UPDATE public.accounts
SET parent_id = (SELECT id FROM public.accounts WHERE code = '2200'),
    is_postable = true
WHERE code = '2221';

-- التزام متداول: إيرادات مستحقة / مؤجلة محصلة مقدماً (Unearned / Deferred Revenue)
UPDATE public.accounts
SET parent_id = (SELECT id FROM public.accounts WHERE code = '2200'),
    is_postable = true
WHERE code = '2231';


-- ── 4. ربط كافة الحسابات الفرعية والتنفيذية بآبائها (Level 3/4) ────────────

-- النقدية والبنوك -> 1100
UPDATE public.accounts
SET parent_id = (SELECT id FROM public.accounts WHERE code = '1100')
WHERE code IN ('1101', '1111', '1112', '1121', '1131', '1132', '1133', '1134', '1139');

-- العملاء والمدينون -> 1200
UPDATE public.accounts
SET parent_id = (SELECT id FROM public.accounts WHERE code = '1200')
WHERE code IN ('1211', '1231');

-- المخزون وضريبة المدخلات -> 1300
UPDATE public.accounts
SET parent_id = (SELECT id FROM public.accounts WHERE code = '1300')
WHERE code IN ('1311', '1312', '1313', '1314', '1315', '1316', '1321');

-- الأصول الثابتة ومجمع الإهلاك -> 1400
UPDATE public.accounts
SET parent_id = (SELECT id FROM public.accounts WHERE code = '1400')
WHERE code IN ('1411', '1421', '1431', '1491');

-- المصروفات المدفوعة مقدماً والمؤجلة -> 1500
UPDATE public.accounts
SET parent_id = (SELECT id FROM public.accounts WHERE code = '1500')
WHERE code IN ('1511', '1512');

-- الموردون وأمانات العملاء -> 2100
UPDATE public.accounts
SET parent_id = (SELECT id FROM public.accounts WHERE code = '2100')
WHERE code IN ('2111', '2121');

-- القروض والمستحقات -> 2200
UPDATE public.accounts
SET parent_id = (SELECT id FROM public.accounts WHERE code = '2200')
WHERE code IN ('2211', '2221', '2231');

-- الضرائب -> 2300
UPDATE public.accounts
SET parent_id = (SELECT id FROM public.accounts WHERE code = '2300')
WHERE code IN ('2311', '2321');

-- رأس المال والمسحوبات -> 3100
UPDATE public.accounts
SET parent_id = (SELECT id FROM public.accounts WHERE code = '3100')
WHERE code IN ('3111', '3211');

-- الأرباح والنتائج -> 3900
UPDATE public.accounts
SET parent_id = (SELECT id FROM public.accounts WHERE code = '3900')
WHERE code IN ('3911', '3921');

-- الإيرادات التشغيلية -> 4100
UPDATE public.accounts
SET parent_id = (SELECT id FROM public.accounts WHERE code = '4100')
WHERE code IN ('4111', '4211', '4311');

-- إيرادات أخرى -> 4900
UPDATE public.accounts
SET parent_id = (SELECT id FROM public.accounts WHERE code = '4900')
WHERE code IN ('4911');

-- تكلفة المبيعات -> 5100
UPDATE public.accounts
SET parent_id = (SELECT id FROM public.accounts WHERE code = '5100')
WHERE code IN ('5111');

-- الأجور والرواتب -> 5200
UPDATE public.accounts
SET parent_id = (SELECT id FROM public.accounts WHERE code = '5200')
WHERE code IN ('5211', '5221', '5231');

-- مصروفات التشغيل -> 5300
UPDATE public.accounts
SET parent_id = (SELECT id FROM public.accounts WHERE code = '5300')
WHERE code IN ('5311', '5312', '5313', '5314', '5315', '5316', '5317', '5318', '5319');

-- المصروفات العمومية والإدارية -> 5400
UPDATE public.accounts
SET parent_id = (SELECT id FROM public.accounts WHERE code = '5400')
WHERE code IN ('5411', '5511');

-- إهلاك الأصول -> 5600
UPDATE public.accounts
SET parent_id = (SELECT id FROM public.accounts WHERE code = '5600')
WHERE code IN ('5611');

-- خسائر وفاقد ومصروفات أخرى -> 5900
UPDATE public.accounts
SET parent_id = (SELECT id FROM public.accounts WHERE code = '5900')
WHERE code IN ('5711', '5811', '5911', '5921');


-- ── 5. دالة استخراج شجرة دليل الحسابات مع الإحصائيات (Recursive CTE) ─────────
CREATE OR REPLACE FUNCTION public.get_chart_of_accounts_tree()
RETURNS TABLE (
  id uuid,
  code varchar(20),
  name_ar text,
  account_type public.account_type,
  parent_id uuid,
  parent_code varchar(20),
  level integer,
  is_postable boolean,
  is_system boolean,
  is_active boolean,
  notes text,
  total_debit numeric,
  total_credit numeric,
  current_balance numeric,
  children_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH RECURSIVE coa_tree AS (
    -- الجذور (المستوى 1: الأصول، الخصوم، حقوق الملكية، الإيرادات، المصروفات)
    SELECT
      a.id,
      a.code,
      a.name_ar,
      a.account_type,
      a.parent_id,
      CAST(NULL AS varchar(20)) AS parent_code,
      1 AS level,
      a.is_postable,
      a.is_system,
      a.is_active,
      a.notes,
      ARRAY[a.code::text] AS path
    FROM public.accounts a
    WHERE a.parent_id IS NULL

    UNION ALL

    -- الأبناء بالتكرار
    SELECT
      c.id,
      c.code,
      c.name_ar,
      c.account_type,
      c.parent_id,
      p.code AS parent_code,
      p.level + 1 AS level,
      c.is_postable,
      c.is_system,
      c.is_active,
      c.notes,
      p.path || c.code::text AS path
    FROM public.accounts c
    JOIN coa_tree p ON c.parent_id = p.id
  ),
  account_balances AS (
    -- مجاميع القيود المرحلة من دفتر اليومية لكل حساب
    SELECT
      jl.account_id,
      round(coalesce(sum(jl.debit), 0), 2) AS debit,
      round(coalesce(sum(jl.credit), 0), 2) AS credit
    FROM public.journal_lines jl
    JOIN public.journal_entries je ON je.id = jl.entry_id AND je.status = 'POSTED'
    GROUP BY jl.account_id
  ),
  children_counts AS (
    SELECT parent_id, count(*) AS cnt
    FROM public.accounts
    WHERE parent_id IS NOT NULL
    GROUP BY parent_id
  )
  SELECT
    t.id,
    t.code,
    t.name_ar,
    t.account_type,
    t.parent_id,
    t.parent_code,
    t.level,
    t.is_postable,
    t.is_system,
    t.is_active,
    t.notes,
    coalesce(ab.debit, 0) AS total_debit,
    coalesce(ab.credit, 0) AS total_credit,
    CASE
      -- طبيعة مدينة للأصول والمصروفات: مدين - دائن
      WHEN t.account_type IN ('ASSET', 'EXPENSE') THEN
        round(coalesce(ab.debit, 0) - coalesce(ab.credit, 0), 2)
      -- طبيعة دائنة للخصوم وحقوق الملكية والإيرادات: دائن - مدين
      ELSE
        round(coalesce(ab.credit, 0) - coalesce(ab.debit, 0), 2)
    END AS current_balance,
    coalesce(cc.cnt, 0) AS children_count
  FROM coa_tree t
  LEFT JOIN account_balances ab ON ab.account_id = t.id
  LEFT JOIN children_counts cc ON cc.parent_id = t.id
  ORDER BY t.code ASC;
$$;

COMMENT ON FUNCTION public.get_chart_of_accounts_tree() IS
  'T-25: استخراج الشجرة الهرمية الكاملة لدليل الحسابات مع مستويات التفرع، ومجاميع القيود، والأرصدة حسب طبيعة الحساب.';

COMMIT;
