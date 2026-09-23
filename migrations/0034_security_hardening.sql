-- Signed admin session cookies carry this number. Logging out raises it, which
-- invalidates every cookie that user holds, on every device. Cookies issued
-- before this column existed count as version 1.
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;

-- A random token replaced on every save, publish, unpublish and restore of a
-- story. The admin sends back the token it loaded, and a save based on an
-- older one is refused instead of overwriting someone else's newer work.
ALTER TABLE texts ADD COLUMN edit_version TEXT NOT NULL DEFAULT 'initial';

-- Each client's share of the day's live pronunciation budget, so one client
-- cannot spend it for everyone. client_hash is a keyed hash of the client's
-- address and the day, never the address itself; only today's rows are kept.
CREATE TABLE IF NOT EXISTS speech_usage_client_daily (
  day TEXT NOT NULL,
  client_hash TEXT NOT NULL,
  characters_used INTEGER NOT NULL DEFAULT 0 CHECK (characters_used >= 0),
  PRIMARY KEY (day, client_hash)
);

-- The daily cap on new dictionary reports counts today's rows on every new
-- report; without this index that count scanned the whole table.
CREATE INDEX IF NOT EXISTS idx_dictionary_reports_created
ON dictionary_reports (created_at);
