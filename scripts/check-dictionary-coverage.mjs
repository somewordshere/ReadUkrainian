import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { seedDatabase } from "./lib/seed-database.mjs";
import { analyzeDictionaryCoverage } from "../functions/_shared/dictionary-workflow.js";
import { lookupDictionaryWord } from "../functions/_shared/dictionary.js";

const { sqlite, db } = seedDatabase();
try {
  const stories = JSON.parse(readFileSync(new URL("../data/content-seed.json", import.meta.url), "utf8"))
    .filter((story) => ["A1", "A2"].includes(story.level) && story.active !== false);
  const coverage = await analyzeDictionaryCoverage(db, stories.flatMap((story) => story.paragraphs), { targetLanguage: "en" });
  console.log(JSON.stringify({ stories: stories.length, ...coverage }, null, 2));
  assert.deepEqual(coverage.missing, [], "Published vocabulary needs reviewed English dictionary coverage");
  assert.equal(coverage.coveragePercent, 100);
  for (const [word, badLemma] of [["мама", "озимина"], ["червоний", "рясний"], ["парк", "лісопарк"]]) {
    const result = await lookupDictionaryWord(db, { text: word, targetLanguage: "en" });
    assert.ok(result.entries.length && !result.entries.some((entry) => entry.lemma === badLemma), `Incorrect lookup: ${word}`);
  }
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
} finally { sqlite.close(); }
