import {
  DEFAULT_SPEECH_VOICE_ID,
  resolveSpeechVoice,
} from "./speech-voices.js";

const SELECT_SETTING_SQL = `
  SELECT
    voice_id AS voiceId,
    version,
    updated_at AS updatedAt,
    updated_by_user_id AS updatedByUserId,
    updated_by_email AS updatedByEmail
  FROM speech_settings
  WHERE singleton_id = 1
`;

function normalizeVersion(value) {
  const version = Number(value);
  return Number.isInteger(version) && version >= 1 ? version : 0;
}

function normalizeActor(session) {
  const rawUserId = Number(session?.userId);
  const userId = Number.isInteger(rawUserId) && rawUserId > 0 ? rawUserId : null;
  const email = typeof session?.email === "string" ? session.email.slice(0, 254) : null;

  return { userId, email };
}

function normalizeSetting(row) {
  const voice = resolveSpeechVoice(row?.voiceId) || resolveSpeechVoice(DEFAULT_SPEECH_VOICE_ID);

  return {
    voiceId: voice.id,
    version: normalizeVersion(row?.version),
    updatedAt: typeof row?.updatedAt === "string" ? row.updatedAt : null,
    updatedByUserId: row?.updatedByUserId != null && Number.isInteger(Number(row.updatedByUserId))
      ? Number(row.updatedByUserId)
      : null,
    updatedByEmail: typeof row?.updatedByEmail === "string" ? row.updatedByEmail : null,
  };
}

export async function getSpeechSetting(db) {
  const row = await db.prepare(SELECT_SETTING_SQL).first();
  return normalizeSetting(row);
}

export async function getSpeechVoice(db) {
  const setting = await getSpeechSetting(db);
  return resolveSpeechVoice(setting.voiceId) || resolveSpeechVoice(DEFAULT_SPEECH_VOICE_ID);
}

export async function saveSpeechVoice(db, voiceId, session) {
  const voice = resolveSpeechVoice(voiceId);

  if (!voice) {
    throw new RangeError("Unsupported speech voice.");
  }

  const actor = normalizeActor(session);

  await db
    .prepare(
      `
        INSERT INTO speech_settings (
          singleton_id,
          voice_id,
          version,
          updated_at,
          updated_by_user_id,
          updated_by_email
        )
        VALUES (1, ?, 1, CURRENT_TIMESTAMP, ?, ?)
        ON CONFLICT(singleton_id) DO UPDATE SET
          voice_id = excluded.voice_id,
          version = speech_settings.version + 1,
          updated_at = CURRENT_TIMESTAMP,
          updated_by_user_id = excluded.updated_by_user_id,
          updated_by_email = excluded.updated_by_email
      `
    )
    .bind(voice.id, actor.userId, actor.email)
    .run();

  return getSpeechSetting(db);
}
