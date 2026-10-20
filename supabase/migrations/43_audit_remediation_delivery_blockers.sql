-- ============================================================================
-- 43_audit_remediation_delivery_blockers.sql
--
-- إغلاق ملاحظات تقرير ما قبل التسليم
--   docs/audits/2026-10-20_vortex-erp-delivery-audit-ar.md
--
-- P0-1  مرتجع المبيعات مربوط بالفاتورة الأصلية: الفاتورة والحالة والعملة
--       والمستودع، وبنود مقفولة، والسعر/الضريبة مشتقّان من البند، والمتبقي
--       القابل للمرتجع محسوب بعد خصم المرتجعات السابقة. القيد يُنشأ لكل
--       مرتجع بما فيه النقدي (بلا عميل).
-- P0-2  معرّف مستند فريد لكل دفعة تصنيع/صرف مستهلكات بدل grain_item_id
--       و warehouse_id، فلا يتصادم uq_journal_source_active.
-- P0-3  حركة الكمية والقيمة في معاملة واحدة: apply_cost_movement يُستدعى من
--       post_stock_delta نفسه، والبيع يُقيَّد بالتكلفة الفعلية لا بمرجع الصنف.
-- P0-4  الخدمة الحرة (AD_HOC_SERVICE) وبند بلا item_class لا يختفيان من قيد
--       الإيراد.
-- P1-1  بند فاتورة أجور الطحن يحمل أساس التسعير: الكمية والسعر الوحدوي،
--       والفترة المالية للاستلام (MM-YYYY) ليمكن طبع «20 كيس × 1,000».
-- P1-6  العميل/المورد النقدي كيان نظامي بعلامة قاعدية: لا يظهران في الأدلة،
--       ولا يُعاد تسميتهما/تعطيلهما/حذفهما، ولا تُسجَّل عليهما ذمة.
-- P1-7  سطور قيود الذمم تحمل partner_type/partner_id.
-- P1-8  صلاحيات دوال public: قائمة سماح صريحة بدل منح كل الدوال.
--
-- ملاحظات التطبيق:
--   • كل الدوال مُعرَّفة هنا بالتعريف النهائي الكامل (لا تغيير توقيعات API
--     خارجية)، فترتيب الهجرات اللاحق لا يعيد إدخال الأخطاء.
--   • إضافي بالكامل: لا حذف لأي بيانات مالية، والـ triggers على الحركات
--     مباشرة تُمنع بنفس رسائل المحرّك (post_stock_delta فقط يحرّك).
-- ============================================================================

BEGIN;

-- ── أعمدة الكيانات النظامية ────────────────────────────────────────────────
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS system_key text;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS system_key text;

-- توسيم الكيانين المزروعين فعلاً. المطابقة بالاسم مرة واحدة فقط (هجرة تثبيت)،
-- وبعدها الحماية تعتمد على العلامة لا على الاسم.
UPDATE public.customers
   SET is_system = true, system_key = 'CASH_CUSTOMER'
 WHERE id = (SELECT c.id FROM public.customers c
              WHERE c.name = 'عميل نقدي' OR c.system_key = 'CASH_CUSTOMER'
              ORDER BY (c.system_key = 'CASH_CUSTOMER') DESC, c.created_at
              LIMIT 1)
   AND (system_key IS NULL OR system_key = 'CASH_CUSTOMER');

UPDATE public.suppliers
   SET is_system = true, system_key = 'CASH_SUPPLIER'
 WHERE id = (SELECT s.id FROM public.suppliers s
              WHERE s.name = 'مورد نقدي' OR s.system_key = 'CASH_SUPPLIER'
              ORDER BY (s.system_key = 'CASH_SUPPLIER') DESC, s.created_at
              LIMIT 1)
   AND (system_key IS NULL OR system_key = 'CASH_SUPPLIER');

