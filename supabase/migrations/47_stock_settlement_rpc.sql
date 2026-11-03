-- ============================================================================
-- 47_stock_settlement_rpc.sql
--
-- إغلاق آخر مسار يكتب المخزون من المتصفح مباشرة.
--
-- المشكلة:
--   src/components/stock/settlement-wizard-sheet.tsx كانت تفعل:
--     supabase.from("inventory").upsert({ quantity: actual }, ...)
--     supabase.from("stock_movements").insert({ movement_type: "adjustment", ... })
--   بعد 43 (tg_stock_movements_engine_only) الكتابة المباشرة على الحركات
--   مرفوضة، ومعها:
--     • القيمة لا تُقيَّد: صف inventory يُكتب بكمية جديدة بلا apply_cost_movement،
--       فتنفصل الكمية عن التكلفة ويختل تقييم المخزون بصمت.
--     • الحركة لا تحمل movement_kind ولا source، فلا يمكن ربطها بمستند ولا
--       معرفة من اعتمدها وبأي سبب.
--     • التحديثان منفصلان (inventory ثم stock_movements) وليسا معاملة واحدة:
--       انقطاع الشبكة في المنتصف يترك كمية جديدة وحركة مفقودة.
--
-- الحل: دالة واحدة SECURITY DEFINER تعتمد التسوية كاملة في معاملة واحدة،
-- وتستخدم **نفس المحرك** post_stock_delta (كمية + قيمة)، وتوثّق مستندًا في
-- stock_adjustments / stock_adjustment_items (جدولان موجودان ولا يكتب فيهما
-- أحد)، وسجل تدقيق.
--
-- الأمان:
--   • المستدعي موظف نشط + مالك أو مدير (التسوية تعدّل رصيدًا محاسبيًا).
--   • السبب إلزامي، والفرق لا يكون صفرًا (تسوية بلا أثر ليست مستندًا).
--   • لا حذف ولا تعديل لحركة سابقة: التصحيح بحركة لاحقة كما في الدفاتر.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.post_stock_settlement(
  p_warehouse_id uuid,
  p_reason       text,
  p_note         text,
  p_lines        jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user  uuid := auth.uid();
  v_doc   uuid;
  v_no    text;
  v_line  record;
  v_before numeric;
  v_diff  numeric;
  v_unit_cost numeric;
  v_total_value numeric := 0;
  v_lines_posted integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(v_user, 'owner') OR public.has_role(v_user, 'manager')) THEN
    RAISE EXCEPTION 'Only an owner or manager may post a stock settlement'
      USING ERRCODE = '42501';
  END IF;

  IF p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.warehouses w WHERE w.id = p_warehouse_id AND w.is_active) THEN
    RAISE EXCEPTION 'Selected warehouse is unavailable';
  END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A settlement reason is required';
  END IF;
  IF coalesce(jsonb_typeof(p_lines), '') <> 'array' OR coalesce(jsonb_array_length(p_lines), 0) = 0 THEN
    RAISE EXCEPTION 'A settlement needs at least one line';
  END IF;

  v_no := public.next_stock_adjustment_number();

  INSERT INTO public.stock_adjustments
    (document_number, warehouse_id, effective_date, reason, note, total_value, created_by)
  VALUES
    (v_no, p_warehouse_id, CURRENT_DATE, btrim(p_reason),
     nullif(btrim(p_note), ''), 0, v_user)
  RETURNING id INTO v_doc;

  FOR v_line IN
    SELECT (l ->> 'product_id')::uuid AS product_id,
           (l ->> 'actual_qty')::numeric AS actual_qty
      FROM jsonb_array_elements(p_lines) AS l
  LOOP
    IF v_line.product_id IS NULL OR v_line.actual_qty IS NULL OR v_line.actual_qty < 0 THEN
      RAISE EXCEPTION 'Every settlement line needs an item and a non-negative actual quantity';
    END IF;

    SELECT coalesce(i.quantity, 0) INTO v_before
      FROM public.inventory i
     WHERE i.product_id = v_line.product_id
       AND i.warehouse_id = p_warehouse_id
       AND i.owner_type = 'COMPANY'
       AND i.owner_id IS NULL;

    v_before := coalesce(v_before, 0);
    v_diff   := round(v_line.actual_qty - v_before, 3);

    -- صفر فرق = لا حركة ولا سطر مستند.
    IF v_diff = 0 THEN
      CONTINUE;
    END IF;

    v_unit_cost := coalesce(
      public.resolve_unit_cost(v_line.product_id, p_warehouse_id),
      (SELECT p.cost_price FROM public.products p WHERE p.id = v_line.product_id),
      0
    );
    v_total_value := v_total_value + round(v_diff * v_unit_cost, 2);
    v_lines_posted := v_lines_posted + 1;

    PERFORM public.post_stock_delta(
      p_product_id           => v_line.product_id,
      p_warehouse_id         => p_warehouse_id,
      p_signed_qty           => v_diff,
      -- زيادة: بقيمة الوحدة المعروفة. نقص: يقيّمه المحرّك بمتوسط الطبقة.
      p_unit_cost            => CASE WHEN v_diff > 0 THEN v_unit_cost ELSE NULL END,
      p_movement_kind        => 'ADJUSTMENT'::public.stock_movement_kind,
      p_source_type          => 'stock_adjustment',
      p_source_id            => v_doc,
      p_note                 => 'تسوية جردية ' || v_no || ' — ' || btrim(p_reason)
                                || coalesce(' — ' || nullif(btrim(p_note), ''), ''),
      p_owner_type           => 'COMPANY'::public.owner_type,
      p_owner_id             => NULL,
      p_movement_type_legacy => 'adjustment'::public.movement_type
    );

    INSERT INTO public.stock_adjustment_items
      (adjustment_id, product_id, quantity, unit_cost, total_cost, note)
    VALUES
      (v_doc, v_line.product_id, v_diff, v_unit_cost,
       round(v_diff * v_unit_cost, 2),
       format('%s → %s', v_before, v_line.actual_qty));
  END LOOP;

  IF v_lines_posted = 0 THEN
    RAISE EXCEPTION 'No differences to post - every counted quantity matches the book balance';
  END IF;

  UPDATE public.stock_adjustments
     SET total_value = round(v_total_value, 2)
   WHERE id = v_doc;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'stock.settlement.posted', 'stock_adjustment', v_doc,
    jsonb_build_object(
      'document_number', v_no,
      'warehouse_id', p_warehouse_id,
      'reason', btrim(p_reason),
      'lines', v_lines_posted,
      'value_delta', round(v_total_value, 2)
    ));

  RETURN v_doc;
