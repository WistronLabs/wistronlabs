-- 0003-pallet-freeform-assignment.sql
-- Goal:
-- 1) Allow pallets to be created/used without factory/DPN grouping requirements.
-- 2) Preserve all existing pallet rows and pallet numbers (backward compatibility).
-- 3) Keep pallet_number uniqueness and existing historical data intact.

-- Make factory/dpn linkage optional on pallet rows (new pallets can be "mixed").
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pallet'
      AND column_name = 'factory_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.pallet ALTER COLUMN factory_id DROP NOT NULL';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pallet'
      AND column_name = 'dpn_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.pallet ALTER COLUMN dpn_id DROP NOT NULL';
  END IF;
END $$;

-- Drop legacy indexes that encoded factory/DPN grouping behavior.
DROP INDEX IF EXISTS idx_pallet_factory_dpn;
DROP INDEX IF EXISTS idx_pallet_factory_dpn_id;

-- Drop any unique constraints tied to both factory and DPN on pallet.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'pallet'
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) ILIKE '%factory_id%'
      AND (
        pg_get_constraintdef(c.oid) ILIKE '%dpn_id%'
        OR pg_get_constraintdef(c.oid) ILIKE '%dpn%'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.pallet DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- Drop any non-primary indexes combining factory and DPN.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT i.indexname
    FROM pg_indexes i
    WHERE i.schemaname = 'public'
      AND i.tablename = 'pallet'
      AND i.indexdef ILIKE '%factory_id%'
      AND (
        i.indexdef ILIKE '%dpn_id%'
        OR i.indexdef ILIKE '%dpn%'
      )
      AND i.indexname NOT ILIKE '%pkey%'
      AND i.indexname NOT ILIKE '%pallet_number%'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', r.indexname);
  END LOOP;
END $$;

-- Helpful for open/released filtering and daily auto-number scans.
CREATE INDEX IF NOT EXISTS idx_pallet_status_created_at
  ON public.pallet (status, created_at DESC);