-- كيان نظامي واحد لكل مفتاح، ومفتاح واحد لكل صف نظامي.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_system_key_unique') THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_system_key_unique UNIQUE (system_key);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_system_key_unique') THEN
    ALTER TABLE public.suppliers
      ADD CONSTRAINT suppliers_system_key_unique UNIQUE (system_key);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_system_flag_shape') THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_system_flag_shape CHECK (is_system = (system_key IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_system_flag_shape') THEN
    ALTER TABLE public.suppliers
      ADD CONSTRAINT suppliers_system_flag_shape CHECK (is_system = (system_key IS NOT NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customers_is_system ON public.customers (is_system) WHERE is_system;
CREATE INDEX IF NOT EXISTS idx_suppliers_is_system ON public.suppliers (is_system) WHERE is_system;

COMMENT ON COLUMN public.customers.is_system IS
  'P1-6: كيان نظامي (العميل النقدي) — اسمه وحالته وحذفه محمية في القاعدة، ومخفي من دليل العملاء.';
COMMENT ON COLUMN public.suppliers.is_system IS
  'P1-6: كيان نظامي (المورد النقدي) — اسمه وحالته وحذفه محمية في القاعدة، ومخفي من دليل الموردين.';

-- ════════════════════════════════════════════════════════════════════════════
-- P1-6 — guards على الكيانين النظاميين
-- ════════════════════════════════════════════════════════════════════════════
-- العلامة is_system لا تُكتب من الواجهة: أي تعديل يضعها false على صف نظامي
-- (حتى من service_role) يُرفض، فلا توجد طريقة لإلغاء الحماية عبر API.
CREATE OR REPLACE FUNCTION public.tg_customers_system_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION
        'The system cash customer is a protected system entity and cannot be deleted'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_system THEN
    IF NEW.is_system IS DISTINCT FROM true OR NEW.system_key IS DISTINCT FROM OLD.system_key THEN
      RAISE EXCEPTION
        'The system cash customer flag cannot be cleared or re-keyed'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.name IS DISTINCT FROM OLD.name THEN
      RAISE EXCEPTION
        'The system cash customer cannot be renamed'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.is_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION
        'The system cash customer cannot be deactivated'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF coalesce(NEW.balance, 0) <> 0 THEN
      RAISE EXCEPTION
        'The system cash customer must keep a zero balance (got %)', NEW.balance
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.is_system THEN
      RAISE EXCEPTION
        'System entities are provisioned by the seed, not created through the API'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.name IN ('عميل نقدي') THEN
      RAISE EXCEPTION
        'That name is reserved for the system cash customer'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS tg_customers_system_guard ON public.customers;
CREATE TRIGGER tg_customers_system_guard
  BEFORE UPDATE OR DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.tg_customers_system_guard();

CREATE OR REPLACE FUNCTION public.tg_suppliers_system_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION
        'The system cash supplier is a protected system entity and cannot be deleted'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_system THEN
    IF NEW.is_system IS DISTINCT FROM true OR NEW.system_key IS DISTINCT FROM OLD.system_key THEN
      RAISE EXCEPTION
        'The system cash supplier flag cannot be cleared or re-keyed'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.name IS DISTINCT FROM OLD.name THEN
      RAISE EXCEPTION
        'The system cash supplier cannot be renamed'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.is_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION
        'The system cash supplier cannot be deactivated'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF coalesce(NEW.balance, 0) <> 0 THEN
      RAISE EXCEPTION
        'The system cash supplier must keep a zero balance (got %)', NEW.balance
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.is_system THEN
      RAISE EXCEPTION
        'System entities are provisioned by the seed, not created through the API'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.name IN ('مورد نقدي') THEN
      RAISE EXCEPTION
        'That name is reserved for the system cash supplier'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS tg_suppliers_system_guard ON public.suppliers;
CREATE TRIGGER tg_suppliers_system_guard
  BEFORE UPDATE OR DELETE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.tg_suppliers_system_guard();

-- أدلة الواجهة: هل الطرف كيان نظامي؟
CREATE OR REPLACE FUNCTION public.is_system_customer(p_customer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce((SELECT c.is_system FROM public.customers c WHERE c.id = p_customer_id), false);
$function$;

CREATE OR REPLACE FUNCTION public.is_system_supplier(p_supplier_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce((SELECT s.is_system FROM public.suppliers s WHERE s.id = p_supplier_id), false);
$function$;

-- حراس النظاميين أيضاً على قيود الذمة: لا بيع آجل ولا شراء آجل ولا مرتجع
-- يمكن أن يترك رصيداً عليهما.
CREATE OR REPLACE FUNCTION public.tg_customer_ledger_system_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(NEW.debit, 0) - coalesce(NEW.credit, 0) <> 0 AND public.is_system_customer(NEW.customer_id) THEN
    RAISE EXCEPTION
      'The system cash customer can only carry settlement lines, never a credit balance'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS tg_customer_ledger_system_guard ON public.customer_ledger;
CREATE TRIGGER tg_customer_ledger_system_guard
  BEFORE INSERT ON public.customer_ledger
  FOR EACH ROW EXECUTE FUNCTION public.tg_customer_ledger_system_guard();

-- ════════════════════════════════════════════════════════════════════════════
-- الدوال الحالية التي كانت تنادي المحرّك بلا اسم وسائط صريحة تبقى صحيحة
-- (أسماء المعاملات هنا هي نفسها في القاعدة المتصلة).
-- ════════════════════════════════════════════════════════════════════════════

COMMENT ON FUNCTION public.post_stock_delta(uuid, uuid, numeric, numeric, public.stock_movement_kind, text, uuid, text, public.owner_type, uuid, public.movement_type) IS
  'P0-3: المسار الوحيد لحركة المخزون — الكمية والقيمة في معاملة واحدة.';
-- المفتاح يُفتح داخل المحرّك. نضيفه إلى النسخة أعلاه بإعادة تعريف مختصرة:
DROP FUNCTION IF EXISTS public.post_stock_delta(uuid, uuid, numeric, numeric, public.stock_movement_kind, text, uuid, text, public.owner_type, uuid, public.movement_type);
CREATE OR REPLACE FUNCTION public.post_stock_delta(
  p_product_id uuid,
  p_warehouse_id uuid,
  p_signed_qty numeric,
  p_unit_cost numeric DEFAULT NULL::numeric,
  p_movement_kind public.stock_movement_kind DEFAULT 'ADJUSTMENT'::public.stock_movement_kind,
  p_source_type text DEFAULT NULL::text,
  p_source_id uuid DEFAULT NULL::uuid,
  p_note text DEFAULT NULL::text,
  p_owner_type public.owner_type DEFAULT 'COMPANY'::public.owner_type,
  p_owner_id uuid DEFAULT NULL::uuid,
  p_movement_type_legacy public.movement_type DEFAULT NULL::public.movement_type
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user   uuid := auth.uid();
  v_mt     public.movement_type;
  v_policy public.inventory_policy;
  v_nature public.item_nature;
  v_before numeric;
  v_after  numeric;
BEGIN
  -- من يستطيع تحريك المخزون: موظف مسجّل، أو سياق داخلي موثوق (auth.uid() فارغ
  -- في المهام الخلفية). المحرّك نفسه لا يتحقق من الأدوار.
  IF v_user IS NOT NULL AND NOT public.is_staff(v_user) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF p_signed_qty IS NULL OR p_signed_qty = 0 THEN
    RETURN;
  END IF;
  IF p_product_id IS NULL OR p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Item and warehouse are required for a stock movement';
  END IF;

  v_mt := coalesce(
    p_movement_type_legacy,
    CASE p_movement_kind
      WHEN 'RECEIPT'      THEN 'purchase'
      WHEN 'ISSUE'        THEN 'sale'
      WHEN 'TRANSFER_IN'  THEN 'transfer_in'
      WHEN 'TRANSFER_OUT' THEN 'transfer_out'
      ELSE 'adjustment'
    END
  );

  SELECT p.item_nature, public.item_effective_policy(p.id)
    INTO v_nature, v_policy
  FROM public.products p WHERE p.id = p_product_id;

  IF v_nature = 'SERVICE' OR v_policy <> 'TRACKED' THEN
    RAISE EXCEPTION
      'Item % does not hold company stock (nature %, policy %)',
      p_product_id, coalesce(v_nature::text, '?'), coalesce(v_policy::text, '?');
  END IF;

  SELECT i.quantity INTO v_before
  FROM public.inventory i
  WHERE i.product_id = p_product_id
    AND i.warehouse_id = p_warehouse_id
    AND i.owner_type = p_owner_type
    AND i.owner_id IS NOT DISTINCT FROM p_owner_id
  FOR UPDATE;

  v_before := coalesce(v_before, 0);
  v_after  := round(v_before + p_signed_qty, 3);

  IF v_after < 0 AND p_owner_type = 'COMPANY' THEN
    RAISE EXCEPTION
      'Insufficient stock for item % in warehouse %: available %, requested %',
      p_product_id, p_warehouse_id, v_before, abs(p_signed_qty)
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.inventory
    (product_id, warehouse_id, owner_type, owner_id, quantity)
  VALUES
    (p_product_id, p_warehouse_id, p_owner_type, p_owner_id, v_after)
  ON CONFLICT (product_id, warehouse_id, owner_type, owner_id)
  DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();

  PERFORM set_config('app.stock_engine', 'on', true);

  INSERT INTO public.stock_movements
    (product_id, warehouse_id, movement_type, quantity, unit_cost, reference,
     note, created_by, movement_kind, source_type, source_id, owner_type, owner_id,
     total_cost)
  VALUES
    (p_product_id, p_warehouse_id, v_mt, p_signed_qty, p_unit_cost,
     coalesce(p_source_type, '') || coalesce(':' || p_source_id::text, ''),
     p_note, v_user, p_movement_kind, p_source_type, p_source_id, p_owner_type,
     p_owner_id,
     CASE WHEN p_unit_cost IS NULL THEN NULL
          ELSE round(abs(p_signed_qty) * p_unit_cost, 2) END);

  -- P0-3: التقييم في نفس المعاملة وبنفس المصدر — لا حركة كمية بلا قيمة.
  PERFORM public.apply_cost_movement(
    p_product_id, p_warehouse_id, p_signed_qty, p_unit_cost,
    p_source_type, p_source_id, p_note, p_owner_type, p_owner_id);

  PERFORM set_config('app.stock_engine', 'off', true);
END $function$;

DROP TRIGGER IF EXISTS tg_stock_movements_engine_only ON public.stock_movements;
CREATE OR REPLACE FUNCTION public.tg_stock_movements_engine_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(current_setting('app.stock_engine', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION
    'Stock movements must be posted through post_stock_delta so quantity and cost stay in step'
    USING ERRCODE = 'restrict_violation';
END $function$;

CREATE TRIGGER tg_stock_movements_engine_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.tg_stock_movements_engine_only();

-- الدوال الحالية التي كان المحرّك القديم يتحقق فيها من توفر المخزون بنفسه
-- تحتاج تحديد كمّية الشركة المقفلة، والحرجة هنا: تسمية muted تُبقي التوقيع.

-- ════════════════════════════════════════════════════════════════════════════
-- P0-3 — تكلفة البيع من الطبقة الفعلية
-- ════════════════════════════════════════════════════════════════════════════
-- كان create_sale يمرّر products.cost_price كتكلفة الحركة، ثم يقيّد COGS بـ
-- resolve_unit_cost لاحقاً. الآن: المحرّك يقيّم الحركة بالقيمة الفعلية، والحركة
-- تحمل total_cost، والقيد يقرأ منه — مصدر واحد للرقم.
CREATE OR REPLACE FUNCTION public.sale_line_unit_cost(p_product_id uuid, p_warehouse_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    public.resolve_unit_cost(p_product_id, p_warehouse_id),
    (SELECT p.cost_price FROM public.products p WHERE p.id = p_product_id),
    0
  );
$function$;

-- الدالة الجذرية للبيع: نفس منطق 20 مع تعديلين —
--   1) لا يُمرَّر cost_price كتكلفة للحركة (المحرّك يقيّمها بنفسه).
--   2) الترحيل عبر post_sales_invoice للدوال الأخرى يبقى كما هو.
CREATE OR REPLACE FUNCTION public.create_sale(_warehouse_id uuid, _customer_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_id     uuid;
  v_invoice_number text;
  v_user           uuid := auth.uid();
  v_line           record;
  v_subtotal       numeric := 0;
  v_tax_total      numeric := 0;
  v_discount       numeric := coalesce(_discount, 0);
  v_total          numeric := 0;
  v_paid           numeric := 0;
  v_outstanding    numeric := 0;
  v_price          numeric;
  v_tax_rate       numeric;
  v_customer_balance numeric;
  v_credit_limit   numeric;
  v_line_total     numeric;
  v_line_tax       numeric;
  v_effect         text;
  v_line_type      text;
  v_sellable       boolean;
  v_status         public.invoice_status;
  v_last_item_id   uuid;
  v_available      numeric;
  v_system         boolean := false;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'cashier')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to post sales';
  END IF;

  IF _warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse is required';
  END IF;

  IF coalesce(jsonb_typeof(_items), '') <> 'array'
     OR coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;

  IF _payment_method NOT IN ('cash', 'card', 'bank_transfer', 'credit', 'mobile_money', 'split') THEN
    RAISE EXCEPTION 'Unsupported payment method';
  END IF;

  IF v_discount < 0 THEN
    RAISE EXCEPTION 'Discount cannot be negative';
  END IF;

  IF coalesce(_paid, 0) < 0 THEN
    RAISE EXCEPTION 'Paid amount cannot be negative';
  END IF;

  -- ============================================================== VALIDATION
  FOR v_line IN
    SELECT r.o_product_id AS product_id, sum(r.o_quantity) AS quantity
    FROM jsonb_array_elements(_items) AS line
    CROSS JOIN LATERAL public.resolve_sale_line(line) AS r
    WHERE r.o_stock_effect = 'STOCK_ISSUE'
    GROUP BY r.o_product_id
    ORDER BY r.o_product_id
  LOOP
    SELECT i.quantity INTO v_available
    FROM public.inventory i
    WHERE i.product_id = v_line.product_id
      AND i.warehouse_id = _warehouse_id
      AND i.owner_type = 'COMPANY'
      AND i.owner_id IS NULL
    FOR UPDATE;

    v_available := coalesce(v_available, 0);

    IF v_available < v_line.quantity THEN
      RAISE EXCEPTION
        'Insufficient stock for item %: available %, requested %',
        v_line.product_id, v_available, v_line.quantity
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  FOR v_line IN
    SELECT r.o_product_id    AS product_id,
           r.o_quantity      AS quantity,
           r.o_service_name  AS service_name,
           coalesce((line ->> 'unit_price')::numeric, 0) AS input_price,
           coalesce((line ->> 'tax_rate')::numeric, 0)   AS input_tax
    FROM jsonb_array_elements(_items) AS line
    CROSS JOIN LATERAL public.resolve_sale_line(line) AS r
  LOOP
    IF v_line.quantity IS NULL OR v_line.quantity <= 0 THEN
      RAISE EXCEPTION 'Every sale line requires a positive quantity';
    END IF;

    IF v_line.product_id IS NULL THEN
      IF coalesce(v_line.service_name, '') = '' THEN
        RAISE EXCEPTION 'Every service line requires a description';
      END IF;
      IF v_line.input_price < 0 OR v_line.input_tax < 0 OR v_line.input_tax > 100 THEN
        RAISE EXCEPTION 'Service line "%" has an invalid price or tax rate', v_line.service_name;
      END IF;
      v_price    := v_line.input_price;
      v_tax_rate := v_line.input_tax;
    ELSE
      SELECT p.sale_price, p.tax_rate, p.is_sellable
        INTO v_price, v_tax_rate, v_sellable
      FROM public.products p
      WHERE p.id = v_line.product_id AND p.is_active = true
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Item % is not available for sale', v_line.product_id;
      END IF;

      IF v_sellable IS NOT TRUE THEN
        RAISE EXCEPTION 'Item % is not marked as sellable', v_line.product_id;
      END IF;

      IF v_price < 0 OR v_tax_rate < 0 OR v_tax_rate > 100 THEN
        RAISE EXCEPTION 'Item % has invalid pricing or tax configuration', v_line.product_id;
      END IF;
    END IF;

    v_line_total := round(v_line.quantity * v_price, 2);
    v_subtotal   := v_subtotal + v_line_total;
    v_tax_total  := v_tax_total + round(v_line_total * v_tax_rate / 100, 2);
  END LOOP;

  v_total := round(v_subtotal + v_tax_total - v_discount, 2);
  IF v_discount > v_subtotal + v_tax_total OR v_total < 0 THEN
    RAISE EXCEPTION 'Discount cannot exceed the invoice amount';
  END IF;

  IF _customer_id IS NOT NULL THEN
    SELECT balance, credit_limit, is_system
      INTO v_customer_balance, v_credit_limit, v_system
    FROM public.customers
    WHERE id = _customer_id AND is_active = true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected customer is unavailable';
    END IF;
  END IF;

  -- Tender above the total is change, not revenue and not credit.
  v_paid := least(coalesce(_paid, 0), v_total);
  v_outstanding := round(v_total - v_paid, 2);

  IF v_outstanding > 0 AND _customer_id IS NULL THEN
    RAISE EXCEPTION 'A customer is required when the sale has an unpaid amount';
  END IF;
  -- P1-6: العميل النقدي لا يحمل ذمة أبداً.
  IF v_outstanding > 0 AND v_system THEN
    RAISE EXCEPTION
      'The system cash customer cannot carry credit — select a real customer for a deferred sale'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_outstanding > 0 AND NOT public.customer_credit_limit_allows(_customer_id, v_outstanding) THEN
    RAISE EXCEPTION
      'Credit limit exceeded: current balance %, requested debt %, limit %',
      coalesce(v_customer_balance, 0), v_outstanding, coalesce(v_credit_limit, 0);
  END IF;

  v_status := 'confirmed'::public.invoice_status;
  v_invoice_number := public.next_invoice_number();

  INSERT INTO public.sales_invoices (
    invoice_number, customer_id, warehouse_id, status, payment_status,
    subtotal, discount, tax, total, paid, payment_method, note, created_by
  )
  VALUES (
    v_invoice_number, _customer_id, _warehouse_id, v_status,
    public.derive_payment_status(v_paid, v_total),
    v_subtotal, v_discount, v_tax_total, v_total, v_paid,
    _payment_method::public.payment_method, nullif(btrim(_note), ''), v_user
  )
    RETURNING id INTO v_invoice_id;

    -- ================================================================== POSTING
    FOR v_line IN
      SELECT r.o_product_id   AS product_id,
             r.o_quantity     AS quantity,
             r.o_stock_effect AS stock_effect,
             r.o_service_name AS service_name,
             coalesce((line ->> 'unit_price')::numeric, 0) AS input_price,
             coalesce((line ->> 'tax_rate')::numeric, 0)   AS input_tax,
             nullif(btrim(coalesce(line ->> 'uom_id', '')), '')::uuid AS uom_id
      FROM jsonb_array_elements(_items) AS line
      CROSS JOIN LATERAL public.resolve_sale_line(line) AS r
    LOOP
      IF v_line.product_id IS NULL THEN
        v_price     := v_line.input_price;
        v_tax_rate  := v_line.input_tax;
        v_line_type := 'AD_HOC_SERVICE';
        v_effect    := 'NONE';
      ELSE
        SELECT p.sale_price, p.tax_rate
          INTO v_price, v_tax_rate
        FROM public.products p WHERE p.id = v_line.product_id;

        v_line_type := public.item_line_type(v_line.product_id, false);
        v_effect    := public.item_stock_effect(v_line.product_id, 'out');

        IF v_effect = 'STOCK_ISSUE' THEN
          PERFORM public.post_stock_delta(
            v_line.product_id,
            _warehouse_id,
            -v_line.quantity,
            NULL,                       -- P0-3: المحرّك يقيّم من الطبقة الفعلية
            'ISSUE'::public.stock_movement_kind,
            'sales_invoice',
            v_invoice_id,
            'POS sale',
            'COMPANY'::public.owner_type,
            NULL,
            'sale'::public.movement_type
          );
        END IF;
      END IF;

      v_line_total := round(v_line.quantity * v_price, 2);
      v_line_tax   := round(v_line_total * v_tax_rate / 100, 2);

      INSERT INTO public.sales_invoice_items (
        invoice_id, product_id, description, quantity, unit_price, discount, tax, total,
        line_type, stock_effect, uom_id
      )
      VALUES (
        v_invoice_id,
        v_line.product_id,
        CASE WHEN v_line.product_id IS NULL THEN v_line.service_name ELSE NULL END,
        v_line.quantity, v_price, 0, v_line_tax, v_line_total + v_line_tax,
        v_line_type, v_effect, v_line.uom_id
      )
      RETURNING id INTO v_last_item_id;

      IF v_line_type = 'AD_HOC_SERVICE' THEN
        INSERT INTO public.ad_hoc_service_lines (
          invoice_id, invoice_item_id, description, quantity, unit_price,
          discount, tax, total, created_by
        )
        VALUES (
          v_invoice_id, v_last_item_id, v_line.service_name, v_line.quantity,
          v_price, 0, v_line_tax, v_line_total + v_line_tax, v_user
        );
      END IF;
    END LOOP;

    IF v_outstanding > 0 THEN
      UPDATE public.customers
      SET balance = round(coalesce(balance, 0) + v_outstanding, 2), updated_at = now()
      WHERE id = _customer_id;

      INSERT INTO public.customer_ledger (
        customer_id, entry_type, debit, reference_id, reference_type,
        occurred_at, created_by, source_key, note
      )
      VALUES (
        _customer_id, 'sale', v_outstanding, v_invoice_id, 'sales_invoice',
        now(), v_user, 'sale:' || v_invoice_id, 'قيد بيع آجل'
      )
      ON CONFLICT (source_key) DO NOTHING;
    END IF;

    INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
    VALUES (v_user, 'sale.posted', 'sales_invoice', v_invoice_id,
      jsonb_build_object(
        'invoice_number', v_invoice_number,
        'warehouse_id', _warehouse_id,
        'customer_id', _customer_id,
        'payment_method', _payment_method,
        'total', v_total,
        'paid', v_paid,
        'outstanding', v_outstanding,
        'line_count', jsonb_array_length(_items)
      ));

    -- الترحيل التلقائي في نفس المعاملة: لا فاتورة مؤكدة بلا قيد.
    PERFORM public.post_sales_invoice(v_invoice_id);

    RETURN v_invoice_id;
  END $function$;

  COMMENT ON FUNCTION public.create_sale(uuid, uuid, text, numeric, numeric, text, jsonb) IS
    'T-06 + P0-3: إنشاء فاتورة مبيعات وتقييم مخزونها وترحيلها للأستاذ في نفس المعاملة.';

  
-- ════════════════════════════════════════════════════════════════════════════
-- P0-4 — قيد إيراد المبيعات: لا يختفي بند خدمة
-- ════════════════════════════════════════════════════════════════════════════
-- JOIN products كان يستبعد البند الحر (product_id = NULL) وبند الصنف الذي لم
-- يُصنَّف (item_class = NULL)، فيفشل الترحيل أو يخرج بلا إيراد. الآن:
--   • الخدمة الحرة تُجمع من ad_hoc_service_lines على حساب الخدمات 4311.
--   • البند بلا تصنيف يذهب إلى 4111 (إيراد مبيعات) بدل أن يسقط.
--   • COGS يقرأ total_cost من الحركة (P0-3) بدل resolve_unit_cost.
--   • سطور الذمم تحمل partner_type/partner_id (P1-7).
CREATE OR REPLACE FUNCTION public.post_sales_invoice(p_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_inv     record;
  v_existing uuid;
  v_entry   uuid;
  v_lines   jsonb := '[]'::jsonb;
  v_cash_acct text;
  v_collectable numeric := 0;
  v_service_total numeric := 0;
  v_cost    record;
  r         record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.has_role(v_user,'owner') OR public.has_role(v_user,'manager')
          OR public.has_role(v_user,'accountant')) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant may post an invoice';
  END IF;

  SELECT * INTO v_inv FROM public.sales_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_inv.status IN ('draft','cancelled') THEN
    RAISE EXCEPTION 'Invoice % is % - only confirmed, paid or partial invoices post',
      v_inv.invoice_number, v_inv.status;
  END IF;

  IF v_inv.paid < 0 THEN
    RAISE EXCEPTION 'Invoice % carries a negative payment (%). A refund is a credit note, not a negative payment.',
      v_inv.invoice_number, v_inv.paid;
  END IF;
  IF v_inv.paid > v_inv.total THEN
    RAISE EXCEPTION 'Invoice % was paid % against a total of %. Fix the invoice before posting - a payment cannot exceed the invoice.',
      v_inv.invoice_number, v_inv.paid, v_inv.total;
  END IF;
  IF v_inv.tax < 0 THEN
    RAISE EXCEPTION 'Invoice % carries a negative tax amount', v_inv.invoice_number;
  END IF;

  SELECT id INTO v_existing
    FROM public.journal_entries
   WHERE source_type = 'sales_invoice' AND source_id = p_invoice_id
     AND status <> 'REVERSED';
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'Invoice % has already been posted to the ledger', v_inv.invoice_number;
  END IF;

  v_cash_acct := public.ledger_account_code_for_payment_method(v_inv.payment_method);
  v_collectable := greatest(v_inv.total - v_inv.paid, 0);

  -- ── الإيراد دائن: بند مُصنَّف حسب item_class ──
  FOR r IN
    SELECT coalesce(p.item_class::text, 'UNCLASSIFIED') AS bucket, sum(it.total) AS amount
      FROM public.sales_invoice_items it
      LEFT JOIN public.products p ON p.id = it.product_id
     WHERE it.invoice_id = p_invoice_id
       AND it.product_id IS NOT NULL
     GROUP BY coalesce(p.item_class::text, 'UNCLASSIFIED')
    HAVING sum(it.total) <> 0
  LOOP
    v_lines := v_lines || jsonb_build_object(
      'account_code', CASE r.bucket
                        WHEN 'BY_PRODUCT' THEN '4211'
                        WHEN 'SERVICE'    THEN '4311'
                        ELSE '4111' END,
      'credit', round(r.amount, 2),
      'memo', 'إيراد ' || r.bucket);
  END LOOP;

  -- ── الإيراد دائن: الخدمة الحرة (بند بلا صنف) ──
  SELECT coalesce(sum(l.total), 0) INTO v_service_total
    FROM public.ad_hoc_service_lines l
   WHERE l.invoice_id = p_invoice_id;
  IF v_service_total <> 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '4311',
      'credit', round(v_service_total, 2),
      'memo', 'إيراد خدمة حرة (AD_HOC_SERVICE)');
  END IF;

  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Invoice % has no revenue lines', v_inv.invoice_number;
  END IF;

  IF v_inv.paid > 0 AND v_cash_acct IS NOT NULL THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', v_cash_acct, 'debit', round(v_inv.paid, 2),
      'memo', 'تحصيل نقدي/بنكي');
  END IF;
  IF v_collectable > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1211', 'debit', round(v_collectable, 2),
      'partner_type', 'customer', 'partner_id', v_inv.customer_id,
      'memo', 'ذمم العميل ' || coalesce(v_inv.invoice_number, ''));
  END IF;

  IF v_inv.tax > 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '2311', 'credit', round(v_inv.tax, 2),
      'memo', 'ضريبة القيمة المضافة المستحقة');
  END IF;

  -- ── تكلفة البضاعة التي خرجت: القيمة الفعلية من حركة المخزون نفسها ──
  FOR v_cost IN
    SELECT p.item_class,
           sum(coalesce(m.total_cost,
                        it.quantity * public.resolve_unit_cost(p.id, v_inv.warehouse_id))) AS cost
      FROM public.sales_invoice_items it
      JOIN public.products p ON p.id = it.product_id
      LEFT JOIN LATERAL (
        SELECT sm.total_cost
          FROM public.stock_movements sm
         WHERE sm.product_id = it.product_id
           AND sm.warehouse_id = v_inv.warehouse_id
           AND sm.source_type = 'sales_invoice'
           AND sm.source_id = p_invoice_id
           AND sm.owner_type = 'COMPANY'
           AND sm.owner_id IS NULL
         ORDER BY sm.created_at DESC
         LIMIT 1
      ) m ON true
     WHERE it.invoice_id = p_invoice_id
       AND it.stock_effect = 'STOCK_ISSUE'
     GROUP BY p.item_class
  LOOP
    IF v_cost.cost IS NULL OR v_cost.cost = 0 THEN
      CONTINUE;
    END IF;
    v_lines := v_lines || jsonb_build_object(
      'account_code', CASE v_cost.item_class
                        WHEN 'RAW_MATERIAL' THEN '1311'
                        WHEN 'BY_PRODUCT'   THEN '1314'
                        ELSE '1313' END,
      'credit', round(v_cost.cost, 2),
      'memo', 'تكلفة ' || coalesce(v_cost.item_class::text, 'UNCLASSIFIED'));
    v_lines := v_lines || jsonb_build_object(
      'account_code', '5111', 'debit', round(v_cost.cost, 2),
      'memo', 'تكلفة البضاعة المباعة');
  END LOOP;

  v_entry := public.create_journal_entry(
    'فاتورة مبيعات ' || v_inv.invoice_number,
    v_inv.created_at::date,
    'sales_invoice', p_invoice_id, true, v_lines);

  RETURN v_entry;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- P0-3 — مشتريات: التكلفة الفعلية تصل للمحرّك بدل تكلفة الكرت
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_purchase(_warehouse_id uuid, _supplier_id uuid, _payment_method text, _paid numeric, _discount numeric, _note text, _items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_id     uuid;
  v_invoice_no     text;
  v_user           uuid := auth.uid();
  v_item           jsonb;
  v_subtotal       numeric := 0;
  v_tax_total      numeric := 0;
  v_total          numeric := 0;
  v_qty            numeric;
  v_cost           numeric;
  v_tax_rate       numeric;
  v_line_total     numeric;
  v_line_tax       numeric;
  v_product        uuid;
  v_effect         text;
  v_type           text;
  v_purchasable    boolean;
  v_system         boolean := false;
  v_supplier_balance numeric;
  v_paid           numeric;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_staff(v_user) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse required';
  END IF;
  IF _supplier_id IS NULL THEN
    RAISE EXCEPTION 'Supplier required';
  END IF;
  IF coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'No items';
  END IF;

  ------------------------------------------------------------------ validate
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty      := (v_item ->> 'quantity')::numeric;
    v_cost     := (v_item ->> 'unit_cost')::numeric;
    v_tax_rate := coalesce((v_item ->> 'tax_rate')::numeric, 0);

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid quantity';
    END IF;
    IF v_cost IS NULL OR v_cost < 0 THEN
      RAISE EXCEPTION 'Invalid unit cost';
    END IF;
    IF v_tax_rate < 0 OR v_tax_rate > 100 THEN
      RAISE EXCEPTION 'Invalid tax rate';
    END IF;
    IF (v_item ->> 'product_id') IS NOT NULL THEN
      SELECT p.is_purchasable INTO v_purchasable
      FROM public.products p WHERE p.id = (v_item ->> 'product_id')::uuid;

      IF v_purchasable IS NOT TRUE THEN
        RAISE EXCEPTION 'Item % is not marked as purchasable', v_item ->> 'product_id';
      END IF;
    END IF;

    v_line_total := v_qty * v_cost;
    v_line_tax   := v_line_total * v_tax_rate / 100;
    v_subtotal   := v_subtotal + v_line_total;
    v_tax_total  := v_tax_total + v_line_tax;
  END LOOP;

  v_total := v_subtotal + v_tax_total - coalesce(_discount, 0);
  v_invoice_no := public.next_purchase_number();

  SELECT balance, is_system INTO v_supplier_balance, v_system
    FROM public.suppliers WHERE id = _supplier_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected supplier is unavailable';
  END IF;
  IF coalesce(_paid, 0) < v_total AND v_system THEN
    RAISE EXCEPTION
      'The system cash supplier cannot carry a payable balance — record a paid purchase or choose a real supplier'
      USING ERRCODE = 'check_violation';
  END IF;

  v_paid := least(coalesce(_paid, 0), v_total);

  INSERT INTO public.purchase_invoices (
    invoice_number, supplier_id, warehouse_id, status, payment_status,
    subtotal, discount, tax, total, paid, payment_method, note, created_by
  )
  VALUES (
    v_invoice_no, _supplier_id, _warehouse_id,
    'confirmed'::public.invoice_status,
    public.derive_payment_status(v_paid, v_total),
    v_subtotal, coalesce(_discount, 0), v_tax_total, v_total, v_paid,
    _payment_method::public.payment_method, nullif(btrim(_note), ''), v_user
  )
  RETURNING id INTO v_invoice_id;

  --------------------------------------------------------------------- post
  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_product  := (v_item ->> 'product_id')::uuid;
    v_qty      := (v_item ->> 'quantity')::numeric;
    v_cost     := (v_item ->> 'unit_cost')::numeric;
    v_tax_rate := coalesce((v_item ->> 'tax_rate')::numeric, 0);

    v_line_total := v_qty * v_cost;
    v_line_tax   := v_line_total * v_tax_rate / 100;

    SELECT r.o_line_type, r.o_stock_effect
      INTO v_type, v_effect
    FROM public.resolve_purchase_line(v_item) AS r;

    INSERT INTO public.purchase_invoice_items (
      invoice_id, product_id, quantity, unit_cost, discount, tax, total,
      line_type, stock_effect
    )
    VALUES (
      v_invoice_id, v_product, v_qty, v_cost, 0, v_line_tax, v_line_total + v_line_tax,
      v_type, v_effect
    );

    IF v_effect = 'STOCK_RECEIPT' AND v_product IS NOT NULL THEN
      PERFORM public.post_stock_delta(
        v_product,
        _warehouse_id,
        v_qty,
        v_cost,
        'RECEIPT'::public.stock_movement_kind,
        'purchase_invoice',
        v_invoice_id,
        'Purchase receipt',
        'COMPANY'::public.owner_type,
        NULL,
        'purchase'::public.movement_type
      );
    END IF;
  END LOOP;

  IF v_total - v_paid > 0 THEN
    UPDATE public.suppliers
    SET balance = balance + (v_total - v_paid), updated_at = now()
    WHERE id = _supplier_id;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'purchase.posted', 'purchase_invoice', v_invoice_id,
    jsonb_build_object(
      'invoice_number', v_invoice_no,
      'supplier_id', _supplier_id,
      'warehouse_id', _warehouse_id,
      'total', v_total,
      'paid', v_paid,
      'line_count', jsonb_array_length(_items)
    ));

  -- الترحيل التلقائي للأستاذ في نفس المعاملة.
  PERFORM public.post_purchase_invoice(v_invoice_id);

  RETURN v_invoice_id;
END $function$;

-- ════════════════════════════════════════════════════════════════════════════
-- P0-1 — مرتجع المبيعات مربوط بالفاتورة الأصلية
-- ════════════════════════════════════════════════════════════════════════════
-- قبل: الدالة تأخذ الصنف والكمية والسعر من الطلب مباشرة، فكان المرتجع يصنع
-- مخزوناً وإيراداً من الهواء. الآن:
--   • الفاتورة إلزامية وموجودة ومؤكدة (لا مرتجع على مسودة/ملغاة).
--   • العميل والمستودع يُشتقان من الفاتورة، ويُرفض أي اختلاف في الطلب.
--   • البنود تُقفل، والسعر والضريبة يُشتقان من بند الفاتورة.
--   • الكمية المرتجعة ≤ (المبيع − المرتجعات السابقة) لكل بند، مجمّعة.
--   • القيد يُنشأ دائماً — بما فيه البيع النقدي بلا عميل (الطرف النقدي).
CREATE OR REPLACE FUNCTION public.create_sales_return(
  _invoice_id uuid,
  _warehouse_id uuid,
  _customer_id uuid,
  _refund_method text,
  _note text,
  _items jsonb
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id        uuid;
  v_no        text;
  v_user      uuid := auth.uid();
  v_item      jsonb;
  v_sub       numeric := 0;
  v_tax       numeric := 0;
  v_tot       numeric := 0;
  v_qty       numeric;
  v_price     numeric;
  v_tr        numeric;
  v_lt        numeric;
  v_ltax      numeric;
  v_p         uuid;
  v_effect    text;
  v_type      text;
  v_entry     uuid;
  v_lines     jsonb := '[]'::jsonb;
  v_cash_acct text;
  r           record;
  v_debits    numeric := 0;
  v_credits   numeric := 0;
  v_inv       record;
  v_sold      numeric;
  v_returned  numeric;
  v_bad       record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_staff(v_user) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _invoice_id IS NULL THEN
    RAISE EXCEPTION 'A sales return must be linked to its original invoice';
  END IF;
  IF coalesce(jsonb_array_length(_items), 0) = 0 THEN
    RAISE EXCEPTION 'No items';
  END IF;
  IF _refund_method IS NULL
     OR NOT (_refund_method::public.payment_method = ANY (ARRAY['cash','card','bank_transfer','mobile_money','split']::public.payment_method[])) THEN
    RAISE EXCEPTION 'A return refund method cannot be credit — pick the account the money leaves from';
  END IF;

  -- ── الفاتورة الأصلية: مقفولة، مؤكدة، وبطرفيها ───────────────────────────
  SELECT * INTO v_inv FROM public.sales_invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original invoice % does not exist', _invoice_id;
  END IF;
  IF v_inv.status IN ('draft', 'cancelled') THEN
    RAISE EXCEPTION 'Invoice % is % - a return needs a confirmed sale', v_inv.invoice_number, v_inv.status;
  END IF;
  IF _customer_id IS NOT NULL AND v_inv.customer_id IS DISTINCT FROM _customer_id THEN
    RAISE EXCEPTION 'The return customer does not match the invoice customer';
  END IF;
  IF _warehouse_id IS NOT NULL AND v_inv.warehouse_id IS DISTINCT FROM _warehouse_id THEN
    RAISE EXCEPTION 'A return must go back to the invoice warehouse (%)', v_inv.warehouse_id;
  END IF;

  -- ── السعر والضريبة من بند الفاتورة، والكمية ضد المتبقي القابل للمرتجع ───
  FOR r IN
    SELECT (src.item ->> 'product_id')::uuid AS product_id,
           sum(coalesce((src.item ->> 'quantity')::numeric, 0)) AS quantity
      FROM jsonb_array_elements(_items) AS src(item)
     GROUP BY (src.item ->> 'product_id')::uuid
  LOOP
    IF r.product_id IS NULL THEN
      RAISE EXCEPTION 'A sales return line must reference a catalogue item';
    END IF;
    IF coalesce(r.quantity, 0) <= 0 THEN
      RAISE EXCEPTION 'Every returned line needs a positive quantity';
    END IF;

    SELECT coalesce(sum(it.quantity), 0) INTO v_sold
      FROM public.sales_invoice_items it
     WHERE it.invoice_id = _invoice_id AND it.product_id = r.product_id;

    IF v_sold <= 0 THEN
      RAISE EXCEPTION 'Item % is not on invoice %', r.product_id, v_inv.invoice_number;
    END IF;

    SELECT coalesce(sum(ri.quantity), 0) INTO v_returned
      FROM public.sales_return_items ri
      JOIN public.sales_returns sr ON sr.id = ri.return_id
     WHERE sr.invoice_id = _invoice_id AND ri.product_id = r.product_id;

    IF v_returned + r.quantity > v_sold THEN
      RAISE EXCEPTION
        'Return exceeds what was sold for item %: sold %, already returned %, requested %',
        r.product_id, v_sold, v_returned, r.quantity
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  -- ── المجاميع من بنود الفاتورة، لا من الطلب ─────────────────────────────
  FOR r IN
    SELECT (src.item ->> 'product_id')::uuid AS product_id,
           sum(coalesce((src.item ->> 'quantity')::numeric, 0)) AS quantity,
           (SELECT sum(sit.unit_price * sit.quantity) / nullif(sum(sit.quantity), 0)
              FROM public.sales_invoice_items sit
             WHERE sit.invoice_id = _invoice_id
               AND sit.product_id = (src.item ->> 'product_id')::uuid) AS unit_price,
           (SELECT sum(sit.tax) / nullif(sum(sit.quantity), 0)
              FROM public.sales_invoice_items sit
             WHERE sit.invoice_id = _invoice_id
               AND sit.product_id = (src.item ->> 'product_id')::uuid) AS unit_tax
      FROM jsonb_array_elements(_items) AS src(item)
     GROUP BY (src.item ->> 'product_id')::uuid
  LOOP
    v_sub := v_sub + round(coalesce(r.unit_price, 0) * r.quantity, 2);
    v_tax := v_tax + round(coalesce(r.unit_tax, 0) * r.quantity, 2);
  END LOOP;

  -- خصم الفاتورة موزّعاً بنسبة قيمة المرتجع، فلا يعود العميل مديناً بخصم لم يُعَد.
  IF coalesce(v_inv.subtotal, 0) > 0 AND coalesce(v_inv.discount, 0) > 0 THEN
    v_tot := round(v_sub * (1 - least(1, v_inv.discount / v_inv.subtotal)) + v_tax, 2);
  ELSE
    v_tot := round(v_sub + v_tax, 2);
  END IF;
  IF v_tot <= 0 THEN
    RAISE EXCEPTION 'The return value must be greater than zero';
  END IF;

  v_no := public.next_sales_return_number();

  INSERT INTO public.sales_returns (
    return_number, invoice_id, customer_id, warehouse_id,
    subtotal, tax, total, refund_method, note, created_by
  )
  VALUES (
    v_no, _invoice_id, coalesce(_customer_id, v_inv.customer_id), v_inv.warehouse_id,
    round(v_sub, 2), round(v_tax, 2), v_tot, _refund_method::public.payment_method,
    nullif(btrim(_note), ''), v_user
  )
  RETURNING id INTO v_id;

  FOR r IN
    SELECT (src.item ->> 'product_id')::uuid AS product_id,
           sum(coalesce((src.item ->> 'quantity')::numeric, 0)) AS quantity
      FROM jsonb_array_elements(_items) AS src(item)
     GROUP BY (src.item ->> 'product_id')::uuid
  LOOP
    v_p   := r.product_id;
    v_qty := r.quantity;

    SELECT sum(it.unit_price * it.quantity) / nullif(sum(it.quantity), 0),
           sum(it.tax) / nullif(sum(it.quantity), 0)
      INTO v_price, v_ltax
      FROM public.sales_invoice_items it
     WHERE it.invoice_id = _invoice_id AND it.product_id = v_p;

    v_price := round(coalesce(v_price, 0), 2);
    v_lt    := round(v_qty * v_price, 2);
    v_ltax  := round(coalesce(v_ltax, 0) * v_qty, 2);

    v_type   := public.item_line_type(v_p, false);
    v_effect := public.item_stock_effect(v_p, 'in');

    INSERT INTO public.sales_return_items (
      return_id, product_id, quantity, unit_price, tax, total, line_type
    )
    VALUES (v_id, v_p, v_qty, v_price, v_ltax, v_lt + v_ltax, v_type);

    IF v_effect = 'STOCK_RECEIPT' THEN
      PERFORM public.post_stock_delta(
        v_p,
        v_inv.warehouse_id,
        v_qty,
        NULL,  -- التقييم بمتوسط الطبقة الحالية (P0-3)
        'RECEIPT'::public.stock_movement_kind,
        'sales_return',
        v_id,
        'Sales return',
        'COMPANY'::public.owner_type,
        NULL,
        'sale_return'::public.movement_type
      );
    END IF;
  END LOOP;

  -- العميل فقط إن كان للفاتورة عميل. النقدي يُسوّى على الصندوق/البنك في القيد.
  IF v_inv.customer_id IS NOT NULL THEN
    UPDATE public.customers
    SET balance = round(coalesce(balance, 0) - v_tot, 2), updated_at = now()
    WHERE id = v_inv.customer_id;

    INSERT INTO public.customer_ledger (
      customer_id, entry_type, credit, reference_id, reference_type,
      occurred_at, created_by, source_key, note
    )
    VALUES (
      v_inv.customer_id, 'return', round(v_tot, 2), v_id, 'sales_return',
      now(), v_user, 'return:' || v_id, 'مرتجع مبيعات'
    )
    ON CONFLICT (source_key) DO NOTHING;
  END IF;

  -- ── القيد: يعكس إيراد البيع وضريبته وCOGS، وللفاتورة النقدية يخرج نقداً ──
  FOR r IN
    SELECT coalesce(p.item_class::text, 'UNCLASSIFIED') AS bucket,
           sum(ri.total - coalesce(ri.tax, 0)) AS net_amount
      FROM public.sales_return_items ri
      LEFT JOIN public.products p ON p.id = ri.product_id
     WHERE ri.return_id = v_id
     GROUP BY coalesce(p.item_class::text, 'UNCLASSIFIED')
    HAVING sum(ri.total - coalesce(ri.tax, 0)) <> 0
  LOOP
    v_lines := v_lines || jsonb_build_object(
      'account_code', CASE r.bucket
                        WHEN 'BY_PRODUCT' THEN '4211'
                        WHEN 'SERVICE'    THEN '4311'
                        ELSE '4111' END,
      'debit', round(r.net_amount, 2),
      'memo', 'مرتجع إيراد ' || r.bucket);
  END LOOP;

  IF v_tax <> 0 THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', '2311', 'debit', round(v_tax, 2),
      'memo', 'عكس ضريبة القيمة المضافة');
  END IF;

  v_cash_acct := public.payment_method_ledger_account(_refund_method);
  IF v_cash_acct IS NOT NULL THEN
    v_lines := v_lines || jsonb_build_object(
      'account_code', v_cash_acct, 'credit', round(v_tot, 2),
      'memo', 'استرداد للعميل');
  ELSE
    v_lines := v_lines || jsonb_build_object(
      'account_code', '1211', 'credit', round(v_tot, 2),
      'partner_type', 'customer', 'partner_id', v_inv.customer_id,
      'memo', 'عكس ذم العميل');
  END IF;

  -- عكس COGS بقيمة الحركة الفعلية التي أعادتها post_stock_delta.
  FOR r IN
    SELECT p.item_class,
           sum(coalesce(sm.total_cost, 0)) AS cost
      FROM public.sales_return_items ri
      JOIN public.products p ON p.id = ri.product_id
      LEFT JOIN public.stock_movements sm
        ON sm.product_id = ri.product_id
       AND sm.source_type = 'sales_return'
       AND sm.source_id = v_id
       AND sm.warehouse_id = v_inv.warehouse_id
     WHERE ri.return_id = v_id
       AND public.item_stock_effect(ri.product_id, 'in') = 'STOCK_RECEIPT'
     GROUP BY p.item_class
  LOOP
    IF r.cost IS NULL OR r.cost = 0 THEN
      CONTINUE;
    END IF;
    v_lines := v_lines || jsonb_build_object(
      'account_code', CASE r.item_class
                        WHEN 'RAW_MATERIAL' THEN '1311'
                        WHEN 'BY_PRODUCT'   THEN '1314'
                        ELSE '1313' END,
      'debit', round(r.cost, 2),
      'memo', 'مرتجع مخزون ' || r.item_class);
    v_lines := v_lines || jsonb_build_object(
      'account_code', '5111', 'credit', round(r.cost, 2),
      'memo', 'عكس تكلفة البضاعة المباعة');
  END LOOP;

  SELECT coalesce(sum((ln->>'debit')::numeric), 0),
         coalesce(sum((ln->>'credit')::numeric), 0)
    INTO v_debits, v_credits
    FROM jsonb_array_elements(v_lines) AS ln;

  IF v_debits > 0 OR v_credits > 0 THEN
    v_entry := public.balance_and_post_return(
      'مرتجع مبيعات ' || v_no, CURRENT_DATE, 'sales_return', v_id, v_lines);
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'sales_return.posted', 'sales_return', v_id,
    jsonb_build_object(
      'return_number', v_no,
      'invoice_id', _invoice_id,
      'customer_id', v_inv.customer_id,
      'total', v_tot,
      'journal_entry_id', v_entry
    ));

  RETURN v_id;
