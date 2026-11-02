-- Production material lines must come from tracked company-owned raw materials
-- or tracked packaging stock. This protects the RPC from accepting finished
-- goods, customer custody, services, or untracked items if a client bypasses
-- the filtered production form.
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_company_production_material_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
BEGIN
  SELECT p.*
    INTO v_product
    FROM public.products p
   WHERE p.id = NEW.product_id
     AND p.is_active
   FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المادة غير موجودة أو غير نشطة' USING ERRCODE = '23514';
  END IF;

  IF v_product.item_class NOT IN ('RAW_MATERIAL', 'PACKAGING')
     OR v_product.item_nature::text = 'SERVICE'
     OR v_product.is_custody_item IS TRUE
     OR public.item_effective_policy(v_product.id)::text <> 'TRACKED' THEN
    RAISE EXCEPTION
      'مواد الإنتاج يجب أن تكون مادة خام أو تعبئة مخزنية مملوكة للمنشأة؛ لا تقبل المنتجات التامة أو أصناف الأمانات'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_company_production_material_scope
  ON public.production_order_materials;

CREATE TRIGGER trg_guard_company_production_material_scope
BEFORE INSERT OR UPDATE ON public.production_order_materials
FOR EACH ROW
EXECUTE FUNCTION public.guard_company_production_material_scope();

REVOKE ALL ON FUNCTION public.guard_company_production_material_scope()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
