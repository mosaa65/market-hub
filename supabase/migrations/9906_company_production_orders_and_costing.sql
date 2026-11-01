-- Company-owned production orders. Customer-owned milling remains in the
-- custody/service workflow and is intentionally not touched by this migration.
BEGIN;

-- Categories are only candidates by default: finance explicitly marks direct
-- production costs. Cost center matching below still decides whether an entry
-- belongs to this particular production run.
ALTER TABLE public.expense_categories
  ADD COLUMN production_cost_eligible boolean NOT NULL DEFAULT false;

CREATE SEQUENCE IF NOT EXISTS public.production_order_number_seq START WITH 1;

CREATE TABLE public.production_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  warehouse_id uuid NOT NULL REFERENCES public.warehouses(id) ON DELETE RESTRICT,
  cost_center_id uuid NOT NULL REFERENCES public.expense_cost_centers(id) ON DELETE RESTRICT,
  production_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED','CANCELLED')),
  material_cost numeric(18,2) NOT NULL DEFAULT 0 CHECK (material_cost >= 0),
  conversion_cost numeric(18,2) NOT NULL DEFAULT 0 CHECK (conversion_cost >= 0),
  total_cost numeric(18,2) NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  output_cost numeric(18,2) NOT NULL DEFAULT 0 CHECK (output_cost >= 0),
  abnormal_loss_cost numeric(18,2) NOT NULL DEFAULT 0 CHECK (abnormal_loss_cost >= 0),
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_orders_posted_has_completion CHECK (
    (status <> 'POSTED') OR completed_at IS NOT NULL
  )
);

CREATE TABLE public.production_order_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id uuid NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  entered_quantity numeric(18,6) NOT NULL CHECK (entered_quantity > 0),
  uom_id uuid REFERENCES public.units(id) ON DELETE RESTRICT,
  base_uom_id uuid REFERENCES public.units(id) ON DELETE RESTRICT,
  uom_conversion_factor numeric(30,12) NOT NULL CHECK (uom_conversion_factor > 0),
  base_quantity numeric(18,6) NOT NULL CHECK (base_quantity > 0),
  mass_kg numeric(18,6),
  unit_cost numeric(18,4) NOT NULL DEFAULT 0,
  total_cost numeric(18,2) NOT NULL DEFAULT 0,
  inventory_account_code text NOT NULL,
  stock_movement_id uuid REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_material_mass_nonnegative CHECK (mass_kg IS NULL OR mass_kg > 0)
);

CREATE TABLE public.production_order_batch_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id uuid NOT NULL REFERENCES public.production_order_materials(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.product_batches(id) ON DELETE RESTRICT,
  base_quantity numeric(18,6) NOT NULL CHECK (base_quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (material_id, batch_id)
);

CREATE TABLE public.production_order_cost_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id uuid NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  expense_line_id uuid NOT NULL REFERENCES public.expense_lines(id) ON DELETE RESTRICT,
  expense_entry_id uuid NOT NULL REFERENCES public.expense_entries(id) ON DELETE RESTRICT,
  cost_center_id uuid REFERENCES public.expense_cost_centers(id) ON DELETE RESTRICT,
  expense_account_code text NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  allocation_basis text NOT NULL,
  note text,
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (production_order_id, expense_line_id),
  CONSTRAINT production_cost_allocation_basis_nonblank CHECK (length(btrim(allocation_basis)) >= 3)
);

