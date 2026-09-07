import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { seedDatabase } from "../scripts/lib/seed-database.mjs";
import { extractUkrainianWords } from "../functions/_shared/ukrainian-word.js";

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const seed = json("../data/content-seed.json");
const questions = json("../data/questions-seed.json");
const historical = json("./fixtures/content-082.json");
const selected = [5, 8, 9, 15, 16, 17, 18, 19];
const key = (s) => `${s.level}#${s.sortOrder}`;
const words = (text) => text.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word));

test("new A1 stories meet their public mechanical acceptance criteria", () => {
  const once = new Map();
  for (const story of historical.filter((s) => s.level === "A1")) {
    for (const word of new Set(extractUkrainianWords(story.paragraphs.join(" ")))) once.set(word, (once.get(word) || 0) + 1);
  }
  const specs = [[15,90,3,"Моя кімната"],[16,95,3,"У школі"],[17,95,3,"Мій друг"],[18,80,2,"Сніданок удома"],[19,90,1,"У магазині"]];
  for (const [order, min, paragraphs, title] of specs) {
    const story = seed.find((s) => s.level === "A1" && s.sortOrder === order);
    assert.ok(story, `A1#${order}`);
    assert.equal(story.title, title);
    assert.equal(story.paragraphs.length, paragraphs);
    const body = story.paragraphs.join(" ");
    assert.ok(words(body).length >= min && words(body).length <= min + 10, `A1#${order} word band`);
    const perParagraph = story.paragraphs.map((p) => p.split(/(?<=[.!?…])\s+/u));
    const lengths = perParagraph.flat().map((s) => words(s).length);
    assert.ok(lengths.every((n) => n <= 11), `A1#${order} sentence ceiling`);
    assert.ok(lengths.filter((n) => n < 5).length >= 2, `A1#${order} short sentences`);
    if (paragraphs > 1) assert.ok(perParagraph.every((p) => p.length <= 6));
    assert.doesNotMatch(body, /[’ʼ]|(?:^|[^а-яіїєґ])(?:якщо|щоб|хоча|поки)(?:$|[^а-яіїєґ])|,\s*як(?:ий|а|і|ого|ому|ої|им|их)\s/iu);
    assert.ok([...new Set(extractUkrainianWords(body))].filter((w) => once.get(w) === 1).length >= 5, `A1#${order} vocabulary recycling`);
    const set = questions.filter((q) => q.level === "A1" && q.storyOrder === order);
    assert.equal(set.length, 5);
    for (const q of set) {
      assert.ok(q.prompt.length <= 30);
      assert.doesNotMatch(q.prompt, /^Чому/);
      assert.equal(q.wrong.length, 3);
      assert.equal(new Set([q.correct, ...q.wrong]).size, 4);
      assert.ok([q.correct, ...q.wrong].every((s) => s.length <= 29));
    }
    if (order === 16) { assert.match(body, /Ви можете/); assert.match(body, /Ти маєш/); }
    if (order === 19) {
      const turns = story.paragraphs[0].split("\n").filter((line) => /^(Покупець|Продавчиня):/.test(line));
      assert.equal(turns.length, 6);
      assert.ok(turns.some((line) => line.startsWith("Покупець:") && /Ви /.test(line)));
      assert.ok(turns.some((line) => line.startsWith("Продавчиня:") && /Ви /.test(line)));
      assert.doesNotMatch(body, /(?:^|\s)ти(?:\s|[,.?!])/iu);
    }
  }
});

test("only the eight approved A1 stories differ from the previous content", () => {
  for (const story of historical) {
    if (story.level === "A1" && selected.includes(story.sortOrder)) continue;
    assert.deepEqual(seed.find((s) => key(s) === key(story)), story, key(story));
  }
  for (const order of [5,8,9]) {
    const body = seed.find((s) => s.level === "A1" && s.sortOrder === order).paragraphs.join(" ");
    assert.doesNotMatch(body, /Якщо|якого звати|, який часто/);
  }
});

