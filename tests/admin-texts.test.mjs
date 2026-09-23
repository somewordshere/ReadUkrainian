import assert from "node:assert/strict";
import test from "node:test";

import { createSessionToken } from "../functions/_shared/auth.js";
import { onRequestPost as createStory } from "../functions/api/admin/texts/index.js";
import { onRequestPut as saveDraft } from "../functions/api/admin/texts/[id].js";
import { onRequestPost as publishStory } from "../functions/api/admin/texts/publish.js";
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

async function create(db, body = STORY) {
  const response = await createStory(await editorRequest(db, { path: "/api/admin/texts", method: "POST", body }));
  assert.equal(response.status, 201);
  return (await response.json()).story;
}

async function publish(db, storyId, body) {
  return publishStory(await editorRequest(db, {
    path: `/api/admin/texts/${storyId}/publish`,
    method: "POST",
    body,
    params: { id: String(storyId) },
  }));
}

test("new and moved stories take the next free position in their level", async () => {
  const { sqlite, db } = createD1();
  const maxOrder = (level) => sqlite.prepare("SELECT MAX(display_order) AS max FROM texts WHERE level = ?").get(level).max;
  const a2Before = maxOrder("A2");

  const first = await create(db);
  const second = await create(db);
  assert.equal(second.sortOrder, first.sortOrder + 1);

  const moved = await publish(db, second.storyId, { ...STORY, level: "A2", baseVersion: second.editVersion });
  assert.equal(moved.status, 200);
  const movedStory = (await moved.json()).story;
  assert.equal(movedStory.level, "A2");
  assert.equal(movedStory.sortOrder, a2Before + 1);
  assert.equal(movedStory.questionIndex, a2Before + 1);
});

test("a save based on an old version is refused instead of overwriting newer work", async () => {
  const { sqlite, db } = createD1();
  const story = await create(db);

  const firstSave = await saveDraft(await editorRequest(db, {
    path: `/api/admin/texts/${story.storyId}`,
    body: { ...STORY, title: "Перша правка", baseVersion: story.editVersion },
    params: { id: String(story.storyId) },
  }));
  assert.equal(firstSave.status, 200);
  const saved = (await firstSave.json()).story;
  assert.notEqual(saved.editVersion, story.editVersion);

  const staleSave = await saveDraft(await editorRequest(db, {
    path: `/api/admin/texts/${story.storyId}`,
    body: { ...STORY, title: "Застаріла правка", baseVersion: story.editVersion },
    params: { id: String(story.storyId) },
  }));
  assert.equal(staleSave.status, 409);
  assert.match((await staleSave.json()).error, /changed by someone else/);

  const stalePublish = await publish(db, story.storyId, { ...STORY, title: "Застаріла", baseVersion: story.editVersion });
  assert.equal(stalePublish.status, 409);

  const row = sqlite.prepare("SELECT draft_json, is_enabled FROM texts WHERE id = ?").get(story.storyId);
  assert.equal(JSON.parse(row.draft_json).title, "Перша правка");
  assert.equal(row.is_enabled, 0);
});

test("a publish that loses a race writes nothing: no checkpoint, text or quiz", async () => {
  const { sqlite, db } = createD1();
  const story = await create(db, { ...STORY, questions: [{ prompt: "Хто?", correct: "Я", wrong: ["Ти", "Він", "Вона"] }] });
  const published = await publish(db, story.storyId, { ...STORY, questions: [{ prompt: "Хто?", correct: "Я", wrong: ["Ти", "Він", "Вона"] }] });
  assert.equal(published.status, 200);

  const count = (sql) => sqlite.prepare(sql).get(story.storyId).count;
  const revisionsBefore = count("SELECT COUNT(*) AS count FROM story_revisions WHERE story_id = ?");
  const questionsBefore = sqlite.prepare("SELECT prompt FROM questions WHERE story_id = ? ORDER BY display_order").all(story.storyId);

  // Another editor saves a draft between this publish reading the story and
  // writing it.
  const racingDb = {
    ...db,
    async batch(statements) {
      sqlite.prepare("UPDATE texts SET draft_json = '{}', edit_version = 'another-editors-save' WHERE id = ?").run(story.storyId);
      return db.batch(statements);
    },
  };
  const lost = await publishStory(await editorRequest(racingDb, {
    path: `/api/admin/texts/${story.storyId}/publish`,
    method: "POST",
    body: { ...STORY, title: "Програна гонка", questions: [] },
    params: { id: String(story.storyId) },
  }));

  assert.equal(lost.status, 409);
  assert.equal(count("SELECT COUNT(*) AS count FROM story_revisions WHERE story_id = ?"), revisionsBefore);
  assert.deepEqual(
    sqlite.prepare("SELECT prompt FROM questions WHERE story_id = ? ORDER BY display_order").all(story.storyId).map((row) => ({ ...row })),
    questionsBefore.map((row) => ({ ...row }))
  );
  assert.equal(sqlite.prepare("SELECT title FROM texts WHERE id = ?").get(story.storyId).title, STORY.title);
});
