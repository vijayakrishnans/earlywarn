-- 220_desk_cases
-- Reporting cases, their deadlines and a tamper-evident timeline.
-- Bounded context: desk

CREATE TABLE IF NOT EXISTS desk_cases (
  id                        TEXT PRIMARY KEY,
  org_id                    TEXT NOT NULL,
  report_id                 TEXT,
  product_id                TEXT NOT NULL,
  kind                      TEXT NOT NULL CHECK (kind IN ('vulnerability', 'incident')),
  title                     TEXT NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  aware_at                  TEXT NOT NULL,
  aware_recorded_by         TEXT NOT NULL,
  corrective_available_at   TEXT,
  notification_submitted_at TEXT,
  early_warning_due_at      TEXT NOT NULL,
  notification_due_at       TEXT NOT NULL,
  final_due_at              TEXT,
  acknowledged_at           TEXT,
  acknowledged_by           TEXT,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);
-- table desk_cases: One reportable matter. Deadlines derive from aware_at, which a named person records. Every query must scope by org_id.
-- column desk_cases.final_due_at: NULL until its starting fact exists: a corrective measure for a vulnerability, the notification for an incident.
CREATE INDEX IF NOT EXISTS desk_cases_org_idx ON desk_cases (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS desk_cases_open_idx ON desk_cases (status, notification_due_at);

CREATE TABLE IF NOT EXISTS desk_case_events (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL,
  case_id     TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  type        TEXT NOT NULL,
  actor       TEXT NOT NULL,
  payload     TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  prev_hash   TEXT NOT NULL,
  hash        TEXT NOT NULL,
  UNIQUE (case_id, seq)
);
-- table desk_case_events: Append-only by convention, hash-chained timeline. No code path updates or deletes these rows.
-- column desk_case_events.hash: SHA-256 of prev_hash and the canonical JSON of the event; see apps/desk-worker/src/chain.ts.
