import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { createSessionToken } from "../functions/_shared/auth.js";
import { lookupDictionaryWord } from "../functions/_shared/dictionary.js";
import { analyzeDictionaryCoverage } from "../functions/_shared/dictionary-workflow.js";
import { onRequestPost as checkUpdate } from "../functions/api/admin/dictionary/check-update.js";
import { onRequestPost as checkCoverage } from "../functions/api/admin/dictionary/coverage.js";
import { onRequestPost as approveSuggestion } from "../functions/api/admin/dictionary/approve.js";
import { onRequestPost as publishStory } from "../functions/api/admin/texts/publish.js";
import {
  onRequestGet as listSuggestions,
  onRequestPost as createSuggestion,
} from "../functions/api/admin/dictionary/suggestions.js";

const SESSION_SECRET = "a sufficiently long dictionary workflow secret";

function createD1Database() {
  const sqlite = new DatabaseSync(":memory:");
  const migrationsDirectory = new URL("../migrations/", import.meta.url);
  for (const migration of readdirSync(migrationsDirectory).filter((file) => file.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
  }
  // Linguisto is not a migration: it is withheld from production, so it lives in
  // data/optional-seeds and has to be asked for. The German lookups and coverage
  // figures below therefore describe a dictionary the live site does not have.
  sqlite.exec(
    readFileSync(new URL("../data/optional-seeds/dictionary_linguisto_uk_de.sql", import.meta.url), "utf8")
  );
  sqlite.exec(`
    INSERT INTO users (id, email, password_hash, role) VALUES
      (1, 'admin@example.com', 'unused', 'admin'),
      (2, 'editor@example.com', 'unused', 'editor');
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
        return statement.get(...parameters);
      },
      async all() {
        return { results: statement.all(...parameters) };
      },
      async run() {
        const result = statement.run(...parameters);
        return {
          success: true,
          meta: {
            changes: Number(result.changes),
            last_row_id: Number(result.lastInsertRowid),
          },
        };
      },
    };
    return prepared;
  }

  return {
    prepare,
    async batch(statements) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
}

async function adminContext(db, {
  path,
  method = "POST",
  role = "admin",
  payload = {},
  origin = "https://readukrainianapp.com",
  params = {},
} = {}) {
  const token = await createSessionToken(SESSION_SECRET, {
    userId: role === "admin" ? 1 : 2,
    email: `${role}@example.com`,
    role,
  });
  const headers = new Headers({
    cookie: `admin_session=${token}`,
    "content-type": "application/json",
  });
  if (origin !== null) headers.set("origin", origin);
  return {
    request: new Request(`https://readukrainianapp.com${path}`, {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(payload),
    }),
    env: { DB: db, SESSION_SECRET },
    params,
  };
}

test("the reviewed supplement gives every active seeded story word English coverage", async () => {
  const db = createD1Database();
  const stories = JSON.parse(readFileSync(new URL("../data/content-seed.json", import.meta.url), "utf8"));
  const paragraphs = stories.filter((story) => story.active !== false).flatMap((story) => story.paragraphs);
  const coverage = await analyzeDictionaryCoverage(db, paragraphs, { targetLanguage: "en" });

  assert.equal(coverage.totalUniqueWords, 4091);
  assert.equal(coverage.coveredUniqueWords, 4091);
  assert.equal(coverage.coveragePercent, 100);
  assert.deepEqual(coverage.missing, []);
});

test("the German Wiktionary and Linguisto seeds form an attributed language pair", async () => {
  const db = createD1Database();
  const stories = JSON.parse(readFileSync(new URL("../data/content-seed.json", import.meta.url), "utf8"));
  const paragraphs = stories.filter((story) => story.active !== false).flatMap((story) => story.paragraphs);
  const coverage = await analyzeDictionaryCoverage(db, paragraphs, { targetLanguage: "de" });
  const lookup = await lookupDictionaryWord(db, { text: "мама", targetLanguage: "de" });
  const linguistoLookup = await lookupDictionaryWord(db, { text: "спокійний", targetLanguage: "de" });

  // German is the deliberately partial pair: the German Wiktionary holds only
  // 473 Ukrainian lexemes to the English edition's 2540, and the curated
  // supplement writes English translations only, so this pair cannot reach the
  // 100% the English test asserts.
  assert.equal(coverage.totalUniqueWords, 4091);
  assert.equal(coverage.coveredUniqueWords, 2893);
  assert.equal(coverage.coveragePercent, 70.7);
  assert.ok(coverage.missing.length > 0);
  assert.equal(lookup.entries[0].translations[0].text, "Mama");
  assert.equal(lookup.attribution.sourceRevision, "2026-08-04");
  assert.equal(linguistoLookup.entries[0].translations[0].text, "ruhig");
  assert.equal(
    linguistoLookup.attributions[0].name,
    "Linguisto German–Ukrainian dictionary (2018-04-12)"
  );
  assert.equal(linguistoLookup.attributions[0].licenseName, "Creative Commons Attribution");
});

