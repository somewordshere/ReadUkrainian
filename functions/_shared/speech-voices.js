// Site voices are Google Cloud Text-to-Speech voice names. Any Ukrainian voice
// Google offers may be auditioned in the admin; learners only hear the one site
// voice, which must be on the admin's enabled shortlist (speech_voice_options).
export const DEFAULT_SPEECH_VOICE_ID = "uk-UA-Chirp3-HD-Achernar";

const VOICE_FAMILIES = Object.freeze({
  "Chirp3-HD": "Chirp 3 HD",
  Neural2: "Neural2",
  Wavenet: "WaveNet",
  Standard: "Standard",
});
const VOICE_ID_PATTERN = /^uk-UA-(Chirp3-HD|Neural2|Wavenet|Standard)-([A-Z][A-Za-z]{0,39})$/u;

export function resolveSpeechVoice(voiceId) {
  if (typeof voiceId !== "string") {
    return null;
  }

  const match = voiceId.match(VOICE_ID_PATTERN);
  if (!match) {
    return null;
  }

  return Object.freeze({
    id: voiceId,
    providerVoice: voiceId,
    label: match[2],
    family: VOICE_FAMILIES[match[1]],
  });
}

// Newest, most natural voices first.
export function compareSpeechVoices(left, right) {
  const familyOrder = Object.values(VOICE_FAMILIES);
  return familyOrder.indexOf(left.family) - familyOrder.indexOf(right.family)
    || left.label.localeCompare(right.label, "en");
}