END $function$;

COMMENT ON FUNCTION public.create_sales_return(uuid, uuid, uuid, text, text, jsonb) IS
  'P0-1: مرتجع مبيعات مربوط بفاتورته الأصلية — بنود مقفولة، كميات مرتجعة محسوبة، وسعر وضريبة من الفاتورة.';

-- ════════════════════════════════════════════════════════════════════════════
-- P0-2 — مصدر فريد لكل دفعة تصنيع وكل عملية صرف مستهلكات
-- ════════════════════════════════════════════════════════════════════════════
-- كان القيد يُنسب إلى grain_item_id (التصنيع) أو warehouse_id (الصرف)،
-- فيمنع uq_journal_source_active الدفعة الثانية لنفس القمح أو ثاني صرف من نفس
-- المستودع. الآن كل عملية تحمل معرّف مستند خاصاً بها (v_doc_id)، وهو نفسه
-- source_id لحركات المخزون والقيد، والمرجع النصي الظاهر يبقى في الملاحظة
-- وفي payload سجل التدقيق.
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
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_ref text;
  v_doc_id uuid := gen_random_uuid();
  v_output_value numeric := 0;
  v_grain_cost numeric;
  v_total_input_cost numeric;
  v_total_output_qty numeric := 0;
  v_waste_qty numeric := 0;
  v_waste_cost numeric := 0;
  v_allocatable_cost numeric := 0;
  v_total_allocated numeric := 0;
  v_line_allocated numeric;
  v_line_idx int := 0;
  v_outputs_count int;
  r record;
  v_last_out numeric;
  v_journal_lines jsonb := '[]'::jsonb;
  v_acct_code text;
  v_item_name text;
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

  IF NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = _grain_item_id AND item_class = 'RAW_MATERIAL' AND is_active
  ) THEN
    RAISE EXCEPTION 'Input must be an active RAW_MATERIAL grain';
  END IF;

  v_outputs_count := jsonb_array_length(_outputs);

  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs) AS o(item_id uuid, qty numeric)
  LOOP
    IF r.item_id IS NULL OR coalesce(r.qty, 0) <= 0 THEN
      RAISE EXCEPTION 'Every output line needs an item and a positive quantity';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.products
      WHERE id = r.item_id AND item_class IN ('FINISHED_GOOD', 'BY_PRODUCT') AND is_active
    ) THEN
      RAISE EXCEPTION 'Outputs must be FINISHED_GOOD or BY_PRODUCT items';
    END IF;

    SELECT coalesce(r.qty, 0) * coalesce(sale_price, 0) INTO v_last_out
    FROM public.products WHERE id = r.item_id;

    v_output_value := v_output_value + coalesce(v_last_out, 0);
    v_total_output_qty := v_total_output_qty + coalesce(r.qty, 0);
  END LOOP;

  IF v_output_value <= 0 THEN
    RAISE EXCEPTION 'Outputs must have sale prices to allocate cost by relative value';
  END IF;

  IF v_total_output_qty > _grain_qty THEN
    RAISE EXCEPTION 'Total output weight (%) cannot exceed input grain weight (%)',
      v_total_output_qty, _grain_qty;
  END IF;

  -- تكلفة القمح من طبقات التكلفة الفعلية أو كتالوج التكلفة
  SELECT coalesce(
    (SELECT sum(cl.quantity * cl.last_unit_cost) / nullif(sum(cl.quantity), 0)
       FROM public.item_cost_layers cl
      WHERE cl.product_id = _grain_item_id AND cl.quantity > 0
        AND cl.owner_type = 'COMPANY'),
    (SELECT cost_price FROM public.products WHERE id = _grain_item_id),
    0
  ) INTO v_grain_cost;

  v_total_input_cost := round(coalesce(_grain_qty, 0) * coalesce(v_grain_cost, 0), 2);
  v_ref := 'SM-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.milling_service_seq')::text, 4, '0');

  v_waste_qty := greatest(0, coalesce(_grain_qty, 0) - v_total_output_qty);
  IF v_waste_qty > 0 AND v_grain_cost > 0 THEN
    v_waste_cost := round(v_waste_qty * v_grain_cost, 2);
  ELSE
    v_waste_cost := 0;
  END IF;

  v_allocatable_cost := greatest(0, v_total_input_cost - v_waste_cost);

  -- 1) صادر القمح (ينقص المخزون ويقيَّم بنفس المعاملة)
  PERFORM public.post_stock_delta(
    _grain_item_id, _warehouse_id, -coalesce(_grain_qty, 0), v_grain_cost,
    'PRODUCTION'::public.stock_movement_kind, 'smart_manufacture', v_doc_id,
    'تصنيع ذكي ' || v_ref || coalesce(' — ' || _notes, ''),
    'COMPANY'::public.owner_type, NULL, 'production_out'::public.movement_type);

  -- 2) وارد النواتج بتكلفة موزعة وبناء أطراف القيد المدين للنواتج
  FOR r IN SELECT * FROM jsonb_to_recordset(_outputs) AS o(item_id uuid, qty numeric)
  LOOP
    DECLARE
      v_line_value numeric;
      v_unit_cost numeric;
      v_item_class text;
    BEGIN
      v_line_idx := v_line_idx + 1;
      SELECT coalesce(r.qty, 0) * coalesce(sale_price, 0), item_class, coalesce(name_ar, name)
        INTO v_line_value, v_item_class, v_item_name
      FROM public.products WHERE id = r.item_id;

      IF v_line_idx = v_outputs_count THEN
        v_line_allocated := v_allocatable_cost - v_total_allocated;
      ELSE
        v_line_allocated := round(v_allocatable_cost * (coalesce(v_line_value, 0) / v_output_value), 2);
        v_total_allocated := v_total_allocated + v_line_allocated;
      END IF;

      v_unit_cost := round(v_line_allocated / nullif(coalesce(r.qty, 0), 0), 4);

      PERFORM public.post_stock_delta(
        r.item_id, _warehouse_id, coalesce(r.qty, 0), v_unit_cost,
        'PRODUCTION'::public.stock_movement_kind, 'smart_manufacture', v_doc_id,
        'تصنيع ذكي ' || v_ref || coalesce(' — ' || _notes, ''),
        'COMPANY'::public.owner_type, NULL, 'production_in'::public.movement_type);

      IF v_item_class = 'BY_PRODUCT' THEN
        v_acct_code := '1314';
      ELSE
        v_acct_code := '1313';
      END IF;

      IF v_line_allocated > 0 THEN
        v_journal_lines := v_journal_lines || jsonb_build_object(
          'account_code', v_acct_code,
          'debit', v_line_allocated,
          'credit', 0,
          'memo', 'إنتاج مخزون ' || v_item_name || ' (' || v_ref || ')'
        );
      END IF;
    END;
  END LOOP;

  IF v_waste_cost > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_object(
      'account_code', '5921',
      'debit', v_waste_cost,
      'credit', 0,
      'memo', 'فاقد وتلف تشغيلي مطحنة (' || v_ref || ')'
    );
  END IF;

  IF v_total_input_cost > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_object(
      'account_code', '1311',
      'debit', 0,
      'credit', v_total_input_cost,
      'memo', 'سحب قمح خام للتصنيع (' || v_ref || ')'
    );

    PERFORM public.create_journal_entry(
      'تصنيع ذكي ' || v_ref || coalesce(' — ' || _notes, ''),
      CURRENT_DATE,
      'smart_manufacture',
      v_doc_id,                -- P0-2: معرّف الدفعة لا معرّف صنف القمح
      true,
      v_journal_lines
    );
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'manufacture.smart', 'stock_movements', v_doc_id,
    jsonb_build_object(
      'doc_id', v_doc_id,
      'ref', v_ref,
      'warehouse_id', _warehouse_id,
      'grain_item_id', _grain_item_id,
      'grain_qty', coalesce(_grain_qty, 0),
      'grain_unit_cost', v_grain_cost,
      'waste_qty', v_waste_qty,
      'waste_cost', v_waste_cost,
      'total_cost', v_total_input_cost,
      'outputs', _outputs,
      'allocation', 'RELATIVE_SALES_VALUE'
    ));

  RETURN v_ref;
