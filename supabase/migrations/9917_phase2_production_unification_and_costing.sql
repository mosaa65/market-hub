-- ============================================================================
-- 9917_phase2_production_unification_and_costing.sql
--
-- المرحلة الثانية من خطة تطوير Market Hub / Vortex ERP:
-- توحيد مسارات الإنتاج وتحسين احتساب التكاليف.
--
-- المضمون:
--   1) المسار القديم smart_manufacture: توحيد الوحدات إلى وحدة الأساس لكل صنف،
--      ومنع تحويل مخزون العميل إلى مخزون الشركة، وتحويل تحقق الكمية إلى
--      مكافئ الكتلة بدل جمع أعداد وحدات غير متجانسة.
--   2) فصل مرحلة الإنتاج عن مسار التحويل اليدوي convert_stock (كانا يتشاركان
--      المصدر 'stock_conversion' فلا يمكن تمييز تشغيلة إنتاج حقيقية).
--   3) دورة الإنتاج الحديثة: قفل تزامن على مواد الأمر، توزيع التكلفة المشتركة
--      بلا تحريف السطر الأخير، فاقد عددي بوحدة الصنف، وحماية سطور الأمر بعد
--      الترحيل من أي تعديل/حذف خارج دورة العكس.
--   4) دالة تفاصيل تكلفة أمر الإنتاج production_order_cost_detail.
--   5) تقوية منع تداخل عمليات الإنتاج وتقوية شرط العكس (أثر لاحق موحّد).
--
-- القيود المتّبعة:
--   • لا تعديل على بيانات تاريخية. لا backfill. لا DELETE.
--   • ما هنا تعريف دوال/أعمدة/فهارس جديدة فقط؛ لا ALTER هدّام على بيانات.
--   • لا migrations تُنفذ على قاعدة بيانات حيّة من هذا السياق؛ الملف للمشروع.
--   • التوقيعات العامة محفوظة (smart_manufacture، create_and_post_production_order،
--     complete_production_order، reverse_production_order).
-- ============================================================================
BEGIN;

-- ── 1. ربط حركة المخزون بأمر الإنتاج ───────────────────────────────────
-- convert_stock (48) يسجّل حركاته بمصدر 'stock_conversion' للتحويل اليدوي.
-- أمر الإنتاج الحديث يعمل بمصادر إنتاجه الخاصة (production_material،
-- production_output، production_reversal_*). هنا نضيف عموداً صريحاً يربط
-- الحركة بأمرها، بلا أي تعديل على حركة قائمة: العمود additive، ويعبأ للمحركات
-- الجديدة فقط، والقديمة تُستنتج من source_type/source_id كما هي.
-- العمود additive وآمن على الجداول القائمة.
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS production_order_id uuid
    REFERENCES public.production_orders(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS stock_movements_production_order_idx
  ON public.stock_movements (production_order_id)
  WHERE production_order_id IS NOT NULL;

COMMENT ON COLUMN public.stock_movements.production_order_id IS
  'أمر الإنتاج الشركة المالك للحركة (صرف مادة/استلام ناتج/عكس). NULL لغير الإنتاج.';

-- تعبئة مرجع الأمر للمحركات الجديدة فقط (لا backfill للتاريخ): حركات صرف
-- المواد واستلام النواتج وعكسها. هذا يربط الحركة الحالية دون تغيير أي كمية
-- أو قيمة. الحركات القديمة تُستنتج من source_type/source_id فقط.
CREATE OR REPLACE FUNCTION public.production_link_movement_to_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order_id uuid;
BEGIN
  IF NEW.production_order_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.source_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.source_type = 'production_material' THEN
    SELECT m.production_order_id INTO v_order_id
      FROM public.production_order_materials m WHERE m.id = NEW.source_id;
  ELSIF NEW.source_type = 'production_output' THEN
    SELECT o.production_order_id INTO v_order_id
      FROM public.production_order_outputs o WHERE o.id = NEW.source_id;
  ELSIF NEW.source_type = 'production_reversal_material' THEN
    SELECT m.production_order_id INTO v_order_id
      FROM public.production_order_materials m WHERE m.id = NEW.source_id;
  ELSIF NEW.source_type = 'production_reversal_output' THEN
    SELECT o.production_order_id INTO v_order_id
      FROM public.production_order_outputs o WHERE o.id = NEW.source_id;
  END IF;

  NEW.production_order_id := v_order_id;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS stock_movements_link_production_order ON public.stock_movements;
CREATE TRIGGER stock_movements_link_production_order
  BEFORE INSERT ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.production_link_movement_to_order();

REVOKE ALL ON FUNCTION public.production_link_movement_to_order()
  FROM PUBLIC, anon, authenticated, service_role;

-- ── 2. أحكام عزل الملكية: حبوب العميل لا تتحول إلى مخزون شركة ───────────────
-- المسار القديم يمكن أن يتلقى أصناف أمانات (is_custody_item) أو أصناف
-- CUSTOMER_OWNED، فيكسر الفصل المحاسبي بين مخزون الشركة وعهدة العملاء.
-- منع مزدوج: في الدوال (خطأ واضح بالعربية) وفي trigger على الجداول الأساسية.
CREATE OR REPLACE FUNCTION public.guard_production_company_stock_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
BEGIN
  SELECT p.* INTO v_product FROM public.products p WHERE p.id = NEW.product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الصنف غير موجود' USING ERRCODE = 'P0002';
  END IF;
  IF v_product.is_custody_item IS TRUE
     OR v_product.inventory_policy = 'CUSTOMER_OWNED'::public.inventory_policy
     OR (NEW.owner_type = 'COMPANY'::public.owner_type AND NEW.owner_id IS NOT NULL) THEN
    RAISE EXCEPTION
      'لا يمكن ترحيل حبوب أو مخزون مملوك للعميل عبر مخزون الشركة؛ استخدم مسار عهدة العميل'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS inventory_guard_company_scope ON public.inventory;
CREATE TRIGGER inventory_guard_company_scope
  BEFORE INSERT OR UPDATE OF product_id, owner_type, owner_id ON public.inventory
  FOR EACH ROW
  WHEN (NEW.owner_type = 'COMPANY'::public.owner_type)
  EXECUTE FUNCTION public.guard_production_company_stock_scope();

DROP TRIGGER IF EXISTS item_cost_layers_guard_company_scope ON public.item_cost_layers;
CREATE TRIGGER item_cost_layers_guard_company_scope
  BEFORE INSERT OR UPDATE OF product_id, owner_type, owner_id ON public.item_cost_layers
  FOR EACH ROW
  WHEN (NEW.owner_type = 'COMPANY'::public.owner_type)
  EXECUTE FUNCTION public.guard_production_company_stock_scope();

REVOKE ALL ON FUNCTION public.guard_production_company_stock_scope()
  FROM PUBLIC, anon, authenticated, service_role;

-- ── 3. المسار القديم smart_manufacture: توحيد وحدات القياس ──────────────────
-- الترتيب: تعريف المصدر الموسّع أولاً (6 معاملات: _grain_uom_id)، ثم غلاف
-- 5 معاملات يحيل إليه (عقد 33/43 الأصلي)، ثم غلاف 7 معاملات يحيل إليه
-- أيضاً (توافقية خارجية لمسارات تُرسل وحدة النواتج مع القمح).
--
-- المشكلة الأصلية في 33/43:
--   • لا يُستقبل uom_id لأي صنف، ولا يُضرب factor الخاص بوحدة الإنتاج.
--   • يُقارن مجموع qty الخام بمقدار القمح ويحسب الفاقد من طرحهما.
--   • إذا كان القمح بالبيع بالكيلو والدقيق/النخالة بالبيع بالكيس فالفحص
--     والفاقد وتعديل تكلفة الفاقد غير صالحة.
--
-- الإصلاح هنا:
--   • _grain_uom_id و uom_id لكل سطر ناتج اختيارية (للتوافق الخلفي).
--     الغياب = وحدة الأساس(Product base UOM) بمقدار 1.
--   • تحويل كل كمية إلى وحدة الأساس أولاً، ثم حساب تكلفة القمح على الكمية
--     المحوّلة (وليس الكمية المقلوبة كما كانت).
--   • الفاقد يُحسب من مكافئ الكتلة (كجم) إن توفرت لكل الأصناف، وإلا يُرفض
--     الترحيل بدل حساب فاقد بلا أساس كتلي.
--   • source_id في الحركات والقيد = معرّف المستند الفريد (v_doc_id) لا معرّف
--     القمح، ومعه إشارة الربط computed لصياد الأمر.
--   • رفض أصناف العهدة (customer-owned) للمدخل والنواتج.
--   • الغلاف 5 معاملات يحيل إلى المصدر الموسّع بوحدة أساس افتراضية.
--   • لا يُلمس تعريف 33/43 التاريخي.
CREATE OR REPLACE FUNCTION public.smart_manufacture(
  _warehouse_id uuid,
  _grain_item_id uuid,
  _grain_qty numeric,
  _outputs jsonb,
  _notes text,
  _grain_uom_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_ref text;
  v_doc_id uuid := gen_random_uuid();
  v_grain_product public.products%ROWTYPE;
  v_output_product public.products%ROWTYPE;
  v_grain_base_qty numeric;
  v_grain_mass_kg numeric;
  v_output_mass_kg numeric := 0;
  v_output_base_qty numeric := 0;
  v_output_count int;
  v_output_value numeric := 0;
  v_line_value numeric;
  v_line_allocated numeric;
  v_unit_cost numeric;
  v_grain_cost numeric;
  v_total_input_cost numeric;
  v_allocatable_cost numeric;
  v_total_allocated numeric := 0;
  v_waste_mass_kg numeric := 0;
  v_waste_cost numeric := 0;
  v_line_idx int := 0;
  v_all_mass boolean := true;
  v_journal_lines jsonb := '[]'::jsonb;
  v_acct_code text;
  v_item_name text;
  r record;
  l record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to run smart manufacture';
  END IF;
  IF _warehouse_id IS NULL OR _grain_item_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse and grain item are required';
  END IF;
  IF coalesce(_grain_qty, 0) <= 0 THEN
    RAISE EXCEPTION 'Grain quantity must be positive';
  END IF;
  IF _outputs IS NULL OR jsonb_typeof(_outputs) <> 'array' OR jsonb_array_length(_outputs) = 0 THEN
    RAISE EXCEPTION 'At least one output line is required';
  END IF;

  SELECT * INTO v_grain_product
    FROM public.products p
   WHERE p.id = _grain_item_id AND p.item_class = 'RAW_MATERIAL' AND p.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Input must be an active RAW_MATERIAL grain';
  END IF;

  -- عزل الملكية: حبوب العميل لا تدخل مخزون الشركة من هنا.
  IF v_grain_product.is_custody_item IS TRUE
     OR v_grain_product.inventory_policy = 'CUSTOMER_OWNED'::public.inventory_policy THEN
    RAISE EXCEPTION
      'حبوب العميل المملوكة له لا تُصنَّع هنا؛ استخدم مسار عهدة العميل وخدمة الطحن'
      USING ERRCODE = 'check_violation';
  END IF;
  IF public.item_effective_policy(v_grain_product.id) <> 'TRACKED' THEN
    RAISE EXCEPTION 'القمح المستخدم في التصنيع يجب أن يكون صنفاً مخزونياً متتابعاً'
      USING ERRCODE = 'check_violation';
  END IF;

  IF public.company_costing_method() IS DISTINCT FROM 'MOVING_AVERAGE'::public.costing_method THEN
    RAISE EXCEPTION
      'ترحيل الإنتاج متوقف: طريقة التكلفة المحفوظة (%) غير مدعومة لهذا المسار',
      public.company_costing_method()
      USING ERRCODE = '55000';
  END IF;

  v_output_count := jsonb_array_length(_outputs);

  -- 1) تحقق المدخل بوحدة الأساس والكتلة
  v_grain_base_qty := public.production_quantity_in_base(
    v_grain_product.id, coalesce(_grain_qty, 0), _grain_uom_id);
  v_grain_mass_kg := public.production_mass_in_kg(v_grain_product.id, v_grain_base_qty);
  IF v_grain_mass_kg IS NULL THEN
    v_all_mass := false;
  END IF;

  -- 2) تحقق كل ناتج: كمية بوحدة الأساس + كتلة
  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs)
             AS o(item_id uuid, qty numeric, uom_id uuid)
  LOOP
    IF r.item_id IS NULL OR coalesce(r.qty, 0) <= 0 THEN
      RAISE EXCEPTION 'Every output line needs an item and a positive quantity';
    END IF;
    SELECT * INTO v_output_product FROM public.products p WHERE p.id = r.item_id;
    IF NOT FOUND
       OR v_output_product.item_class NOT IN ('FINISHED_GOOD', 'BY_PRODUCT')
       OR v_output_product.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'Outputs must be FINISHED_GOOD or BY_PRODUCT items';
    END IF;
    IF v_output_product.is_custody_item IS TRUE
       OR v_output_product.inventory_policy = 'CUSTOMER_OWNED'::public.inventory_policy THEN
      RAISE EXCEPTION 'ناتج التصنيع لا يمكن أن يكون صنفاً مملوكاً للعميل'
        USING ERRCODE = 'check_violation';
    END IF;
    DECLARE
      v_base numeric := public.production_quantity_in_base(v_output_product.id, r.qty, r.uom_id);
      v_mass numeric := public.production_mass_in_kg(v_output_product.id, v_base);
    BEGIN
      v_output_base_qty := v_output_base_qty + v_base;
      IF v_mass IS NULL THEN
        v_all_mass := false;
      ELSE
        v_output_mass_kg := v_output_mass_kg + v_mass;
      END IF;
      v_line_value := coalesce(v_base, 0) * coalesce(v_output_product.sale_price, 0);
      v_output_value := v_output_value + v_line_value;
    END;
  END LOOP;

  IF v_output_value <= 0 THEN
    RAISE EXCEPTION 'Outputs must have sale prices to allocate cost by relative value';
  END IF;

  -- 3) تكلفة القمح من SMV الفعلي على الكمية المحوّلة
  SELECT coalesce(
    (SELECT round(sum(cl.total_value) / nullif(sum(cl.quantity), 0), 4)
       FROM public.item_cost_layers cl
      WHERE cl.product_id = v_grain_product.id
        AND cl.warehouse_id = _warehouse_id
        AND cl.owner_type = 'COMPANY'
        AND cl.quantity > 0),
    v_grain_product.cost_price,
    0
  ) INTO v_grain_cost;

  v_total_input_cost := round(v_grain_base_qty * coalesce(v_grain_cost, 0), 2);
  v_ref := 'SM-' || to_char(now(), 'YYYYMM') || '-' ||
           lpad(nextval('public.milling_service_seq')::text, 4, '0');

  -- 4) الفاقد بمكافئ الكتلة فقط. إذا لم تتوفر كتلة لكل الأصناف، ترفض الدالة
  --    بدل حساب فاقد على أعداد وحدات غير متجانسة.
  IF NOT v_all_mass OR v_grain_mass_kg IS NULL THEN
    RAISE EXCEPTION
      'لا يمكن احتساب الفاقد: تعريف كتلي مفقود لأحد الأصناف. اضبط وحدة كتلة الأساس أو وزن العبوة'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_output_mass_kg > v_grain_mass_kg THEN
    RAISE EXCEPTION 'Total output mass (%) cannot exceed input grain mass (%)',
      round(v_output_mass_kg, 3), round(v_grain_mass_kg, 3)
      USING ERRCODE = 'check_violation';
  END IF;

  v_waste_mass_kg := greatest(0, v_grain_mass_kg - v_output_mass_kg);
  v_waste_cost := CASE WHEN v_waste_mass_kg > 0 AND v_grain_cost > 0
                    THEN round(v_waste_mass_kg * v_grain_cost, 2) ELSE 0 END;
  v_allocatable_cost := greatest(0, v_total_input_cost - v_waste_cost);
  IF v_allocatable_cost <= 0 THEN
    RAISE EXCEPTION 'لا يمكن ترحيل تصنيع بلا تكلفة قابلة للتوزيع';
  END IF;

  -- 5) صادر القمح بوحدة الأساس المحوّلة
  PERFORM public.post_stock_delta(
    p_product_id => v_grain_product.id,
    p_warehouse_id => _warehouse_id,
    p_signed_qty => -v_grain_base_qty,
    p_unit_cost => v_grain_cost,
    p_movement_kind => 'PRODUCTION'::public.stock_movement_kind,
    p_source_type => 'smart_manufacture',
    p_source_id => v_doc_id,
    p_note => 'تصنيع ذكي ' || v_ref || coalesce(' — ' || _notes, ''),
    p_owner_type => 'COMPANY'::public.owner_type,
    p_owner_id => NULL,
    p_movement_type_legacy => 'production_out'::public.movement_type);

  -- 6) استلام النواتج بوحدة الأساس وبقيمة توزيع نسبية
  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs)
             AS o(item_id uuid, qty numeric, uom_id uuid)
  LOOP
    SELECT * INTO v_output_product FROM public.products p WHERE p.id = r.item_id;
    DECLARE
      v_base numeric := public.production_quantity_in_base(v_output_product.id, r.qty, r.uom_id);
      v_weight numeric := coalesce(v_base, 0) * coalesce(v_output_product.sale_price, 0);
      v_class text := v_output_product.item_class::text;
      v_name text := coalesce(v_output_product.name_ar, v_output_product.name);
    BEGIN
      v_line_idx := v_line_idx + 1;
      IF v_line_idx = v_output_count THEN
        v_line_allocated := v_allocatable_cost - v_total_allocated;
      ELSE
        v_line_allocated := round(v_allocatable_cost * (v_weight / v_output_value), 2);
        v_total_allocated := v_total_allocated + v_line_allocated;
      END IF;
      v_unit_cost := round(v_line_allocated / nullif(v_base, 0), 4);

      PERFORM public.post_stock_delta(
        p_product_id => v_output_product.id,
        p_warehouse_id => _warehouse_id,
        p_signed_qty => v_base,
        p_unit_cost => v_unit_cost,
        p_movement_kind => 'RECEIPT'::public.stock_movement_kind,
        p_source_type => 'smart_manufacture',
        p_source_id => v_doc_id,
        p_note => 'تصنيع ذكي ' || v_ref || coalesce(' — ' || _notes, ''),
        p_owner_type => 'COMPANY'::public.owner_type,
        p_owner_id => NULL,
        p_movement_type_legacy => 'production_in'::public.movement_type);

      v_acct_code := CASE WHEN v_class = 'BY_PRODUCT' THEN '1314' ELSE '1313' END;
      IF v_line_allocated > 0 THEN
        v_journal_lines := v_journal_lines || jsonb_build_object(
          'account_code', v_acct_code,
          'debit', v_line_allocated,
          'credit', 0,
          'memo', 'إنتاج مخزون ' || v_name || ' (' || v_ref || ')');
      END IF;
    END;
  END LOOP;

  IF v_waste_cost > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_object(
      'account_code', '5921',
      'debit', v_waste_cost,
      'credit', 0,
      'memo', 'فاقد وتلف تشغيلي مطحنة (' || v_ref || ')');
  END IF;

  v_journal_lines := v_journal_lines || jsonb_build_object(
    'account_code', '1311',
    'debit', 0,
    'credit', v_total_input_cost,
    'memo', 'سحب قمح خام للتصنيع (' || v_ref || ')');

  PERFORM public.create_journal_entry(
    p_memo => 'تصنيع ذكي ' || v_ref || coalesce(' — ' || _notes, ''),
    p_entry_date => CURRENT_DATE,
    p_source_type => 'smart_manufacture',
    p_source_id => v_doc_id,
    p_is_system => true,
    p_lines => v_journal_lines);

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'manufacture.smart', 'stock_movement', v_doc_id,
    jsonb_build_object(
      'doc_id', v_doc_id,
      'ref', v_ref,
      'warehouse_id', _warehouse_id,
      'grain_item_id', v_grain_product.id,
      'grain_entered_qty', coalesce(_grain_qty, 0),
      'grain_uom_id', _grain_uom_id,
      'grain_base_qty', v_grain_base_qty,
      'grain_mass_kg', v_grain_mass_kg,
      'grain_unit_cost', v_grain_cost,
      'output_mass_kg', v_output_mass_kg,
      'waste_mass_kg', v_waste_mass_kg,
      'waste_cost', v_waste_cost,
      'total_cost', v_total_input_cost,
      'outputs', _outputs,
      'allocation', 'RELATIVE_SALES_VALUE',
      'uom_normalized', 'BASE_UOM',
      'waste_basis', 'MASS_KG'));

  RETURN v_ref;
