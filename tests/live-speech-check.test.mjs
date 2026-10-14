import assert from "node:assert/strict";
import test from "node:test";

import { verifyLiveSpeech } from "../scripts/check-live-speech.mjs";

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]);
const ORIGIN = "https://readukrainianapp.com";

function fakeSite({ source = "static", voice = "uk-UA-Chirp3-HD-Sadachbia", body = MP3, speechEnabled = true, statuses = [200] } = {}) {
  const calls = [];
  const speechStatuses = [...statuses];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const { pathname } = new URL(url);
    if (pathname === "/api/content") {
      return Response.json({
        levels: [
          { id: "B1", active: false, texts: [{ storyId: 9, active: true }] },
          { id: "A1", active: true, texts: [{ storyId: 7, active: true }] },
        ],
      });
    }
    if (pathname === "/api/content/story") {
      return Response.json({
        story: { storyId: 7, paragraphs: ["Я і мама гуляємо."], speechEnabled, speechVoiceId: "uk-UA-Chirp3-HD-Sadachbia" },
      });
    }
    if (pathname === "/api/speech") {
      const status = speechStatuses.length > 1 ? speechStatuses.shift() : speechStatuses[0];
      return new Response(status === 200 ? body : "error", {
        status,
        headers: { "content-type": "audio/mpeg", "x-speech-source": source, "x-speech-voice": voice },
      });
    }
    return new Response("not found", { status: 404 });
  };
  return { calls, fetchImpl };
}

test("passes when a story word plays from the static files of the site voice", async () => {
  const site = fakeSite();
  const result = await verifyLiveSpeech({ origin: ORIGIN, fetchImpl: site.fetchImpl });

  // The hidden B1 level is skipped and the first word of three letters or more is chosen.
  assert.deepEqual(result, { word: "мама", storyId: 7, voice: "uk-UA-Chirp3-HD-Sadachbia" });
  const speechCall = site.calls.find((call) => call.url.endsWith("/api/speech"));
  assert.equal(speechCall.init.headers.origin, ORIGIN);
  assert.deepEqual(JSON.parse(speechCall.init.body), { storyId: 7, text: "мама" });
});

test("fails when the audio comes from Google instead of the static files", async () => {
  const site = fakeSite({ source: "google" });
  await assert.rejects(
    verifyLiveSpeech({ origin: ORIGIN, fetchImpl: site.fetchImpl }),
    /came from google in voice uk-UA-Chirp3-HD-Sadachbia, not from the static files/
  );
});

test("fails when the static voice is not the site voice", async () => {
  const site = fakeSite({ voice: "uk-UA-Chirp3-HD-Achernar" });
  await assert.rejects(verifyLiveSpeech({ origin: ORIGIN, fetchImpl: site.fetchImpl }), /but the site voice is uk-UA-Chirp3-HD-Sadachbia/);
});

test("fails on audio that is not MP3, on errors and when pronunciation is off", async () => {
  await assert.rejects(
    verifyLiveSpeech({ origin: ORIGIN, fetchImpl: fakeSite({ body: new Uint8Array([1, 2, 3]) }).fetchImpl }),
    /did not return MP3 audio/
  );
  await assert.rejects(
    verifyLiveSpeech({ origin: ORIGIN, fetchImpl: fakeSite({ statuses: [502] }).fetchImpl, retryDelayMs: 0 }),
    /HTTP 502/
  );
  await assert.rejects(
    verifyLiveSpeech({ origin: ORIGIN, fetchImpl: fakeSite({ speechEnabled: false }).fetchImpl }),
    /switched off/
  );
});

test("retries a passing hiccup before giving up", async () => {
  const site = fakeSite({ statuses: [503, 200] });
  const result = await verifyLiveSpeech({ origin: ORIGIN, fetchImpl: site.fetchImpl, retryDelayMs: 0 });
  assert.equal(result.word, "мама");
  assert.equal(site.calls.filter((call) => call.url.endsWith("/api/speech")).length, 2);
});
