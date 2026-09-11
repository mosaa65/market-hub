-- SAFETY NOTE
-- This file used to truncate every business and identity table as part of a
-- developer seed reset. Migrations are deployed to customer databases, so a
-- reset must never live here. Development-only sample data belongs in
-- `supabase/seeds/` and must be invoked explicitly by developers.
--
-- Keep this historical migration data-safe for fresh installations while
-- retaining the enum compatibility it was intended to provide.

ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'received';
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'completed';
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'unpaid';

ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'mobile_money';

