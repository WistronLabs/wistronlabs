-- 0015-add-pending-mrb-location.sql
-- Add Pending MRB location.

INSERT INTO public.location (name)
SELECT 'Pending MRB'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.location
  WHERE LOWER(name) = LOWER('Pending MRB')
);
