import {
  DEFAULT_SPEECH_VOICE_ID,
  compareSpeechVoices,
  resolveSpeechVoice,
  speechVoiceGender,
} from "./speech-voices.js";

const SELECT_SETTING_SQL = `
  SELECT
    voice_id AS voiceId,
    is_enabled AS enabled,
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
    enabled: row?.enabled === true || Number(row?.enabled) === 1,
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

// The admin's shortlist of voices that may become the site voice.
export async function listEnabledSpeechVoiceIds(db) {
  const { results } = await db
    .prepare("SELECT voice_id AS voiceId FROM speech_voice_options WHERE is_enabled = 1")
    .all();
  return new Set(
    (results || [])
      .map((row) => resolveSpeechVoice(row.voiceId)?.id)
      .filter(Boolean)
  );
}

function learnerVoice(voice) {
  return {
    id: voice.id,
    label: voice.family === "Chirp 3 HD" ? voice.label : `${voice.family} ${voice.label}`,
    gender: speechVoiceGender(voice),
  };
}

// What the reader needs: whether pronunciation is on, the site voice, and the
// voices a learner may pick instead (the site voice first, then the shortlist).
// A shortlist that cannot load leaves just the site voice.
export async function getLearnerSpeechOptions(db) {
  const setting = await getSpeechSetting(db);
  let enabledIds = new Set();
  try {
    enabledIds = await listEnabledSpeechVoiceIds(db);
  } catch {
    // Pronunciation still works in the site voice.
  }
  enabledIds.delete(setting.voiceId);
  const others = [...enabledIds].map((id) => resolveSpeechVoice(id)).sort(compareSpeechVoices);

  return {
    enabled: setting.enabled,
    voiceId: setting.voiceId,
    voices: [resolveSpeechVoice(setting.voiceId), ...others].map(learnerVoice),
  };
}

// A learner's chosen voice, if it is still allowed; otherwise the site voice.
export async function resolveLearnerSpeechVoice(db, setting, requestedVoiceId) {
  const siteVoice = resolveSpeechVoice(setting.voiceId);
  const requested = resolveSpeechVoice(requestedVoiceId);
  if (!requested || requested.id === siteVoice?.id) return siteVoice;

  const enabledIds = await listEnabledSpeechVoiceIds(db);
  return enabledIds.has(requested.id) ? requested : siteVoice;
}

export async function saveSpeechVoiceOption(db, { voiceId, enabled }, session) {
  const voice = resolveSpeechVoice(voiceId);

  if (!voice) {
    throw new RangeError("Unsupported speech voice.");
  }
  if (typeof enabled !== "boolean") {
    throw new TypeError("Voice enabled state must be a boolean.");
  }

  const actor = normalizeActor(session);

  await db
    .prepare(
      `
        INSERT INTO speech_voice_options (voice_id, is_enabled, updated_at, updated_by_email)
        VALUES (?, ?, CURRENT_TIMESTAMP, ?)
        ON CONFLICT(voice_id) DO UPDATE SET
          is_enabled = excluded.is_enabled,
          updated_at = CURRENT_TIMESTAMP,
          updated_by_email = excluded.updated_by_email
      `
    )
    .bind(voice.id, enabled ? 1 : 0, actor.email)
    .run();
}

export async function saveSpeechSetting(db, { voiceId, enabled }, session) {
  const voice = resolveSpeechVoice(voiceId);

  if (!voice) {
    throw new RangeError("Unsupported speech voice.");
  }
  if (typeof enabled !== "boolean") {
    throw new TypeError("Speech enabled state must be a boolean.");
  }

  const actor = normalizeActor(session);

  await db
    .prepare(
      `
        INSERT INTO speech_settings (
          singleton_id,
          voice_id,
          is_enabled,
          version,
          updated_at,
          updated_by_user_id,
          updated_by_email
        )
        VALUES (1, ?, ?, 1, CURRENT_TIMESTAMP, ?, ?)
        ON CONFLICT(singleton_id) DO UPDATE SET
          voice_id = excluded.voice_id,
          is_enabled = excluded.is_enabled,
          version = speech_settings.version + 1,
          updated_at = CURRENT_TIMESTAMP,
          updated_by_user_id = excluded.updated_by_user_id,
          updated_by_email = excluded.updated_by_email
      `
    )
    .bind(voice.id, enabled ? 1 : 0, actor.userId, actor.email)
    .run();

  return getSpeechSetting(db);
}
