BEGIN;

-- Posted production is reversible only while its stock effects are untouched.
-- This preserves the moving-average values used by the original posting and
-- avoids silently reversing stock after downstream sales, receipts or issues.
ALTER TABLE public.production_orders
  DROP CONSTRAINT production_orders_status_check;
ALTER TABLE public.production_orders
  ADD CONSTRAINT production_orders_status_check
  CHECK (status IN ('DRAFT','POSTED','CANCELLED','REVERSED'));
ALTER TABLE public.production_orders
  ADD COLUMN reversed_at timestamptz,
  ADD COLUMN reversed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN reversal_reason text;

ALTER TABLE public.production_orders
  ADD CONSTRAINT production_order_reversal_audit_complete CHECK (
    (status <> 'REVERSED') OR
    (reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND length(btrim(coalesce(reversal_reason,''))) >= 3)
  );

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

-- A product cannot be both an input and output of this simple, single-step
  -- reversal. Such a process needs a multi-stage production ledger.
  IF EXISTS (
    SELECT 1
      FROM public.production_order_materials m
      JOIN public.production_order_outputs o
        ON o.production_order_id=m.production_order_id AND o.product_id=m.product_id
     WHERE m.production_order_id=v_order.id
  ) THEN
    RAISE EXCEPTION 'لا يمكن عكس تشغيلة تعيد إنتاج الصنف نفسه المستخدم كمدخل';
  END IF;

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

  UPDATE public.production_orders
     SET status='REVERSED',reversed_at=now(),reversed_by=v_user,
         reversal_reason=btrim(p_reason),updated_at=now()
   WHERE id=v_order.id;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,payload)
  VALUES(v_user,'production.order_reversed','production_order',v_order.id,
    jsonb_build_object('order_number',v_order.order_number,'reason',btrim(p_reason),
                       'reversal_journal_ids',to_jsonb(v_reversal_ids)));
  RETURN v_order.id;
END;
$function$;

ALTER FUNCTION public.rpc_allowlist() RENAME TO rpc_allowlist_before_production_reversal;
CREATE FUNCTION public.rpc_allowlist()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=public
AS $function$
  SELECT public.rpc_allowlist_before_production_reversal() || ARRAY['reverse_production_order']::text[];
$function$;
REVOKE ALL ON FUNCTION public.rpc_allowlist() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.reverse_production_order(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reverse_production_order(uuid,text) TO authenticated,service_role;

COMMENT ON FUNCTION public.reverse_production_order(uuid,text) IS
  'Audit-safe reversal for a posted production order only when no later inventory or batch movement has touched its inputs or outputs.';

COMMIT;
