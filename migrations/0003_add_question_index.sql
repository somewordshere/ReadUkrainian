ALTER TABLE texts ADD COLUMN question_index INTEGER;

UPDATE texts
SET question_index = display_order
WHERE question_index IS NULL;
