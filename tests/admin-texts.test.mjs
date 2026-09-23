import assert from "node:assert/strict";
import test from "node:test";

import { createSessionToken } from "../functions/_shared/auth.js";
import { onRequestPost as createStory } from "../functions/api/admin/texts/index.js";
import { onRequestPut as saveDraft } from "../functions/api/admin/texts/[id].js";
import { onRequestPost as restoreRevision } from "../functions/api/admin/texts/restore.js";
import { seedDatabase } from "../scripts/lib/seed-database.mjs";

const ORIGIN = "https://readukrainianapp.com";
const SESSION_SECRET = "a sufficiently long editor test secret";

// A D1 stand-in over node:sqlite whose batch is one transaction, like D1's.
function createD1() {
  const { sqlite } = seedDatabase();
  sqlite.exec(`
    INSERT INTO users (id, email, password_hash, role) VALUES
      (1, 'admin@example.com', 'unused', 'admin');
  `);

  function prepare(sql) {
    const statement = sqlite.prepare(sql);
    let parameters = [];
    const prepared = {
      bind(...values) {
        parameters = values;
        return prepared;
      },
      async first() {
        return statement.get(...parameters) ?? null;
      },
      async all() {
        return { results: statement.all(...parameters) };
      },
      async run() {
        const result = statement.run(...parameters);
        return {
          success: true,
          meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
        };
      },
    };
    return prepared;
  }

  const db = {
    prepare,
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (batchError) {
        sqlite.exec("ROLLBACK");
        throw batchError;
      }
    },
  };
  return { sqlite, db };
}

async function editorRequest(db, { path, method = "PUT", body, params = {}, headers = {} }) {
  const token = await createSessionToken(SESSION_SECRET, { userId: 1, email: "admin@example.com", role: "admin", sv: 1 });
  return {
    request: new Request(`${ORIGIN}${path}`, {
      method,
      headers: {
        cookie: `admin_session=${token}`,
        origin: ORIGIN,
        "content-type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env: { DB: db, SESSION_SECRET },
    params,
  };
}

const STORY = {
  level: "A1",
  title: "Нова історія",
  paragraphs: ["Перший абзац."],
  questions: [],
  showWordCount: true,
};

test("editor writes must come from the site's own pages", async () => {
  const { sqlite, db } = createD1();
  const before = sqlite.prepare("SELECT COUNT(*) AS count FROM texts").get().count;

  const response = await createStory(await editorRequest(db, {
    path: "/api/admin/texts",
    method: "POST",
    body: STORY,
    headers: { origin: "https://attacker.example" },
  }));

  assert.equal(response.status, 403);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM texts").get().count, before);
});

test("editor writes must be JSON of a bounded size", async () => {
  const { db } = createD1();

  const form = await createStory(await editorRequest(db, {
    path: "/api/admin/texts",
    method: "POST",
    body: STORY,
    headers: { "content-type": "text/plain" },
  }));
  assert.equal(form.status, 415);

  const huge = await createStory(await editorRequest(db, {
    path: "/api/admin/texts",
    method: "POST",
    body: { ...STORY, paragraphs: ["а".repeat(300 * 1024)] },
  }));
  assert.equal(huge.status, 413);
});

test("stories and quizzes over the size caps are rejected before any write", async () => {
  const { db } = createD1();

  for (const [body, pattern] of [
    [{ ...STORY, title: "Т".repeat(201) }, /Title must not exceed/],
    [{ ...STORY, paragraphs: ["Абзац.".repeat(4000)] }, /Story text must not exceed/],
    [{ ...STORY, questions: Array.from({ length: 21 }, (_, index) => ({ prompt: `П${index}?`, correct: "Так", wrong: ["Ні", "Може", "Ніколи"] })) }, /at most 20 questions/],
    [{ ...STORY, questions: [{ prompt: "П?".repeat(300), correct: "Так", wrong: ["Ні", "Може", "Ніколи"] }] }, /prompt must not exceed/],
  ]) {
    const response = await createStory(await editorRequest(db, { path: "/api/admin/texts", method: "POST", body }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, pattern);
  }
});

test("saving a draft for an unknown story is a 404", async () => {
  const { db } = createD1();
  const response = await saveDraft(await editorRequest(db, {
    path: "/api/admin/texts/999999",
    body: STORY,
    params: { id: "999999" },
  }));

  assert.equal(response.status, 404);
});

test("restoring reports bad checkpoints but hides database errors", async () => {
  const { sqlite, db } = createD1();
  const storyId = sqlite.prepare("SELECT id FROM texts ORDER BY id LIMIT 1").get().id;
  const insertRevision = (snapshot) => Number(sqlite.prepare(`
    INSERT INTO story_revisions (story_id, action, snapshot_json, created_by_email)
    VALUES (?, 'before_publish', ?, 'admin@example.com')
  `).run(storyId, JSON.stringify(snapshot)).lastInsertRowid);

  const broken = insertRevision({ level: "A1", title: "", paragraphs: [] });
  const invalid = await restoreRevision(await editorRequest(db, {
    path: `/api/admin/texts/${storyId}/revisions/${broken}/restore`,
    method: "POST",
    params: { id: String(storyId), revisionId: String(broken) },
  }));
  assert.equal(invalid.status, 409);
  assert.match((await invalid.json()).error, /invalid story data/);

  const good = insertRevision({ ...STORY, sortOrder: 1, active: true });
  const failingDb = { ...db, async batch() { throw new Error("D1_ERROR: UNIQUE constraint failed: texts.level"); } };
  const failed = await restoreRevision(await editorRequest(failingDb, {
    path: `/api/admin/texts/${storyId}/revisions/${good}/restore`,
    method: "POST",
    params: { id: String(storyId), revisionId: String(good) },
  }));
  assert.equal(failed.status, 500);
  assert.doesNotMatch((await failed.json()).error, /D1_ERROR|UNIQUE/);
});
