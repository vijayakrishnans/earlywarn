-- 200_desk_register
-- Reporting desk register: products, desk settings, escalation chain.
-- Bounded context: desk
-- schema desk: Desk bounded context — owns the CRA reporting register, cases and evidence.

CREATE TABLE IF NOT EXISTS desk_products (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  name            TEXT NOT NULL,
  product_type    TEXT,
  versions_note   TEXT,
  support_ends_on TEXT,
  member_states   TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT
);
-- table desk_products: Products with digital elements a manufacturer reports on. Every query must scope by org_id.
-- column desk_products.member_states: JSON array of EU Member State codes where the product is available.
CREATE INDEX IF NOT EXISTS desk_products_org_idx ON desk_products (org_id, created_at);

CREATE TABLE IF NOT EXISTS desk_settings (
  org_id                   TEXT PRIMARY KEY,
  public_slug              TEXT,
  policy_text              TEXT,
  main_establishment_state TEXT,
  coordinating_csirt       TEXT,
  triage_target_minutes    INTEGER NOT NULL DEFAULT 240,
  disclosure_published_at  TEXT,
  updated_at               TEXT NOT NULL
);
-- table desk_settings: One row per organization; absent until first saved.
CREATE UNIQUE INDEX IF NOT EXISTS desk_settings_public_slug_idx
  ON desk_settings (public_slug) WHERE public_slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS desk_escalation_steps (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL,
  position      INTEGER NOT NULL,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  after_minutes INTEGER NOT NULL,
  channels      TEXT NOT NULL DEFAULT '["email"]',
  created_at    TEXT NOT NULL,
  UNIQUE (org_id, position)
);
-- table desk_escalation_steps: The ordered people to alert. Position 1 is the primary representative, position 2 the first backup.
-- column desk_escalation_steps.after_minutes: Minutes after the previous step without acknowledgement before this step is alerted; position 1 uses 0.
