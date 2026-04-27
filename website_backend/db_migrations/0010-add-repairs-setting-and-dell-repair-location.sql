-- 0010-add-repairs-setting-and-dell-repair-location.sql
-- Add global repairs_allowed setting and Sent for Dell Repair location.

CREATE TABLE IF NOT EXISTS public.global_settings (
  key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.global_settings (key, value_json)
SELECT 'repairs_allowed', 'true'::jsonb
WHERE NOT EXISTS (
  SELECT 1
  FROM public.global_settings
  WHERE key = 'repairs_allowed'
);

INSERT INTO public.location (name)
SELECT 'Sent for Dell Repair'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.location
  WHERE LOWER(name) = LOWER('Sent for Dell Repair')
);