test("new text coverage is non-blocking data with an exact missing-word list", async () => {
  const db = createD1Database();
  const response = await checkCoverage(await adminContext(db, {
    path: "/api/admin/dictionary/coverage",
    role: "editor",
    payload: {
      paragraphs: ["Марійка і космоліт. Космоліт."],
      targetLanguage: "en",
    },
  }));

  assert.equal(response.status, 200);
  const { coverage } = await response.json();
  assert.equal(coverage.available, true);
  assert.deepEqual(coverage.missing, [{ word: "космоліт", count: 2 }]);
});

test("publishing succeeds while returning a visible dictionary warning", async () => {
  const db = createD1Database();
  const response = await publishStory(await adminContext(db, {
    path: "/api/admin/texts/1/publish",
    role: "publisher",
    params: { id: "1" },
    payload: {
      level: "A1",
      title: "Новий космоліт",
      paragraphs: ["Марійка і космоліт."],
      questions: [],
      showWordCount: true,
    },
  }));

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.story.active, true);
  assert.equal(body.dictionaryCoverage.missingCount, 1);
  assert.deepEqual(body.dictionaryCoverage.missing, [{ word: "космоліт", count: 1 }]);
});

test("editors suggest entries and administrators approve them before learner lookup", async () => {
  const db = createD1Database();
  const createResponse = await createSuggestion(await adminContext(db, {
    path: "/api/admin/dictionary/suggestions",
    role: "editor",
    payload: {
      word: "космоліт",
      lemma: "космоліт",
      partOfSpeech: "noun",
      tags: ["masculine", "nominative", "singular"],
      targetLanguage: "en",
      translation: "spacecraft",
      explanation: "A fictional vehicle in a new story.",
    },
  }));
  assert.equal(createResponse.status, 201);
  const { suggestionId } = await createResponse.json();

  const editorList = await listSuggestions(await adminContext(db, {
    path: "/api/admin/dictionary/suggestions",
    method: "GET",
    role: "editor",
  }));
  assert.equal(editorList.status, 403);

  const adminList = await listSuggestions(await adminContext(db, {
    path: "/api/admin/dictionary/suggestions",
    method: "GET",
  }));
  assert.equal((await adminList.json()).suggestions.length, 1);

  const approveResponse = await approveSuggestion(await adminContext(db, {
    path: `/api/admin/dictionary/suggestions/${suggestionId}/approve`,
    payload: { note: "Reviewed." },
    params: { id: String(suggestionId) },
  }));
  assert.equal(approveResponse.status, 200);

  const lookup = await lookupDictionaryWord(db, { text: "космоліт", targetLanguage: "en" });
  assert.equal(lookup.entries[0].translations[0].text, "spacecraft");
  assert.equal(lookup.attributions[0].name, "Read Ukrainian reviewed supplement");
});

test("the refresh action records only the available upstream revision", async () => {
  const db = createD1Database();
  const previousFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (url) => {
    requests += 1;
    assert.equal(url, "https://kaikki.org/dictionary/Ukrainian/");
    return new Response(
      "This dictionary is based on structured data extracted today from the enwiktionary dump dated 2026-08-12 using wiktextract.",
      { headers: { "content-type": "text/html; charset=utf-8" } }
    );
  };

  try {
    const response = await checkUpdate(await adminContext(db, {
      path: "/api/admin/dictionary/check-update",
    }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.currentRevision, "2026-08-05");
    assert.equal(result.availableRevision, "2026-08-12");
    assert.equal(result.updateAvailable, true);
    assert.equal(requests, 1);

    const pair = await db.prepare(`
      SELECT source_revision AS currentRevision, available_revision AS availableRevision
      FROM dictionary_language_pairs WHERE source_language = 'uk' AND target_language = 'en'
    `).first();
    assert.equal(pair.currentRevision, "2026-08-05");
    assert.equal(pair.availableRevision, "2026-08-12");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
