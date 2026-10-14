// Checks pronunciation on the live site: one word of the first published story must
// play, and it must come from the static MP3s of the site voice, not from a live
// Google call. Version 1.10 shipped audio for a voice the site did not use, and a
// Google billing outage went unnoticed before that; both now fail this check.
//
//   node scripts/check-live-speech.mjs [--origin https://readukrainianapp.com]
import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { isMp3 } from "../functions/_shared/google-speech.js";
import { extractUkrainianWords } from "../functions/_shared/ukrainian-word.js";

async function getJson(fetchImpl, url) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

export async function verifyLiveSpeech({ origin, fetchImpl = fetch, retryDelayMs = 2000 }) {
  const index = await getJson(fetchImpl, `${origin}/api/content`);
  const first = (index.levels || [])
    .filter((level) => level.active !== false)
    .flatMap((level) => level.texts || [])
    .find((text) => text.active !== false);
  if (!first) throw new Error("The live content index lists no published story.");

  const { story } = await getJson(fetchImpl, `${origin}/api/content/story?id=${encodeURIComponent(first.storyId)}`);
  if (!story?.speechEnabled) throw new Error("Pronunciation is switched off on the live site (admin → Audio).");
  const word = extractUkrainianWords((story.paragraphs || []).join(" ")).find((candidate) => candidate.length >= 3);
  if (!word) throw new Error(`Story ${first.storyId} has no word to pronounce.`);

  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetchImpl(`${origin}/api/speech`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ storyId: first.storyId, text: word }),
      signal: AbortSignal.timeout(20000),
    });
    if (response.ok || attempt === 2 || ![429, 502, 503, 504].includes(response.status)) break;
    await setTimeout(retryDelayMs);
  }
  if (!response.ok) throw new Error(`Pronunciation of «${word}» (story ${first.storyId}): HTTP ${response.status}`);

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!isMp3(bytes)) throw new Error(`Pronunciation of «${word}» did not return MP3 audio.`);
  const source = response.headers.get("x-speech-source");
  const voice = response.headers.get("x-speech-voice");
  if (source !== "static") {
    throw new Error(
      `Pronunciation of «${word}» came from ${source || "an unknown source"} in voice ${voice}, not from the static files. ` +
      `Generate them with \`npm run speech:build -- --voice-id ${voice}\` and release.`
    );
  }
  if (story.speechVoiceId && voice !== story.speechVoiceId) {
    throw new Error(`Pronunciation of «${word}» played voice ${voice}, but the site voice is ${story.speechVoiceId}.`);
  }
  return { word, storyId: first.storyId, voice };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { origin: { type: "string", default: "https://readukrainianapp.com" } } });
  const { word, storyId, voice } = await verifyLiveSpeech({ origin: new URL(values.origin).origin });
  console.log(`Pronunciation verified live: «${word}» (story ${storyId}) played from the static files in voice ${voice}.`);
}