CREATE TABLE public.production_order_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id uuid NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  entered_quantity numeric(18,6) NOT NULL CHECK (entered_quantity > 0),
  uom_id uuid REFERENCES public.units(id) ON DELETE RESTRICT,
  base_uom_id uuid REFERENCES public.units(id) ON DELETE RESTRICT,
  uom_conversion_factor numeric(30,12) NOT NULL CHECK (uom_conversion_factor > 0),
  base_quantity numeric(18,6) NOT NULL CHECK (base_quantity > 0),
  mass_kg numeric(18,6),
  allocation_value_per_base numeric(18,6) NOT NULL DEFAULT 0 CHECK (allocation_value_per_base >= 0),
  allocated_cost numeric(18,2) NOT NULL DEFAULT 0 CHECK (allocated_cost >= 0),
  actual_stock_cost numeric(18,2) NOT NULL DEFAULT 0 CHECK (actual_stock_cost >= 0),
  unit_cost numeric(18,4) NOT NULL DEFAULT 0,
  inventory_account_code text NOT NULL,
  batch_id uuid REFERENCES public.product_batches(id) ON DELETE RESTRICT,
  batch_number text,
  expiry_date date,
  stock_movement_id uuid REFERENCES public.stock_movements(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_output_mass_nonnegative CHECK (mass_kg IS NULL OR mass_kg > 0)
);

CREATE TABLE public.production_order_losses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id uuid NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  loss_type text NOT NULL CHECK (loss_type IN ('NORMAL','ABNORMAL')),
  quantity numeric(18,6) NOT NULL CHECK (quantity > 0),
  uom_id uuid NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  mass_kg numeric(18,6) NOT NULL CHECK (mass_kg > 0),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_loss_reason_nonblank CHECK (length(btrim(reason)) >= 3)
);

CREATE INDEX production_orders_status_date_idx ON public.production_orders(status, production_date DESC);
CREATE INDEX production_orders_center_date_idx ON public.production_orders(cost_center_id, production_date DESC);
CREATE INDEX production_materials_order_idx ON public.production_order_materials(production_order_id);
CREATE INDEX production_outputs_order_idx ON public.production_order_outputs(production_order_id);
CREATE INDEX production_cost_allocations_line_idx ON public.production_order_cost_allocations(expense_line_id);

ALTER TABLE public.production_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_order_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_order_batch_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_order_cost_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_order_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_order_losses ENABLE ROW LEVEL SECURITY;

CREATE POLICY production_orders_finance_read ON public.production_orders
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY production_materials_finance_read ON public.production_order_materials
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY production_batch_allocations_finance_read ON public.production_order_batch_allocations
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY production_cost_allocations_finance_read ON public.production_order_cost_allocations
  FOR SELECT TO authenticated USING (public.can_read_finance(auth.uid()));
CREATE POLICY production_outputs_finance_read ON public.production_order_outputs
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY production_losses_finance_read ON public.production_order_losses
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

REVOKE ALL ON public.production_orders, public.production_order_materials,
  public.production_order_batch_allocations, public.production_order_cost_allocations,
  public.production_order_outputs, public.production_order_losses
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.production_orders, public.production_order_materials,
  public.production_order_batch_allocations, public.production_order_cost_allocations,
  public.production_order_outputs, public.production_order_losses TO authenticated;
GRANT ALL ON public.production_orders, public.production_order_materials,
  public.production_order_batch_allocations, public.production_order_cost_allocations,
  public.production_order_outputs, public.production_order_losses TO service_role;

CREATE OR REPLACE FUNCTION public.production_inventory_account_code(p_class public.item_class)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public
AS $function$
  SELECT CASE p_class
    WHEN 'RAW_MATERIAL' THEN '1311'
    WHEN 'BY_PRODUCT' THEN '1314'
    WHEN 'PACKAGING' THEN '1315'
    ELSE '1313'
  END;
$function$;

CREATE OR REPLACE FUNCTION public.production_mass_in_kg(p_product_id uuid, p_base_quantity numeric)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_dimension text;
  v_factor numeric;
  v_package_weight numeric;
  v_kg_factor numeric;
