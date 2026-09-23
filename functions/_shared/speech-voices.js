// Site voices are Google Cloud Text-to-Speech voice names. Any Ukrainian voice
// Google offers may be auditioned in the admin. Learners hear the site voice by
// default and may pick any other voice on the admin's enabled shortlist
// (speech_voice_options).
export const DEFAULT_SPEECH_VOICE_ID = "uk-UA-Chirp3-HD-Achernar";

// Google's ssmlGender for its Ukrainian voices, copied from the voices list on
// 2026-09-23 so the reader can say "жіночий"/"чоловічий" without calling Google.
// A voice Google adds later simply shows no gender until it is listed here.
const FEMALE_VOICES = new Set([
  "Achernar", "Aoede", "Autonoe", "Callirrhoe", "Despina", "Erinome", "Gacrux", "Kore",
  "Laomedeia", "Leda", "Pulcherrima", "Sulafat", "Vindemiatrix", "Zephyr",
]);
const MALE_VOICES = new Set([
  "Achird", "Algenib", "Algieba", "Alnilam", "Charon", "Enceladus", "Fenrir", "Iapetus",
  "Orus", "Puck", "Rasalgethi", "Sadachbia", "Sadaltager", "Schedar", "Umbriel", "Zubenelgenubi",
]);
const OTHER_VOICE_GENDERS = Object.freeze({
  "uk-UA-Standard-B": "female",
  "uk-UA-Wavenet-B": "female",
});

export function speechVoiceGender(voice) {
  if (!voice) return null;
  if (voice.family === "Chirp 3 HD") {
    if (FEMALE_VOICES.has(voice.label)) return "female";
    if (MALE_VOICES.has(voice.label)) return "male";
    return null;
  }
  return OTHER_VOICE_GENDERS[voice.id] || null;
}

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