END $function$;

CREATE OR REPLACE FUNCTION public.consume_internal_supplies(
  _warehouse_id uuid,
  _lines jsonb,
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
  r record;
  v_unit_cost numeric;
  v_line_cost numeric;
  v_total_cost numeric := 0;
  v_journal_lines jsonb := '[]'::jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.can_operate_milling() THEN
    RAISE EXCEPTION 'You are not permitted to issue internal consumables';
  END IF;
  IF _warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Warehouse is required';
  END IF;
  IF _lines IS NULL OR jsonb_typeof(_lines) <> 'array' OR jsonb_array_length(_lines) = 0 THEN
    RAISE EXCEPTION 'At least one consumable line is required';
  END IF;

  FOR r IN SELECT * FROM jsonb_to_recordset(_lines) AS l(item_id uuid, qty numeric)
  LOOP
    IF r.item_id IS NULL OR coalesce(r.qty, 0) <= 0 THEN
      RAISE EXCEPTION 'Every line needs an item and a positive quantity';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.products
      WHERE id = r.item_id AND item_class IN ('NON_STOCK_ITEM', 'PACKAGING') AND is_active
    ) THEN
      RAISE EXCEPTION 'Only consumable (NON_STOCK_ITEM / PACKAGING) items may be issued here';
    END IF;
  END LOOP;

  v_ref := 'CS-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.milling_service_seq')::text, 4, '0');

  FOR r IN SELECT * FROM jsonb_to_recordset(_lines) AS l(item_id uuid, qty numeric)
  LOOP
    SELECT coalesce(
      (SELECT sum(cl.quantity * cl.last_unit_cost) / nullif(sum(cl.quantity), 0)
         FROM public.item_cost_layers cl
        WHERE cl.product_id = r.item_id AND cl.quantity > 0
          AND cl.owner_type = 'COMPANY'),
      (SELECT cost_price FROM public.products WHERE id = r.item_id),
      0
    ) INTO v_unit_cost;

    v_line_cost := round(coalesce(r.qty, 0) * coalesce(v_unit_cost, 0), 2);
    v_total_cost := v_total_cost + v_line_cost;

    PERFORM public.post_stock_delta(
      r.item_id, _warehouse_id, -coalesce(r.qty, 0), v_unit_cost,
      'ISSUE'::public.stock_movement_kind, 'internal_consumables', v_doc_id,
      'صرف مستهلكات داخلي ' || v_ref || coalesce(' — ' || _notes, ''),
      'COMPANY'::public.owner_type, NULL, 'adjustment'::public.movement_type);
  END LOOP;

  IF v_total_cost > 0 THEN
    v_journal_lines := jsonb_build_array(
      jsonb_build_object(
        'account_code', '5316',
        'debit', v_total_cost,
        'credit', 0,
        'memo', 'مصروف مواد تعبئة وتغليف مستهلكة (' || v_ref || ')'
      ),
      jsonb_build_object(
        'account_code', '1315',
        'debit', 0,
        'credit', v_total_cost,
        'memo', 'منصرف مخزون مواد التعبئة (' || v_ref || ')'
      )
    );

    PERFORM public.create_journal_entry(
      'صرف مستهلكات تعبئة وتشغيل ' || v_ref || coalesce(' — ' || _notes, ''),
      CURRENT_DATE,
      'consume_internal_supplies',
      v_doc_id,                -- P0-2: معرّف العملية لا معرّف المستودع
      true,
      v_journal_lines
    );
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'consumables.issued', 'stock_movement', v_doc_id,
    jsonb_build_object(
      'doc_id', v_doc_id,
      'ref', v_ref,
      'warehouse_id', _warehouse_id,
      'lines', _lines,
      'total_cost', v_total_cost,
      'notes', _notes
    ));

  RETURN v_ref;
