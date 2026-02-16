-- 0002-add-mac-fields.sql
-- host_mac / bmc_mac: exactly 12 uppercase alphanumeric chars, unique per column.

-- 1) Add columns
ALTER TABLE public.system
  ADD COLUMN IF NOT EXISTS host_mac char(12),
  ADD COLUMN IF NOT EXISTS bmc_mac  char(12);

-- 2) Add CHECK constraints (no "IF NOT EXISTS" support for ADD CONSTRAINT)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_system_host_mac_12alnum'
      AND conrelid = 'public.system'::regclass
  ) THEN
    ALTER TABLE public.system
      ADD CONSTRAINT chk_system_host_mac_12alnum
      CHECK (host_mac IS NULL OR host_mac ~ '^[0-9A-Z]{12}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_system_bmc_mac_12alnum'
      AND conrelid = 'public.system'::regclass
  ) THEN
    ALTER TABLE public.system
      ADD CONSTRAINT chk_system_bmc_mac_12alnum
      CHECK (bmc_mac IS NULL OR bmc_mac ~ '^[0-9A-Z]{12}$');
  END IF;
END $$;

-- 3) Unique per column (allow multiple NULLs)
CREATE UNIQUE INDEX IF NOT EXISTS uq_system_host_mac
  ON public.system (host_mac)
  WHERE host_mac IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_system_bmc_mac
  ON public.system (bmc_mac)
  WHERE bmc_mac IS NOT NULL;

