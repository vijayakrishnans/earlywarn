-- 250_desk_sample_cases
-- Practice cases: visibly not real, and never alerted on.
-- Bounded context: desk

ALTER TABLE desk_cases ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0;
-- column desk_cases.is_sample: 1 for a practice case. The scheduler never reads these and it cannot alert anyone.
