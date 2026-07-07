-- 0005-system-doa-per-unit.sql
-- Add per-unit DOA support on system records and backfill from released pallets.

ALTER TABLE public.system
ADD COLUMN IF NOT EXISTS doa_number VARCHAR(20);

-- Backfill per-unit DOA from pallet-level DOA for released pallets, but only for
-- systems currently still in a resolved location.
UPDATE public.system s
SET doa_number = LEFT(BTRIM(p.doa_number), 20)
FROM public.pallet p
JOIN public.pallet_system ps
  ON ps.pallet_id = p.id
JOIN public.location l
  ON TRUE
WHERE p.status = 'released'
  AND ps.system_id = s.id
  AND l.id = s.location_id
  AND p.doa_number IS NOT NULL
  AND BTRIM(p.doa_number) <> ''
  AND ps.added_at <= p.released_at
  AND COALESCE(ps.removed_at, 'infinity'::timestamptz) >= p.released_at
  AND l.name = ANY (ARRAY['Sent to L11', 'RMA PID', 'RMA VID', 'RMA CID'])
  AND (s.doa_number IS NULL OR BTRIM(s.doa_number) = '');
