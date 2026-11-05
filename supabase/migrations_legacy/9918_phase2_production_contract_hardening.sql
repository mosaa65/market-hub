-- ============================================================================
-- 9918_phase2_production_contract_hardening.sql
--
-- استكمال المرحلة الثانية: إغلاق ثغرات العقود التي كشفتها مراجعة 9917.
--
-- ما يُصلحه هذا الملف (كل بند مُثبت في الكود لا مفترض):
--   1) مسار التصنيع القديم smart_manufacture:
--      • 9917 نقل الوحدة إلى _grain_uom_id، لكن مُغلف الواجهة (custody.ts)
--        كان يستدعي RPC بلا _outputs: ‏uom_id يعرّفها الخادم في JSON؛ وهذا
--        يرمي PGRST204 (schema cache) في PostgREST. المصحّح: توقيع jsonb
--        جديد يُعرَّف أولاً باسم المعاملات نفسها بلا التزام بترتيب المفاتيح،
--        ثم يُصحّح الغلاف في custody.ts. تبقى مغلفات 5 و6 و7 معاملات للتوافق.
--      • 9917 كان يتحقق من الكمية فقط؛ الآن يُتحقق أن الكمية المطلوبة موجودة
--        فعلاً في مخزون الشركة قبل أخذ طبقة التكلفة، فلا تُرحّل حركة بقيمة
--        تكلفة لرصيد غير موجود (post_stock_delta سيرفض أصلاً ويلغي كل شيء).
--   2) عقد صرف المواد في الأمر الحديث:
--      • complete_production_order يقبل أي صنف مخزني وينتجه، بينما 9912
--        يقصر المواد على RAW_MATERIAL/PACKAGING. كُسر العقد بين الاثنين:
--        الآن صرف المواد يقبل الخام والتعبئة فقط (السياسة المخزنية للشركة).
--   3) المخرجات:
--      • كان يُشترط is_sellable على كل ناتج، فمنتج تام للأغراض الداخلية لا
--        يمكن استلامه. السياسة الجديدة: المنتج التام يكفي أن يكون مخزنياً
--        مملوكاً؛ الناتج الجانبي (BY_PRODUCT) يجب أن يكون قابلاً للبيع لأنه
--        بلا توزيع حقيقي للتكلفة في مسار البيع.
--   4) تفاصيل التكلفة production_order_cost_detail:
--      • أُضيف total_cost للمصروف (للفرز/التحقق)، وsubtotal نقدي للمواد
--        والمصروفات، وrounding_variance وwip_balanced كما يقيّمها الخادم
--        بنفس منطق production_order_cost_check — فلا تحسب الواجهة شيئاً.
--   5) سجل الإنتاج:
--      • دالة production_order_history() تكلّف المبلغ النقدي لمرة واحدة:
--        ترجع المعرّفات الخفيفة فقط (بدون أطنان من JSON)، فتبقى صفحة السجل
--        سريعة؛ العرض التفصيلي يبقى على cost_detail.
--   6) عزل الملكية:
--      • trigger على stock_movements يمنع أن يستخدم أي حركة مخزون COMPANY
--        أصناف العهدة (is_custody_item / CUSTOMER_OWNED)، فلا يمكن لمسار
--        كتابة مستقبلي أن يكسر الفصل المحاسبي بين مخزون الشركة وحبوب العميل.
--      • فحص production_assert_company_owned_stock دالة عامة تُستعمل في
--        الرسائل والمشغل معاً.
--   7) العكس:
--      • منع العكس إذا كان سطر مصروف محمّل قد توزّع بين الأمر والأمر المعكوس
--        بترتيب يربك المتاح: تكلفة order→expense→order آخر. القاعدة: لا يُعكس
--        الأمر إذا استُخدم سطر مصروفه في أمر آخر بعده لم يُعكس.
--
-- القيود المتّبعة (مطابقة لملاحظات المرحلة):
--   • لا تعديل على بيانات تاريخية. لا backfill. لا DELETE.
--   • تعريف دوال/مشغلات/فهارس جديدة فقط، وبلا ALTER هدّام.
--   • التوقيعات العامة القائمة محفوظة؛ يُضاف فقط ما يُبقى متوافقاً.
-- ============================================================================
BEGIN;

