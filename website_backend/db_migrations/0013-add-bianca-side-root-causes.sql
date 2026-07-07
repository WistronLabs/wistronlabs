-- 0013-add-bianca-side-root-causes.sql
-- Rename the existing Bianca Failure root cause and add side-specific variants.

UPDATE public.root_cause
SET name = 'Bianca Failure (Side Unknown)'
WHERE LOWER(name) = LOWER('Bianca Failure');

INSERT INTO public.root_cause (name)
SELECT 'Left Bianca Failure'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.root_cause
  WHERE LOWER(name) = LOWER('Left Bianca Failure')
);

INSERT INTO public.root_cause (name)
SELECT 'Right Bianca Failure'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.root_cause
  WHERE LOWER(name) = LOWER('Right Bianca Failure')
);
