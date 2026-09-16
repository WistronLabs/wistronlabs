CREATE TABLE IF NOT EXISTS public.l11_scan_job (
  id uuid PRIMARY KEY,
  system_id integer NOT NULL REFERENCES public.system(id) ON DELETE CASCADE,
  received_event_id integer REFERENCES public.system_location_history(id) ON DELETE SET NULL,
  received_at timestamptz,
  rack_service_tag text NOT NULL,
  requested_by integer REFERENCES public.users(id) ON DELETE SET NULL,
  trigger text NOT NULL,
  batch_id uuid,
  runner_job_id text,
  status text NOT NULL DEFAULT 'queued',
  stdout text NOT NULL DEFAULT '',
  stderr text NOT NULL DEFAULT '',
  error text,
  returncode integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  ended_at timestamptz
);
CREATE INDEX IF NOT EXISTS l11_scan_job_unit_history ON public.l11_scan_job(system_id, created_at DESC);
CREATE INDEX IF NOT EXISTS l11_scan_job_queue ON public.l11_scan_job(status, created_at);
