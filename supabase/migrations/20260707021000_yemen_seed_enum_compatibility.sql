-- Keep schema/default enum values compatible with the Yemen stationery seed.
-- Operational rows live in supabase/seeds/seed.sql.

ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'received';
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'completed';

ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'mobile_money';

ALTER TYPE public.movement_type ADD VALUE IF NOT EXISTS 'purchase_return';
ALTER TYPE public.movement_type ADD VALUE IF NOT EXISTS 'sale_return';