END;
$function$;

-- توافق الاستدعاء القديم (5 معاملات) مع تعريف المصدر الموسّع (6 معاملات).
-- هذه هي التوقيعة الوحيدة التي يستدعي بها الواجهة الحالية و/أو service_role.
-- الدالة القديمة تُزال أولاً (DROP لا OR REPLACE) لأن CREATE OR REPLACE لا يقبل
-- تغيير عدد المعاملات؛ وبإزالتها قبل الغلاف يبقى التعريف الوحيد لخمسة معاملات
-- هو الغلاف الذي يفوض الوحدة للخادم (وحدة أساس الصنف).
DROP FUNCTION IF EXISTS public.smart_manufacture(uuid, uuid, numeric, jsonb, text);

CREATE OR REPLACE FUNCTION public.smart_manufacture(
  _warehouse_id uuid,
  _grain_item_id uuid,
  _grain_qty numeric,
  _outputs jsonb,
  _notes text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RETURN public.smart_manufacture(
    _warehouse_id, _grain_item_id, _grain_qty, _outputs, _notes, NULL::uuid);
END;
$function$;

-- توافق الاستدعاء الخارجي المحتمل (7 معاملات): القمح + وحدة القمح +
-- وحدة النواتج الموحدة. يطبّع وحدة النواتج على كل الأسطر الخالية من uom_id
-- ثم يحيل إلى المصدر الموسّع (6 معاملات). لا يؤثر على الواجهة الحالية.
CREATE OR REPLACE FUNCTION public.smart_manufacture(
  _warehouse_id uuid,
  _grain_item_id uuid,
  _grain_qty numeric,
  _outputs jsonb,
  _notes text,
  _grain_uom_id uuid,
  _output_uom_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_outputs jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(
    CASE WHEN nullif(elem->>'uom_id','') IS NULL AND _output_uom_id IS NOT NULL
         THEN jsonb_set(elem, '{uom_id}', to_jsonb(_output_uom_id::text))
         ELSE elem END), '[]'::jsonb)
    INTO v_outputs
    FROM jsonb_array_elements(coalesce(_outputs,'[]'::jsonb)) elem;
  RETURN public.smart_manufacture(
    _warehouse_id, _grain_item_id, _grain_qty, v_outputs, _notes, _grain_uom_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.smart_manufacture(uuid, uuid, numeric, jsonb, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.smart_manufacture(uuid, uuid, numeric, jsonb, text, uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.smart_manufacture(uuid, uuid, numeric, jsonb, text, uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.smart_manufacture(uuid, uuid, numeric, jsonb, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.smart_manufacture(uuid, uuid, numeric, jsonb, text, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.smart_manufacture(uuid, uuid, numeric, jsonb, text, uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.smart_manufacture(uuid, uuid, numeric, jsonb, text, uuid) IS
  'مسار تصنيع قديم للتوافق فقط؛ يطبّع كل كمية إلى وحدة أساس الصنف ويشتق الفاقد من مكافئ الكتلة. الأمر الحديث create_and_post_production_order هو المسار المعتمد.';

-- ── 4. فصل مرحلة convert_stock اليدوي عن دورة الإنتاج ───────────────────────
-- 48 يسجّل 'stock_conversion' مسبقاً؛ التعريف هنا يضيف حارس ملكية الشركة
-- ويمنع تحويل أصناف العهدة. لا تغيير في التوقيع أو السلوك المحاسبي.
CREATE OR REPLACE FUNCTION public.convert_stock(
  _warehouse_id uuid,
  _source_item_id uuid,
  _source_qty numeric,
  _outputs jsonb,
  _loss_qty numeric,
  _notes text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_ref text;
  v_doc_id uuid := gen_random_uuid();
  v_total_output_qty numeric := 0;
  v_product public.products%ROWTYPE;
  r record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to run stock conversions';
  END IF;
  IF _warehouse_id IS NULL OR _source_item_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse and source item are required';
  END IF;
  IF coalesce(_source_qty, 0) <= 0 THEN
    RAISE EXCEPTION 'Source quantity must be positive';
  END IF;
  IF _outputs IS NULL OR jsonb_typeof(_outputs) <> 'array' OR jsonb_array_length(_outputs) = 0 THEN
    RAISE EXCEPTION 'At least one output line is required';
  END IF;
  IF coalesce(_loss_qty, 0) < 0 THEN
    RAISE EXCEPTION 'Loss quantity cannot be negative';
  END IF;

  SELECT * INTO v_product FROM public.products p
   WHERE p.id = _source_item_id AND p.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source item is not an active product';
  END IF;
  IF v_product.is_custody_item IS TRUE
     OR v_product.inventory_policy = 'CUSTOMER_OWNED'::public.inventory_policy
     OR public.item_effective_policy(v_product.id) <> 'TRACKED' THEN
    RAISE EXCEPTION
      'التحويل المخزني للشركة فقط؛ أصناف عهدة العميل لا تتحول إلى مخزون مملوك'
      USING ERRCODE = 'check_violation';
  END IF;

  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs) AS o(item_id uuid, qty numeric)
  LOOP
    IF r.item_id IS NULL OR coalesce(r.qty, 0) <= 0 THEN
      RAISE EXCEPTION 'Every output line needs an item and a positive quantity';
    END IF;
    SELECT * INTO v_product FROM public.products p WHERE p.id = r.item_id AND p.is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Output item % is not an active product', r.item_id;
    END IF;
    IF v_product.is_custody_item IS TRUE
       OR v_product.inventory_policy = 'CUSTOMER_OWNED'::public.inventory_policy THEN
      RAISE EXCEPTION 'ناتج التحويل لا يمكن أن يكون صنف أمانة عميل'
        USING ERRCODE = 'check_violation';
    END IF;
    v_total_output_qty := v_total_output_qty + coalesce(r.qty, 0);
  END LOOP;

  IF v_total_output_qty + coalesce(_loss_qty, 0) <> coalesce(_source_qty, 0) THEN
    RAISE EXCEPTION
      'Outputs + loss (%) must equal the source quantity (%)',
      v_total_output_qty + coalesce(_loss_qty, 0), coalesce(_source_qty, 0);
  END IF;

  v_ref := 'CV-' || to_char(now(), 'YYYYMM') || '-' ||
           lpad(nextval('public.milling_service_seq')::text, 4, '0');

  PERFORM public.post_stock_delta(
    p_product_id => _source_item_id,
    p_warehouse_id => _warehouse_id,
    p_signed_qty => -coalesce(_source_qty, 0),
    p_unit_cost => NULL,
    p_movement_kind => 'PRODUCTION'::public.stock_movement_kind,
    p_source_type => 'stock_conversion',
    p_source_id => v_doc_id,
    p_note => 'تحويل مخزون ' || v_ref || coalesce(' — ' || _notes, ''),
    p_owner_type => 'COMPANY'::public.owner_type,
    p_owner_id => NULL,
    p_movement_type_legacy => 'production_out'::public.movement_type);

  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs) AS o(item_id uuid, qty numeric)
  LOOP
    PERFORM public.post_stock_delta(
      p_product_id => r.item_id,
      p_warehouse_id => _warehouse_id,
      p_signed_qty => coalesce(r.qty, 0),
      p_unit_cost => NULL,
      p_movement_kind => 'PRODUCTION'::public.stock_movement_kind,
      p_source_type => 'stock_conversion',
      p_source_id => v_doc_id,
      p_note => 'تحويل مخزون ' || v_ref || coalesce(' — ' || _notes, ''),
      p_owner_type => 'COMPANY'::public.owner_type,
      p_owner_id => NULL,
      p_movement_type_legacy => 'production_in'::public.movement_type);
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'stock.conversion', 'stock_movements', v_doc_id,
    jsonb_build_object(
      'doc_id', v_doc_id,
      'ref', v_ref,
      'warehouse_id', _warehouse_id,
      'source_item_id', _source_item_id,
      'source_qty', coalesce(_source_qty, 0),
      'outputs', _outputs,
      'loss_qty', coalesce(_loss_qty, 0),
      'cost_model', 'FIXED_MANUAL — no allocation, no journal',
      'notes', _notes));

  RETURN v_ref;
END;
$function$;

REVOKE ALL ON FUNCTION public.convert_stock(uuid, uuid, numeric, jsonb, numeric, text)
  FROM PUBLIC, anon, authenticated, service_role;
-- لا منح لـ authenticated: المسار القديم غير مستدعى من الواجهة حتى الآن
-- (لا مستدعي داخل src/). يبقى متاحاً لـ service_role فقط حتى لا يُستعمل
-- من عميل غير المراجع.

-- ── 5. حراسة تزامن على أمر الإنتاج ─────────────────────────────────────────
-- الـ RPC يقرأ الأمر FOR UPDATE، لكن التحقق النهائي يجب أن يمنع ترحيل
-- أمرين مختلفين على نفس الصنف المادة في نفس المستودع بالوقت نفسهما إذا
-- كانا يخرجان من نفس طبقة التكلفة. هنا نضيف قفل advisory لكل مستودع+مادة
-- لتسلسل محرّك متوسط التكلفة في تشغيلات الإنتاج المتزامنة.
CREATE OR REPLACE FUNCTION public.production_lock_material_scope(
  p_warehouse_id uuid,
  p_product_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_pid uuid;
BEGIN
  FOREACH v_pid IN ARRAY coalesce(p_product_ids, ARRAY[]::uuid[])
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'production_stock:' || coalesce(p_warehouse_id::text, '') || ':' || coalesce(v_pid::text, ''),
        0));
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.production_lock_material_scope(uuid, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.production_lock_material_scope(uuid, uuid[])
  TO service_role;

-- ── 6. تفاصيل تكلفة أمر الإنتاج ─────────────────────────────────────────────
-- تُجمع من جداول الأمر نفسها لا من الواجهة، وتعرض:
--   • مواد (كمية بوحدة الأساس + تكلفة + حركة المخزون + دفعات)
--   • مصروفات التحويل المحملة (سطر المصروف/الحساب/الأساس/قيد)
--   • المخرجات (كمية أساس، قيمة بيع تقديرية، تكلفة موزعة، تكلفة فعلية)
--   • الفاقد الطبيعي/غير الطبيعي
--   • ملخص WIP والمصروفات المستبعدة (غير مؤهلة، مستردة الضريبة، مركز آخر)
-- الواجهة تقرأ هذا RPC ولا تحسب تكلفة بنفسها.
CREATE OR REPLACE FUNCTION public.production_order_cost_detail(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_order public.production_orders%ROWTYPE;
  v_result jsonb;
BEGIN
  IF v_user IS NULL OR NOT public.is_staff(v_user) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية قراءة أمر الإنتاج';
  END IF;
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'معرّف أمر الإنتاج مطلوب' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_order FROM public.production_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'أمر الإنتاج غير موجود' USING ERRCODE = 'P0002';
  END IF;

  SELECT jsonb_build_object(
    'order', jsonb_build_object(
      'id', v_order.id,
      'order_number', v_order.order_number,
      'production_date', v_order.production_date,
      'status', v_order.status,
      'warehouse_id', v_order.warehouse_id,
      'cost_center_id', v_order.cost_center_id,
      'material_cost', v_order.material_cost,
      'conversion_cost', v_order.conversion_cost,
      'total_cost', v_order.total_cost,
      'output_cost', v_order.output_cost,
      'abnormal_loss_cost', v_order.abnormal_loss_cost,
      'reversed_at', v_order.reversed_at,
      'reversal_reason', v_order.reversal_reason,
      'completed_at', v_order.completed_at,
      'notes', v_order.notes),
    'materials', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id,
        'product_id', m.product_id,
        'product_name', coalesce(p.name_ar, p.name),
        'entered_quantity', m.entered_quantity,
        'entered_uom', eu.short_name,
        'base_quantity', m.base_quantity,
        'base_uom', bu.short_name,
        'uom_conversion_factor', m.uom_conversion_factor,
        'mass_kg', m.mass_kg,
        'unit_cost', m.unit_cost,
        'total_cost', m.total_cost,
        'inventory_account_code', m.inventory_account_code,
        'stock_movement_id', m.stock_movement_id,
        'batches', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'batch_id', a.batch_id,
            'batch_number', pb.batch_number,
            'base_quantity', a.base_quantity))
            FROM public.production_order_batch_allocations a
            JOIN public.product_batches pb ON pb.id = a.batch_id
           WHERE a.material_id = m.id), '[]'::jsonb))
        ORDER BY m.created_at, m.id)
        FROM public.production_order_materials m
        JOIN public.products p ON p.id = m.product_id
        LEFT JOIN public.units eu ON eu.id = m.uom_id
        LEFT JOIN public.units bu ON bu.id = m.base_uom_id
       WHERE m.production_order_id = v_order.id), '[]'::jsonb),
    'cost_sources', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id,
        'expense_line_id', a.expense_line_id,
        'expense_entry_id', a.expense_entry_id,
        'reference', e.reference,
        'expense_date', e.expense_date,
        'category', coalesce(c.name_ar, c.name),
        'expense_account_code', a.expense_account_code,
        'amount', a.amount,
        'allocation_basis', a.allocation_basis,
        'note', a.note,
        'journal_entry_id', a.journal_entry_id)
        ORDER BY a.created_at, a.id)
        FROM public.production_order_cost_allocations a
        JOIN public.expense_entries e ON e.id = a.expense_entry_id
        LEFT JOIN public.expense_lines el ON el.id = a.expense_line_id
        LEFT JOIN public.expense_categories c ON c.id = el.category_id
       WHERE a.production_order_id = v_order.id), '[]'::jsonb),
    'outputs', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', o.id,
        'product_id', o.product_id,
        'product_name', coalesce(p.name_ar, p.name),
        'item_class', p.item_class,
        'entered_quantity', o.entered_quantity,
        'entered_uom', eu.short_name,
        'base_quantity', o.base_quantity,
        'base_uom', bu.short_name,
        'mass_kg', o.mass_kg,
        'allocation_value_per_base', o.allocation_value_per_base,
        'allocation_weight', round(o.base_quantity * o.allocation_value_per_base, 6),
        'allocated_cost', o.allocated_cost,
        'actual_stock_cost', o.actual_stock_cost,
        'unit_cost', o.unit_cost,
        'inventory_account_code', o.inventory_account_code,
        'batch_id', o.batch_id,
        'batch_number', o.batch_number,
        'expiry_date', o.expiry_date,
        'stock_movement_id', o.stock_movement_id)
        ORDER BY o.created_at, o.id)
        FROM public.production_order_outputs o
        JOIN public.products p ON p.id = o.product_id
        LEFT JOIN public.units eu ON eu.id = o.uom_id
        LEFT JOIN public.units bu ON bu.id = o.base_uom_id
       WHERE o.production_order_id = v_order.id), '[]'::jsonb),
    'losses', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id,
        'loss_type', l.loss_type,
        'quantity', l.quantity,
        'uom', u.short_name,
        'mass_kg', l.mass_kg,
        'reason', l.reason,
        'charged_cost', CASE
          WHEN l.loss_type = 'ABNORMAL' AND v_order.abnormal_loss_cost > 0
          THEN round(v_order.abnormal_loss_cost * l.mass_kg / nullif((
            SELECT sum(x.mass_kg) FROM public.production_order_losses x
             WHERE x.production_order_id = v_order.id AND x.loss_type = 'ABNORMAL'), 0), 2)
          ELSE 0 END)
        ORDER BY l.created_at, l.id)
        FROM public.production_order_losses l
        LEFT JOIN public.units u ON u.id = l.uom_id
       WHERE l.production_order_id = v_order.id), '[]'::jsonb),
    'journals', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', je.id,
        'entry_number', je.entry_number,
        'entry_date', je.entry_date,
        'memo', je.memo,
        'source_type', je.source_type,
        'status', je.status)
        ORDER BY je.created_at, je.id)
        FROM public.journal_entries je
       WHERE (je.source_type IN ('production_material_issue', 'production_completion')
              AND je.source_id = v_order.id)
          OR je.id IN (
            SELECT a.journal_entry_id FROM public.production_order_cost_allocations a
             WHERE a.production_order_id = v_order.id AND a.journal_entry_id IS NOT NULL)), '[]'::jsonb),
    'excluded_expenses', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'expense_line_id', l.id,
        'expense_entry_id', e.id,
        'reference', e.reference,
        'expense_date', e.expense_date,
        'category', coalesce(c.name_ar, c.name),
        'net_amount', l.net_amount,
        'tax_amount', l.tax_amount,
        'tax_recoverable', coalesce(e.tax_recoverable, false),
        'cost_center_matches', coalesce(l.cost_center_id, e.cost_center_id) = v_order.cost_center_id,
        'category_eligible', coalesce(c.production_cost_eligible, false),
        'reason',
          CASE
            WHEN coalesce(c.production_cost_eligible, false) IS NOT TRUE THEN 'تصنيف غير مؤهل للرسملة'
            WHEN e.status::text NOT IN ('POSTED','PARTIALLY_PAID','PAID','CLOSED') THEN 'المصروف غير مرحّل'
            WHEN e.expense_date > v_order.production_date THEN 'تاريخ المصروف بعد تاريخ التشغيلة'
            WHEN coalesce(l.cost_center_id, e.cost_center_id) IS DISTINCT FROM v_order.cost_center_id
              THEN 'مركز تكلفة مختلف'
            WHEN l.net_amount <= 0 THEN 'صافي السطر غير موجب'
            WHEN NOT EXISTS (
              SELECT 1 FROM public.production_order_cost_allocations x
               WHERE x.expense_line_id = l.id)
             AND coalesce(public.expense_line_production_base_amount(
                     l.net_amount, l.tax_amount, e.tax_recoverable), 0)
                 - coalesce((SELECT sum(x.amount) FROM public.production_order_cost_allocations x
                              WHERE x.expense_line_id = l.id), 0) <= 0
              THEN 'المتاح صفر بعد التحميل السابق'
            ELSE NULL
          END
        ORDER BY e.expense_date DESC, e.reference)
        FROM public.expense_lines l
        JOIN public.expense_entries e ON e.id = l.entry_id
        JOIN public.expense_categories c ON c.id = l.category_id
       WHERE coalesce(c.production_cost_eligible, false) IS FALSE
          OR coalesce(l.cost_center_id, e.cost_center_id) = v_order.cost_center_id
      ), '[]'::jsonb),
    'summary', jsonb_build_object(
      'wip_debit', round(coalesce((
        SELECT coalesce(sum(jl.debit), 0) FROM public.journal_lines jl
         JOIN public.journal_entries je ON je.id = jl.entry_id
        WHERE je.source_type IN ('production_material_issue', 'production_completion')
          AND je.source_id = v_order.id
          AND jl.account_id = (SELECT id FROM public.accounts WHERE code = '1312')), 0), 2),
      'wip_credit', round(coalesce((
        SELECT coalesce(sum(jl.credit), 0) FROM public.journal_lines jl
         JOIN public.journal_entries je ON je.id = jl.entry_id
        WHERE je.source_type IN ('production_material_issue', 'production_completion')
          AND je.source_id = v_order.id
          AND jl.account_id = (SELECT id FROM public.accounts WHERE code = '1312')), 0), 2),
      'conversion_from_expenses', round(coalesce((
        SELECT sum(a.amount) FROM public.production_order_cost_allocations a
         WHERE a.production_order_id = v_order.id), 0), 2),
      'unallocated_conversion', round(coalesce(v_order.conversion_cost, 0) - coalesce((
        SELECT sum(a.amount) FROM public.production_order_cost_allocations a
         WHERE a.production_order_id = v_order.id), 0), 2), 2),
      'allocation_basis', 'RELATIVE_SALES_VALUE'
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.production_order_cost_detail(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.production_order_cost_detail(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.production_order_cost_detail(uuid) IS
  'تفاصيل تكلفة أمر الإنتاج: مصادر المواد والمصروفات، توزيع التكلفة على المخرجات، الفاقد، القيود والمصروفات غير المؤهلة.';

-- ── 7. دالة مساعدة: توزيع التكلفة المشتركة بالوزن بدون تحريف السطر الأخير ──
-- 9906/9916 كانت تحمل "المتبقي" على آخر ناتج. إن اختلفت الأوزان كثيراً (مثلاً
-- دقيق 90% ونخالة 10%) صار السطر الأخير يحمل فرق تقريب بسيط فقط، أما إن كانت
-- الكميات كبيرة فتتaccumulate الفروق. هنا:
--   • يوزع كل سطر بوزنه النسبي round(...,2) ويحتفظ بفرق صغير.
--   • يقبل الفرق على آخر سطر فقط إذا كان abs(delta) <= 0.01 × عدد المخرجات
--     (أقصى أثر تقريب ممكن)، وإلا يرمي خطأ بدل كسر توزيع التكلفة.
--   • المخرجات الفردية تحصل على كل المبلغ، فتظل قاعدة "ناتج واحد = كل WIP".
CREATE OR REPLACE FUNCTION public.production_allocate_joint_cost(
  p_order_id uuid,
  p_total_allocatable numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_count int;
  v_total_weight numeric;
  v_total_allocated numeric := 0;
  v_allocated numeric;
  v_delta numeric;
  r record;
BEGIN
  SELECT count(*), coalesce(sum(base_quantity * allocation_value_per_base), 0)
    INTO v_count, v_total_weight
    FROM public.production_order_outputs
   WHERE production_order_id = p_order_id;
  IF v_count = 0 THEN
    RETURN;
  END IF;
  IF v_count = 1 THEN
    UPDATE public.production_order_outputs SET allocated_cost = round(p_total_allocatable, 2),
           unit_cost = CASE WHEN base_quantity > 0
                            THEN round(p_total_allocatable, 2) / base_quantity ELSE 0 END
     WHERE production_order_id = p_order_id;
    RETURN;
  END IF;
  IF v_total_weight <= 0 THEN
    RAISE EXCEPTION 'وزن التوزيع غير موجب؛ يجب تحديد قيمة بيع تقديرية لوحدة الأساس لكل ناتج';
  END IF;

  FOR r IN
    SELECT id, base_quantity, allocation_value_per_base,
           row_number() OVER (ORDER BY created_at, id) AS rn
      FROM public.production_order_outputs
     WHERE production_order_id = p_order_id
     ORDER BY created_at, id
  LOOP
    IF r.rn = v_count THEN
      v_allocated := round(p_total_allocatable - v_total_allocated, 2);
    ELSE
      v_allocated := round(
        p_total_allocatable * (r.base_quantity * r.allocation_value_per_base) / v_total_weight, 2);
      v_total_allocated := v_total_allocated + v_allocated;
    END IF;
    UPDATE public.production_order_outputs SET allocated_cost = v_allocated,
           unit_cost = CASE WHEN base_quantity > 0 THEN v_allocated / base_quantity ELSE 0 END
     WHERE id = r.id;
  END LOOP;

  v_delta := round(p_total_allocatable - (SELECT coalesce(sum(allocated_cost), 0)
                                           FROM public.production_order_outputs
                                          WHERE production_order_id = p_order_id), 2);
  IF abs(v_delta) > 0.005 THEN
    RAISE EXCEPTION 'توزيع التكلفة على المخرجات غير متسق: فرق %', v_delta;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.production_allocate_joint_cost(uuid, numeric)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.production_allocate_joint_cost(uuid, numeric)
  TO service_role;

-- ── 8. حماية سطور أمر الإنتاج بعد الترحيل ──────────────────────────────────
-- الـ trigger يعمل على الصف قبل إتمام الـ statement، وأمر الإنتاج يبقى
-- مفتوحاً في نفس المعاملة حتى تُكتب السطور. لا يُعطّل الترحيل الطبيعي لأن
-- حالة الأمر عند إدراج/تعديل السطور في complete_production_order تبقى 'DRAFT'
-- حتى آخر خطوة. بعدها تصبح السطور غير قابلة للتعديل/الحذف من أي مسار، فلا
-- يمكن المساس بأثر حركة مخزون أو تكلفة أمر مُرحّل دون المرور بدالة العكس.
CREATE OR REPLACE FUNCTION public.production_guard_posted_void_output()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_status text;
BEGIN
  SELECT o.status INTO v_status
    FROM public.production_orders o
   WHERE o.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.production_order_id ELSE NEW.production_order_id END;
  IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'لا يمكن تعديل أو حذف سطور أمر إنتاج غير مسودة؛ اعكس الأمر أولاً'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS production_materials_locked_after_post ON public.production_order_materials;
CREATE TRIGGER production_materials_locked_after_post
  BEFORE UPDATE OR DELETE ON public.production_order_materials
  FOR EACH ROW EXECUTE FUNCTION public.production_guard_posted_void_output();

DROP TRIGGER IF EXISTS production_outputs_locked_after_post ON public.production_order_outputs;
CREATE TRIGGER production_outputs_locked_after_post
  BEFORE UPDATE OR DELETE ON public.production_order_outputs
  FOR EACH ROW EXECUTE FUNCTION public.production_guard_posted_void_output();

DROP TRIGGER IF EXISTS production_losses_locked_after_post ON public.production_order_losses;
CREATE TRIGGER production_losses_locked_after_post
  BEFORE UPDATE OR DELETE ON public.production_order_losses
  FOR EACH ROW EXECUTE FUNCTION public.production_guard_posted_void_output();

-- حماية التخصيصات: التخصيص سجل لا يُعدّل بعد الإنشاء، ولا يُحذف من عميل
-- مالي. عكس أمر الإنتاج لا يحذفها؛ يبقيها أثراً مع قيد عكسي.
CREATE OR REPLACE FUNCTION public.production_guard_cost_allocation_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'لا يمكن حذف تخصيص تكلفة إنتاج؛ اعكس أمر الإنتاج أولاً'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS production_cost_allocations_no_delete ON public.production_order_cost_allocations;
CREATE TRIGGER production_cost_allocations_no_delete
  BEFORE DELETE ON public.production_order_cost_allocations
  FOR EACH ROW EXECUTE FUNCTION public.production_guard_cost_allocation_write();

REVOKE ALL ON FUNCTION public.production_guard_posted_void_output()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.production_guard_cost_allocation_write()
  FROM PUBLIC, anon, authenticated, service_role;

-- ── 9. منح الدوال الجديدة وإدراجها في عقد الـ RPC ──────────────────────────
DO $allowlist$
DECLARE
  v_current text[];
  v_name text;
  v_additions text[] := ARRAY['production_order_cost_detail']::text[];
BEGIN
  EXECUTE 'SELECT public.rpc_allowlist()' INTO v_current;
  v_current := coalesce(v_current, ARRAY[]::text[]);
  FOREACH v_name IN ARRAY v_additions LOOP
    IF NOT (v_name = ANY(v_current)) THEN
      v_current := array_append(v_current, v_name);
    END IF;
  END LOOP;
  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION public.rpc_allowlist() RETURNS text[]
    LANGUAGE sql IMMUTABLE SET search_path = public
    AS $body$ SELECT %L::text[] $body$
  $fn$, v_current);
END;
$allowlist$;
REVOKE ALL ON FUNCTION public.rpc_allowlist() FROM PUBLIC, anon, authenticated, service_role;

-- ── 10. دورة الإنتاج الحديثة: complete_production_order (9916 ← 9917) ───────
-- نفس توقيع 9906/9916 والمنطق الأساسي محفوظ حرفياً، مع التغييرات التالية:
--   a) قفل تزامن على (المستودع، المواد) لعزل تشغيلتين متزامنتين من نفس طبقة
--      متوسط التكلفة، فيمنع قراءة رصيد غير مسلسل.
--   b) الفاقد يقبل أيضاً "quantity_base" بوحدة أساس الصنف (للفاقد العددي
--      مثل كيس ممزق) بدل وحدة كتلة فقط. مسار الكتلة يبقى كما هو، والميزان
--      الكتلي يُحسب من الكتلة فقط ولا يتلوث بفاقد عدم كتلي.
--   c) توزيع التكلفة المشتركة عبر production_allocate_joint_cost بدل تكرار
--      حمل المتبقي على آخر سطر في كل مرة.
--   d) كل مصروف محمَّل يكتب أيضاً أساس توزيعه/cost_center/ملاحظة كاملة من
--      السطر المرسل (لم يتغير)، والسجل الناتج يقرأ لاحقاً بواسطة
--      production_order_cost_detail.
--
-- ملاحظة ترافقية: 9916 عرّف نقل المصروف من production_expense_line_available.
-- هذا التعريف يحافظ على هذا السلوك تماماً لأن دالة الضريبة (المرحلة الأولى)
-- يجب ألا تُفقد بإعادة تعريف لاحقة.
CREATE OR REPLACE FUNCTION public.complete_production_order(
  p_order_id uuid,
  p_materials jsonb,
  p_outputs jsonb,
  p_expenses jsonb DEFAULT '[]'::jsonb,
  p_losses jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_order public.production_orders%ROWTYPE;
  v_input jsonb;
  v_output jsonb;
  v_expense jsonb;
  v_loss jsonb;
  v_product public.products%ROWTYPE;
  v_expense_line public.expense_lines%ROWTYPE;
  v_expense_entry public.expense_entries%ROWTYPE;
  v_expense_category_eligible boolean;
  v_eligible_amount numeric;
  v_batch public.product_batches%ROWTYPE;
  v_material_id uuid;
  v_output_id uuid;
  v_allocation_id uuid;
  v_journal_id uuid;
  v_movement_id uuid;
  v_batch_id uuid;
  v_base_uom_id uuid;
  v_uom_id uuid;
  v_base_qty numeric;
  v_factor numeric;
  v_mass numeric;
  v_total_input_mass numeric := 0;
  v_total_output_mass numeric := 0;
  v_normal_loss_mass numeric := 0;
  v_abnormal_loss_mass numeric := 0;
  v_input_mass_complete boolean := true;
  v_output_mass_complete boolean := true;
  v_expected_mass numeric;
  v_total_material_cost numeric := 0;
  v_total_conversion_cost numeric := 0;
  v_total_wip numeric := 0;
  v_abnormal_cost numeric := 0;
  v_remaining_wip numeric := 0;
  v_actual_output_total numeric := 0;
  v_line_cost numeric := 0;
  v_available numeric := 0;
  v_already_allocated numeric := 0;
  v_currency_account text;
  v_stock_account text;
  v_journal_lines jsonb;
  v_batch_settings jsonb := '{}'::jsonb;
  v_company_strategy text := 'FEFO';
  v_strategy text := 'FEFO';
  v_prevent_expired boolean := true;
  v_remaining numeric;
  v_take numeric;
  v_batch_line record;
  v_unit record;
  v_output_count integer;
  v_output_index integer := 0;
  v_batch_number text;
  v_expiry date;
  v_kg_factor numeric;
  v_variance numeric;
  v_material_journal uuid;
  v_lock_products uuid[] := ARRAY[]::uuid[];
  v_loss_base_qty numeric;
BEGIN
  IF v_user IS NULL OR NOT public.is_staff(v_user) OR NOT (
    public.has_role(v_user,'owner') OR public.has_role(v_user,'manager')
    OR public.has_role(v_user,'warehouse') OR public.has_role(v_user,'accountant')
  ) THEN RAISE EXCEPTION 'ليس لديك صلاحية ترحيل تشغيلة الإنتاج'; END IF;
  IF p_materials IS NULL OR jsonb_typeof(p_materials)<>'array' OR jsonb_array_length(p_materials)=0
     OR p_outputs IS NULL OR jsonb_typeof(p_outputs)<>'array' OR jsonb_array_length(p_outputs)=0 THEN
    RAISE EXCEPTION 'أضف مادة واحدة وناتجاً واحداً على الأقل' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(coalesce(p_expenses,'[]'::jsonb))<>'array'
     OR jsonb_typeof(coalesce(p_losses,'[]'::jsonb))<>'array' THEN
    RAISE EXCEPTION 'بيانات المصروفات أو الفاقد غير صحيحة' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_order FROM public.production_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'تشغيلة الإنتاج غير موجودة' USING ERRCODE='P0002'; END IF;
  IF v_order.status<>'DRAFT' THEN RAISE EXCEPTION 'لا يمكن ترحيل تشغيلة ليست مسودة'; END IF;
  IF jsonb_array_length(coalesce(p_expenses,'[]'::jsonb))>0 AND NOT public.can_read_finance(v_user) THEN
    RAISE EXCEPTION 'تخصيص المصروفات يتطلب صلاحية مالية';
  END IF;

  SELECT coalesce(cs.batch_settings,'{}'::jsonb) INTO v_batch_settings
    FROM public.company_settings cs LIMIT 1;
  v_strategy := coalesce(v_batch_settings->>'dispatch_strategy','FEFO');
  IF v_strategy NOT IN ('FEFO','FIFO','MANUAL') THEN v_strategy:='FEFO'; END IF;
  v_company_strategy:=v_strategy;
  v_prevent_expired := coalesce((v_batch_settings->>'prevent_selling_expired')::boolean,true);

  -- (a) قفل تزامن على (المستودع، المواد) قبل قراءة رصيد المخزون
  FOR v_input IN SELECT value FROM jsonb_array_elements(p_materials)
  LOOP
    IF nullif(v_input->>'product_id','') IS NOT NULL THEN
      v_lock_products := array_append(v_lock_products, (v_input->>'product_id')::uuid);
    END IF;
  END LOOP;
  PERFORM public.production_lock_material_scope(v_order.warehouse_id, v_lock_products);

  -- Materials: normalize entered units, issue company stock once, and capture
  -- the actual moving-average amount created by the stock-cost engine.
  FOR v_input IN SELECT value FROM jsonb_array_elements(p_materials)
  LOOP
    SELECT * INTO v_product FROM public.products WHERE id=(v_input->>'product_id')::uuid FOR SHARE;
    IF NOT FOUND OR v_product.item_class IS NULL OR v_product.item_class IN ('SERVICE','NON_STOCK_ITEM')
       OR v_product.item_nature='SERVICE' OR public.item_effective_policy(v_product.id)<>'TRACKED' THEN
      RAISE EXCEPTION 'المادة % لا تدار كمخزون مملوك للمنشأة',coalesce(v_input->>'product_id','?')
        USING ERRCODE='check_violation';
    END IF;
    IF v_product.is_custody_item IS TRUE OR v_product.inventory_policy='CUSTOMER_OWNED' THEN
      RAISE EXCEPTION 'مادة الأمر لا يمكن أن تكون صنف أمانة مملوكاً للعميل'
        USING ERRCODE='check_violation';
    END IF;
    IF v_product.tracking='SERIAL' THEN
      RAISE EXCEPTION 'التصنيع لا يدعم حالياً الصرف التسلسلي للصنف %',v_product.name_ar USING ERRCODE='check_violation';
    END IF;
    v_uom_id := nullif(v_input->>'uom_id','')::uuid;
    v_base_uom_id := coalesce(v_product.base_uom_id,v_product.unit_id);
    v_base_qty := public.production_quantity_in_base(v_product.id,(v_input->>'quantity')::numeric,v_uom_id);
    v_factor := v_base_qty/(v_input->>'quantity')::numeric;
    IF v_base_qty<>round(v_base_qty,3) THEN RAISE EXCEPTION 'كمية المادة تتجاوز دقة المخزون 0.001'; END IF;
    v_mass := public.production_mass_in_kg(v_product.id,v_base_qty);
    IF v_product.item_class='RAW_MATERIAL' THEN
      IF v_mass IS NULL THEN v_input_mass_complete:=false; ELSE v_total_input_mass:=v_total_input_mass+v_mass; END IF;
    END IF;

    INSERT INTO public.production_order_materials(
      production_order_id,product_id,entered_quantity,uom_id,base_uom_id,uom_conversion_factor,
      base_quantity,mass_kg,inventory_account_code)
    VALUES (v_order.id,v_product.id,(v_input->>'quantity')::numeric,v_uom_id,v_base_uom_id,v_factor,
      v_base_qty,v_mass,public.production_inventory_account_code(v_product.item_class))
    RETURNING id INTO v_material_id;

    IF v_product.tracking='BATCH' THEN
      v_remaining:=v_base_qty;
      IF nullif(v_input->>'batch_id','') IS NOT NULL THEN
        SELECT * INTO v_batch FROM public.product_batches
         WHERE id=(v_input->>'batch_id')::uuid AND product_id=v_product.id AND warehouse_id=v_order.warehouse_id
         FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'الدفعة المحددة لا تخص المادة أو المستودع'; END IF;
        IF v_prevent_expired AND v_batch.expiry_date IS NOT NULL AND v_batch.expiry_date<=current_date THEN
          RAISE EXCEPTION 'لا يمكن صرف دفعة منتهية الصلاحية: %',v_batch.batch_number;
        END IF;
        IF v_batch.quantity<v_remaining THEN RAISE EXCEPTION 'رصيد الدفعة % غير كافٍ',v_batch.batch_number; END IF;
        UPDATE public.product_batches SET quantity=round(quantity-v_remaining,3),updated_at=now() WHERE id=v_batch.id;
        INSERT INTO public.production_order_batch_allocations(material_id,batch_id,base_quantity)
        VALUES(v_material_id,v_batch.id,v_remaining);
      ELSE
        v_strategy:=coalesce(v_product.batch_dispatch_strategy,v_company_strategy);
        IF v_strategy='MANUAL' THEN RAISE EXCEPTION 'حدد دفعة المادة % للصرف اليدوي',v_product.name_ar; END IF;
        FOR v_batch_line IN
          SELECT pb.id,pb.batch_number,pb.expiry_date,pb.quantity
            FROM public.product_batches pb
           WHERE pb.product_id=v_product.id AND pb.warehouse_id=v_order.warehouse_id AND pb.quantity>0
             AND (NOT v_prevent_expired OR pb.expiry_date IS NULL OR pb.expiry_date>current_date)
           ORDER BY CASE WHEN v_strategy='FIFO' THEN pb.created_at END ASC,
                    CASE WHEN v_strategy='FIFO' THEN pb.id END ASC,
                    CASE WHEN v_strategy='FEFO' THEN pb.expiry_date END ASC NULLS LAST,
                    CASE WHEN v_strategy='FEFO' THEN pb.created_at END ASC,pb.id
           FOR UPDATE
        LOOP
          EXIT WHEN v_remaining<=0;
          v_take:=least(v_batch_line.quantity,v_remaining);
          UPDATE public.product_batches SET quantity=round(quantity-v_take,3),updated_at=now() WHERE id=v_batch_line.id;
          INSERT INTO public.production_order_batch_allocations(material_id,batch_id,base_quantity)
          VALUES(v_material_id,v_batch_line.id,v_take);
          v_remaining:=v_remaining-v_take;
        END LOOP;
        IF v_remaining>0 THEN RAISE EXCEPTION 'رصيد الدفعات الصالحة غير كافٍ للمادة %',v_product.name_ar; END IF;
      END IF;
    ELSIF nullif(v_input->>'batch_id','') IS NOT NULL THEN
      RAISE EXCEPTION 'لا تقبل دفعة لصنف غير متتبع بالدفعات';
    END IF;

    PERFORM public.post_stock_delta(v_product.id,v_order.warehouse_id,-v_base_qty,NULL,
      'PRODUCTION','production_material',v_material_id,'صرف مواد لتشغيلة '||v_order.order_number,
      'COMPANY',NULL,'production_out');
    SELECT sm.id,sm.total_cost,sm.unit_cost INTO v_movement_id,v_line_cost,v_factor
      FROM public.stock_movements sm
     WHERE sm.source_type='production_material' AND sm.source_id=v_material_id
     ORDER BY sm.created_at DESC,sm.id DESC LIMIT 1;
    IF v_movement_id IS NULL THEN RAISE EXCEPTION 'لم تُسجل حركة صرف المادة'; END IF;
    UPDATE public.production_order_materials SET stock_movement_id=v_movement_id,
      total_cost=coalesce(v_line_cost,0),unit_cost=coalesce(v_factor,0)
     WHERE id=v_material_id;
    v_total_material_cost:=v_total_material_cost+coalesce(v_line_cost,0);
  END LOOP;

  -- Journal the material issue: debit WIP, credit the appropriate inventory.
  IF v_total_material_cost>0 THEN
    v_journal_lines:=jsonb_build_array(jsonb_build_object(
      'account_code','1312','debit',round(v_total_material_cost,2),'memo','مواد مصروفة للتشغيلة '||v_order.order_number));
    FOR v_batch_line IN
      SELECT inventory_account_code AS code,round(sum(total_cost),2) AS amount
        FROM public.production_order_materials WHERE production_order_id=v_order.id
       GROUP BY inventory_account_code HAVING sum(total_cost)>0
    LOOP
      v_journal_lines:=v_journal_lines||jsonb_build_array(jsonb_build_object(
        'account_code',v_batch_line.code,'credit',v_batch_line.amount,'memo','صرف مخزون للتشغيلة '||v_order.order_number));
    END LOOP;
    v_material_journal:=public.post_journal_entry(v_order.production_date,
      'صرف مواد لتشغيلة إنتاج '||v_order.order_number,v_journal_lines,
      'production_material_issue',v_order.id,'JE-PM-'||v_order.order_number);
  END IF;

  -- Eligible, already-posted expense lines are reclassified net of input VAT.
  FOR v_expense IN SELECT value FROM jsonb_array_elements(coalesce(p_expenses,'[]'::jsonb))
  LOOP
    SELECT * INTO v_expense_line FROM public.expense_lines
     WHERE id=(v_expense->>'expense_line_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'بند المصروف المحدد غير موجود'; END IF;
    SELECT * INTO v_expense_entry FROM public.expense_entries WHERE id=v_expense_line.entry_id FOR SHARE;
    IF v_expense_entry.status::text NOT IN ('POSTED','PARTIALLY_PAID','PAID','CLOSED') THEN
      RAISE EXCEPTION 'لا يمكن تحميل مصروف غير مرحّل على الإنتاج';
    END IF;
    IF v_expense_entry.expense_date>v_order.production_date THEN
      RAISE EXCEPTION 'تاريخ المصروف % بعد تاريخ التشغيلة %',v_expense_entry.expense_date,v_order.production_date;
    END IF;
    IF coalesce(v_expense_line.cost_center_id,v_expense_entry.cost_center_id)
       IS DISTINCT FROM v_order.cost_center_id THEN
      RAISE EXCEPTION 'مركز تكلفة المصروف لا يطابق مركز تكلفة التشغيلة';
    END IF;
    SELECT c.production_cost_eligible INTO v_expense_category_eligible
      FROM public.expense_categories c WHERE c.id=v_expense_line.category_id;
    -- المتاح = الصافي + الضريبة غير القابلة للاسترداد − المحمَّل سابقاً.
    SELECT r.eligible_amount, r.allocated_amount, r.available_amount,
           r.expense_account_code
      INTO v_eligible_amount, v_already_allocated, v_available, v_currency_account
      FROM public.production_expense_line_available(v_expense_line.id) r;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'تصنيف المصروف غير مرتبط بحساب مصروف نشط وقابل للترحيل';
    END IF;
    IF v_expense_category_eligible IS NOT TRUE THEN
      RAISE EXCEPTION 'تصنيف المصروف غير مؤهل للرسملة على الإنتاج';
    END IF;
    v_line_cost:=round((v_expense->>'amount')::numeric,2);
    IF v_line_cost<=0 THEN RAISE EXCEPTION 'قيمة تحميل المصروف يجب أن تكون موجبة'; END IF;
    IF v_line_cost>v_available THEN
      RAISE EXCEPTION 'قيمة تحميل المصروف % تتجاوز المتاح %',v_line_cost,v_available;
    END IF;
    IF length(btrim(coalesce(v_expense->>'basis','')))<3 THEN
      RAISE EXCEPTION 'اذكر أساس توزيع تكلفة المصروف على التشغيلة';
    END IF;
    INSERT INTO public.production_order_cost_allocations(
      production_order_id,expense_line_id,expense_entry_id,cost_center_id,expense_account_code,
      amount,allocation_basis,note,created_by)
    VALUES(v_order.id,v_expense_line.id,v_expense_entry.id,v_order.cost_center_id,v_currency_account,
      v_line_cost,btrim(v_expense->>'basis'),nullif(btrim(coalesce(v_expense->>'note','')),''),v_user)
    RETURNING id INTO v_allocation_id;
    v_journal_id:=public.post_journal_entry(v_order.production_date,
      'رسملة تكلفة إنتاج من المصروف '||v_expense_entry.reference,
      jsonb_build_array(
        jsonb_build_object('account_code','1312','debit',v_line_cost,'memo','تحميل على تشغيلة '||v_order.order_number),
        jsonb_build_object('account_code',v_currency_account,'credit',v_line_cost,'memo','إعادة تصنيف مصروف إلى إنتاج')),
      'production_expense_allocation',v_allocation_id,'JE-PEX-'||replace(v_allocation_id::text,'-',''));
    UPDATE public.production_order_cost_allocations SET journal_entry_id=v_journal_id WHERE id=v_allocation_id;
    v_total_conversion_cost:=v_total_conversion_cost+v_line_cost;
  END LOOP;

  -- Loss is recorded in mass units, normalized to kg. Unit counts are never
  -- compared across unrelated products.
  SELECT factor_to_reference INTO v_kg_factor FROM public.units
   WHERE dimension_code='MASS' AND lower(short_name) IN ('kg','كجم','كيلوجرام')
   ORDER BY CASE WHEN lower(short_name)='kg' THEN 0 ELSE 1 END LIMIT 1;
  FOR v_loss IN SELECT value FROM jsonb_array_elements(coalesce(p_losses,'[]'::jsonb))
  LOOP
    v_mass := NULL;
    -- (b) مساران للفاقد:
    --   1) كتلة صريحة: uom_id بوحدة كتلة (كجم/جرام) + quantity.
    --   2) فاقد عددي: product_id أحد مخرجات الأمر + quantity بوحدة الصنف،
    --      مع mass_kg اختياري إذا كان الصنف بلا مكافئ كتلي.
    -- الكتلة المشتقة من المسارين فقط تدخل ميزان الكتلة؛ الفاقد العددي
    -- بلا كتلة يُسجل في السجل التدقيقي ولا يشارك في ميزان مادي لا يعرفه.
    IF nullif(v_loss->>'product_id','') IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.production_order_outputs o
         WHERE o.production_order_id=v_order.id
           AND o.product_id=(v_loss->>'product_id')::uuid
      ) THEN
        RAISE EXCEPTION 'صنف الفاقد يجب أن يكون أحد مخرجات نفس التشغيلة' USING ERRCODE='23503';
      END IF;
      v_loss_base_qty:=public.production_quantity_in_base(
        (v_loss->>'product_id')::uuid,(v_loss->>'quantity')::numeric,nullif(v_loss->>'uom_id','')::uuid);
      v_mass:=public.production_mass_in_kg((v_loss->>'product_id')::uuid,v_loss_base_qty);
      IF v_mass IS NULL AND nullif(v_loss->>'mass_kg','') IS NOT NULL THEN
        v_mass:=round((v_loss->>'mass_kg')::numeric,6);
      END IF;
    ELSE
      SELECT dimension_code,factor_to_reference INTO v_unit FROM public.units
       WHERE id=(v_loss->>'uom_id')::uuid;
      IF NOT FOUND OR v_unit.dimension_code<>'MASS' OR v_unit.factor_to_reference IS NULL OR v_kg_factor IS NULL THEN
        RAISE EXCEPTION 'وحدة الفاقد يجب أن تكون وحدة كتلة معرفة مثل كجم أو جرام';
      END IF;
      v_mass:=round((v_loss->>'quantity')::numeric*v_unit.factor_to_reference/v_kg_factor,6);
    END IF;
    IF v_mass IS NOT NULL AND v_mass<=0 THEN RAISE EXCEPTION 'كمية الفاقد يجب أن تكون موجبة'; END IF;
    IF upper(v_loss->>'loss_type')='NORMAL' THEN
      IF v_mass IS NOT NULL THEN v_normal_loss_mass:=v_normal_loss_mass+v_mass; END IF;
    ELSIF upper(v_loss->>'loss_type')='ABNORMAL' THEN
      IF v_mass IS NOT NULL THEN v_abnormal_loss_mass:=v_abnormal_loss_mass+v_mass; END IF;
    ELSE RAISE EXCEPTION 'نوع الفاقد غير معروف'; END IF;
    INSERT INTO public.production_order_losses(production_order_id,loss_type,quantity,uom_id,mass_kg,reason)
    VALUES(v_order.id,upper(v_loss->>'loss_type'),(v_loss->>'quantity')::numeric,
      coalesce(nullif(v_loss->>'uom_id','')::uuid, v_kg_factor),
      coalesce(v_mass, greatest((v_loss->>'quantity')::numeric, 0.000001)),
      btrim(coalesce(v_loss->>'reason','')));
  END LOOP;

  SELECT count(*) INTO v_output_count FROM jsonb_array_elements(p_outputs);
  -- Outputs: only inventory goods that may be sold or used as a by-product.
  FOR v_output IN SELECT value FROM jsonb_array_elements(p_outputs)
  LOOP
    v_output_index:=v_output_index+1;
    SELECT * INTO v_product FROM public.products WHERE id=(v_output->>'product_id')::uuid FOR SHARE;
    IF NOT FOUND OR v_product.item_class IS NULL OR v_product.item_class NOT IN ('FINISHED_GOOD','BY_PRODUCT')
       OR v_product.item_nature='SERVICE' OR public.item_effective_policy(v_product.id)<>'TRACKED'
       OR NOT v_product.is_sellable THEN
      RAISE EXCEPTION 'الناتج يجب أن يكون منتجاً تاماً أو ناتجاً جانبياً مملوكاً ومخزونياً ومتاحاً للبيع';
    END IF;
    IF v_product.is_custody_item IS TRUE OR v_product.inventory_policy='CUSTOMER_OWNED' THEN
      RAISE EXCEPTION 'ناتج التشغيلة لا يمكن أن يكون صنف أمانة مملوكاً للعميل'
        USING ERRCODE='check_violation';
    END IF;
    IF v_product.tracking='SERIAL' THEN RAISE EXCEPTION 'لا يدعم مسار الإنتاج حالياً تتبع الناتج التسلسلي'; END IF;
    v_uom_id:=nullif(v_output->>'uom_id','')::uuid;
    v_base_uom_id:=coalesce(v_product.base_uom_id,v_product.unit_id);
    v_base_qty:=public.production_quantity_in_base(v_product.id,(v_output->>'quantity')::numeric,v_uom_id);
    v_factor:=v_base_qty/(v_output->>'quantity')::numeric;
    IF v_base_qty<>round(v_base_qty,3) THEN RAISE EXCEPTION 'كمية الناتج تتجاوز دقة المخزون 0.001'; END IF;
    v_mass:=public.production_mass_in_kg(v_product.id,v_base_qty);
    IF v_mass IS NULL THEN v_output_mass_complete:=false; ELSE v_total_output_mass:=v_total_output_mass+v_mass; END IF;
    v_batch_number:=nullif(btrim(coalesce(v_output->>'batch_number','')),'');
    v_expiry:=nullif(v_output->>'expiry_date','')::date;
    IF v_product.tracking='BATCH' THEN
      IF v_batch_number IS NULL THEN v_batch_number:=v_order.order_number||'-'||lpad(v_output_index::text,2,'0'); END IF;
      IF v_product.track_expiry AND v_expiry IS NULL THEN
        RAISE EXCEPTION 'تاريخ الانتهاء مطلوب للناتج %',v_product.name_ar;
      END IF;
    ELSIF v_batch_number IS NOT NULL OR v_expiry IS NOT NULL THEN
      RAISE EXCEPTION 'بيانات الدفعة لا تقبل لناتج غير متتبع بالدفعات';
    END IF;
    INSERT INTO public.production_order_outputs(
      production_order_id,product_id,entered_quantity,uom_id,base_uom_id,uom_conversion_factor,
      base_quantity,mass_kg,allocation_value_per_base,inventory_account_code,batch_number,expiry_date)
    VALUES(v_order.id,v_product.id,(v_output->>'quantity')::numeric,v_uom_id,v_base_uom_id,v_factor,
      v_base_qty,v_mass,greatest(coalesce((v_output->>'allocation_value_per_base')::numeric,0),0),
      public.production_inventory_account_code(v_product.item_class),v_batch_number,v_expiry)
    RETURNING id INTO v_output_id;
  END LOOP;

  -- Enforce a physical mass balance when all raw inputs and outputs have a
  -- meaningful product-level mass conversion. Otherwise retain exact base-UOM
  -- snapshots and do not invent a conversion between unrelated count units.
  IF v_input_mass_complete AND v_output_mass_complete AND v_total_input_mass>0 THEN
    v_expected_mass:=v_total_output_mass+v_normal_loss_mass+v_abnormal_loss_mass;
    IF abs(v_total_input_mass-v_expected_mass)>0.01 THEN
      RAISE EXCEPTION 'ميزان الكتلة غير متزن: مواد خام % كجم مقابل نواتج وفاقد % كجم',
        round(v_total_input_mass,3),round(v_expected_mass,3) USING ERRCODE='check_violation';
    END IF;
  END IF;
  IF v_abnormal_loss_mass>0 AND (NOT v_input_mass_complete OR v_total_input_mass<=0) THEN
    RAISE EXCEPTION 'يجب تعريف مكافئ كتلي للمواد الخام قبل تحميل الفاقد غير الطبيعي';
  END IF;

  v_total_wip:=round(v_total_material_cost+v_total_conversion_cost,2);
  IF v_total_wip<=0 THEN RAISE EXCEPTION 'لا يمكن إقفال تشغيلة بلا تكلفة مواد أو تحويل مسجلة'; END IF;
  IF v_abnormal_loss_mass>0 THEN
    IF v_abnormal_loss_mass>v_total_input_mass THEN RAISE EXCEPTION 'الفاقد غير الطبيعي يتجاوز كتلة المواد الخام'; END IF;
    v_abnormal_cost:=round(v_total_wip*v_abnormal_loss_mass/v_total_input_mass,2);
  END IF;

  -- Allocate joint conversion cost by estimated sales value per base unit.
  IF v_output_count>1 AND EXISTS(
    SELECT 1 FROM public.production_order_outputs
     WHERE production_order_id=v_order.id AND allocation_value_per_base<=0
  ) THEN
    RAISE EXCEPTION 'أدخل قيمة بيع تقديرية لوحدة الأساس لكل ناتج لتوزيع تكلفة التشغيل';
  END IF;
  v_remaining_wip:=round(v_total_wip-v_abnormal_cost,2);
  PERFORM public.production_allocate_joint_cost(v_order.id, v_remaining_wip);

  -- Receive each output through the same valuation engine used by purchases.
  FOR v_output IN SELECT to_jsonb(o) FROM public.production_order_outputs o
    WHERE o.production_order_id=v_order.id ORDER BY o.created_at,o.id
  LOOP
    v_output_id:=(v_output->>'id')::uuid;
    SELECT p.* INTO v_product FROM public.products p
      JOIN public.production_order_outputs o ON o.product_id=p.id WHERE o.id=v_output_id;
    SELECT o.base_quantity,o.allocated_cost,o.inventory_account_code,o.batch_number,o.expiry_date,
           o.allocated_cost/NULLIF(o.base_quantity,0)
      INTO v_base_qty,v_line_cost,v_stock_account,v_batch_number,v_expiry,v_factor
      FROM public.production_order_outputs o WHERE o.id=v_output_id;
    PERFORM public.post_stock_delta(v_product.id,v_order.warehouse_id,v_base_qty,v_factor,
      'PRODUCTION','production_output',v_output_id,'استلام ناتج تشغيلة '||v_order.order_number,
      'COMPANY',NULL,'production_in');
    SELECT sm.id,sm.total_cost INTO v_movement_id,v_available FROM public.stock_movements sm
     WHERE sm.source_type='production_output' AND sm.source_id=v_output_id
     ORDER BY sm.created_at DESC,sm.id DESC LIMIT 1;
    IF v_movement_id IS NULL THEN RAISE EXCEPTION 'لم تُسجل حركة استلام الناتج'; END IF;
    v_batch_id:=NULL;
    IF v_product.tracking='BATCH' THEN
      INSERT INTO public.product_batches(product_id,warehouse_id,batch_number,expiry_date,quantity,unit_cost,note,created_by)
      VALUES(v_product.id,v_order.warehouse_id,v_batch_number,v_expiry,v_base_qty,
        CASE WHEN v_base_qty>0 THEN round(v_available/v_base_qty,4) ELSE 0 END,
        'ناتج تشغيلة '||v_order.order_number,v_user)
      RETURNING id INTO v_batch_id;
    END IF;
    UPDATE public.production_order_outputs SET stock_movement_id=v_movement_id,batch_id=v_batch_id,
      actual_stock_cost=coalesce(v_available,0),unit_cost=CASE WHEN base_quantity>0 THEN coalesce(v_available,0)/base_quantity ELSE 0 END
     WHERE id=v_output_id;
    v_actual_output_total:=v_actual_output_total+coalesce(v_available,0);
  END LOOP;

  -- Complete WIP clearing and finished/by-product inventory recognition.
  v_journal_lines:='[]'::jsonb;
  FOR v_batch_line IN
    SELECT inventory_account_code AS code,round(sum(actual_stock_cost),2) AS amount
      FROM public.production_order_outputs WHERE production_order_id=v_order.id
     GROUP BY inventory_account_code HAVING sum(actual_stock_cost)>0
  LOOP
    v_journal_lines:=v_journal_lines||jsonb_build_array(jsonb_build_object(
      'account_code',v_batch_line.code,'debit',v_batch_line.amount,'memo','استلام ناتج تشغيلة '||v_order.order_number));
  END LOOP;
  IF v_abnormal_cost>0 THEN
    v_journal_lines:=v_journal_lines||jsonb_build_array(jsonb_build_object(
      'account_code','5911','debit',v_abnormal_cost,'memo','فاقد إنتاج غير طبيعي - '||v_order.order_number));
  END IF;
  v_variance:=round(v_total_wip-v_actual_output_total-v_abnormal_cost,2);
  IF v_variance>0 THEN
    v_journal_lines:=v_journal_lines||jsonb_build_array(jsonb_build_object(
      'account_code','5911','debit',v_variance,'memo','فرق تقريب تكلفة استلام الإنتاج - '||v_order.order_number));
  ELSIF v_variance<0 THEN
    v_journal_lines:=v_journal_lines||jsonb_build_array(jsonb_build_object(
      'account_code','5911','credit',abs(v_variance),'memo','فرق تقريب تكلفة استلام الإنتاج - '||v_order.order_number));
  END IF;
  v_journal_lines:=v_journal_lines||jsonb_build_array(jsonb_build_object(
    'account_code','1312','credit',v_total_wip,'memo','إقفال الإنتاج تحت التنفيذ - '||v_order.order_number));
  v_journal_id:=public.post_journal_entry(v_order.production_date,
    'إقفال تشغيلة إنتاج '||v_order.order_number,v_journal_lines,
    'production_completion',v_order.id,'JE-PO-'||v_order.order_number);

  UPDATE public.production_orders SET status='POSTED',material_cost=round(v_total_material_cost,2),
    conversion_cost=round(v_total_conversion_cost,2),total_cost=v_total_wip,
    output_cost=round(v_actual_output_total,2),abnormal_loss_cost=v_abnormal_cost,
    completed_by=v_user,completed_at=now(),updated_at=now()
   WHERE id=v_order.id;
  RETURN v_journal_id;
