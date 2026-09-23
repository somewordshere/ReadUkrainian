export const DEFAULT_SPEECH_VOICE_ID = "achernar";

// Each voice needs a generated static set in public/speech/<id>/ (see
// scripts/speech/README.md); the Google fallback only covers words added since.
const SPEECH_VOICES = Object.freeze([
  Object.freeze({
    id: "achernar",
    label: "Achernar",
    description: "Ukrainian female voice · Google Chirp 3 HD",
    providerVoice: "uk-UA-Chirp3-HD-Achernar",
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
