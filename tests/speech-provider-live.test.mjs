import assert from "node:assert/strict";
import test from "node:test";

import { onRequestPost } from "../functions/api/speech.js";

const LIVE_TEST_ENABLED = process.env.LIVE_TTS_AI_TEST === "1";

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
            return { voiceId: "mai", enabled: 1, version: 1 };
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
  "live TTS.ai catalog and MAI synthesis contract",
  { skip: !LIVE_TEST_ENABLED, timeout: 30_000 },
  async () => {
    const catalogResponse = await fetch("https://api.tts.ai/v1/voices/");
    assert.equal(catalogResponse.ok, true);
    const catalog = await catalogResponse.json();
    assert.ok(
      catalog.voices.some(
        (voice) => voice.id === "mai_uk" && voice.model === "vits" && voice.language === "uk"
      )
    );

    const pendingWrites = [];
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
      },
      cache: null,
      fetch: globalThis.fetch,
      waitUntil(promise) {
        pendingWrites.push(promise);
      },
    });

    await Promise.all(pendingWrites);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-speech-voice"), "mai");
    assert.equal(response.headers.get("content-type"), "audio/wav");
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.ok(bytes.byteLength > 1_000);
    assert.equal(new TextDecoder("ascii").decode(bytes.slice(0, 4)), "RIFF");
    assert.equal(new TextDecoder("ascii").decode(bytes.slice(8, 12)), "WAVE");
  }
);