BEGIN
  SELECT u.dimension_code, u.factor_to_reference, p.package_weight_kg
    INTO v_dimension, v_factor, v_package_weight
    FROM public.products p
    LEFT JOIN public.units u ON u.id = coalesce(p.base_uom_id, p.unit_id)
   WHERE p.id = p_product_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_dimension = 'MASS' AND v_factor IS NOT NULL THEN
    SELECT factor_to_reference INTO v_kg_factor
      FROM public.units
     WHERE dimension_code = 'MASS' AND lower(short_name) IN ('kg','كجم','كيلوجرام')
     ORDER BY CASE WHEN lower(short_name) = 'kg' THEN 0 ELSE 1 END
     LIMIT 1;
    IF v_kg_factor IS NULL OR v_kg_factor <= 0 THEN RETURN NULL; END IF;
    RETURN round(p_base_quantity * v_factor / v_kg_factor, 6);
  END IF;
  IF v_package_weight IS NOT NULL AND v_package_weight > 0 THEN
    RETURN round(p_base_quantity * v_package_weight, 6);
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.production_quantity_in_base(
  p_product_id uuid,p_quantity numeric,p_uom_id uuid
)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public
AS $function$
DECLARE
  v_base_uom_id uuid;
  v_unit_id uuid;
  v_factor numeric;
  v_increment numeric;
  v_active boolean;
  v_base_quantity numeric;
BEGIN
  IF p_quantity IS NULL OR p_quantity<=0 THEN
    RAISE EXCEPTION 'كمية الإنتاج يجب أن تكون أكبر من صفر' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(p.base_uom_id,p.unit_id) INTO v_base_uom_id
    FROM public.products p WHERE p.id=p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'الصنف غير موجود' USING ERRCODE='P0002'; END IF;
  v_unit_id:=coalesce(p_uom_id,v_base_uom_id);
  SELECT pu.factor_to_base,pu.quantity_increment,pu.is_active
    INTO v_factor,v_increment,v_active
    FROM public.product_uoms pu
   WHERE pu.product_id=p_product_id AND pu.unit_id=v_unit_id;
  IF FOUND THEN
    IF v_active IS NOT TRUE THEN
      RAISE EXCEPTION 'وحدة الإنتاج غير مفعّلة لهذا الصنف';
    END IF;
  ELSIF v_unit_id IS NOT DISTINCT FROM v_base_uom_id THEN
    v_factor:=1;
    v_increment:=0.001;
  ELSIF v_unit_id IS NULL AND v_base_uom_id IS NULL THEN
    v_factor:=1;
    v_increment:=0.001;
  ELSE
    RAISE EXCEPTION 'وحدة الإنتاج غير معرفة لهذا الصنف' USING ERRCODE='check_violation';
  END IF;
  IF mod(p_quantity,coalesce(v_increment,0.001))<>0 THEN
    RAISE EXCEPTION 'الكمية يجب أن تكون مضاعفاً لخطوة الوحدة %',coalesce(v_increment,0.001)
      USING ERRCODE='22023';
  END IF;
  v_base_quantity:=p_quantity*coalesce(v_factor,1);
  IF v_base_quantity<>round(v_base_quantity,3) THEN
    RAISE EXCEPTION 'الكمية المحولة تتجاوز دقة مخزون 0.001؛ اختر وحدة أساس أدق' USING ERRCODE='22023';
  END IF;
  RETURN v_base_quantity;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_production_order(
  p_warehouse_id uuid,
  p_cost_center_id uuid,
  p_production_date date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_id uuid;
  v_number text;
BEGIN
  IF v_user IS NULL OR NOT public.is_staff(v_user) OR NOT (
    public.has_role(v_user,'owner') OR public.has_role(v_user,'manager')
    OR public.has_role(v_user,'warehouse') OR public.has_role(v_user,'accountant')
  ) THEN RAISE EXCEPTION 'ليس لديك صلاحية إنشاء تشغيلة إنتاج'; END IF;
  IF p_warehouse_id IS NULL OR p_cost_center_id IS NULL OR p_production_date IS NULL THEN
    RAISE EXCEPTION 'المستودع ومركز التكلفة وتاريخ الإنتاج مطلوبة' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id=p_warehouse_id AND is_active) THEN
    RAISE EXCEPTION 'المستودع غير نشط أو غير موجود' USING ERRCODE='23503';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.expense_cost_centers WHERE id=p_cost_center_id AND is_active) THEN
    RAISE EXCEPTION 'مركز التكلفة غير نشط أو غير موجود' USING ERRCODE='23503';
  END IF;
  v_number := 'MO-' || to_char(p_production_date,'YYYYMMDD') || '-' ||
              lpad(nextval('public.production_order_number_seq')::text,5,'0');
  INSERT INTO public.production_orders(order_number,warehouse_id,cost_center_id,production_date,notes,created_by)
  VALUES (v_number,p_warehouse_id,p_cost_center_id,p_production_date,nullif(btrim(coalesce(p_notes,'')),''),v_user)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.production_cost_sources()
