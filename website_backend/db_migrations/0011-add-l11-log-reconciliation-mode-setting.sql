-- 0011-add-l11-log-reconciliation-mode-setting.sql
-- Add global setting for temporary L11 log reconciliation access.

CREATE TABLE IF NOT EXISTS public.global_settings (
  key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.global_settings (key, value_json)
SELECT 'l11_log_reconciliation_mode', 'false'::jsonb
WHERE NOT EXISTS (
  SELECT 1
  FROM public.global_settings
  WHERE key = 'l11_log_reconciliation_mode'
);
