-- Re-enable A2 #3 «Мій будинок».
--
-- The row was is_enabled = 0 in production, so /api/content/story returned 404
-- and learners reading A2 in order hit a gap at position three. 0020 could not
-- fix it: that migration preserves is_enabled on purpose, so that refreshing
-- content never overrides an editor disabling a story.
--
-- A sweep of all 117 live A1 and A2 stories on 2026-08-28 found this as the only
-- defect: every other story matched data/content-seed.json and served five
-- questions. Its text and quiz were already refreshed by 0020, so enabling the
-- row is all that is required.

UPDATE texts
SET is_enabled = 1, updated_at = CURRENT_TIMESTAMP
WHERE level = 'A2' AND display_order = 3;