END $function$;

-- ════════════════════════════════════════════════════════════════════════════
-- P1-1 — أساس التسعير في فاتورة أجور الطحن
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.milling_service_documents
  ADD COLUMN IF NOT EXISTS billing_basis text,
  ADD COLUMN IF NOT EXISTS fee_per_unit numeric(14,2),
  ADD COLUMN IF NOT EXISTS fee_quantity numeric(14,3);

COMMENT ON COLUMN public.milling_service_documents.billing_basis IS
  'P1-1: أساس التسعير — PER_BAG (أجرة الكيس × عدد الأكياس) أو PER_KG (أجرة الكيلو × الوزن).';
COMMENT ON COLUMN public.milling_service_documents.fee_per_unit IS
  'P1-1: سعر الوحدة المتعاقد عليه (للكيس أو للكيلو) في هذا المستند.';
COMMENT ON COLUMN public.milling_service_documents.fee_quantity IS
  'P1-1: الكمية المسعّرة (عدد الأكياس أو الكيلوجرامات) التي ضُربت في fee_per_unit.';

-- بند الفاتورة يحمل نفس الأساس، فتظهر «20 كيس × 1,000» في أي قالب طباعة.
CREATE OR REPLACE FUNCTION public.create_milling_service_document(
  _customer_id uuid,
  _warehouse_id uuid,
  _grain_item_id uuid,
  _bags numeric,
  _kg numeric,
  _service_item_id uuid,
  _service_unit_price numeric,
  _discount numeric,
  _payment_method text,
  _paid numeric,
  _notes text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_document_id uuid;
  v_document_number text;
  v_invoice_id uuid;
  v_invoice_number text;
  v_subtotal numeric;
  v_total numeric;
  v_paid numeric;
  v_outstanding numeric;
  v_customer_balance numeric;
  v_credit_limit numeric;
  v_period text := to_char(coalesce(current_date, now()::date), 'MM-YYYY');
  v_basis text;
  v_fee_qty numeric;
  v_fee_per_unit numeric;
  v_description text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (
    public.has_role(v_user, 'owner')
    OR public.has_role(v_user, 'manager')
    OR public.has_role(v_user, 'cashier')
  ) THEN
    RAISE EXCEPTION 'You are not permitted to create milling service documents';
  END IF;
  IF _customer_id IS NULL OR _warehouse_id IS NULL OR _grain_item_id IS NULL
     OR _service_item_id IS NULL THEN
    RAISE EXCEPTION 'Customer, warehouse, grain and service are required';
  END IF;
  IF coalesce(_bags, 0) <= 0 AND coalesce(_kg, 0) <= 0 THEN
    RAISE EXCEPTION 'Record at least one bag or a positive weight';
  END IF;
  IF coalesce(_bags, 0) < 0 OR coalesce(_kg, 0) < 0 THEN
    RAISE EXCEPTION 'Quantities cannot be negative';
  END IF;
  IF coalesce(_service_unit_price, 0) < 0 OR coalesce(_discount, 0) < 0
     OR coalesce(_paid, 0) < 0 THEN
    RAISE EXCEPTION 'Service price, discount and paid amount cannot be negative';
  END IF;
  IF _payment_method NOT IN ('cash', 'card', 'bank_transfer', 'credit', 'mobile_money', 'split') THEN
    RAISE EXCEPTION 'Unsupported payment method';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = _grain_item_id AND item_class = 'RAW_MATERIAL' AND is_active
  ) THEN
    RAISE EXCEPTION 'Intake item must be an active RAW_MATERIAL grain';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.products
    WHERE id = _service_item_id AND item_class = 'SERVICE' AND is_active AND is_sellable
  ) THEN
    RAISE EXCEPTION 'Milling fee item must be an active sellable SERVICE';
  END IF;

  SELECT balance, credit_limit
    INTO v_customer_balance, v_credit_limit
  FROM public.customers
  WHERE id = _customer_id AND is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected customer is unavailable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = _warehouse_id AND is_active) THEN
    RAISE EXCEPTION 'Selected warehouse is unavailable';
  END IF;

  v_subtotal := round(coalesce(_service_unit_price, 0), 2);
  v_total := round(v_subtotal - coalesce(_discount, 0), 2);
  IF v_total < 0 THEN
    RAISE EXCEPTION 'Discount cannot exceed the service fee';
  END IF;
  v_paid := least(round(coalesce(_paid, 0), 2), v_total);
  v_outstanding := round(v_total - v_paid, 2);
  IF _payment_method = 'credit' AND v_paid <> 0 THEN
    RAISE EXCEPTION 'Credit payment method requires zero paid amount';
  END IF;
  IF v_outstanding > 0 AND NOT public.customer_credit_limit_allows(_customer_id, v_outstanding) THEN
    RAISE EXCEPTION
      'Credit limit exceeded: current balance %, requested debt %, limit %',
      coalesce(v_customer_balance, 0), v_outstanding, coalesce(v_credit_limit, 0);
  END IF;

  -- P1-1: أساس التسعير يُخزَّن بدل دفنه في كمية 1 وسعر إجمالي.
  IF coalesce(_bags, 0) > 0 THEN
    v_basis       := 'PER_BAG';
    v_fee_qty     := round(_bags, 3);
    v_fee_per_unit := round(v_subtotal / _bags, 2);
    v_description := format(
      'أجور طحن وتجهيز — %s كيس × %s (فترة الاستلام %s)',
      trim(to_char(_bags, 'FM999999990.###')),
      trim(to_char(v_fee_per_unit, 'FM999999990.00')),
      v_period);
  ELSE
    v_basis       := 'PER_KG';
    v_fee_qty     := round(_kg, 3);
    v_fee_per_unit := round(v_subtotal / nullif(_kg, 0), 2);
    v_description := format(
      'أجور طحن وتجهيز — %s كجم × %s (فترة الاستلام %s)',
      trim(to_char(_kg, 'FM999999990.###')),
      trim(to_char(v_fee_per_unit, 'FM999999990.00')),
      v_period);
  END IF;

  v_invoice_number := public.next_invoice_number();
  INSERT INTO public.sales_invoices (
    invoice_number, customer_id, warehouse_id, status, payment_status,
    subtotal, discount, tax, total, paid, payment_method, note, created_by
  ) VALUES (
    v_invoice_number, _customer_id, _warehouse_id, 'confirmed',
    public.derive_payment_status(v_paid, v_total),
    v_subtotal, round(coalesce(_discount, 0), 2), 0, v_total, v_paid,
    _payment_method::public.payment_method, nullif(btrim(_notes), ''), v_user
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.sales_invoice_items (
    invoice_id, product_id, description, quantity, unit_price, discount, tax, total,
    line_type, stock_effect
  ) VALUES (
    v_invoice_id, _service_item_id, v_description, v_fee_qty, v_fee_per_unit,
    0, 0, v_subtotal, 'SERVICE', 'NONE'
  );

  IF v_outstanding > 0 THEN
    UPDATE public.customers
    SET balance = round(coalesce(balance, 0) + v_outstanding, 2), updated_at = now()
    WHERE id = _customer_id;

    INSERT INTO public.customer_ledger (
      customer_id, entry_type, debit, reference_id, reference_type,
      occurred_at, created_by, source_key, note
    ) VALUES (
      _customer_id, 'sale', v_outstanding, v_invoice_id, 'sales_invoice',
      now(), v_user, 'sale:' || v_invoice_id, 'قيد أجور طحن آجل'
    ) ON CONFLICT (source_key) DO NOTHING;
  END IF;

  PERFORM public.post_sales_invoice(v_invoice_id);

  v_document_number := 'MT-' || to_char(now(), 'YYYYMM') || '-' ||
    lpad(nextval('public.milling_document_seq')::text, 4, '0');
  INSERT INTO public.milling_service_documents (
    document_number, customer_id, warehouse_id, sales_invoice_id, created_by,
    billing_basis, fee_per_unit, fee_quantity
  ) VALUES (
    v_document_number, _customer_id, _warehouse_id, v_invoice_id, v_user,
    v_basis, v_fee_per_unit, v_fee_qty
  ) RETURNING id INTO v_document_id;

  INSERT INTO public.custody_ledger (
    customer_id, warehouse_id, entry_type, item_id, doc_number,
    bags_in, kg_in, milling_document_id, notes, created_by
  ) VALUES (
    _customer_id, _warehouse_id, 'INTAKE', _grain_item_id, v_document_number,
    coalesce(_bags, 0), coalesce(_kg, 0), v_document_id, _notes, v_user
  );

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user, 'milling.service_document.created', 'milling_service_documents', v_document_id,
    jsonb_build_object(
      'document_number', v_document_number,
      'invoice_id', v_invoice_id,
      'invoice_number', v_invoice_number,
      'customer_id', _customer_id,
      'grain_item_id', _grain_item_id,
      'bags', coalesce(_bags, 0),
      'kg', coalesce(_kg, 0),
      'billing_basis', v_basis,
      'fee_per_unit', v_fee_per_unit,
      'fee_quantity', v_fee_qty,
      'service_total', v_total,
      'paid', v_paid,
      'outstanding', v_outstanding,
      'stock_impact', 'NONE — customer custody'
    ));

  RETURN jsonb_build_object(
    'document_id', v_document_id,
    'document_number', v_document_number,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'billing_basis', v_basis,
    'fee_per_unit', v_fee_per_unit,
    'fee_quantity', v_fee_qty
  );
