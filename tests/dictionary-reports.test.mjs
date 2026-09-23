import assert from "node:assert/strict";
import test from "node:test";

import { createSessionToken } from "../functions/_shared/auth.js";
import { extractUkrainianWords } from "../functions/_shared/ukrainian-word.js";
import { onRequestGet as listReports, onResolvePost as resolveReport } from "../functions/api/admin/dictionary/reports.js";
import { onRequestPost as report } from "../functions/api/dictionary/report.js";
import { seedDatabase } from "../scripts/lib/seed-database.mjs";

const ORIGIN = "https://readukrainianapp.com";
const SESSION_SECRET = "a sufficiently long test session secret";

function setup() {
  const { sqlite, db } = seedDatabase();
  const story = sqlite.prepare("SELECT id, paragraphs_json AS paragraphs FROM texts WHERE is_enabled = 1 ORDER BY id LIMIT 1").get();
  const word = extractUkrainianWords(JSON.parse(story.paragraphs).join(" "))[0];
  const limiterCalls = [];
  const env = {
    DB: db,
    SESSION_SECRET,
    REPORT_RATE_LIMITER: {
      allow: true,
      async limit(input) {
        limiterCalls.push(input);
        return { success: this.allow };
      },
    },
  };
  return { sqlite, env, storyId: story.id, word, limiterCalls };
}

function reportRequest(body, headers = {}) {
  return new Request(`${ORIGIN}/api/dictionary/report`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": "203.0.113.7", ...headers },
    body: JSON.stringify(body),
  });
}

async function adminContext(env, { method = "GET", path = "/api/admin/dictionary/reports", body, params = {}, role = "admin" } = {}) {
  const token = await createSessionToken(SESSION_SECRET, { userId: 1, email: "admin@example.com", role });
  return {
    request: new Request(`${ORIGIN}${path}`, {
      method,
      headers: { cookie: `admin_session=${token}`, origin: ORIGIN, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    params,
  };
}

test("a report stores what the dictionary showed, and repeats raise one row's count", async () => {
  const { sqlite, env, storyId, word, limiterCalls } = setup();
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await report({ request: reportRequest({ text: word.toUpperCase(), targetLanguage: "en", storyId }), env });
      assert.equal(response.status, 202);
    }
    const rows = sqlite.prepare("SELECT * FROM dictionary_reports").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].normalized_word, word);
    assert.equal(rows[0].reports, 2);
    assert.equal(rows[0].status, "open");
    const shown = JSON.parse(rows[0].shown_json);
    assert.ok(shown.length > 0 && shown[0].lemma && Array.isArray(shown[0].translations));
    assert.deepEqual(limiterCalls[0], { key: "dictionary-report:203.0.113.7" });

    // Once resolved, a new report opens a fresh row.
    sqlite.exec("UPDATE dictionary_reports SET status = 'fixed'");
    assert.equal((await report({ request: reportRequest({ text: word, targetLanguage: "en", storyId }), env })).status, 202);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM dictionary_reports").get().n, 2);
  } finally {
    sqlite.close();
  }
});

test("reports are limited to real story words from the site itself", async () => {
  const { sqlite, env, storyId, word } = setup();
  try {
    const cases = [
      [reportRequest({ text: word, targetLanguage: "en", storyId }, { origin: "https://example.com" }), 403],
      [reportRequest({ text: word, targetLanguage: "en", storyId, note: "free text" }), 400],
      [reportRequest({ text: "два слова", targetLanguage: "en", storyId }), 422],
      [reportRequest({ text: word, targetLanguage: "fr", storyId }), 400],
      [reportRequest({ text: word, targetLanguage: "en", storyId: 0 }), 400],
      [reportRequest({ text: "абракадабра", targetLanguage: "en", storyId }), 404],
      [reportRequest({ text: word, targetLanguage: "en", storyId: 999999 }), 404],
    ];
    for (const [request, status] of cases) {
      assert.equal((await report({ request, env })).status, status);
    }
    env.REPORT_RATE_LIMITER.allow = false;
    const limited = await report({ request: reportRequest({ text: word, targetLanguage: "en", storyId }), env });
    assert.equal(limited.status, 429);
    delete env.REPORT_RATE_LIMITER;
    assert.equal((await report({ request: reportRequest({ text: word, targetLanguage: "en", storyId }), env })).status, 503);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM dictionary_reports").get().n, 0);
  } finally {
    sqlite.close();
  }
});

test("admins list open reports and resolve them once", async () => {
  const { sqlite, env, storyId, word } = setup();
  try {
    await report({ request: reportRequest({ text: word, targetLanguage: "de", storyId }), env });

    assert.equal((await listReports(await adminContext(env, { role: "editor" }))).status, 403);
    const listed = await (await listReports(await adminContext(env))).json();
    assert.equal(listed.reports.length, 1);
    assert.equal(listed.reports[0].word, word);
    assert.equal(listed.reports[0].targetLanguage, "de");
    assert.equal(listed.reports[0].storyId, storyId);
    assert.ok(listed.reports[0].storyTitle);

    const id = listed.reports[0].reportId;
    const path = `/api/admin/dictionary/reports/${id}/resolve`;
    const bad = await resolveReport(await adminContext(env, { method: "POST", path, params: { id: String(id) }, body: { status: "deleted" } }));
    assert.equal(bad.status, 400);
    const fixed = await resolveReport(await adminContext(env, { method: "POST", path, params: { id: String(id) }, body: { status: "fixed" } }));
    assert.equal(fixed.status, 200);
    const again = await resolveReport(await adminContext(env, { method: "POST", path, params: { id: String(id) }, body: { status: "dismissed" } }));
    assert.equal(again.status, 409);
    assert.equal(sqlite.prepare("SELECT resolved_by_email FROM dictionary_reports").get().resolved_by_email, "admin@example.com");
    assert.equal((await (await listReports(await adminContext(env))).json()).reports.length, 0);
  } finally {
    sqlite.close();
  }
});
