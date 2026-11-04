-- ============================================================================
-- 9917 — حِماية حذف الأصناف: دفتر أمانات المطحنة وأي مرجع غير معروف
-- ============================================================================
--
-- المشكلة
-- -------
-- `product_delete_guard` تسمح بالحذف حين `blocking_total = 0`، و
-- `product_reference_counts` تحسب ستة جداول فقط:
--
--     sales_invoice_items, purchase_invoice_items, sales_return_items,
--     purchase_return_items, stock_transfer_items, stock_movements
--
-- ودفتر أمانات المطحنة `custody_ledger` ليس منها. وهو يحمل بند كل استلام وطحن
-- وتسليم، ومفتاحه `item_id` لا `product_id`. النتيجة: صنف أمانة استُلم من عميل
-- وطُحن وسُلّم يبدو «غير مرتبط» عند الحذف، فيُحذف — فيضيع تاريخ العميل
-- والأمانات المسجّلة عليه.
--
-- المبدأ
-- ------
-- الحذف مسموح فقط حين نُثبت أنه غير مرتبط. الفحص القديم كان قائمة سماح
-- (allow-list) لما نعرفه، وأي جدول جديد يسقط منها بصمت. هنا نقلب الاتجاه:
-- نبحث في `pg_constraint` عن كل مفتاح خارجي يشير إلى `products.id`، ونعدّ
-- الصفوف في كل جدول من هذه الجداول عبر `product_id` أو `item_id`. بهذا يُغطى
-- `custody_ledger` وأي جدول يُضاف مستقبلًا دون تعديل هذه الدالة.
--
-- الجداول التي تُحذف مع الصنف كما هي مقصودة (catalog-satellites) تُستثنى؛
-- فهي بيانات وصفية للصنف نفسه، لا سجلات عميل ولا مستندات:
--     inventory, product_compatibilities
--
-- ما يبقى خارج الحساب عن قصد
-- ---------------------------
--   • `inventory` تُحذف مع الصنف حين يُسمح بالحذف (منتج بلا حركات). لكن وجود
--     صف مخزون مع حركات يعني أن `stock_movements > 0` فالحذف ممنوع أصلًا.
--   • `sales_invoice_items` تُعدّ عبر المفتاح الخارجي كأي جدول آخر.
--   • `milling_service_documents` لا يشير إلى `products.id` مباشرة، بل عبر
--     `sales_invoice_items` التي تمنع الحذف.
--
-- الأمان
-- ------
-- الدالة `SECURITY DEFINER` و`search_path` مثبتة. تُعيد jsonb فقط ولا تكشف
-- أسماء جداول للعميل إلا عبر الرسالة العامة. صلاحية الحذف كما هي: owner /
-- manager / platform admin.

