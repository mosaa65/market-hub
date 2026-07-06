-- Patch ENUMs to be compatible with yemen_stationery_seed.sql
-- This migration only updates ENUM values (does not truncate data).

BEGIN;

-- 1) invoice_status enum values used by seed: draft, received, completed, confirmed, partial, cancelled, returned
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'invoice_status'
  ) THEN
    -- add missing values safely
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM unnest(enum_range(NULL::public.invoice_status)) v(val) WHERE val = 'received') THEN
        ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'received';
      END IF;
    EXCEPTION WHEN others THEN
      -- Fallback for older Postgres: try direct add value
      ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'received';
    END;

    BEGIN
      IF NOT EXISTS (SELECT 1 FROM unnest(enum_range(NULL::public.invoice_status)) v(val) WHERE val = 'completed') THEN
        ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'completed';
      END IF;
    EXCEPTION WHEN others THEN
      ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'completed';
    END;
  END IF;
END $$;

-- 2) payment_method enum values used by seed: cash, card, bank_transfer, credit, mobile_money
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'payment_method'
  ) THEN
    ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'mobile_money';
  END IF;
END $$;

-- 3) movement_type enum values used by seed: purchase, sale, adjustment?, transfer_in/out, return_in/out, opening, plus stock transfer mappings
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'movement_type'
  ) THEN
    -- seed uses: transfer_out, transfer_in, return_in, return_out (already present in initial enum)
    -- no-op for now; kept to indicate intentional compatibility.
    NULL;
  END IF;
END $$;

COMMIT;