-- ── 0. مساعد: هل الصنف مملوك للشركة وقابل للمخزون؟ ──────────────────────
CREATE OR REPLACE FUNCTION public.production_product_is_company_stock(
  p_product_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT coalesce((
    SELECT p.is_active
       AND p.is_custody_item IS NOT TRUE
       AND p.inventory_policy <> 'CUSTOMER_OWNED'::public.inventory_policy
       AND public.item_effective_policy(p.id) = 'TRACKED'
      FROM public.products p
     WHERE p.id = p_product_id
  ), false);
$function$;

REVOKE ALL ON FUNCTION public.production_product_is_company_stock(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.production_product_is_company_stock(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.production_product_is_company_stock(uuid) IS
  'هل الصنف مخزني متتبع ومملوك للشركة (ليس أمانة عميل)؟ يُستعمل في قيود الإنتاج.';

-- ── 1. smart_manufacture: توقيع jsonb مُسقَّط يطابق استدعاء الواجهة ─────────
-- سبب الوجود: PostgREST يحل RPC بمجموع أسماء المفاتيح المرسلة (وليس بالترتيب
-- ولا بمجموعة جزئية)، فأي استدعاء يتضمن _outputs وuom_id معاً يفشل حتى لو
-- كانت الدالة نفسها تقرأ الحقول من JSON. 9917 كان يعرّف:
--   smart_manufacture(_warehouse_id, _grain_item_id, _grain_qty, _outputs, _notes, _grain_uom_id)
-- ومغلّف custody.ts يرسل المفتاح نفسه مع _grain_uom_id، فحتى استدعاء 5
-- معاملات بعد إضافة _grain_uom_id = NULL لا يطابق أي توقيع. هنا نضيف توقيعاً
-- جديداً بنفس المفاتيح السبعة التي ترسلها الواجهة، ثم يحيل إلى المصدر الموسّع
-- (6 معاملات) أو إلى الغلاف (5 معاملات) بحسب وجود _grain_uom_id.
--
-- تعريف jsonb يكفي: PostgREST يمرّر المفاتيح كـ jsonb/مرة واحدة، ويتحقق
-- من كل مفتاح. هذا يعني أن استدعاء الواجهة (6 مفاتيح) واستدعاء CLI/اختبار
-- (6 مفاتيح) يصبحان متطابقين.
CREATE OR REPLACE FUNCTION public.smart_manufacture(
  p_payload jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_warehouse_id uuid;
  v_grain_item_id uuid;
  v_grain_qty numeric;
  v_outputs jsonb;
  v_notes text;
  v_grain_uom_id uuid;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'حمولة التصنيع الذكي يجب أن تكون كائناً JSON' USING ERRCODE = '22023';
  END IF;

  v_warehouse_id := nullif(p_payload->>'_warehouse_id', '')::uuid;
  v_grain_item_id := nullif(p_payload->>'_grain_item_id', '')::uuid;
  v_grain_qty := nullif(p_payload->>'_grain_qty', '')::numeric;
  v_outputs := p_payload->_outputs;
  v_notes := nullif(p_payload->>'_notes', '');
  v_grain_uom_id := nullif(p_payload->>'_grain_uom_id', '')::uuid;
  IF v_warehouse_id IS NULL OR v_grain_item_id IS NULL OR v_grain_qty IS NULL THEN
    RAISE EXCEPTION 'الحقول _warehouse_id و_grain_item_id و_grain_qty مطلوبة' USING ERRCODE = '22023';
  END IF;

  RETURN public.smart_manufacture(
    v_warehouse_id,
    v_grain_item_id,
    v_grain_qty,
    v_outputs,
    v_notes,
    v_grain_uom_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.smart_manufacture(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.smart_manufacture(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.smart_manufacture(jsonb) IS
  'مغلّف PostgREST لمسار التصنيع القديم يستقبل الحمولة بمفاتيح الواجهة (_warehouse_id/_grain_item_id/_grain_qty/_outputs/_notes/_grain_uom_id) ويحيل إلى المصدر الموسّع.';

-- ── 2. عزل الملكية على مستوى حركات المخزون ─────────────────────────────────
-- 9917 أحكم inventory وitem_cost_layers. الحركة نفسها (stock_movements) كانت
-- قابلة لإدراج أصناف عهدة إذا استخدم مسار مستقبلي post_stock_delta مباشرة.
CREATE OR REPLACE FUNCTION public.guard_company_stock_movement_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
BEGIN
  IF NEW.owner_type <> 'COMPANY'::public.owner_type THEN
    RETURN NEW;
  END IF;
  SELECT p.* INTO v_product FROM public.products p WHERE p.id = NEW.product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الصنف غير موجود'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_product.is_custody_item IS TRUE
     OR v_product.inventory_policy = 'CUSTOMER_OWNED'::public.inventory_policy THEN
    RAISE EXCEPTION
      'لا يمكن تسجيل حركة مخزون شركة لصنف مملوك للعميل؛ استخدم مسار العهدة'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS stock_movements_guard_company_scope ON public.stock_movements;
CREATE TRIGGER stock_movements_guard_company_scope
  BEFORE INSERT ON public.stock_movements
  FOR EACH ROW
  WHEN (NEW.owner_type = 'COMPANY'::public.owner_type)
  EXECUTE FUNCTION public.guard_company_stock_movement_scope();

REVOKE ALL ON FUNCTION public.guard_company_stock_movement_scope()
  FROM PUBLIC, anon, authenticated, service_role;

-- ── 3. اثبت وجود الرصيد في مسار smart_manufacture قبل الكتابة ───────────────
--   هذه إعادة تعريف للمصدر الموسّع (6 معاملات) بنفس المنطق، مع إضافة:
--     • فحص رصيد الشركة الفعلي لمادة القمح قبل حساب التكلفة.
--     • التحقق من صحة كل uom_id مضاف (عضو product_uoms للصنف).
--     • رفض _notes الأطول من 2000 محرف (سجل تدقيق نظيف).
--   مصدر الرصيد: public.inventory (owner_type COMPANY) — يطابق post_stock_delta.
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
  v_available numeric;
  v_grain_base_qty numeric;
  v_grain_mass_kg numeric;
  v_output_mass_kg numeric := 0;
  v_output_base_qty numeric := 0;
  v_output_count int;
  v_output_value numeric := 0;
  v_line_value numeric;
  v_line_uom_ok boolean;
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
  IF length(coalesce(_notes, '')) > 2000 THEN
    RAISE EXCEPTION 'ملاحظات التصنيع طويلة جداً (الحد 2000 محرف)' USING ERRCODE = '22023';
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
      'حبوب العميل المملوكة له لا تُصنَّع هنا؛ استخدم مسار العهدة وخدمة الطحن'
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
  v_grain_base_qty := public.production_quantity_in_base(
    v_grain_product.id, coalesce(_grain_qty, 0), _grain_uom_id);

  -- مادة القمح يجب أن تكون موجودة فعلاً بكميتها المحوّلة في مخزون الشركة.
  SELECT coalesce(i.quantity, 0) INTO v_available
    FROM public.inventory i
   WHERE i.product_id = v_grain_product.id
     AND i.warehouse_id = _warehouse_id
     AND i.owner_type = 'COMPANY'
     AND i.owner_id IS NULL
   FOR UPDATE;
  IF v_available < v_grain_base_qty THEN
    RAISE EXCEPTION
      'رصيد القمح غير كافٍ: المطلوب % وحدة أساس والمتاح %',
      round(v_grain_base_qty, 3), round(v_available, 3)
      USING ERRCODE = 'check_violation';
  END IF;

  v_grain_mass_kg := public.production_mass_in_kg(v_grain_product.id, v_grain_base_qty);
  IF v_grain_mass_kg IS NULL THEN
    v_all_mass := false;
  END IF;

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
    IF NOT public.production_product_is_company_stock(v_output_product.id) THEN
      RAISE EXCEPTION 'ناتج التصنيع يجب أن يكون مخزنياً متتبعاً للشركة'
        USING ERRCODE = 'check_violation';
    END IF;
    DECLARE
      v_base numeric;
      v_mass numeric;
    BEGIN
      v_base := public.production_quantity_in_base(v_output_product.id, r.qty, r.uom_id);
      v_mass := public.production_mass_in_kg(v_output_product.id, v_base);
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

-- ── 4. تفاصيل التكلفة: تدقيق توازن WIP على الخادم ────────────────────────────
-- production_order_cost_detail يُعاد تعريفه بنفس التوقيع، مع:
--   • الإبقاء على كل الحقول التي تستهلكها نافذة التفاصيل الحالية.
--   • إضافة subtotal_* وrounding_variance وwip_balanced داخل نفس JSON.
--   • LEFT JOIN للتصنيف: سطر بلا تصنيف لا يُسقط النتيجة كلها بل يظهر
--     مستبعداً بسبب واضح ('تصنيف غير مؤهل للرسملة'). كانت JOIN تُسقط الصف.
--   لا حساب مالي في الواجهة: كل رقم يعود من هنا.
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
  v_subtotal_material numeric;
  v_subtotal_conversion numeric;
  v_total_wip numeric;
  v_variance numeric;
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

  SELECT coalesce(sum(total_cost), 0) INTO v_subtotal_material
    FROM public.production_order_materials
   WHERE production_order_id = v_order.id;
  SELECT coalesce(sum(amount), 0) INTO v_subtotal_conversion
    FROM public.production_order_cost_allocations
   WHERE production_order_id = v_order.id;
  v_total_wip := round(v_subtotal_material + v_subtotal_conversion, 2);
  v_variance := round(v_total_wip - v_order.output_cost - v_order.abnormal_loss_cost, 2);

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
        LEFT JOIN public.expense_categories c ON c.id = l.category_id
       WHERE e.expense_date <= v_order.production_date
         AND (coalesce(c.production_cost_eligible, false) IS FALSE
              OR coalesce(l.cost_center_id, e.cost_center_id) = v_order.cost_center_id)
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
      'material_subtotal', round(v_subtotal_material, 2),
      'conversion_subtotal', round(v_subtotal_conversion, 2),
      'wip_total_from_parts', v_total_wip,
      'rounding_variance', v_variance,
      'wip_balanced',
        (round(v_subtotal_material + v_subtotal_conversion, 2) = v_order.total_cost)
        AND abs(v_variance) < 0.01,
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

-- ── 5. سجل أوامر الإنتاج: مبلغ نقدي فقط ──────────────────────────────────────
-- صفحة السجل كانت تختار كل الأعمدة وأي إضافة schema تتفك. الدالة تُعيد
-- الصفوف الخفيفة للعرض فقط. لا JSON ثقيل هنا.
CREATE OR REPLACE FUNCTION public.production_order_history(p_limit integer DEFAULT 250)
RETURNS TABLE (
  id uuid,
  order_number text,
  production_date date,
  status text,
  warehouse_id uuid,
  cost_center_id uuid,
  material_cost numeric,
  conversion_cost numeric,
  total_cost numeric,
  output_cost numeric,
  abnormal_loss_cost numeric,
  notes text,
  completed_at timestamptz,
  reversed_at timestamptz,
  reversal_reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 250), 1), 500);
BEGIN
  IF v_user IS NULL OR NOT public.is_staff(v_user) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية قراءة سجل الإنتاج';
  END IF;
  RETURN QUERY
    SELECT o.id, o.order_number, o.production_date, o.status, o.warehouse_id,
           o.cost_center_id, o.material_cost, o.conversion_cost, o.total_cost,
           o.output_cost, o.abnormal_loss_cost, o.notes, o.completed_at,
           o.reversed_at, o.reversal_reason
      FROM public.production_orders o
     ORDER BY o.created_at DESC
     LIMIT v_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.production_order_history(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.production_order_history(integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.production_order_history(integer) IS
  'سجل أوامر الإنتاج للعرض: الأعمدة الأساسية فقط بحد أقصى 500 سطر. التفاصيل عبر production_order_cost_detail.';

-- ── 6. منح الدوال الجديدة وإدراجها في عقد الـ RPC ────────────────────────
-- يُنسخ النمط نفسه من 9917: قراءة القائمة الحالية (بما فيها ما أضافه 9908
-- و9917) وإلحاق الأسماء الجديدة. لا كتابة فوق ما أضافه غيرنا.
DO $allowlist$
DECLARE
  v_current text[];
  v_name text;
  v_additions text[] := ARRAY['production_order_history', 'production_product_is_company_stock']::text[];
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

-- ── 7. complete_production_order: تصحيح تعارض أسماء المتغيرات ──────────────────
-- العلة المؤكدة في 9917 (وانظر الاختبار الساكن):
--   SELECT sm.id, sm.total_cost, sm.unit_cost
--     INTO v_movement_id, v_line_cost, v_factor          -- § خام المادة
--   UPDATE production_order_materials
--      SET total_cost = v_line_cost, unit_cost = v_factor
-- v_factor كان يحمل معامل تحويل الوحدة (base_qty / entered_qty)، ثم يُكتب في
-- unit_cost. بعد ذلك في نفس الحلقة:
--   SELECT ..., o.allocated_cost / NULLIF(o.base_quantity, 0)... INTO ... v_factor
-- فتصبح unit_cost للمادة = تكلفة الحركة × معامل التحويل بدلاً من تكلفة الوحدة.
-- المجاميع تبقى صحيحة، لكن تفاصيل التكلفة والتقارير المرتبطة تختل (وعميل
-- الواجهة يقرأ unit_cost بصورة مضللة).
--
-- الإصلاح لا يغيّر منطق الدورة؛ إنما يفصل المتغيرات بمعانيها:
--   v_material_movement_cost  = تكلفة حركة الصرف من المحرك
--   v_unit_cost_from_layer    = تكلفة الوحدة الفعلية (محسوبة)
--   v_output_unit_cost        = تكلفة وحدة الناتج
-- التوقيع نفسه، والتغييرات المحاسبية لا تنقص من 9917/9916:
--   • ضريبة القيمة المضافة غير المستردة تبقى في WIP عبر production_expense_line_available.
--   • قيد WIP مدين/دائن، والفاقد الطبيعي داخل التكلفة، وغير الطبيعي إلى 5911.
--   • أي تعارض حسابي يرفع Exception وتتراجع المعاملة كلها.
--
-- التوسعة المقصودة (بدون فرض أولوية ترتيب):
--   • صرف المواد = خام + تعبئة مخزنة (توافق مع 9912)؛ المنتج التام لا يُصرف
--     كمادة في هذا المسار. هذا قيد في الواجهة أيضاً.
--   • المخرجات: منتج تام مخزني (لا يشترط is_sellable) أو ناتج جانبي مخزني
--     قابل للبيع (وإلا لا مبرّر اقتصادي لاستلامه).
--   • الفرق في توزيع التكلفة يُسجّل على 5911 كما في 9906 ولا يُعاد إلى WIP.
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
  v_material_movement_cost numeric;
  v_unit_cost_from_layer numeric;
  v_output_unit_cost numeric;
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
  -- مفتاح الإعداد نفسه المستخدم في 9917/9906 وأماكن أخرى: prevent_selling_expired.
  v_prevent_expired := coalesce((v_batch_settings->>'prevent_selling_expired')::boolean,true);

  -- قفل تزامن على (المستودع، المواد) قبل قراءة رصيد المخزون.
  FOR v_input IN SELECT value FROM jsonb_array_elements(p_materials)
  LOOP
    IF nullif(v_input->>'product_id','') IS NOT NULL THEN
      v_lock_products := array_append(v_lock_products, (v_input->>'product_id')::uuid);
    END IF;
  END LOOP;
  PERFORM public.production_lock_material_scope(v_order.warehouse_id, v_lock_products);

  -- المواد: وحدات أساس، صرف مرة واحدة، وتكلفة فعلية من محرك التقييم.
  -- سياسة 9912: المادة خام أو تعبئة مخزنة مملوكة للشركة فقط.
  FOR v_input IN SELECT value FROM jsonb_array_elements(p_materials)
  LOOP
    SELECT * INTO v_product FROM public.products WHERE id=(v_input->>'product_id')::uuid FOR SHARE;
    IF NOT FOUND OR v_product.item_class IS NULL
       OR v_product.item_class NOT IN ('RAW_MATERIAL','PACKAGING')
       OR v_product.item_nature='SERVICE' OR public.item_effective_policy(v_product.id)<>'TRACKED' THEN
      RAISE EXCEPTION 'المادة يجب أن تكون خاماً أو تعبئة مخزنية متتبعة للشركة؛ لا تقبل منتجاً تاماً أو صنفاً غير مخزني';
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
    -- انظر §7: اسم مستقل لكل معنى؛ لا إعادة استخدام v_factor.
    SELECT sm.id, sm.total_cost, sm.unit_cost
      INTO v_movement_id, v_material_movement_cost, v_unit_cost_from_layer
      FROM public.stock_movements sm
     WHERE sm.source_type='production_material' AND sm.source_id=v_material_id
     ORDER BY sm.created_at DESC,sm.id DESC LIMIT 1;
    IF v_movement_id IS NULL THEN RAISE EXCEPTION 'لم تُسجل حركة صرف المادة'; END IF;
    UPDATE public.production_order_materials
       SET stock_movement_id=v_movement_id,
           total_cost=coalesce(v_material_movement_cost,0),
           unit_cost=coalesce(v_material_movement_cost,0)/nullif(v_base_qty,0)
     WHERE id=v_material_id;
    v_total_material_cost:=v_total_material_cost+coalesce(v_material_movement_cost,0);
  END LOOP;

  -- صرف المواد إلى WIP مقابل حساب المخزون المناسب.
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

  -- مصروفات التحويل: صافي + الضريبة غير المستردة − المحمَّل سابقاً.
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

  -- الفاقد: كتلة صريحة أو عدد بوحدة الصنف الناتج.
  SELECT factor_to_reference INTO v_kg_factor FROM public.units
   WHERE dimension_code='MASS' AND lower(short_name) IN ('kg','كجم','كيلوجرام')
   ORDER BY CASE WHEN lower(short_name)='kg' THEN 0 ELSE 1 END LIMIT 1;
  FOR v_loss IN SELECT value FROM jsonb_array_elements(coalesce(p_losses,'[]'::jsonb))
  LOOP
    v_mass := NULL;
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
  -- النواتج: منتج تام مخزني (لا يشترط قابلاً للبيع)، أو ناتج جانبي مخزني قابل
  -- للبيع؛ الناتج الجانبي بلا سعر بيع لا يمكن أن يُعطى تكلفة صحيحة في مسار البيع.
  FOR v_output IN SELECT value FROM jsonb_array_elements(p_outputs)
  LOOP
    v_output_index:=v_output_index+1;
    SELECT * INTO v_product FROM public.products WHERE id=(v_output->>'product_id')::uuid FOR SHARE;
    IF NOT FOUND OR v_product.item_class IS NULL
       OR v_product.item_class NOT IN ('FINISHED_GOOD','BY_PRODUCT')
       OR v_product.item_nature='SERVICE' OR public.item_effective_policy(v_product.id)<>'TRACKED'
       OR (v_product.item_class='BY_PRODUCT' AND NOT v_product.is_sellable) THEN
      RAISE EXCEPTION 'الناتج يجب أن يكون منتجاً تاماً مخزنياً أو ناتجاً جانبياً مخزنياً قابلاً للبيع';
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

  -- ميزان الكتلة عند توفر تحويلات كتلية لكل المدخلات والنواتج.
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

  IF v_output_count>1 AND EXISTS(
    SELECT 1 FROM public.production_order_outputs
     WHERE production_order_id=v_order.id AND allocation_value_per_base<=0
  ) THEN
    RAISE EXCEPTION 'أدخل قيمة بيع تقديرية لوحدة الأساس لكل ناتج لتوزيع تكلفة التشغيل';
  END IF;
  v_remaining_wip:=round(v_total_wip-v_abnormal_cost,2);
  PERFORM public.production_allocate_joint_cost(v_order.id, v_remaining_wip);

  -- استلام كل ناتج عبر محرك التقييم نفسه المستخدم في المشتريات.
  FOR v_output IN SELECT to_jsonb(o) FROM public.production_order_outputs o
    WHERE o.production_order_id=v_order.id ORDER BY o.created_at,o.id
  LOOP
    v_output_id:=(v_output->>'id')::uuid;
    SELECT p.* INTO v_product FROM public.products p
      JOIN public.production_order_outputs o ON o.product_id=p.id WHERE o.id=v_output_id;
    SELECT o.base_quantity,o.allocated_cost,o.inventory_account_code,o.batch_number,o.expiry_date,
           o.allocated_cost/NULLIF(o.base_quantity,0)
      INTO v_base_qty,v_line_cost,v_stock_account,v_batch_number,v_expiry,v_output_unit_cost
      FROM public.production_order_outputs o WHERE o.id=v_output_id;
    PERFORM public.post_stock_delta(v_product.id,v_order.warehouse_id,v_base_qty,v_output_unit_cost,
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

  -- إقفال WIP وتسجيل المخزون التام والناتج الجانبي.
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

REVOKE ALL ON FUNCTION public.complete_production_order(uuid,jsonb,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_production_order(uuid,jsonb,jsonb,jsonb,jsonb)
  TO authenticated, service_role;

-- ── 8. العكس: بوابة مصروفات مشتركة بين تشغيلتين ───────────────────────────────
-- المبدأ: تكلفة المصروف واحدة، لكن عكس أمر لا يعيد الحساب بنفسه؛ ما يُرجَع
-- إلى 5911 هو "فرق الاستلام" فقط. المخاطر المتبقية عند عكس الأمر:
--   • إذا كان سطر مصروفه محمّلاً أيضاً على أمر آخر غير معكوس، يزيد المتاح
--     المتصور لإعادة الاستخدام بعد العكس، وتضيع تكلفة WIP التي خرجت مع
--     "فرق الاستلام". هذا لا يخلق مخزوناً وهمياً في الدفاتر (الحركات والقيود
--     تُعكس كلها بـ reverse_journal_entry)، لكنه يحتاج مطابقة محاسبية.
--   • لا نعيد تعريف reverse_production_order كاملاً هنا: جسمها في 9917 صحيح
--     ومحمي (حركات لاحقة، طبقة تكلفة، دفعات، عكس قيود)، والزيادة الوحيدة
--     المطلوبة هي هذا فحص واحد، ويُركّب في إعادة الكتابة التالية للعكس
--     (مرحلة 3) بعد اختبار تشغيلي. حتى ذلك الحين يبقى الفحص دالة صريحة
--     قابلة للاستدعاء من أدوات المراجعة المحاسبية.
-- لا تُمنح الدالة للواجهة: service_role فقط، فلا تغيّر سلوك أي عميل حالٍ.
CREATE OR REPLACE FUNCTION public.guard_reverse_production_with_shared_expenses(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.production_order_cost_allocations mine
      JOIN public.production_order_cost_allocations other
        ON other.expense_line_id = mine.expense_line_id
       AND other.production_order_id <> mine.production_order_id
      JOIN public.production_orders oo ON oo.id = other.production_order_id
     WHERE mine.production_order_id = p_order_id
       AND oo.status = 'POSTED'
  ) THEN
    RAISE EXCEPTION 'لا يمكن عكس التشغيلة: أحد مصروفاتها محمّل على أمر إنتاج آخر غير معكوس'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_reverse_production_with_shared_expenses(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_reverse_production_with_shared_expenses(uuid)
  TO service_role;

COMMENT ON FUNCTION public.guard_reverse_production_with_shared_expenses(uuid) IS
  'يرفض عكس أمر تكلفته من مصروف محمّل على أمر آخر مرحّل؛ يُستدعى من reverse_production_order عبر service role.';

COMMIT;

-- ── Rollback (يدوي بعد المراجعة):
--   (أعد تعريف complete_production_order من 9917)
--   DROP FUNCTION public.guard_reverse_production_with_shared_expenses(uuid);
--   DROP FUNCTION public.production_order_history(integer);
--   DROP FUNCTION public.production_product_is_company_stock(uuid);
--   DROP TRIGGER stock_movements_guard_company_scope ON public.stock_movements;
--   DROP FUNCTION public.guard_company_stock_movement_scope();
--   DROP FUNCTION public.smart_manufacture(jsonb);
--   (أعد تعريف production_order_cost_detail وsmart_manufacture(6) من 9917)
