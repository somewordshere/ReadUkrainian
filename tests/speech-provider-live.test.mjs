import assert from "node:assert/strict";
import test from "node:test";

import { onRequestPost } from "../functions/api/speech.js";
import { DEFAULT_SPEECH_VOICE_ID, resolveSpeechVoice } from "../functions/_shared/speech-voices.js";

// Opt-in: LIVE_GOOGLE_TTS_TEST=1 with GOOGLE_TTS_API_KEY set.
const LIVE_TEST_ENABLED = process.env.LIVE_GOOGLE_TTS_TEST === "1";
const voice = resolveSpeechVoice(process.env.LIVE_SPEECH_VOICE || DEFAULT_SPEECH_VOICE_ID);

function liveTestDb() {
  const storyRow = {
    id: 42,
    level: "A1",
    display_order: 1,
    question_index: 1,
    title: "Перевірка",
    paragraphs_json: JSON.stringify(["Добрий день."]),
    show_word_count: 1,
    is_enabled: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  return {
    prepare(sql) {
      return {
        bind() {
          return this;
        },
        async first() {
          if (sql.includes("FROM speech_settings")) {
            return { voiceId: voice.id, enabled: 1, version: 1 };
          }
          if (sql.includes("speech_usage_daily")) {
            return { characters_used: 6 };
          }
          return storyRow;
        },
      };
    },
  };
}

test(
  "live Google synthesis for the configured voice",
  { skip: !LIVE_TEST_ENABLED, timeout: 30_000 },
  async () => {
    const response = await onRequestPost({
      request: new Request("https://readukrainianapp.com/api/speech", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://readukrainianapp.com",
        },
        body: JSON.stringify({ storyId: 42, text: "Добрий" }),
      }),
      env: {
        DB: liveTestDb(),
        ASSETS: {
          async fetch() {
            return new Response("missing", { status: 404 });
          },
        },
        SPEECH_DAILY_CHARACTER_LIMIT: "4500",
        SPEECH_RATE_LIMITER: {
          async limit() {
            return { success: true };
          },
        },
        GOOGLE_TTS_API_KEY: process.env.GOOGLE_TTS_API_KEY,
      },
      cache: null,
      fetch: globalThis.fetch,
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-speech-voice"), voice.id);
    assert.equal(response.headers.get("x-speech-source"), "google");
    assert.equal(response.headers.get("content-type"), "audio/mpeg");
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.ok(bytes.byteLength > 1_000);
  }
);
