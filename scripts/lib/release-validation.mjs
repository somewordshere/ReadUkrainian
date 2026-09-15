import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { comparableQuestions } from "./live-content-check.mjs";

export const sqlHash = (text) => createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex");

export function validateMigrationFiles(manifest, directory, { allowLater = false } = {}) {
  const last = manifest.migrations.at(-1).name;
  const files = readdirSync(directory).filter((f) => f.endsWith(".sql") && (!allowLater || f <= last)).sort();
  assert.deepEqual(files, manifest.migrations.map((m) => m.name), "Migration list differs from the reviewed release manifest");
  for (const file of manifest.migrations) assert.equal(sqlHash(readFileSync(new URL(file.name, directory), "utf8")), file.sha256, `Migration changed: ${file.name}`);
}

export function pendingMigrations(manifest, applied) {
  const known = manifest.migrations.map((m) => m.name);
  assert.equal(new Set(applied).size, applied.length, "Duplicate applied migration names");
  for (const name of applied) assert.ok(known.includes(name), `Unexpected applied migration: ${name}`);
  const pending = known.filter((name) => !applied.includes(name));
  assert.ok(pending.every((name) => manifest.releaseMigrations.includes(name)), "An older migration is unexpectedly pending");
  // A retry can resume after the dictionary migration, but never skip backwards.
  const expected = manifest.releaseMigrations.slice(manifest.releaseMigrations.length - pending.length);
  assert.deepEqual(pending, expected, "Release migrations were applied out of order");
  return pending;
}

export function validateLiveBaseline(manifest, rows, questions, alreadyApplied = false) {
  for (const item of manifest.stories) {
    const row = rows.find((r) => r.level === item.level && r.display_order === item.order);
    const expected = alreadyApplied ? item.after : item.before;
    if (!expected) { assert.equal(row, undefined, `${item.level}#${item.order} already exists; review editorial drift`); continue; }
    assert.ok(row, `${item.level}#${item.order} is missing`);
    const actual = {
      title: row.title, paragraphs: JSON.parse(row.paragraphs_json),
      showWordCount: Boolean(row.show_word_count), active: Boolean(row.is_enabled),
      questions: comparableQuestions(questions.filter((q) => q.story_id === row.id).sort((a,b) => a.display_order - b.display_order).map((q) => ({prompt:q.prompt,correct:q.correct_answer,wrong:JSON.parse(q.wrong_answers_json)}))),
    };
    assert.deepEqual(actual, expected, `${item.level}#${item.order} changed since the reviewed baseline; publication stopped`);
  }
}
