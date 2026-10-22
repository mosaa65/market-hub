-- ════════════════════
-- V1: التحويل الداخلي بنموذج «عدّ المنتجات» (موافق عليه من المالك)
--
-- يلغي نموذج smart_manufacture القديم (توزيع التكلفة حسب القيمة البيعية النسبية
-- + قيد 5921 فاقد تشغيلي). النموذج الجديد:
--   • كل الكميات بوحدة المنتج (عدّ صافٍ — لا كجم، لا سعات، لا نسب).
--   • صادر منتج المصدر + وارد النواتج في معاملة واحدة عبر المحرك الوحيد.
--   • تكلفة كل منتج تبقى كما هي (قرار المالك: ثابتة يدوياً) — لا توزيع تكلفة،
--     لا انتقال تكلفة بين النواتج، لا قيود محاسبية (الحركة توازن ذاتياً).
--   • الفاقد اختياري بوحدات: يُخصم من المصدر ويظهر في السجل التدقيق فقط.
-- ════════════════════

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
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_ref text;
  v_doc_id uuid := gen_random_uuid();
  v_total_output_qty numeric := 0;
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

  -- المصدر: أي منتج نشط (حبوب خام أو غيرها — التحويل لا يقيد فئة المصدر)
  IF NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = _source_item_id AND is_active
  ) THEN
    RAISE EXCEPTION 'Source item is not an active product';
  END IF;

  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs) AS o(item_id uuid, qty numeric)
  LOOP
    IF r.item_id IS NULL OR coalesce(r.qty, 0) <= 0 THEN
      RAISE EXCEPTION 'Every output line needs an item and a positive quantity';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.products
      WHERE id = r.item_id AND is_active
    ) THEN
      RAISE EXCEPTION 'Output item % is not an active product', r.item_id;
    END IF;
    v_total_output_qty := v_total_output_qty + coalesce(r.qty, 0);
  END LOOP;

  -- القاعدة الرياضيّة الوحيدة: النواتج + الفاقد = المصدر (العدّ بوحدة المنتج)
  IF v_total_output_qty + coalesce(_loss_qty, 0) <> coalesce(_source_qty, 0) THEN
    RAISE EXCEPTION
      'Outputs + loss (%) must equal the source quantity (%)',
      v_total_output_qty + coalesce(_loss_qty, 0), coalesce(_source_qty, 0);
  END IF;

  v_ref := 'CV-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.milling_service_seq')::text, 4, '0');

  -- 1) صادر المصدر — تكلفة المنتج تبقى كما هي (لا توزيع)
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

  -- 2) وارد النواتج — بلا توزيع تكلفة (تكلفة كل منتج ثابتة يدوياً)
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
      'notes', _notes
    ));

  RETURN v_ref;
END $function$;