RETURNS TABLE (
  expense_line_id uuid,
  expense_entry_id uuid,
  reference text,
  expense_date date,
  description text,
  category_name text,
  cost_center_id uuid,
  account_code text,
  net_amount numeric,
  allocated_amount numeric,
  available_amount numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_read_finance(auth.uid()) THEN
    RAISE EXCEPTION 'لا تتوفر صلاحية قراءة مصروفات الإنتاج';
  END IF;
  RETURN QUERY
  SELECT l.id,e.id,e.reference,e.expense_date,coalesce(l.description,e.description,'مصروف'),
         coalesce(c.name_ar,c.name,'مصروف'),coalesce(l.cost_center_id,e.cost_center_id),
         a.code::text,l.net_amount,
         coalesce(sum(pa.amount),0)::numeric,
         greatest(l.net_amount-coalesce(sum(pa.amount),0),0)::numeric
    FROM public.expense_lines l
    JOIN public.expense_entries e ON e.id=l.entry_id
    JOIN public.expense_categories c ON c.id=l.category_id AND c.production_cost_eligible
    JOIN public.accounts a ON a.id=c.account_id AND a.account_type::text='EXPENSE'
      AND a.is_active AND a.is_postable
    LEFT JOIN public.production_order_cost_allocations pa ON pa.expense_line_id=l.id
   WHERE e.status::text IN ('POSTED','PARTIALLY_PAID','PAID','CLOSED')
     AND l.net_amount > 0
   GROUP BY l.id,e.id,e.reference,e.expense_date,l.description,e.description,c.name_ar,c.name,
            l.cost_center_id,e.cost_center_id,a.code,l.net_amount
  HAVING l.net_amount-coalesce(sum(pa.amount),0) > 0
   ORDER BY e.expense_date DESC,e.reference,l.line_no;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_production_expense_category_eligibility(
  p_category_id uuid,
  p_eligible boolean
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $function$
DECLARE
  v_user uuid := public.expense_actor();
  v_name text;
  v_account_type text;
  v_account_active boolean;
  v_account_postable boolean;
BEGIN
  PERFORM public.expense_assert_capability(v_user,'expense.category.manage');
  IF p_category_id IS NULL OR p_eligible IS NULL THEN
    RAISE EXCEPTION 'اختر تصنيف المصروف وحالة الأهلية' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(c.name_ar,c.name),a.account_type::text,a.is_active,a.is_postable
    INTO v_name,v_account_type,v_account_active,v_account_postable
    FROM public.expense_categories c LEFT JOIN public.accounts a ON a.id=c.account_id
   WHERE c.id=p_category_id FOR UPDATE OF c;
  IF NOT FOUND THEN RAISE EXCEPTION 'تصنيف المصروف غير موجود' USING ERRCODE='P0002'; END IF;
  IF p_eligible AND (v_account_type IS DISTINCT FROM 'EXPENSE'
     OR v_account_active IS NOT TRUE OR v_account_postable IS NOT TRUE) THEN
    RAISE EXCEPTION 'اربط التصنيف بحساب مصروف نشط وقابل للترحيل قبل تأهيله للإنتاج';
  END IF;
  UPDATE public.expense_categories SET production_cost_eligible=p_eligible WHERE id=p_category_id;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,payload)
  VALUES(v_user,'expense.category.production_eligibility_changed','expense_category',p_category_id,
    jsonb_build_object('name',v_name,'production_cost_eligible',p_eligible));
  RETURN p_eligible;
END;
$function$;

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
  v_allocated numeric := 0;
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
  v_loss_factor numeric;
  v_kg_factor numeric;
  v_variance numeric;
  v_material_journal uuid;
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
    SELECT c.production_cost_eligible,a.code,a.account_type::text
      INTO v_expense_category_eligible,v_currency_account,v_stock_account
      FROM public.expense_categories c JOIN public.accounts a ON a.id=c.account_id
       AND a.is_active AND a.is_postable
     WHERE c.id=v_expense_line.category_id;
    IF NOT FOUND OR v_stock_account<>'EXPENSE' THEN
      RAISE EXCEPTION 'تصنيف المصروف غير مرتبط بحساب مصروف صالح للرسملة';
    END IF;
    IF v_expense_category_eligible IS NOT TRUE THEN
      RAISE EXCEPTION 'تصنيف المصروف غير مؤهل للرسملة على الإنتاج';
    END IF;
    v_line_cost:=round((v_expense->>'amount')::numeric,2);
    IF v_line_cost<=0 THEN RAISE EXCEPTION 'قيمة تحميل المصروف يجب أن تكون موجبة'; END IF;
    SELECT coalesce(sum(amount),0) INTO v_already_allocated
      FROM public.production_order_cost_allocations WHERE expense_line_id=v_expense_line.id;
    v_available:=round(v_expense_line.net_amount-v_already_allocated,2);
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
    SELECT dimension_code,factor_to_reference INTO v_unit FROM public.units
     WHERE id=(v_loss->>'uom_id')::uuid;
    IF NOT FOUND OR v_unit.dimension_code<>'MASS' OR v_unit.factor_to_reference IS NULL OR v_kg_factor IS NULL THEN
      RAISE EXCEPTION 'وحدة الفاقد يجب أن تكون وحدة كتلة معرفة مثل كجم أو جرام';
    END IF;
    v_mass:=round((v_loss->>'quantity')::numeric*v_unit.factor_to_reference/v_kg_factor,6);
    IF v_mass<=0 THEN RAISE EXCEPTION 'كمية الفاقد يجب أن تكون موجبة'; END IF;
    IF upper(v_loss->>'loss_type')='NORMAL' THEN v_normal_loss_mass:=v_normal_loss_mass+v_mass;
    ELSIF upper(v_loss->>'loss_type')='ABNORMAL' THEN v_abnormal_loss_mass:=v_abnormal_loss_mass+v_mass;
    ELSE RAISE EXCEPTION 'نوع الفاقد غير معروف'; END IF;
    INSERT INTO public.production_order_losses(production_order_id,loss_type,quantity,uom_id,mass_kg,reason)
    VALUES(v_order.id,upper(v_loss->>'loss_type'),(v_loss->>'quantity')::numeric,(v_loss->>'uom_id')::uuid,
      v_mass,btrim(coalesce(v_loss->>'reason','')));
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
  FOR v_batch_line IN
    SELECT id,base_quantity,allocation_value_per_base,
           base_quantity*allocation_value_per_base AS allocation_weight,
           row_number() OVER (ORDER BY created_at,id) AS rn
      FROM public.production_order_outputs WHERE production_order_id=v_order.id ORDER BY created_at,id
  LOOP
    IF v_batch_line.rn=v_output_count THEN
      v_allocated:=v_remaining_wip;
    ELSIF v_output_count=1 THEN
      v_allocated:=v_remaining_wip;
    ELSE
      SELECT sum(base_quantity*allocation_value_per_base) INTO v_expected_mass
        FROM public.production_order_outputs WHERE production_order_id=v_order.id;
      v_allocated:=round((v_total_wip-v_abnormal_cost)*v_batch_line.allocation_weight/v_expected_mass,2);
    END IF;
    UPDATE public.production_order_outputs SET allocated_cost=v_allocated,
      unit_cost=CASE WHEN base_quantity>0 THEN v_allocated/base_quantity ELSE 0 END
     WHERE id=v_batch_line.id;
    v_remaining_wip:=round(v_remaining_wip-v_allocated,2);
  END LOOP;

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

-- One atomic front-door operation: if any inventory, batch, expense, UOM or
-- journal validation fails, both the order header and all postings roll back.
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

-- Prevent reversing a posted expense while any unreversed production order
-- still capitalizes one of its net lines.
CREATE OR REPLACE FUNCTION public.guard_allocated_expense_reversal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $function$
BEGIN
  IF NEW.status::text='REVERSED' AND OLD.status::text<>'REVERSED'
     AND EXISTS(
       SELECT 1 FROM public.production_order_cost_allocations a
       JOIN public.production_orders o ON o.id=a.production_order_id
       WHERE a.expense_entry_id=NEW.id AND o.status='POSTED'
     ) THEN
    RAISE EXCEPTION 'لا يمكن عكس المصروف؛ توجد تكلفة محملة على تشغيلات إنتاج مرحلة';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER expense_reversal_blocked_by_production
  BEFORE UPDATE OF status ON public.expense_entries
  FOR EACH ROW EXECUTE FUNCTION public.guard_allocated_expense_reversal();

-- Reuse the existing invoice posting rules verbatim, replacing only its COGS
-- block with class-specific inventory credits. This preserves sales, VAT,
-- split tenders, receivables and payment validation already deployed there.
CREATE OR REPLACE FUNCTION public.post_sales_invoice_cogs(
  p_invoice_id uuid,p_entry_date date,p_invoice_number text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $function$
DECLARE
  v_cost numeric;
  v_lines jsonb:='[]'::jsonb;
  r record;
BEGIN
  SELECT coalesce(sum(sm.total_cost),0) INTO v_cost
    FROM public.stock_movements sm
   WHERE sm.source_type='sales_invoice' AND sm.source_id=p_invoice_id AND sm.movement_type='sale';
  IF v_cost<=0 THEN RETURN; END IF;
  v_lines:=jsonb_build_array(jsonb_build_object('account_code','5111','debit',round(v_cost,2),'memo','تكلفة المبيعات'));
  FOR r IN
    SELECT CASE p.item_class WHEN 'RAW_MATERIAL' THEN '1311' WHEN 'BY_PRODUCT' THEN '1314'
                              WHEN 'PACKAGING' THEN '1315' ELSE '1313' END AS account_code,
           round(sum(sm.total_cost),2) AS amount,
           coalesce(p.item_class::text,'FINISHED_GOOD') AS item_class
      FROM public.stock_movements sm JOIN public.products p ON p.id=sm.product_id
     WHERE sm.source_type='sales_invoice' AND sm.source_id=p_invoice_id AND sm.movement_type='sale'
     GROUP BY 1,3 HAVING sum(sm.total_cost)>0
  LOOP
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
      'account_code',r.account_code,'credit',r.amount,'memo','صرف مخزون '||r.item_class));
  END LOOP;
  -- Preserve cents when grouping account codes by placing any rounding
  -- difference on the last inventory credit line.
  SELECT round(sum(coalesce((x->>'credit')::numeric,0)),2) INTO v_cost
    FROM jsonb_array_elements(v_lines) x WHERE x ? 'credit';
  IF v_cost<>round((SELECT coalesce(sum(sm.total_cost),0) FROM public.stock_movements sm
    WHERE sm.source_type='sales_invoice' AND sm.source_id=p_invoice_id AND sm.movement_type='sale'),2) THEN
    RAISE EXCEPTION 'تكلفة المبيعات حسب فئة المخزون غير متزنة';
  END IF;
  PERFORM public.post_journal_entry(
    p_entry_date,'تكلفة البضاعة المباعة - فاتورة '||p_invoice_number,v_lines,
    'sales_invoice_cogs',p_invoice_id,'JE-COGS-'||p_invoice_number);
