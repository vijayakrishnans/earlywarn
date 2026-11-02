-- 230_desk_alerts
-- What the escalation scheduler has sent, so a re-run sends nothing twice.
-- Bounded context: desk

CREATE TABLE IF NOT EXISTS desk_alerts (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('case', 'report')),
  subject_id   TEXT NOT NULL,
  alert_key    TEXT NOT NULL,
  sent_at      TEXT NOT NULL,
  UNIQUE (subject_id, alert_key)
);
-- table desk_alerts: One row per alert delivered. The scheduler is the only reader across organizations.
-- column desk_alerts.alert_key: step-<n>, deadline-<stage>-<percent>, received, or triage-late.