test("the targeted migration preserves identities, drafts, revisions, disabled flags and unrelated rows", () => {
  const { sqlite } = seedDatabase({ before: "0024" });
  try {
    sqlite.exec("UPDATE texts SET draft_json = '{\"title\":\"Unpublished draft\"}', draft_updated_by_email = 'editor@example.com', is_enabled = 0 WHERE level = 'A1' AND display_order = 8");
    sqlite.exec("INSERT INTO story_revisions (story_id, action, snapshot_json, created_by_email) SELECT id, 'save_draft', '{}', 'editor@example.com' FROM texts WHERE level='A1' AND display_order=8");
    sqlite.exec("INSERT INTO texts (level,display_order,title,paragraphs_json,question_index) VALUES ('B1',16,'Live only','[\"Preserve\"]',16)");
    const before = sqlite.prepare("SELECT * FROM texts ORDER BY id").all();
    const revisions = sqlite.prepare("SELECT * FROM story_revisions").all();
    const unrelatedQuestions = sqlite.prepare("SELECT * FROM questions WHERE story_id NOT IN (SELECT id FROM texts WHERE level='A1' AND display_order IN (5,8,9)) ORDER BY id").all();
    sqlite.exec(readFileSync(new URL("../migrations/0024_a1_batch_015_019.sql", import.meta.url), "utf8"));
    assert.deepEqual(sqlite.prepare("SELECT * FROM story_revisions").all(), revisions);
    for (const row of before) {
      const after = sqlite.prepare("SELECT * FROM texts WHERE id=?").get(row.id);
      if (row.level === "A1" && [5,8,9].includes(row.display_order)) {
        for (const column of Object.keys(row).filter((c) => !["title","paragraphs_json","show_word_count","updated_at"].includes(c))) assert.equal(after[column], row[column], column);
      } else assert.deepEqual(after, row);
    }
    for (const q of unrelatedQuestions) assert.deepEqual(sqlite.prepare("SELECT * FROM questions WHERE id=?").get(q.id), q);
    for (const order of selected) {
      const row = sqlite.prepare("SELECT * FROM texts WHERE level='A1' AND display_order=?").get(order);
      const expected = seed.find((s) => s.level === "A1" && s.sortOrder === order);
      assert.deepEqual(JSON.parse(row.paragraphs_json), expected.paragraphs);
      const stored = sqlite.prepare("SELECT prompt, correct_answer, wrong_answers_json FROM questions WHERE story_id=? ORDER BY display_order").all(row.id);
      assert.deepEqual(stored.map((q) => ({prompt:q.prompt,correct:q.correct_answer,wrong:JSON.parse(q.wrong_answers_json)})), questions.filter((q) => q.level === "A1" && q.storyOrder === order).map(({prompt,correct,wrong}) => ({prompt,correct,wrong})));
    }
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { sqlite.close(); }
});

test("refresh generation refuses missing selections, unknown stories, overwritten files and incomplete quizzes", () => {
  const root = mkdtempSync(join(tmpdir(), "a1-refresh-"));
  mkdirSync(join(root,"scripts")); mkdirSync(join(root,"data"));
  copyFileSync(new URL("../scripts/build-content-refresh.mjs", import.meta.url), join(root,"scripts/build-content-refresh.mjs"));
  writeFileSync(join(root,"data/content-seed.json"), JSON.stringify(seed));
  writeFileSync(join(root,"data/questions-seed.json"), JSON.stringify(questions));
  const out = join(root,"new.sql");
  const run = (...args) => spawnSync(process.execPath,[join(root,"scripts/build-content-refresh.mjs"),...args], {encoding:"utf8"});
  assert.notEqual(run("--output",out).status,0);
  assert.notEqual(run("--output",out,"--stories","A1#999").status,0);
  assert.equal(existsSync(out),false);
  assert.equal(run("--output",out,"--stories","A1#15").status,0);
  const generated = readFileSync(out,"utf8");
  assert.notEqual(run("--output",out,"--stories","A1#16").status,0);
  assert.equal(readFileSync(out,"utf8"),generated);
  writeFileSync(join(root,"data/questions-seed.json"),JSON.stringify(questions.filter((q) => !(q.level === "A1" && q.storyOrder === 16 && q.displayOrder === 5))));
  assert.notEqual(run("--output",join(root,"invalid.sql"),"--stories","A1#16").status,0);
  assert.equal(existsSync(join(root,"invalid.sql")),false);
});
