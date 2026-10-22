-- ============================================================================
-- accounting-phase4-coa-tree-tests.sql
--
-- اختبارات التحقق من المرحلة الرابعة: المهمة T-25
-- شجرة دليل الحسابات (parent_id) والحسابات التجميعية وحسابات الاستحقاق.
-- ============================================================================

DO $$
DECLARE
  v_roots_count integer;
  v_unpostable_parents integer;
  v_linked_leaves integer;
  v_unlinked_accounts integer;
  v_accrual_2221 boolean;
  v_accrual_2231 boolean;
  v_accrual_1231 boolean;
  v_tree_rows integer;
BEGIN
  RAISE NOTICE '=== بدء اختبارات T-25: شجرة دليل الحسابات وحسابات الاستحقاق ===';

  -- 1. التحقق من وجود الحسابات الجذرية الخمسة الرئيسية
  SELECT count(*) INTO v_roots_count
  FROM public.accounts
  WHERE code IN ('1000', '2000', '3000', '4000', '5000')
    AND parent_id IS NULL;

  IF v_roots_count <> 5 THEN
    RAISE EXCEPTION 'عدد الحسابات الجذرية الرئيسية غير مطابق: المتوقع 5 والفعلي %', v_roots_count;
  END IF;
  RAISE NOTICE '1. تم التحقق من الحسابات الجذرية الخمسة (1000-5000): بنجاح';

  -- 2. التحقق من أن الحسابات الأبوية التجميعية غير قابلة للترحيل المباشر
  SELECT count(*) INTO v_unpostable_parents
  FROM public.accounts
  WHERE code IN ('1000','2000','3000','4000','5000','1100','1200','1300','1400','1500','2100','2200','2300','3100','3900','4100','4900','5100','5200','5300','5400','5600','5900')
    AND is_postable = true;

  IF v_unpostable_parents > 0 THEN
    RAISE EXCEPTION 'يوجد % حساب تجميعي يحمل is_postable=true! يجب أن تكون الحسابات التجميعية غير قابلة للترحيل', v_unpostable_parents;
  END IF;
  RAISE NOTICE '2. تم التحقق من إغلاق الترحيل المباشر (is_postable = false) لكافة الحسابات التجميعية بنجاح';

  -- 3. التحقق من اكتمال حسابات الاستحقاق (2221 مصروفات مستحقة، 2231 إيرادات مؤجلة، 1231 إيرادات مستحقة)
  SELECT EXISTS(SELECT 1 FROM public.accounts WHERE code = '2221' AND account_type = 'LIABILITY') INTO v_accrual_2221;
  SELECT EXISTS(SELECT 1 FROM public.accounts WHERE code = '2231' AND account_type = 'LIABILITY') INTO v_accrual_2231;
  SELECT EXISTS(SELECT 1 FROM public.accounts WHERE code = '1231' AND account_type = 'ASSET') INTO v_accrual_1231;

  IF NOT (v_accrual_2221 AND v_accrual_2231 AND v_accrual_1231) THEN
    RAISE EXCEPTION 'نقص في حسابات الاستحقاق: 2221=%, 2231=%, 1231=%', v_accrual_2221, v_accrual_2231, v_accrual_1231;
  END IF;
  RAISE NOTICE '3. تم التحقق من سلامة وتكامل حسابات الاستحقاق (1231 أصل، 2221 التزام، 2231 التزام): بنجاح';

  -- 4. التحقق من ربط الحسابات التنفيذية بآباء شرعيين
  SELECT count(*) INTO v_linked_leaves
  FROM public.accounts
  WHERE code IN ('1101', '1211', '1311', '1411', '1511', '2111', '2311', '3111', '4111', '5111')
    AND parent_id IS NOT NULL;

  IF v_linked_leaves < 10 THEN
    RAISE EXCEPTION 'عدد الحسابات التنفيذية المرتبطة بآباء أقل من المتوقع: %', v_linked_leaves;
  END IF;
  RAISE NOTICE '4. تم التحقق من ربط الحسابات التنفيذية بالأكواد التجميعية الأبوية: بنجاح';

  -- 5. اختبار دالة get_chart_of_accounts_tree
  SELECT count(*) INTO v_tree_rows
  FROM public.get_chart_of_accounts_tree();

  IF v_tree_rows < 35 THEN
    RAISE EXCEPTION 'دالة الشجرة get_chart_of_accounts_tree لم ترجع العدد الكافي من الحسابات: %', v_tree_rows;
  END IF;
  RAISE NOTICE '5. تم استخراج شجرة الحسابات بالكامل بنجاح: % حساب بمستويات تفريعية وأرصدة تجميعية', v_tree_rows;

  RAISE NOTICE '=== اكتملت جميع اختبارات T-25 لشجرة دليل الحسابات وحسابات الاستحقاق بنجاح 100% ===';
END $$;