END $function$;

COMMENT ON FUNCTION public.post_stock_settlement(uuid, text, text, jsonb) IS
  'T-47: اعتماد تسوية جردية — مستند + حركات عبر المحرّك (كمية وقيمة) في معاملة واحدة. تستبدل الكتابة المباشرة على inventory/stock_movements من الواجهة.';

REVOKE ALL ON FUNCTION public.post_stock_settlement(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_stock_settlement(uuid, text, text, jsonb) TO authenticated, service_role;

-- عقد RPC: 45 تملك rpc_allowlist(). لا نعيد تعريفها هنا (نسخة ثانية تجمّد
-- القائمة)، بل نتحقق أنها تحتوي الاسم إن كانت 45 مطبقة.
DO $$
BEGIN
  IF to_regprocedure('public.rpc_allowlist()') IS NOT NULL
     AND NOT ('post_stock_settlement' = ANY (public.rpc_allowlist())) THEN
    RAISE EXCEPTION 'post_stock_settlement غير مدرجة في rpc_allowlist() — الواجهة ستحصل على 401'
      USING HINT = 'أضف الاسم في migration 45 (rpc_allowlist) في نفس الهجرة التي تنشئ الدالة';
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- التحقق:
--   SELECT has_function_privilege('authenticated',
--            'public.post_stock_settlement(uuid,text,text,jsonb)', 'EXECUTE');
--
--   -- بعد اعتماد تسوية من الشاشة:
--   SELECT quantity FROM public.inventory
--    WHERE product_id = ... AND warehouse_id = ... AND owner_type = 'COMPANY';
--   SELECT quantity, total_cost, movement_type, adjustment_reason
--     FROM public.stock_movements WHERE source_type = 'stock_adjustment';
--
-- ROLLBACK: DROP FUNCTION public.post_stock_settlement(uuid, text, text, jsonb);
--           (المستندات المُنشأة تُعكس بحركة لاحقة، لا تُمسح.)
-- ============================================================================