END;
$function$;

DO $function$
DECLARE
  v_definition text;
  v_start integer;
  v_end integer;
  v_old text;
BEGIN
  SELECT pg_get_functiondef('public.post_sales_invoice(uuid)'::regprocedure) INTO v_definition;
  v_start:=position('  -- ── ترحيل تكلفة البضاعة المباعة (COGS) ──' in v_definition);
  v_end:=position('  RETURN v_entry;' in v_definition);
  IF v_start=0 OR v_end<=v_start THEN
    RAISE EXCEPTION 'تعذر تحديد كتلة تكلفة المبيعات في post_sales_invoice؛ لم يتم تعديل الدالة';
  END IF;
  v_old:=substr(v_definition,v_start,v_end-v_start);
  v_definition:=replace(v_definition,v_old,
    '  -- ترحيل تكلفة المبيعات حسب فئة الصنف من تكلفة حركة الصرف الفعلية.'||E'\n'||
    '  PERFORM public.post_sales_invoice_cogs(p_invoice_id,v_inv.created_at::date,v_inv.invoice_number);'||E'\n'||E'\n');
  EXECUTE v_definition;
END;
$function$;

-- Extend the declared RPC contract without changing its existing entries.
ALTER FUNCTION public.rpc_allowlist() RENAME TO rpc_allowlist_before_company_production;
CREATE FUNCTION public.rpc_allowlist()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=public
AS $function$
  SELECT public.rpc_allowlist_before_company_production() || ARRAY[
    'create_and_post_production_order','production_cost_sources',
    'set_production_expense_category_eligibility'
  ]::text[];
