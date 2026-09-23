// Google Cloud Text-to-Speech, shared by the /api/speech fallback and the
// build-time generator in scripts/speech/ so both produce identical audio.

export const GOOGLE_TTS_ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize";
export const GOOGLE_VOICES_ENDPOINT = "https://texttospeech.googleapis.com/v1/voices?languageCode=uk-UA";
// Learners hear single words; a slightly slower rate keeps every sound audible.
export const GOOGLE_AUDIO_CONFIG = Object.freeze({
  audioEncoding: "MP3",
  sampleRateHertz: 24000,
  speakingRate: 0.9,
});
// Bump when the request shape changes, so cached and generated audio is rebuilt.
export const GOOGLE_REQUEST_VERSION = "google-tts-v1";

export function googleSpeechRequestInit({ key, text, voice, signal }) {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": key,
    },
    redirect: "manual",
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: "uk-UA", name: voice.providerVoice },
      audioConfig: GOOGLE_AUDIO_CONFIG,
    }),
    signal,
  };
}

export function googleVoicesRequestInit({ key, signal }) {
  return {
    method: "GET",
    headers: { "x-goog-api-key": key },
    redirect: "manual",
    signal,
  };
}

export function isMp3(bytes) {
  return (
    (bytes.byteLength >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
    (bytes.byteLength >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  );
}

// The API answers { audioContent: "<base64 MP3>" }.
export function decodeGoogleAudio(payload) {
  const encoded = payload?.audioContent;
  if (typeof encoded !== "string" || !encoded) return null;

  let bytes;
  try {
    const binary = atob(encoded);
    bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
  } catch {
    return null;
  }
  return isMp3(bytes) ? bytes : null;
}
