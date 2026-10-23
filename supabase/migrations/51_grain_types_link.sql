-- ═══════════════════
-- E6 / M5 — ربط عملية الطحن بنوع الحبة المرجعي (grain_types)
--
-- يضيف توقيعاً جديداً (overload) لدالة custody_milling بمعامل
-- _grain_type_id اختياري — التوقيع القديم (7 معاملات) يبقى صالحاً
-- فلا ينكسر أي مستدعٍ قائم.
--
-- سلوك المعامل الجديد:
--   • NULL  → سلوك مطابق تماماً للتوقيع القديم.
--   • معطى  → يتحقق أن النوع نشط، ويوثّق النوع في سجل التدقيق
--             (سلسلة تتبع: العملية ← نوع الحبة ← الفاقد الافتراضي).
-- ═══════════════════════════════════

CREATE OR REPLACE FUNCTION public.custody_milling(
  _customer_id uuid,
  _warehouse_id uuid,
  _grain_item_id uuid,
  _bags_out numeric,
  _kg_out numeric,
  _outputs jsonb,
  _notes text,
  _grain_type_id uuid DEFAULT NULL
)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_doc text;
  v_balance_bags numeric;
  v_balance_kg numeric;
  v_total_out_bags numeric := 0;
  v_total_out_kg numeric := 0;
  v_grain_type_name text := NULL;
  v_grain_type_loss numeric := NULL;
  r record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to record custody milling';
  END IF;
  IF _customer_id IS NULL OR _warehouse_id IS NULL OR _grain_item_id IS NULL THEN
    RAISE EXCEPTION 'Customer, warehouse and grain item are required';
  END IF;
  IF coalesce(_bags_out, 0) <= 0 AND coalesce(_kg_out, 0) <= 0 THEN
    RAISE EXCEPTION 'Milling must consume at least one bag or a positive weight of grain';
  END IF;
  IF _outputs IS NULL OR jsonb_typeof(_outputs) <> 'array' OR jsonb_array_length(_outputs) = 0 THEN
    RAISE EXCEPTION 'At least one output line is required';
  END IF;

  -- نوع الحبة المرجعي: يجب أن يكون نشطاً إن مُرِّر.
  IF _grain_type_id IS NOT NULL THEN
    SELECT gt.name_ar, gt.default_loss_rate_pct
      INTO v_grain_type_name, v_grain_type_loss
      FROM public.grain_types gt
     WHERE gt.id = _grain_type_id AND gt.is_active;
    IF v_grain_type_name IS NULL THEN
      RAISE EXCEPTION 'Grain type is not active or does not exist';
    END IF;
  END IF;

  -- صنف الحبوب خام، وأصناف النواتج منتجات/نواتج جانبية — من القاعدة.
  IF NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = _grain_item_id AND item_class = 'RAW_MATERIAL' AND is_active
  ) THEN
    RAISE EXCEPTION 'Milling input must be an active RAW_MATERIAL grain';
  END IF;

  SELECT * FROM public.custody_balance(_customer_id, _warehouse_id, _grain_item_id)
    INTO v_balance_bags, v_balance_kg;

  IF coalesce(_bags_out, 0) > v_balance_bags THEN
    RAISE EXCEPTION 'Grain bags balance (%) is less than the requested milling amount (%)',
      v_balance_bags, coalesce(_bags_out, 0);
  END IF;
  IF coalesce(_kg_out, 0) > v_balance_kg THEN
    RAISE EXCEPTION 'Grain kg balance (%) is less than the requested milling amount (%)',
      v_balance_kg, coalesce(_kg_out, 0);
  END IF;

  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs)
             AS o(item_id uuid, bags numeric, kg numeric)
  LOOP
    IF r.item_id IS NULL THEN
      RAISE EXCEPTION 'Every output line needs an item';
    END IF;
    IF coalesce(r.bags, 0) <= 0 AND coalesce(r.kg, 0) <= 0 THEN
      RAISE EXCEPTION 'Every output line needs bags or a positive weight';
    END IF;
    IF coalesce(r.bags, 0) < 0 OR coalesce(r.kg, 0) < 0 THEN
      RAISE EXCEPTION 'Output quantities cannot be negative';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.products
      WHERE id = r.item_id AND item_class IN ('FINISHED_GOOD', 'BY_PRODUCT') AND is_active
    ) THEN
      RAISE EXCEPTION 'Milling outputs must be FINISHED_GOOD or BY_PRODUCT items';
    END IF;
    v_total_out_bags := v_total_out_bags + coalesce(r.bags, 0);
    v_total_out_kg   := v_total_out_kg + coalesce(r.kg, 0);
  END LOOP;

  v_doc := 'CM-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.milling_service_seq')::text, 4, '0');

  -- صادر الحبوب — يوثّق نوع الحبة المرجعي في الملاحظات إن مُرِّر
  INSERT INTO public.custody_ledger
    (customer_id, warehouse_id, entry_type, item_id, doc_number,
     bags_out, kg_out, notes, created_by)
  VALUES
    (_customer_id, _warehouse_id, 'MILLING', _grain_item_id, v_doc,
     coalesce(_bags_out, 0), coalesce(_kg_out, 0),
     CASE WHEN v_grain_type_name IS NOT NULL
          THEN coalesce(_notes, '') || CASE WHEN coalesce(_notes, '') = '' THEN '' ELSE ' — ' END
               || '[نوع الحبة: ' || v_grain_type_name || ']'
          ELSE _notes END,
     v_user);

  -- وارد النواتج: سطر لكل ناتج
  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs)
             AS o(item_id uuid, bags numeric, kg numeric)
  LOOP
    INSERT INTO public.custody_ledger
      (customer_id, warehouse_id, entry_type, item_id, doc_number,
       bags_in, kg_in, notes, created_by)
    VALUES
      (_customer_id, _warehouse_id, 'MILLING', r.item_id, v_doc,
       coalesce(r.bags, 0), coalesce(r.kg, 0), _notes, v_user);
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'custody.milling', 'custody_ledger', _customer_id,
    jsonb_build_object(
      'doc_number', v_doc,
      'grain_item_id', _grain_item_id,
      'grain_type_id', _grain_type_id,
      'grain_type_name', v_grain_type_name,
      'grain_type_default_loss_pct', v_grain_type_loss,
      'grain_bags', coalesce(_bags_out, 0),
      'grain_kg', coalesce(_kg_out, 0),
      'outputs', _outputs,
      'stock_impact', 'NONE — customer custody'
    ));

  RETURN v_doc;
END $function$;

-- صلاحيات التوقيع الجديد
GRANT EXECUTE ON FUNCTION public.custody_milling(uuid, uuid, uuid, numeric, numeric, jsonb, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.custody_milling(uuid, uuid, uuid, numeric, numeric, jsonb, text, uuid) TO service_role;
