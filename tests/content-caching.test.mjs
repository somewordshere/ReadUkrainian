import assert from "node:assert/strict";
import test from "node:test";

import { onRequestGet as listing } from "../functions/api/content.js";
import { onRequestGet as storyRoute } from "../functions/api/content/story.js";

// Both public content routes used to defeat caching entirely: the listing sent
// no Cache-Control at all and the story route sent no-store, so every visit and
// every story open was a fresh D1 round trip. They are safe to cache because
// they only ever serve published rows — drafts reach editors through
// /api/admin/* — so the only cost is how long a learner can lag behind a
// publish. Errors must still never be cached.

function createDb({ story = true } = {}) {
  const storyRow = {
    id: 42,
    level: "A2",
    display_order: 1,
    question_index: 1,
    title: "Мій день",
    paragraphs_json: JSON.stringify(["Будильник дзвонить о сьомій."]),
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
          if (sql.includes("FROM speech_settings")) return { enabled: 1, voice_id: "lada" };
          return story ? storyRow : null;
        },
        async all() {
          if (sql.includes("FROM questions")) return { results: [] };
          return { results: story ? [storyRow] : [] };
        },
      };
    },
  };
}

test("the library listing is cacheable by shared caches", async () => {
  const response = await listing({ env: { DB: createDb() } });
  const cacheControl = response.headers.get("cache-control");

  assert.equal(response.status, 200);
  assert.match(cacheControl, /public/);
  assert.match(cacheControl, /max-age=\d+/);
  assert.ok(!/no-store|private/.test(cacheControl));
});

test("a published story is cacheable by shared caches", async () => {
  const request = new Request("https://readukrainianapp.com/api/content/story?id=42");
  const response = await storyRoute({ request, env: { DB: createDb() } });
  const cacheControl = response.headers.get("cache-control");

  assert.equal(response.status, 200);
  assert.match(cacheControl, /public/);
  assert.ok(!/no-store/.test(cacheControl));
});

test("an unpublished story 404s exactly like a missing one", async () => {
  // A2 #3 «Мій будинок» sat unpublished in production and this route answered
  // 404, which reads as a deleted row. getStoryByLevelAndOrder has no is_enabled
  // filter, so the SQL alone suggests the row was gone; the !story.active check
  // a few lines later is what actually produced the 404. The two cases are
  // indistinguishable from outside, so diagnose them by querying is_enabled, not
  // by reading the status code.
  const db = createDb();
  db.prepare = ((original) => (sql) => {
    const statement = original(sql);
    if (sql.includes("FROM texts")) {
      const first = statement.first;
      statement.first = async () => ({ ...(await first()), is_enabled: 0 });
    }
    return statement;
  })(db.prepare.bind(db));

  const request = new Request("https://readukrainianapp.com/api/content/story?id=42");
  const response = await storyRoute({ request, env: { DB: db } });

  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "Story not found.");
});

test("a missing story is never cached", async () => {
  const request = new Request("https://readukrainianapp.com/api/content/story?id=999");
  const response = await storyRoute({ request, env: { DB: createDb({ story: false }) } });

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("a rejected request is never cached", async () => {
  const request = new Request("https://readukrainianapp.com/api/content/story");
  const response = await storyRoute({ request, env: { DB: createDb() } });

  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
