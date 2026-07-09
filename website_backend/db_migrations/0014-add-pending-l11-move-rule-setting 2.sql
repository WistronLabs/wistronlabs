-- 0014-add-pending-l11-move-rule-setting.sql
-- Add global setting to delay moves into Pending L11 Logs after returning to Received.

CREATE TABLE IF NOT EXISTS public.global_settings (
  key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.global_settings (key, value_json)
SELECT
  'pending_l11_move_rule',
  '{"enabled": false, "minutes": 30}'::jsonb
WHERE NOT EXISTS (
  SELECT 1
  FROM public.global_settings
  WHERE key = 'pending_l11_move_rule'
);
