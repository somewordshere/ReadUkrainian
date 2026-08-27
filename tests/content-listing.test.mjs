import assert from "node:assert/strict";
import test from "node:test";

import { onRequestGet } from "../functions/api/content.js";

// The listing renders titles and progress markers only. It used to select
// paragraphs_json for every row, so each visit pulled roughly 160 KB of story
// text out of D1, parsed all of it, and discarded it in groupStories.
function createDb() {
  const queries = [];
  const rows = [
    { id: 1, level: "A1", display_order: 1, question_index: 1, title: "Мій день", show_word_count: 1, is_enabled: 1 },
    { id: 2, level: "A1", display_order: 2, question_index: 2, title: "Моя сім'я", show_word_count: 0, is_enabled: 1 },
    { id: 3, level: "A2", display_order: 1, question_index: 3, title: "Борщ", show_word_count: 1, is_enabled: 1 },
  ];

  return {
    queries,
    prepare(sql) {
      queries.push(sql);
      return {
        bind() {
          return this;
        },
        async all() {
          return { results: rows };
        },
      };
    },
  };
}

test("the library listing selects no story body text", async () => {
  const db = createDb();
  await onRequestGet({ env: { DB: db } });

  assert.equal(db.queries.length, 1);
  const [sql] = db.queries;
  assert.ok(!sql.includes("paragraphs_json"), "listing must not read story bodies");
  assert.ok(!sql.includes("draft_json"), "listing must not read drafts");
  assert.match(sql, /FROM texts/);
  assert.match(sql, /ORDER BY level ASC, display_order ASC/);
});

test("the library listing returns grouped levels with display metadata", async () => {
  const db = createDb();
  const response = await onRequestGet({ env: { DB: db } });
  const body = await response.json();

  const a1 = body.levels.find((level) => level.id === "A1");
  const a2 = body.levels.find((level) => level.id === "A2");

  assert.deepEqual(a1.texts, [
    { storyId: 1, sortOrder: 1, questionIndex: 1, title: "Мій день", active: true, showWordCount: true },
    { storyId: 2, sortOrder: 2, questionIndex: 2, title: "Моя сім'я", active: true, showWordCount: false },
  ]);
  assert.deepEqual(a2.texts, [
    { storyId: 3, sortOrder: 1, questionIndex: 3, title: "Борщ", active: true, showWordCount: true },
  ]);

  // No body text reaches the client through this route.
  assert.ok(!JSON.stringify(body).includes("paragraphs"));
});
