
-- =========================================
-- PRODUCT BATCHES (expiry & batch tracking)
-- =========================================
CREATE TABLE public.product_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  batch_number TEXT NOT NULL,
  expiry_date DATE,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  note TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, warehouse_id, batch_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_batches TO authenticated;
GRANT ALL ON public.product_batches TO service_role;
ALTER TABLE public.product_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read batches" ON public.product_batches FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Staff write batches" ON public.product_batches FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE TRIGGER set_batches_updated_at BEFORE UPDATE ON public.product_batches FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_batches_expiry ON public.product_batches(expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX idx_batches_product ON public.product_batches(product_id);

-- =========================================
-- AUDIT LOGS
-- =========================================
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff insert audit" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "Owners/managers read audit" ON public.audit_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'manager'));
CREATE INDEX idx_audit_created ON public.audit_logs(created_at DESC);
CREATE INDEX idx_audit_entity ON public.audit_logs(entity_type, entity_id);

-- =========================================
-- LOYALTY
-- =========================================
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS loyalty_points NUMERIC NOT NULL DEFAULT 0;

CREATE TABLE public.loyalty_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  points NUMERIC NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('earn','redeem','adjust')),
  reference_type TEXT,
  reference_id UUID,
  note TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.loyalty_transactions TO authenticated;
GRANT ALL ON public.loyalty_transactions TO service_role;
ALTER TABLE public.loyalty_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read loyalty" ON public.loyalty_transactions FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "Staff write loyalty" ON public.loyalty_transactions FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE INDEX idx_loyalty_customer ON public.loyalty_transactions(customer_id, created_at DESC);

-- RPC: adjust loyalty points atomically
CREATE OR REPLACE FUNCTION public.adjust_loyalty(_customer UUID, _points NUMERIC, _kind TEXT, _note TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id UUID; v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_staff(v_user) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _kind NOT IN ('earn','redeem','adjust') THEN RAISE EXCEPTION 'Invalid kind'; END IF;

  INSERT INTO public.loyalty_transactions(customer_id, points, kind, note, created_by)
  VALUES (_customer, _points, _kind, _note, v_user)
  RETURNING id INTO v_id;

  UPDATE public.customers
    SET loyalty_points = GREATEST(loyalty_points + (CASE WHEN _kind='redeem' THEN -ABS(_points) ELSE ABS(_points) END), 0),
        updated_at = now()
    WHERE id = _customer;

  RETURN v_id;
END $$;
