import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { getDatabaseVersion, summarizeMigrations } from "../functions/_shared/database-version.js";

const MIGRATIONS = readdirSync(new URL("../migrations/", import.meta.url))
  .filter((name) => name.endsWith(".sql"))
  .sort();

test("the database version is the last applied migration, whatever order D1 returns", () => {
  const rows = MIGRATIONS.map((name, index) => ({ name, appliedAt: `2026-09-${String(1 + (index % 28)).padStart(2, "0")} 10:00:00` }))
    .reverse();
  const summary = summarizeMigrations(rows);
  const last = MIGRATIONS.at(-1).replace(/\.sql$/, "");

  assert.equal(summary.count, MIGRATIONS.length);
  assert.equal(summary.latest.name, last);
  assert.equal(summary.latest.number, last.slice(0, 4));
});

test("each dictionary's version is the last migration that built it", () => {
  const summary = summarizeMigrations(MIGRATIONS.map((name) => ({ name, appliedAt: null })));
  assert.equal(summary.dictionaries.de.number >= "0033", true);
  assert.equal(summary.dictionaries.en.number >= "0017", true);

  // A migration that installs a new dictionary source must be named so the admin
  // counts it; otherwise the admin would show an older build as current.
  for (const name of MIGRATIONS) {
    const sql = readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
    for (const [, language] of sql.matchAll(/INSERT INTO dictionary_language_pairs \([^)]*\) VALUES \('uk', '([a-z]{2})'/g)) {
      assert.match(name, new RegExp(`^\\d{4}_dictionary_uk_${language}_`), `${name} installs the ${language} source`);
      assert.equal(summary.dictionaries[language].name >= name.replace(/\.sql$/, ""), true);
    }
  }
});

test("an unreadable migrations table gives no version instead of failing the page", async () => {
  const db = { prepare() { return { async all() { throw new Error("no such table: d1_migrations"); } }; } };
  assert.equal(await getDatabaseVersion(db), null);
});
