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
      (2, 'editor@example.com', 'unused', 'editor'),
      (3, 'publisher@example.com', 'unused', 'publisher');
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
    userId: { admin: 1, editor: 2, publisher: 3 }[role],
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

  assert.ok(coverage.totalUniqueWords >= 4091);
  assert.equal(coverage.coveredUniqueWords, coverage.totalUniqueWords);
  assert.equal(coverage.coveragePercent, 100);
  assert.deepEqual(coverage.missing, []);
});

test("the German Wiktionary and Linguisto seeds form an attributed language pair", async () => {
  const db = createD1Database();
  const stories = JSON.parse(readFileSync(new URL("./fixtures/content-082.json", import.meta.url), "utf8"));
  const paragraphs = stories.filter((story) => story.active !== false).flatMap((story) => story.paragraphs);
  const coverage = await analyzeDictionaryCoverage(db, paragraphs, { targetLanguage: "de" });
  const lookup = await lookupDictionaryWord(db, { text: "мама", targetLanguage: "de" });
  const linguistoLookup = await lookupDictionaryWord(db, { text: "спокійний", targetLanguage: "de" });

  // German is the deliberately partial pair: the German Wiktionary holds only
  // 473 Ukrainian lexemes to the English edition's 2540, and the curated
  // supplement writes English translations only, so this pair cannot reach the
  // 100% the English test asserts.
  // Floors, not exact values: a prepared dictionary update (prepare-update.mjs)
  // only adds entries, so coverage may rise but must never fall below this.
  assert.equal(coverage.totalUniqueWords, 4091);
  // 2893 until 0031 removed «серед» → Mittwoch, which counted as coverage but was wrong.
  assert.ok(coverage.coveredUniqueWords >= 2892, `covered ${coverage.coveredUniqueWords}`);
  assert.ok(coverage.coveragePercent >= 70.7);
  assert.ok(coverage.missing.length > 0);
  assert.equal(lookup.entries[0].translations[0].text, "Mama");
  assert.match(lookup.attribution.sourceRevision, /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
  assert.ok(lookup.attribution.sourceRevision >= "2026-08-04");
  assert.equal(linguistoLookup.entries[0].translations[0].text, "ruhig");
  assert.equal(
    linguistoLookup.attributions[0].name,
    "Linguisto German–Ukrainian dictionary (2018-04-12)"
  );
  assert.equal(linguistoLookup.attributions[0].licenseName, "Creative Commons Attribution");
});

test("the Polish Wiktionary seed reaches its entries through the English word forms", async () => {
  const db = createD1Database();
  const stories = JSON.parse(readFileSync(new URL("../data/content-seed.json", import.meta.url), "utf8"));
  const paragraphs = stories
    .filter((story) => ["A1", "A2"].includes(story.level) && story.active !== false)
    .flatMap((story) => story.paragraphs);
  const coverage = await analyzeDictionaryCoverage(db, paragraphs, { targetLanguage: "pl" });
  const shown = async (text) => (await lookupDictionaryWord(db, { text, targetLanguage: "pl" })).entries;

  // Polish Wiktionary has no Ukrainian inflections, so every inflected form here
  // is reached through the English dictionary's forms. A floor, like German's.
  assert.ok(coverage.coveredUniqueWords >= 3308, `covered ${coverage.coveredUniqueWords}`);
  assert.ok(coverage.coveragePercent >= 79.5);
  assert.ok(coverage.missing.length > 0);

  const book = await shown("книжку");
  assert.equal(book[0].lemma, "книжка");
  assert.equal(book[0].translations[0].text, "książka");
  assert.equal(book[0].translations[0].source.name, "Polish Wiktionary via Kaikki.org");
  assert.ok(book[0].forms.some((form) => form.grammar.case === "accusative"));
  assert.equal((await shown("йду"))[0].translations[0].text, "iść");
  // Filed as a determiner, as English Wiktionary has it, not Polish's pronoun.
  const thisOne = await shown("цього");
  assert.deepEqual(thisOne.map((entry) => [entry.lemma, entry.partOfSpeech]), [["цей", "determiner"]]);
  // The translation first, then what the preposition expresses.
  assert.match((await shown("на"))[0].translations[0].text, /^na \(/u);
  // A letter's description is not a translation.
  assert.ok(!(await shown("я")).some((entry) => entry.partOfSpeech === "character"));
  const result = await lookupDictionaryWord(db, { text: "книжку", targetLanguage: "pl" });
  assert.equal(result.attribution.sourceRevision, "2026-09-20");
});

test("the refresh action versions the Polish source by its extract's Last-Modified date", async () => {
  const db = createD1Database();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(url, "https://kaikki.org/dictionary/downloads/pl/pl-extract.jsonl.gz");
    assert.equal(options.method, "HEAD");
    return new Response(null, { headers: { "last-modified": "Sun, 04 Oct 2099 02:23:42 GMT" } });
  };
  try {
    const response = await checkUpdate(await adminContext(db, {
      path: "/api/admin/dictionary/check-update",
      payload: { targetLanguage: "pl" },
    }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.currentRevision, "2026-09-20");
    assert.equal(result.availableRevision, "2099-10-04");
    assert.equal(result.updateAvailable, true);
  } finally {
    globalThis.fetch = previousFetch;
  }
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

test("a suggestion rejected mid-approval never reaches learners", async () => {
  const db = createD1Database();
  const created = await createSuggestion(await adminContext(db, {
    path: "/api/admin/dictionary/suggestions",
    role: "editor",
    payload: {
      word: "космоліт",
      lemma: "космоліт",
      partOfSpeech: "noun",
      tags: ["masculine", "nominative", "singular"],
      targetLanguage: "en",
      translation: "spacecraft",
    },
  }));
  const { suggestionId } = await created.json();

  // A second admin rejects it after this approval read the pending row but
  // before its batch ran.
  const racingDb = {
    ...db,
    async batch(statements) {
      await db.prepare("UPDATE dictionary_suggestions SET status = 'rejected' WHERE id = ?1").bind(suggestionId).run();
      return db.batch(statements);
    },
  };
  const approve = await approveSuggestion(await adminContext(racingDb, {
    path: `/api/admin/dictionary/suggestions/${suggestionId}/approve`,
    params: { id: String(suggestionId) },
  }));

  assert.equal(approve.status, 409);
  assert.equal(await db.prepare("SELECT 1 FROM dictionary_lexemes WHERE id = ?1").bind(`curated-lexeme-${suggestionId}`).first() ?? null, null);
  const lookup = await lookupDictionaryWord(db, { text: "космоліт", targetLanguage: "en" });
  assert.equal(lookup.entries.length, 0);

  const again = await approveSuggestion(await adminContext(db, {
    path: `/api/admin/dictionary/suggestions/${suggestionId}/approve`,
    params: { id: String(suggestionId) },
  }));
  assert.equal(again.status, 409);
});

test("the refresh action refuses to follow an upstream redirect", async () => {
  const db = createD1Database();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, {
    status: 301,
    headers: { location: "https://untrusted.invalid/" },
  });

  try {
    const response = await checkUpdate(await adminContext(db, {
      path: "/api/admin/dictionary/check-update",
    }));
    assert.equal(response.status, 502);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("the refresh action records only the available upstream revision", async () => {
  const db = createD1Database();
  const previousFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (url, options = {}) => {
    requests += 1;
    assert.equal(url, "https://kaikki.org/dictionary/Ukrainian/");
    // Cloudflare Workers throw on redirect: "error"; only "manual" or "follow" work.
    assert.equal(options.redirect, "manual");
    return new Response(
      "This dictionary is based on structured data extracted today from the enwiktionary dump dated 2099-08-12 using wiktextract.",
      { headers: { "content-type": "text/html; charset=utf-8" } }
    );
  };

  // Whatever revision the migrations installed; a later dictionary update moves it.
  const installed = (await db.prepare(`
    SELECT source_revision AS currentRevision FROM dictionary_language_pairs
    WHERE source_language = 'uk' AND target_language = 'en'
  `).first()).currentRevision;

  try {
    const response = await checkUpdate(await adminContext(db, {
      path: "/api/admin/dictionary/check-update",
    }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.currentRevision, installed);
    assert.equal(result.availableRevision, "2099-08-12");
    assert.equal(result.updateAvailable, true);
    assert.equal(requests, 1);

    const pair = await db.prepare(`
      SELECT source_revision AS currentRevision, available_revision AS availableRevision
      FROM dictionary_language_pairs WHERE source_language = 'uk' AND target_language = 'en'
    `).first();
    assert.equal(pair.currentRevision, installed);
    assert.equal(pair.availableRevision, "2099-08-12");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
