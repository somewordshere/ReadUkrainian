UPDATE speech_settings
SET
  voice_id = CASE
    WHEN voice_id IN ('lada-medium', 'mykyta', 'tetiana') THEN 'mai'
    ELSE 'lada'
  END,
  version = version + 1,
  updated_at = CURRENT_TIMESTAMP,
  updated_by_user_id = NULL,
  updated_by_email = 'migration:0009'
WHERE voice_id NOT IN ('lada', 'mai');
