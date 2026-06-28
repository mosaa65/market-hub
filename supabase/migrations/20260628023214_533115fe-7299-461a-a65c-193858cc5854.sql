ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS reference_type TEXT,
  ADD COLUMN IF NOT EXISTS reference_id UUID;

CREATE INDEX IF NOT EXISTS idx_stock_movements_reference
  ON public.stock_movements(reference_type, reference_id);