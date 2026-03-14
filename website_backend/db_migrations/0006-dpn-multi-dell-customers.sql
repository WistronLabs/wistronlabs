-- 0006-dpn-multi-dell-customers.sql
-- Support multiple allowed Dell customers per DPN while preserving legacy fields.

BEGIN;

CREATE TABLE IF NOT EXISTS public.dell_customer (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dell_customer_name_ci
  ON public.dell_customer (LOWER(name));

CREATE TABLE IF NOT EXISTS public.dpn_dell_customer (
  dpn_id INTEGER NOT NULL REFERENCES public.dpn(id) ON DELETE CASCADE,
  dell_customer_id INTEGER NOT NULL REFERENCES public.dell_customer(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (dpn_id, dell_customer_id)
);

-- Compatibility: ensure system has a per-unit Dell customer field.
ALTER TABLE public.system
  ADD COLUMN IF NOT EXISTS dell_customer VARCHAR(255);

-- Seed dell_customer master table from existing dpn baseline values.
INSERT INTO public.dell_customer (name)
SELECT DISTINCT TRIM(d.dell_customer) AS name
FROM public.dpn d
WHERE TRIM(COALESCE(d.dell_customer, '')) <> ''
ON CONFLICT (LOWER(name)) DO NOTHING;

-- Seed mapping table from existing dpn baseline values.
INSERT INTO public.dpn_dell_customer (dpn_id, dell_customer_id)
SELECT d.id, dc.id
FROM public.dpn d
JOIN public.dell_customer dc
  ON LOWER(dc.name) = LOWER(TRIM(d.dell_customer))
WHERE TRIM(COALESCE(d.dell_customer, '')) <> ''
ON CONFLICT (dpn_id, dell_customer_id) DO NOTHING;

-- Backfill per-system value from dpn baseline where missing.
UPDATE public.system s
SET dell_customer = d.dell_customer
FROM public.dpn d
WHERE s.dpn_id = d.id
  AND TRIM(COALESCE(s.dell_customer, '')) = ''
  AND TRIM(COALESCE(d.dell_customer, '')) <> '';

COMMIT;

