-- Add details column which will be stored as a JSON string or string
ALTER TABLE public.station
    ADD COLUMN IF NOT EXISTS details TEXT;