END $function$;

-- ════════════════════════════════════════════════════════════════════════════
-- P1-8 — صلاحيات دوال public: قائمة سماح صريحة
-- ════════════════════════════════════════════════════════════════════════════
-- كان 38 يمنح authenticated تنفيذ *كل* دوال public إلا قائمة استثناءات قصيرة،
-- فكان أي محرّك داخلي جديد يُفتح بالخطأ (post_stock_delta و apply_cost_movement
-- نفساهما كانا في هذه المجموعة قبل سحبهما يدوياً).
-- هنا القاعدة معكوسة: لا تنفيذ ل authenticated إلا لما في القائمة أدناه.
-- أي RPC جديد للواجهة يُضاف هنا في نفس الهجرة التي ينشئه.
DO $$
DECLARE
  v_allowed text[] := ARRAY[
    -- بيع وشراء ومخزون
    'create_sale', 'create_sales_return', 'create_purchase', 'create_purchase_return',
    'create_stock_transfer', 'post_sales_invoice', 'post_purchase_invoice',
    'search_products', 'item_line_type', 'item_stock_effect', 'item_effective_policy',
    'item_has_stock_history', 'resolve_unit_cost', 'receive_stock',
    -- دفعات وذمم
    'record_customer_payment', 'record_supplier_payment', 'get_supplier_statement',
    'adjust_loyalty', 'customer_credit_limit_allows',
    -- أمانات المطحنة (تستدعيها واجهة الكاونتر مباشرة)
    'custody_intake', 'custody_milling', 'custody_deliver', 'custody_adjust',
    'custody_balances', 'custody_link_invoice',
    -- تقييم الحركات: internal engine تُستدعى من شاشات التوريد والتسوية بنفسها
    'post_stock_delta',
    -- مطحنة وأمانات
    'create_milling_service_document', 'smart_manufacture', 'consume_internal_supplies',
    'milling_custody_intake', 'milling_custody_issue_milling', 'milling_custody_deliver',
    'milling_custody_adjust', 'can_operate_milling', 'can_view_milling',
    -- محاسبة وأصول وضرائب
    'create_journal_entry', 'reverse_journal_entry', 'get_chart_of_accounts_tree',
    'activate_fixed_asset', 'dispose_fixed_asset', 'run_depreciation',
    'run_batch_depreciation', 'run_contract_amortization', 'run_batch_amortization',
    'close_fiscal_year', 'open_fiscal_year', 'set_period_status',
    'generate_tax_declaration', 'settle_tax_period', 'pay_tax_settlement',
    -- مصروفات
    'create_expense', 'update_expense', 'submit_expense', 'decide_expense',
    'post_expense', 'close_expense', 'cancel_expense', 'reverse_expense',
    'record_expense_payment', 'reverse_expense_payment',
    'list_expenses', 'expense_detail', 'expense_summary', 'expense_report',
    'expense_lookups', 'save_expense_category', 'delete_expense_category',
    -- طرق الدفع والأطراف
    'create_tenant_payment_method', 'update_payment_method_identity',
    'remove_tenant_payment_method', 'can_author_payment_methods',
    'payment_method_ledger_account', 'ledger_account_code_for_payment_method',
    'is_system_customer', 'is_system_supplier',
    -- نسخ احتياطي وترقيم ومساعدات
    'backup_export_all', 'backup_restore_all', 'backup_schema_fingerprint',
    'fn_next_document_number', 'fn_format_document_number',
    'fn_resolve_document_numbering', 'fn_set_document_numbering',
    'has_role', 'is_staff', 'is_platform_admin', 'is_platform_superadmin',
    'can_read_finance', 'can_read_expense_entry',
    'product_reference_counts', 'warehouse_reference_counts'
  ];
  v_name text;
