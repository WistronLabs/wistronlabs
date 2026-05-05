-- 0012-dpn-multi-config.sql
-- Allow multiple config rows per DPN name while keeping Dell customers unique within a DPN family.

BEGIN;

UPDATE public.dpn
SET config = '1'
WHERE TRIM(COALESCE(config, '')) = '';

ALTER TABLE public.dpn
  ALTER COLUMN config SET DEFAULT '1';

ALTER TABLE public.dpn
  ALTER COLUMN config SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_dpn_config_not_blank'
      AND conrelid = 'public.dpn'::regclass
  ) THEN
    ALTER TABLE public.dpn
      ADD CONSTRAINT chk_dpn_config_not_blank
      CHECK (TRIM(config) <> '');
  END IF;
END $$;

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'dpn'
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) ILIKE '%(name)%'
      AND pg_get_constraintdef(c.oid) NOT ILIKE '%config%'
  LOOP
    EXECUTE format('ALTER TABLE public.dpn DROP CONSTRAINT %I', rec.conname);
  END LOOP;
END $$;

DROP INDEX IF EXISTS public.uq_dpn_name_ci;
DROP INDEX IF EXISTS public.dpn_name_key;

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'dpn'
      AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
      AND indexdef ILIKE '%(name%'
      AND indexdef NOT ILIKE '%config%'
      AND indexname <> 'dpn_pkey'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', rec.indexname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dpn_name_config_ci
  ON public.dpn (UPPER(TRIM(name)), UPPER(TRIM(config)));

COMMIT;