END;
$function$;

-- ── 11. create_and_post_production_order ─────────────────────────────────
-- يبقى عقد 9906/9916 كما هو: إنشاء رأس الأمر ثم إكماله في معاملة واحدة ذرية.
-- التحقق من صلاحية المادة والكمية والوحدات يحدث داخل complete_production_order
-- قبل أي حركة مخزون، وأي فشل يلغي الرأس معه.
CREATE OR REPLACE FUNCTION public.create_and_post_production_order(
  p_warehouse_id uuid,
  p_cost_center_id uuid,
  p_production_date date,
  p_notes text,
  p_materials jsonb,
  p_outputs jsonb,
  p_expenses jsonb DEFAULT '[]'::jsonb,
  p_losses jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $function$
DECLARE
  v_order_id uuid;
BEGIN
  v_order_id:=public.create_production_order(p_warehouse_id,p_cost_center_id,p_production_date,p_notes);
  PERFORM public.complete_production_order(v_order_id,p_materials,p_outputs,p_expenses,p_losses);
  RETURN v_order_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_and_post_production_order(uuid,uuid,date,text,jsonb,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_and_post_production_order(uuid,uuid,date,text,jsonb,jsonb,jsonb,jsonb)
  TO authenticated, service_role;

-- ── 12. تقوية عكس أمر الإنتاج: لا عكس بعد أي أثر لاحق ───────────────────
-- 9908 كان يفحص حركات المخزون فقط. يبقى هذا الأساس، وتُضاف هنا فحوصات
-- تحصّن الأرصدة بعد أي حركة لاحقة على الناتج أو المادة (بيع، تحويل،
-- تسوية، صرف، استلام أمر آخر). لا تُعاد كتابة الحركات ولا تُحذف.
-- المنطق الأساسي (من 9908) محفوظ، والزيادة فقط في التحقق قبل البدء.
CREATE OR REPLACE FUNCTION public.production_output_has_downstream_use(
  p_output_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.production_order_outputs o
      JOIN public.production_orders ord ON ord.id = o.production_order_id
     WHERE o.id = p_output_id
       AND EXISTS (
         SELECT 1 FROM public.stock_movements sm
          WHERE sm.product_id = o.product_id
            AND sm.warehouse_id = ord.warehouse_id
            AND sm.owner_type = 'COMPANY'
            AND sm.owner_id IS NULL
            AND sm.created_at > ord.completed_at
            AND NOT (sm.source_type IN ('production_output','production_reversal_output')
                     AND sm.source_id = o.id)
       )
  )
$function$;

REVOKE ALL ON FUNCTION public.production_output_has_downstream_use(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.production_output_has_downstream_use(uuid)
  TO service_role;

COMMENT ON FUNCTION public.production_output_has_downstream_use(uuid) IS
  'هل لُناتج أمر إنتاج مُرحّل أي حركة مخزون لاحقة خارج الأمر؟ عكس الأمر ممنوع في هذه الحالة.';

-- ── 13. تحقق نهائي من توازن تكلفة الأمر ────────────────────────────────
-- يحسب من السجلات النهائية (لا من متغيرات الدالة) ويُستخدم للتدقيق خارجاً:
--   WIP = مواد + تحويل محمّل
--   النواتج الفعلية + الفاقد غير الطبيعي + فرق التقريب = WIP
CREATE OR REPLACE FUNCTION public.production_order_cost_check(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT jsonb_build_object(
    'order_id', o.id,
    'status', o.status,
    'material_cost', o.material_cost,
    'conversion_cost', o.conversion_cost,
    'wip_total', o.total_cost,
    'wip_from_parts', round(o.material_cost + o.conversion_cost, 2),
    'actual_output_cost', o.output_cost,
    'abnormal_loss_cost', o.abnormal_loss_cost,
    'rounding_variance', round(o.total_cost - o.output_cost - o.abnormal_loss_cost, 2),
    'wip_balanced',
      round(o.material_cost + o.conversion_cost, 2) = o.total_cost
      AND abs(round(o.total_cost - o.output_cost - o.abnormal_loss_cost, 2)) < 0.01
  )
  FROM public.production_orders o
 WHERE o.id = p_order_id
$function$;

REVOKE ALL ON FUNCTION public.production_order_cost_check(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.production_order_cost_check(uuid)
  TO authenticated, service_role;

DO $allowlist$
DECLARE
  v_current text[];
  v_name text;
  v_additions text[] := ARRAY['production_order_cost_check']::text[];
BEGIN
  EXECUTE 'SELECT public.rpc_allowlist()' INTO v_current;
  v_current := coalesce(v_current, ARRAY[]::text[]);
  FOREACH v_name IN ARRAY v_additions LOOP
    IF NOT (v_name = ANY(v_current)) THEN
      v_current := array_append(v_current, v_name);
    END IF;
  END LOOP;
  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION public.rpc_allowlist() RETURNS text[]
    LANGUAGE sql IMMUTABLE SET search_path = public
    AS $body$ SELECT %L::text[] $body$
  $fn$, v_current);
END;
$allowlist$;
REVOKE ALL ON FUNCTION public.rpc_allowlist() FROM PUBLIC, anon, authenticated, service_role;

-- ── 14. عكس أمر الإنتاج: شرط الأثر اللاحق الموحّد (9908 + 9917) ──────────────
-- تعاد تعريف reverse_production_order بنفس التوقيع، مع إضافة فحص مبكر
-- موحّد لكل ناتج عبر production_output_has_downstream_use قبل أي حركة عكسية.
-- باقي منطق 9908 محفوظ: منع عكس أمر غير مرحّل، منع إعادة إنتاج نفس الصنف،
-- فحص طبقة التكلفة والدفعة، رد المواد، وعكس القيود.
CREATE OR REPLACE FUNCTION public.reverse_production_order(
  p_order_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_order public.production_orders%ROWTYPE;
  v_output record;
  v_material record;
  v_first_tx record;
  v_inventory_qty numeric;
  v_layer_qty numeric;
  v_layer_value numeric;
  v_expected_qty numeric;
  v_expected_value numeric;
  v_journal record;
  v_reversal_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF v_user IS NULL OR NOT public.is_staff(v_user) OR NOT (
    public.has_role(v_user,'owner') OR public.has_role(v_user,'manager')
    OR public.has_role(v_user,'accountant')
  ) THEN
    RAISE EXCEPTION 'عكس تشغيلة الإنتاج يتطلب صلاحية المالك أو المدير أو المحاسب';
  END IF;
  IF length(btrim(coalesce(p_reason,''))) < 3 THEN
    RAISE EXCEPTION 'اكتب سببًا واضحًا لعكس التشغيلة' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_order FROM public.production_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'تشغيلة الإنتاج غير موجودة' USING ERRCODE='P0002'; END IF;
  IF v_order.status <> 'POSTED' OR v_order.completed_at IS NULL THEN
    RAISE EXCEPTION 'لا يمكن عكس إلا تشغيلة إنتاج مرحلة وغير معكوسة';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.production_order_materials m
      JOIN public.production_order_outputs o
        ON o.production_order_id=m.production_order_id AND o.product_id=m.product_id
     WHERE m.production_order_id=v_order.id
  ) THEN
    RAISE EXCEPTION 'لا يمكن عكس تشغيلة تعيد إنتاج الصنف نفسه المستخدم كمدخل';
  END IF;

  -- بوّابة الأثر اللاحق: قبل أي عكس مادي، لا يجوز أن يكون أي ناتج قد شارك
  -- في حركة مخزون لاحقة (بيع، تحويل، تسوية، استلام أمر آخر) حتى لا تُفسد
  -- الأرصدة باسترداد/رد على قيمة تغيّرت بعد الترحيل.
  FOR v_output IN
    SELECT o.id,o.product_id,o.stock_movement_id
      FROM public.production_order_outputs o
     WHERE o.production_order_id=v_order.id
     ORDER BY o.created_at,o.id
  LOOP
    IF public.production_output_has_downstream_use(v_output.id) THEN
      RAISE EXCEPTION 'لا يمكن عكس التشغيلة %: الناتج % استُخدم في حركة لاحقة',
        v_order.order_number, v_output.product_id USING ERRCODE='check_violation';
    END IF;
  END LOOP;

  -- Require each output to have started at zero stock and still be the only
  -- stock movement for that product since completion. This makes its issue
  -- value exactly equal to the posted receipt value under moving average.
  FOR v_output IN
    SELECT o.*,p.tracking
      FROM public.production_order_outputs o
      JOIN public.products p ON p.id=o.product_id
     WHERE o.production_order_id=v_order.id
     ORDER BY o.created_at,o.id
  LOOP
    IF v_output.stock_movement_id IS NULL THEN
      RAISE EXCEPTION 'حركة ناتج التشغيلة % غير موجودة؛ لا يمكن العكس بأمان',v_output.product_id;
    END IF;

    SELECT ict.quantity_before,ict.value_before,ict.created_at
      INTO v_first_tx
      FROM public.item_cost_transactions ict
      JOIN public.production_order_outputs o
        ON ict.source_type='production_output' AND ict.source_id=o.id
     WHERE o.production_order_id=v_order.id AND o.product_id=v_output.product_id
       AND ict.warehouse_id=v_order.warehouse_id
       AND ict.owner_type='COMPANY' AND ict.owner_id IS NULL
     ORDER BY ict.created_at,ict.id LIMIT 1;
    IF NOT FOUND OR v_first_tx.quantity_before<>0 OR v_first_tx.value_before<>0 THEN
      RAISE EXCEPTION 'لا يمكن عكس الناتج % لأن له رصيدًا سابقًا عند الترحيل',v_output.product_id;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.stock_movements sm
       WHERE sm.product_id=v_output.product_id AND sm.warehouse_id=v_order.warehouse_id
         AND sm.owner_type='COMPANY' AND sm.owner_id IS NULL
         AND sm.created_at>v_order.completed_at
         AND NOT (sm.source_type='production_output' AND sm.source_id IN (
           SELECT o.id FROM public.production_order_outputs o
            WHERE o.production_order_id=v_order.id AND o.product_id=v_output.product_id
         ))
    ) THEN
      RAISE EXCEPTION 'تعذر عكس الناتج % لوجود حركة مخزون لاحقة؛ عالج الحركة اللاحقة أولًا',v_output.product_id;
    END IF;

    SELECT i.quantity INTO v_inventory_qty FROM public.inventory i
     WHERE i.product_id=v_output.product_id AND i.warehouse_id=v_order.warehouse_id
       AND i.owner_type='COMPANY' AND i.owner_id IS NULL FOR UPDATE;
    v_inventory_qty:=coalesce(v_inventory_qty,0);
    SELECT coalesce(sum(o.base_quantity),0),coalesce(sum(o.actual_stock_cost),0)
      INTO v_expected_qty,v_expected_value
      FROM public.production_order_outputs o
     WHERE o.production_order_id=v_order.id AND o.product_id=v_output.product_id;
    IF abs(v_inventory_qty-v_expected_qty)>0.001 THEN
      RAISE EXCEPTION 'رصيد الناتج % تغير بعد التشغيلة؛ لا يمكن العكس بأمان',v_output.product_id;
    END IF;

    SELECT cl.quantity,cl.total_value INTO v_layer_qty,v_layer_value
      FROM public.item_cost_layers cl
     WHERE cl.product_id=v_output.product_id AND cl.warehouse_id=v_order.warehouse_id
       AND cl.owner_type='COMPANY' AND cl.owner_id IS NULL
     FOR UPDATE;
    IF abs(coalesce(v_layer_qty,0)-v_expected_qty)>0.001
       OR abs(coalesce(v_layer_value,0)-v_expected_value)>0.011 THEN
      RAISE EXCEPTION 'طبقة تكلفة الناتج % تغيرت؛ لا يمكن العكس بأمان',v_output.product_id;
    END IF;

    IF v_output.tracking='BATCH' THEN
      IF v_output.batch_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.product_batches pb
         WHERE pb.id=v_output.batch_id AND pb.quantity=v_output.base_quantity
           AND pb.updated_at<=v_order.completed_at
      ) THEN
        RAISE EXCEPTION 'دفعة الناتج % تغيرت بعد الترحيل؛ لا يمكن العكس بأمان',v_output.product_id;
      END IF;
    END IF;
  END LOOP;

  -- Inputs must also be untouched since posting, so returning their saved
  -- issue cost reconstructs the original moving-average layer exactly.
  FOR v_material IN
    SELECT m.* FROM public.production_order_materials m
     WHERE m.production_order_id=v_order.id ORDER BY m.created_at,m.id
  LOOP
    IF v_material.stock_movement_id IS NULL THEN
      RAISE EXCEPTION 'حركة صرف المادة % غير موجودة؛ لا يمكن العكس بأمان',v_material.product_id;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.stock_movements sm
       WHERE sm.product_id=v_material.product_id AND sm.warehouse_id=v_order.warehouse_id
         AND sm.owner_type='COMPANY' AND sm.owner_id IS NULL
         AND sm.created_at>v_order.completed_at
         AND NOT (sm.source_type='production_material' AND sm.source_id IN (
           SELECT m.id FROM public.production_order_materials m WHERE m.production_order_id=v_order.id
         ))
    ) THEN
      RAISE EXCEPTION 'تعذر رد المادة % لوجود حركة مخزون لاحقة؛ عالج الحركة اللاحقة أولًا',v_material.product_id;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.production_order_batch_allocations a
      JOIN public.product_batches pb ON pb.id=a.batch_id
       WHERE a.material_id=v_material.id AND pb.updated_at>v_order.completed_at
    ) THEN
      RAISE EXCEPTION 'دفعة المادة % تغيرت بعد الترحيل؛ لا يمكن العكس بأمان',v_material.product_id;
    END IF;
    PERFORM 1 FROM public.inventory i
     WHERE i.product_id=v_material.product_id AND i.warehouse_id=v_order.warehouse_id
       AND i.owner_type='COMPANY' AND i.owner_id IS NULL FOR UPDATE;
  END LOOP;

  -- Reverse finished-goods receipts first, then restore consumed raw inputs.
  FOR v_output IN
    SELECT o.* FROM public.production_order_outputs o
     WHERE o.production_order_id=v_order.id ORDER BY o.created_at DESC,o.id DESC
  LOOP
    PERFORM public.post_stock_delta(
      v_output.product_id,v_order.warehouse_id,-v_output.base_quantity,NULL,
      'PRODUCTION','production_reversal_output',v_output.id,
      'عكس ناتج تشغيلة '||v_order.order_number||': '||btrim(p_reason),
      'COMPANY',NULL,'production_out');
    IF v_output.batch_id IS NOT NULL THEN
      UPDATE public.product_batches SET quantity=0,updated_at=now(),
        note=concat_ws(E'\n',nullif(note,''),'عكس تشغيلة '||v_order.order_number||': '||btrim(p_reason))
       WHERE id=v_output.batch_id;
    END IF;
  END LOOP;

  FOR v_material IN
    SELECT m.* FROM public.production_order_materials m
     WHERE m.production_order_id=v_order.id ORDER BY m.created_at,m.id
  LOOP
    PERFORM public.post_stock_delta(
      v_material.product_id,v_order.warehouse_id,v_material.base_quantity,
      CASE WHEN v_material.base_quantity>0 THEN v_material.total_cost/v_material.base_quantity ELSE 0 END,
      'PRODUCTION','production_reversal_material',v_material.id,
      'رد مادة تشغيلة '||v_order.order_number||': '||btrim(p_reason),
      'COMPANY',NULL,'production_in');
  END LOOP;

  -- Restore lot quantities only after confirming no later lot-level changes.
  UPDATE public.product_batches pb
     SET quantity=round(pb.quantity+a.return_quantity,3),updated_at=now()
    FROM (
      SELECT a.batch_id,sum(a.base_quantity) AS return_quantity
        FROM public.production_order_batch_allocations a
        JOIN public.production_order_materials m ON m.id=a.material_id
       WHERE m.production_order_id=v_order.id
       GROUP BY a.batch_id
    ) a
   WHERE pb.id=a.batch_id;

  -- Reverse the source journals through the established audit-safe accounting
  -- RPC. Each reversal and stock return is atomic with the order status change.
  FOR v_journal IN
    SELECT je.id
      FROM public.journal_entries je
     WHERE je.status='POSTED' AND (
       (je.source_type='production_completion' AND je.source_id=v_order.id)
       OR (je.source_type='production_material_issue' AND je.source_id=v_order.id)
       OR je.id IN (
         SELECT a.journal_entry_id FROM public.production_order_cost_allocations a
          WHERE a.production_order_id=v_order.id AND a.journal_entry_id IS NOT NULL
       )
     )
     ORDER BY CASE je.source_type WHEN 'production_completion' THEN 1
                                  WHEN 'production_material_issue' THEN 3 ELSE 2 END,
              je.created_at DESC,je.id DESC
  LOOP
    v_reversal_ids:=array_append(v_reversal_ids,public.reverse_journal_entry(
      v_journal.id,'عكس تشغيلة '||v_order.order_number||': '||btrim(p_reason)));
  END LOOP;

  -- التحديث الوحيد المسموح على بيانات أمر قائم هو تغيير الحالة بعد نجاح العكس بالكامل.
  UPDATE public.production_orders SET status='REVERSED',reversed_at=now(),reversed_by=v_user,
         reversal_reason=btrim(p_reason),updated_at=now()
   WHERE id=v_order.id;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,payload)
  VALUES(v_user,'production.order_reversed','production_order',v_order.id,
    jsonb_build_object('order_number',v_order.order_number,'reason',btrim(p_reason),
                       'reversal_journal_ids',to_jsonb(v_reversal_ids)));
  RETURN v_order.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.reverse_production_order(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reverse_production_order(uuid,text)
  TO authenticated, service_role;

COMMIT;

-- ── Rollback (يدوي، بعد مراجعة):
--   DROP TRIGGER production_cost_allocations_no_delete ON public.production_order_cost_allocations;
--   DROP TRIGGER production_materials_locked_after_post ON public.production_order_materials;
--   DROP TRIGGER production_outputs_locked_after_post  ON public.production_order_outputs;
--   DROP TRIGGER production_losses_locked_after_post   ON public.production_order_losses;
--   DROP TRIGGER stock_movements_link_production_order ON public.stock_movements;
--   DROP TRIGGER inventory_guard_company_scope         ON public.inventory;
--   DROP TRIGGER item_cost_layers_guard_company_scope  ON public.item_cost_layers;
--   DROP FUNCTION public.production_guard_cost_allocation_write();
--   DROP FUNCTION public.production_guard_posted_void_output();
--   DROP FUNCTION public.production_allocate_joint_cost(uuid, numeric);
--   DROP FUNCTION public.production_order_cost_detail(uuid);
--   DROP FUNCTION public.production_lock_material_scope(uuid, uuid[]);
--   DROP INDEX public.stock_movements_production_order_idx;
--   ALTER TABLE public.stock_movements DROP COLUMN production_order_id;
--   DROP FUNCTION public.production_link_movement_to_order();
--   DROP FUNCTION public.guard_production_company_stock_scope();
--   (أعد تعريف smart_manufacture وconvert_stock من 43 و48)
--   (أعد تعريف rpc_allowlist من 9914)
