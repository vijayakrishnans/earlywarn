-- 240_desk_submissions
-- A record that a person filed a stage in ENISA's Single Reporting Platform.
-- Bounded context: desk

CREATE TABLE IF NOT EXISTS desk_submissions (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL,
  case_id       TEXT NOT NULL,
  stage         TEXT NOT NULL CHECK (stage IN ('early_warning', 'notification', 'final')),
  fields        TEXT NOT NULL,
  srp_reference TEXT,
  submitted_at  TEXT NOT NULL,
  submitted_by  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  UNIQUE (case_id, stage)
);
-- table desk_submissions: What was filed for each stage. Earlywarn does not file; a person does, then records it here.
-- column desk_submissions.fields: JSON of SRP field id to the value entered. Its hash is on the case's timeline.
