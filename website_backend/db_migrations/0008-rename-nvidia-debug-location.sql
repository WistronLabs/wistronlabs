-- 0008-rename-nvidia-debug-location.sql
-- Rename the existing location while preserving its id and history links.

UPDATE public.location
SET name = 'Pending L11 Logs'
WHERE name = 'In Debug - Nvidia';