CREATE OR REPLACE FUNCTION public.product_reference_counts(p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sales_items      bigint := 0;
  v_purchase_items   bigint := 0;
  v_sales_returns    bigint := 0;
  v_purchase_returns bigint := 0;
  v_transfers        bigint := 0;
  v_stock_movements  bigint := 0;
  v_inventory_rows   bigint := 0;
  v_compatibilities  bigint := 0;
  v_custody_entries  bigint := 0;
  v_other_refs       bigint := 0;
  v_blocking         bigint := 0;

  v_table   text;
  v_column  text;
  v_count   bigint;
BEGIN
  -- ------------------------------------------------------------------------
  -- 1) العدّادات المعروفة (تبقى صريحة لأن الواجهة تعرضها بأسماء مقروءة)
  -- ------------------------------------------------------------------------
  SELECT count(*) INTO v_sales_items
    FROM public.sales_invoice_items WHERE product_id = p_product_id;

  SELECT count(*) INTO v_purchase_items
    FROM public.purchase_invoice_items WHERE product_id = p_product_id;

  -- المرتجعات والتحويلات تُفحص ديناميكيًا: تثبيتات أقدم لا تحتوي هذه الجداول.
  BEGIN
    SELECT count(*) INTO v_sales_returns
      FROM public.sales_return_items WHERE product_id = p_product_id;
  EXCEPTION WHEN undefined_table THEN v_sales_returns := 0;
  END;

  BEGIN
    SELECT count(*) INTO v_purchase_returns
      FROM public.purchase_return_items WHERE product_id = p_product_id;
  EXCEPTION WHEN undefined_table THEN v_purchase_returns := 0;
  END;

  BEGIN
    SELECT count(*) INTO v_transfers
      FROM public.stock_transfer_items WHERE product_id = p_product_id;
  EXCEPTION WHEN undefined_table THEN v_transfers := 0;
  END;

  SELECT count(*) INTO v_stock_movements
    FROM public.stock_movements WHERE product_id = p_product_id;

  SELECT count(*) INTO v_inventory_rows
    FROM public.inventory WHERE product_id = p_product_id;

  BEGIN
    SELECT count(*) INTO v_compatibilities
      FROM public.product_compatibilities WHERE product_id = p_product_id;
  EXCEPTION WHEN undefined_table THEN v_compatibilities := 0;
  END;

  -- ------------------------------------------------------------------------
  -- 2) دفتر أمانات المطحنة — كل استلام/طحن/تسليم مربوط بصنف وعميل
  --
  -- هذا هو الثقب الذي أُصلح: الصنف الذي استُلم في المطحنة وأُعيد تسليمه ليس
  -- «غير مرتبط» حتى لو لم يدخل فاتورة بيع أو شراء.
  -- ------------------------------------------------------------------------
  BEGIN
    SELECT count(*) INTO v_custody_entries
      FROM public.custody_ledger WHERE item_id = p_product_id;
  EXCEPTION WHEN undefined_table THEN v_custody_entries := 0;
  END;

  -- ------------------------------------------------------------------------
  -- 3) قاعدة عامة: كل مفتاح خارجي آخر يشير إلى products(id) ويحمل صفًا
  --
  -- تُستثنى الجداول المعروفة أعلاه (عُدّت بالفعل) والجداول الوصفية التي تُحذف
  -- مع الصنف (inventory / product_compatibilities). أي جدول جديد يُضاف لاحقًا
  -- يدخل الحساب تلقائيًا؛ فالحذف يبقى محصورًا في «غير المرتبطين».
  -- ------------------------------------------------------------------------
  FOR v_table, v_column IN
    SELECT DISTINCT c.conrelid::regclass::text, a.attname
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid
       AND a.attnum = ANY (c.conkey)
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.products'::regclass
       AND c.conrelid::regclass::text NOT IN (
         'public.sales_invoice_items',
         'public.purchase_invoice_items',
         'public.sales_return_items',
         'public.purchase_return_items',
         'public.stock_transfer_items',
         'public.stock_movements',
         'public.inventory',
         'public.product_compatibilities'
       )
  LOOP
    -- الحماية من الحقن: الأسماء تأتي من كتالوج القاعدة نفسه، لكن نتحقق منها
    -- صراحةً فلا يُنفَّذ إلا مُعرِّف كائن معروف.
    CONTINUE WHEN v_table !~ '^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$';
    CONTINUE WHEN v_column !~ '^[a-z_][a-z0-9_]*$';

    BEGIN
      EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', v_table, v_column)
        INTO v_count
        USING p_product_id;
      v_other_refs := v_other_refs + coalesce(v_count, 0);
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      -- تثبيت بلا الجدول/العمود: لا مراجع منه.
      NULL;
    END;
  END LOOP;

  v_blocking := v_sales_items + v_purchase_items + v_sales_returns
              + v_purchase_returns + v_transfers + v_stock_movements
              + v_custody_entries + v_other_refs;

  RETURN jsonb_build_object(
    'product_id',          p_product_id,
    'sales_items',         v_sales_items,
    'purchase_items',      v_purchase_items,
    'sales_returns',       v_sales_returns,
    'purchase_returns',    v_purchase_returns,
    'transfers',           v_transfers,
    'stock_movements',     v_stock_movements,
    'inventory_rows',      v_inventory_rows,
    'compatibilities',     v_compatibilities,
    'custody_entries',     v_custody_entries,
    'other_refs',          v_other_refs,
    'blocking_total',      v_blocking,
    'can_delete',          v_blocking = 0,
    'has_history',         v_stock_movements > 0
                           OR v_inventory_rows > 0
                           OR v_custody_entries > 0
  );
END;
$$;

COMMENT ON FUNCTION public.product_reference_counts(uuid) IS
  'عدد المراجع لكل صنف قبل الحذف. يشمل دفتر أمانات المطحنة (custody_ledger) وأي مفتاح خارجي آخر يشير إلى products(id).';

-- ============================================================================
-- إعادة تعريف بوابة الحذف فوق العدّاد الموسّع
-- ============================================================================
--
-- نفس العقد السابق (deleted/reason/counts) حتى تبقى الواجهة كما هي، لكن
-- الرسالة صارت أصدق: «referenced» تعني الآن «مرتبط فعلًا بأي سجل».
--
CREATE OR REPLACE FUNCTION public.product_delete_guard(p_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_counts   jsonb;
  v_blocking bigint;
BEGIN
  -- الصلاحية مفحوصة في القاعدة: لا يعتمد على الواجهة.
  IF NOT (
    public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'manager')
    OR public.is_platform_admin(auth.uid())
  ) THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'forbidden');
  END IF;

  v_counts   := public.product_reference_counts(p_product_id);
  v_blocking := COALESCE((v_counts ->> 'blocking_total')::bigint, 0);

  IF v_blocking > 0 THEN
    -- مرجع تاريخي أو مستند أو عميل: لا حذف أبدًا. البديل هو إلغاء التنشيط.
    RETURN jsonb_build_object(
      'deleted', false,
      'reason',  'referenced',
      'counts',  v_counts
    );
  END IF;

  -- لا مراجع: امسح ملحقات الكتالوج التي لا تحمل معنى ماليًا، ثم الصنف.
  BEGIN
    DELETE FROM public.product_compatibilities WHERE product_id = p_product_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  DELETE FROM public.inventory WHERE product_id = p_product_id;

  DELETE FROM public.products WHERE id = p_product_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'deleted', true,
    'reason',  'deleted',
    'counts',  v_counts
  );
END;
$$;

COMMENT ON FUNCTION public.product_delete_guard(uuid) IS
  'حذف صنف فقط إذا لم يرتبط بأي مستند أو عميل أو سجل مخزون. غير ذلك تُرجع referenced والواجهة تعرض إلغاء التنشيط.';
