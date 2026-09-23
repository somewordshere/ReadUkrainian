-- Signed admin session cookies carry this number. Logging out raises it, which
-- invalidates every cookie that user holds, on every device. Cookies issued
-- before this column existed count as version 1.
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;
