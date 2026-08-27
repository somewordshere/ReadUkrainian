import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

// 0020_content_refresh.sql is the only way the rewritten texts can reach
// production: 0002 and 0005 are already applied, D1 never re-runs a migration,
// and both of those open with an unqualified DELETE that would take ids,
// question_index, drafts and editor history with them.
//
// These tests stand up a database shaped like production — including a story an
// editor disabled, one carrying an unpublished draft, a gap where A2 #3 should
// be, and a B1 row that exists live but not in the seed — and check the refresh
// updates content without disturbing any of it.

const sql = (name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
const REFRESH = sql("0020_content_refresh.sql");

function createProductionLikeDb() {
  const db = new DatabaseSync(":memory:");
  // Schema only. The seed migrations are deliberately skipped: production ran
  // them long ago and their rows are simulated below with the old content.
  db.exec(sql("0001_schema.sql"));
  db.exec(sql("0003_add_question_index.sql"));
  db.exec(sql("0004_questions_schema.sql"));
  db.exec(sql("0006_editor_workflow.sql"));

  const insert = db.prepare(`
    INSERT INTO texts (level, display_order, title, paragraphs_json, show_word_count, is_enabled, question_index)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `);
  // Old content, as production still serves it.
  insert.run("A1", 1, "Будинок моєї сім'ї", JSON.stringify(["Стара версія."]), 1, 1);
  insert.run("A2", 1, "Мій день", JSON.stringify(["Мене звати Оля. Я прокидаюся о сьомій ранку."]), 1, 1);
  insert.run("A2", 2, "Моя сім'я", JSON.stringify(["Стара версія."]), 1, 2);
  // A2 #3 is absent in production: the story route 404s for it.
  insert.run("A2", 4, "У школі", JSON.stringify(["Стара версія."]), 1, 4);
  // An editor disabled this one.
  insert.run("A2", 5, "Мій друг", JSON.stringify(["Стара версія."]), 0, 5);
  // Exists live, absent from the seed.
  insert.run("B1", 16, "Тільки в продакшені", JSON.stringify(["Не чіпати."]), 1, 16);

  db.prepare(`
    UPDATE texts SET draft_json = ?, draft_updated_by_email = ?, published_at = ?, updated_by_email = ?
    WHERE level = 'A2' AND display_order = 2
  `).run(JSON.stringify({ title: "Чернетка" }), "editor@example.com", "2026-01-01T00:00:00.000Z", "admin@example.com");

  const question = db.prepare(`
    INSERT INTO questions (story_id, display_order, prompt, correct_answer, wrong_answers_json)
    VALUES ((SELECT id FROM texts WHERE level = ? AND display_order = ?), ?, ?, ?, ?)
  `);
  question.run("A2", 1, 1, "Старе питання?", "Стара відповідь", JSON.stringify(["а", "б", "в"]));

  return db;
}

const row = (db, level, order) =>
  db.prepare("SELECT * FROM texts WHERE level = ? AND display_order = ?").get(level, order);

test("the refresh updates existing stories in place without changing their id", () => {
  const db = createProductionLikeDb();
  const before = row(db, "A2", 1);

  db.exec(REFRESH);

  const after = row(db, "A2", 1);
  assert.equal(after.id, before.id, "the row must keep its id so questions stay attached");
  assert.equal(after.question_index, before.question_index);
  assert.match(JSON.parse(after.paragraphs_json)[0], /^Будильник дзвонить о сьомій/);
});

test("the refresh inserts the story missing from production and links its questions", () => {
  const db = createProductionLikeDb();
  assert.equal(row(db, "A2", 3), undefined);

  db.exec(REFRESH);

  const inserted = row(db, "A2", 3);
  assert.equal(inserted.title, "Мій будинок");
  assert.equal(inserted.question_index, 3, "a null question_index would render no quiz");
  assert.equal(inserted.is_enabled, 1);

  const count = db
    .prepare("SELECT COUNT(*) AS n FROM questions WHERE story_id = ?")
    .get(inserted.id).n;
  assert.equal(count, 5);
});

test("the refresh leaves editorial state alone", () => {
  const db = createProductionLikeDb();
  db.exec(REFRESH);

  const disabled = row(db, "A2", 5);
  assert.equal(disabled.is_enabled, 0, "a story an editor disabled must stay disabled");

  const drafted = row(db, "A2", 2);
  assert.equal(JSON.parse(drafted.draft_json).title, "Чернетка");
  assert.equal(drafted.draft_updated_by_email, "editor@example.com");
  assert.equal(drafted.published_at, "2026-01-01T00:00:00.000Z");
  assert.equal(drafted.updated_by_email, "admin@example.com");
});

test("the refresh never removes rows that are absent from the seed", () => {
  const db = createProductionLikeDb();
  db.exec(REFRESH);

  const orphan = row(db, "B1", 16);
  assert.ok(orphan, "a live-only row must survive");
  assert.equal(orphan.title, "Тільки в продакшені");
  assert.equal(JSON.parse(orphan.paragraphs_json)[0], "Не чіпати.");
});

test("questions are replaced per story rather than table-wide", () => {
  const db = createProductionLikeDb();
  const storyId = row(db, "A2", 1).id;

  db.exec(REFRESH);

  const prompts = db
    .prepare("SELECT prompt FROM questions WHERE story_id = ? ORDER BY display_order")
    .all(storyId)
    .map((r) => r.prompt);
  assert.equal(prompts.length, 5);
  assert.ok(!prompts.includes("Старе питання?"), "the stale question must be gone");

  // The live-only B1 row has no seed questions, so nothing should have been
  // deleted on its behalf either.
  const total = db.prepare("SELECT COUNT(*) AS n FROM questions").get().n;
  assert.equal(total, 585);
});

test("applying the refresh twice changes nothing", () => {
  const db = createProductionLikeDb();
  db.exec(REFRESH);

  const snapshot = () =>
    JSON.stringify({
      texts: db.prepare("SELECT id, level, display_order, title, paragraphs_json, is_enabled, question_index FROM texts ORDER BY level, display_order").all(),
      questions: db.prepare("SELECT story_id, display_order, prompt, correct_answer FROM questions ORDER BY story_id, display_order").all(),
    });

  const first = snapshot();
  db.exec(REFRESH);
  assert.equal(snapshot(), first);
});

test("the refresh brings every seeded story into the database", () => {
  const db = createProductionLikeDb();
  db.exec(REFRESH);

  const seeded = JSON.parse(readFileSync(new URL("../data/content-seed.json", import.meta.url), "utf8"));
  for (const story of seeded) {
    const stored = row(db, story.level, story.sortOrder);
    assert.ok(stored, `${story.level} #${story.sortOrder} is missing`);
    assert.deepEqual(JSON.parse(stored.paragraphs_json), story.paragraphs);
  }
});
