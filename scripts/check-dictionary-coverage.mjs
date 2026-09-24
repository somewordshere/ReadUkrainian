import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { seedDatabase } from "./lib/seed-database.mjs";
import {
  checkCanaries,
  checkFormCaps,
  checkFormCrossings,
  databaseLookup,
  loadGuardConfig,
  reportFailures,
  storyWordFrequency,
} from "./lib/dictionary-guards.mjs";
import { analyzeDictionaryCoverage } from "../functions/_shared/dictionary-workflow.js";

const { sqlite, db } = seedDatabase();
try {
  const allStories = JSON.parse(readFileSync(new URL("../data/content-seed.json", import.meta.url), "utf8"));
  const stories = allStories.filter((story) => ["A1", "A2"].includes(story.level) && story.active !== false);
  const coverage = await analyzeDictionaryCoverage(db, stories.flatMap((story) => story.paragraphs), { targetLanguage: "en" });
  console.log(JSON.stringify({ stories: stories.length, ...coverage }, null, 2));
  assert.deepEqual(coverage.missing, [], "Published vocabulary needs reviewed English dictionary coverage");
  assert.equal(coverage.coveragePercent, 100);
  const german = await analyzeDictionaryCoverage(db, stories.flatMap((story) => story.paragraphs), { targetLanguage: "de" });
  console.log(JSON.stringify({ stories: stories.length, ...german, missing: process.argv.includes("--missing") ? german.missing : undefined }, null, 2));
  const polish = await analyzeDictionaryCoverage(db, stories.flatMap((story) => story.paragraphs), { targetLanguage: "pl" });
  console.log(JSON.stringify({ stories: stories.length, ...polish, missing: process.argv.includes("--missing") ? polish.missing : undefined }, null, 2));
  assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);

  // The whole dictionary, not only the latest update, must pass the guards, so
  // bad data can't be released whichever route it arrived by.
  const guard = loadGuardConfig();
  const frequency = storyWordFrequency(allStories);
  reportFailures("Dictionary canaries", await checkCanaries(databaseLookup(db), guard.canaries, { frequency }));
  reportFailures("Dictionary form limits", checkFormCaps(sqlite, guard.formCaps));
  reportFailures("Unreviewed dictionary forms", checkFormCrossings(sqlite, guard.approvedForms, { frequency }));
  console.log(`Dictionary guards passed: ${guard.canaries.length} canary words, form limits, ${guard.approvedForms.size} reviewed form pairs.`);
} finally { sqlite.close(); }
