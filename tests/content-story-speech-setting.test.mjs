import assert from "node:assert/strict";
import test from "node:test";

import { onRequestGet } from "../functions/api/content/story.js";

function createDb({ speechRow = null, speechThrows = false } = {}) {
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
  assert.equal(response.headers.get("cache-control"), "no-store");
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
