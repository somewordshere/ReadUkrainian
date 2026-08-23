export const DEFAULT_SPEECH_VOICE_ID = "lada";

const SPEECH_VOICES = Object.freeze([
  Object.freeze({
    id: "lada",
    label: "Lada",
    description: "Ukrainian female voice · Piper",
    providerModel: "piper",
    providerVoice: "uk_UA-lada-x_low",
    providerFormat: "mp3",
  }),
  Object.freeze({
    id: "mai",
    label: "MAI",
    description: "Alternative Ukrainian voice · VITS",
    providerModel: "vits",
    providerVoice: "mai_uk",
    providerFormat: "wav",
  }),
]);

const VOICES_BY_ID = new Map(SPEECH_VOICES.map((voice) => [voice.id, voice]));
const PUBLIC_SPEECH_VOICES = Object.freeze(
  SPEECH_VOICES.map((voice) =>
    Object.freeze({
      id: voice.id,
      label: voice.label,
      description: voice.description,
    })
  )
);

export function resolveSpeechVoice(voiceId) {
  if (typeof voiceId !== "string") {
    return null;
  }

  return VOICES_BY_ID.get(voiceId) || null;
}

export function listPublicSpeechVoices() {
  return PUBLIC_SPEECH_VOICES;
}
