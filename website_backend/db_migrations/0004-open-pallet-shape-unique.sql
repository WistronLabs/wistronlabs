-- 0004-open-pallet-shape-unique.sql
-- Enforce one shape per open pallet (shape uniqueness only within open status).

CREATE UNIQUE INDEX IF NOT EXISTS uq_open_pallet_shape
  ON public.pallet (shape)
  WHERE status = 'open' AND shape IS NOT NULL;
