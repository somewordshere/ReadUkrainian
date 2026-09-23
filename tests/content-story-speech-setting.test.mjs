import assert from "node:assert/strict";
import test from "node:test";

import { onRequestGet } from "../functions/api/content/story.js";

function createDb({ speechRow = null, speechThrows = false, enabledVoices = [], voicesThrow = false } = {}) {
  const storyRow = {
    id: 42,
    level: "A1",
    display_order: 1,
    question_index: 1,
    title: "Вітання",
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
            if (speechThrows) {
              throw new Error("Speech settings unavailable.");
            }
            return speechRow;
          }
          if (sql.includes("FROM texts")) {
            return storyRow;
          }
          return null;
        },
        async all() {
          if (sql.includes("FROM speech_voice_options")) {
            if (voicesThrow) throw new Error("Voice shortlist unavailable.");
            return { results: enabledVoices.map((voiceId) => ({ voiceId })) };
          }
          assert.match(sql, /FROM questions/);
          return { results: [] };
        },
      };
    },
  };
}

async function fetchStory(db) {
  return onRequestGet({
    request: new Request("https://readukrainianapp.com/api/content/story?id=42"),
    env: { DB: db },
  });
}

test("story content exposes the enabled speech setting", async () => {
  const response = await fetchStory(createDb({
    speechRow: { voiceId: "lada", enabled: 1, version: 1 },
  }));

  assert.equal(response.status, 200);
  // Cache-Control is asserted in tests/content-caching.test.mjs, which owns that
  // policy; this test is about the speech setting reaching the client.
  const payload = await response.json();
  assert.equal(payload.story.storyId, 42);
  assert.equal(payload.story.speechEnabled, true);
});

test("story content keeps reading available and defaults speech to disabled", async () => {
  for (const db of [createDb(), createDb({ speechThrows: true })]) {
    const response = await fetchStory(db);

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.story.storyId, 42);
    assert.equal(payload.story.speechEnabled, false);
  }
});

test("story content lists the site voice first, then the rest of the shortlist", async () => {
  const response = await fetchStory(createDb({
    speechRow: { voiceId: "uk-UA-Chirp3-HD-Charon", enabled: 1, version: 3 },
    enabledVoices: ["uk-UA-Wavenet-B", "uk-UA-Chirp3-HD-Charon", "uk-UA-Chirp3-HD-Aoede", "not-a-voice"],
  }));
  const { story } = await response.json();

  assert.equal(story.speechVoiceId, "uk-UA-Chirp3-HD-Charon");
  assert.deepEqual(story.speechVoices, [
    { id: "uk-UA-Chirp3-HD-Charon", label: "Charon", gender: "male" },
    { id: "uk-UA-Chirp3-HD-Aoede", label: "Aoede", gender: "female" },
    { id: "uk-UA-Wavenet-B", label: "WaveNet B", gender: "female" },
  ]);
});

test("story content keeps the site voice when the shortlist cannot load, and no voices when speech is off", async () => {
  const shortlistDown = await (await fetchStory(createDb({
    speechRow: { voiceId: "uk-UA-Chirp3-HD-Achernar", enabled: 1, version: 1 },
    voicesThrow: true,
  }))).json();
  assert.equal(shortlistDown.story.speechEnabled, true);
  assert.deepEqual(shortlistDown.story.speechVoices.map((voice) => voice.id), ["uk-UA-Chirp3-HD-Achernar"]);

  const speechOff = await (await fetchStory(createDb({
    speechRow: { voiceId: "uk-UA-Chirp3-HD-Achernar", enabled: 0, version: 1 },
    enabledVoices: ["uk-UA-Chirp3-HD-Charon"],
  }))).json();
  assert.deepEqual(speechOff.story.speechVoices, []);
});
