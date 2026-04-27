-- 0009-add-cold-plate-root-cause.sql
-- Add Cold Plate Failure to root cause categories.

INSERT INTO public.root_cause (name)
SELECT 'Cold Plate Failure'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.root_cause
  WHERE LOWER(name) = LOWER('Cold Plate Failure')
);
