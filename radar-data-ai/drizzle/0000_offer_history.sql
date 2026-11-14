CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY NOT NULL,
  offer_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Nueva',
  date_applied TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS offers_status_updated_idx ON offers(status, updated_at);