$function$;
REVOKE ALL ON FUNCTION public.rpc_allowlist() FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION public.production_inventory_account_code(public.item_class) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.production_mass_in_kg(uuid,numeric) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.production_quantity_in_base(uuid,numeric,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.guard_allocated_expense_reversal() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.post_sales_invoice_cogs(uuid,date,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.create_production_order(uuid,uuid,date,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.complete_production_order(uuid,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.production_cost_sources() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.create_and_post_production_order(uuid,uuid,date,text,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.set_production_expense_category_eligibility(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_production_order(uuid,uuid,date,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_production_order(uuid,jsonb,jsonb,jsonb,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.production_cost_sources() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_and_post_production_order(uuid,uuid,date,text,jsonb,jsonb,jsonb,jsonb) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_production_expense_category_eligibility(uuid,boolean) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.production_inventory_account_code(public.item_class) TO service_role;
GRANT EXECUTE ON FUNCTION public.production_mass_in_kg(uuid,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.production_quantity_in_base(uuid,numeric,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.post_sales_invoice_cogs(uuid,date,text) TO service_role;

COMMENT ON TABLE public.production_orders IS
  'Company-owned production work orders. Customer-owned goods remain in milling custody documents.';
COMMENT ON TABLE public.production_order_cost_allocations IS
  'Net-of-input-tax allocations from posted expense lines to a production order; these reclassify expense to WIP.';
COMMENT ON COLUMN public.production_order_materials.base_quantity IS
  'Material quantity in the product base UOM as captured at posting; stock and cost are valued in this UOM.';
COMMENT ON COLUMN public.production_order_outputs.allocation_value_per_base IS
  'Estimated sales value per base UOM used only to allocate joint production cost among multiple outputs.';

COMMIT;

-- Rollback note: this migration is additive. To revert before any production
-- orders are posted, first restore the previous post_sales_invoice definition
-- from migration 64/70, drop the expense reversal trigger, restore the old
-- rpc_allowlist name, then drop the new functions, tables and sequence in
-- dependency order. Posted production must be reversed through accounting and
-- stock reversal documents before dropping its records; do not CASCADE-delete
-- production audit history.