BEGIN
  -- سحب شامل أولاً، ثم منح القائمة فقط. نستبعد أيضاً صلاحية PUBLIC الافتراضية
  -- لأن كل دور جديد يرثها، فلا يكفي سحبها من authenticated وحده.
  FOR v_name IN
    SELECT p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, authenticated', v_name);
  END LOOP;

  FOR v_name IN
    SELECT p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = ANY (v_allowed)
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_name);
  END LOOP;
END $$;

-- فحص ذاتي: المحرّكات الداخلية يجب أن تبقى غير قابلة للاستدعاء من الواجهة.
-- ملاحظة: proacl فارغ = صلاحية PUBLIC الافتراضية في PostgreSQL، وهي لا تمنح
-- شيئاً هنا لأن كل مستدعي المحرّك SECURITY DEFINER يعمل بصلاحيات المالك.
-- post_stock_delta مسموحة عمداً: شاشتا التوريد والتسوية تنادينها مباشرة
-- (توقّف الكتابة المباشرة على inventory/stock_movements).
DO $$
DECLARE
  v_leak text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_leak
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND p.proname IN (
      'apply_cost_movement', 'next_invoice_number',
      'next_journal_number', 'product_delete_guard',
      'tg_stock_movements_engine_only', 'tg_customers_system_guard',
      'tg_suppliers_system_guard', 'tg_customer_ledger_system_guard'
    );

  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION 'محرّكات داخلية مكشوفة للمستخدم المسجّل: %', v_leak;
  END IF;

END $$;

COMMIT;
