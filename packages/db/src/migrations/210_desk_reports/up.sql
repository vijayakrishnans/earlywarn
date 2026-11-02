-- 210_desk_reports
-- Vulnerability reports received through the public disclosure page.
-- Bounded context: desk

CREATE TABLE IF NOT EXISTS desk_reports (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  sealed          TEXT NOT NULL,
  receipt_hash    TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'triaged', 'duplicate', 'rejected')),
  received_at     TEXT NOT NULL,
  acknowledged_at TEXT,
  updated_at      TEXT NOT NULL
);
-- table desk_reports: Reports from outside. Every query must scope by org_id, except the receipt and intake lookups.
-- column desk_reports.sealed: AES-GCM ciphertext of title, details, product and reporter contact; these may hold unpatched vulnerability details.
-- column desk_reports.receipt_hash: SHA-256 of the reporter's receipt token; the token itself is never stored.
CREATE INDEX IF NOT EXISTS desk_reports_org_idx ON desk_reports (org_id, received_at DESC);
