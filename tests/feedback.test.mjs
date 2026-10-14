import assert from "node:assert/strict";
import test from "node:test";

import { createSessionToken } from "../functions/_shared/auth.js";
import { onRequestGet as listFeedback, onResolvePost as resolveFeedback } from "../functions/api/admin/feedback.js";
import { onRequestPost as sendFeedback, validateFeedback } from "../functions/api/feedback.js";
import { seedDatabase } from "../scripts/lib/seed-database.mjs";

const ORIGIN = "https://readukrainianapp.com";
const SESSION_SECRET = "a sufficiently long test session secret";

function setup() {
  const { sqlite, db } = seedDatabase();
  sqlite.exec(`
    INSERT INTO users (id, email, password_hash, role) VALUES
      (1, 'admin@example.com', 'unused', 'admin'),
      (2, 'publisher@example.com', 'unused', 'publisher');
  `);
  const story = sqlite.prepare("SELECT id, title FROM texts WHERE is_enabled = 1 ORDER BY id LIMIT 1").get();
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
  return { sqlite, env, story, limiterCalls };
}

function feedbackRequest(body, headers = {}) {
  return new Request(`${ORIGIN}/api/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": "203.0.113.9", ...headers },
    body: JSON.stringify(body),
  });
}

async function adminContext(env, { method = "GET", path = "/api/admin/feedback", body, params = {}, role = "admin" } = {}) {
  const userId = role === "admin" ? 1 : 2;
  const token = await createSessionToken(SESSION_SECRET, { userId, email: `${role}@example.com`, role });
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

test("a reader's message is stored with its page, story and optional email", async () => {
  const { sqlite, env, story, limiterCalls } = setup();
  try {
    const response = await sendFeedback({
      request: feedbackRequest({ message: "  Помилка в тексті.\nДякую!  ", email: "reader@example.com", page: `/story.html?story=${story.id}`, storyId: story.id }),
      env,
    });
    assert.equal(response.status, 201);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM feedback").get().n, 1);
    const row = sqlite.prepare("SELECT * FROM feedback").get();
    assert.equal(row.message, "Помилка в тексті.\nДякую!");
    assert.equal(row.email, "reader@example.com");
    assert.equal(row.page, `/story.html?story=${story.id}`);
    assert.equal(row.story_id, story.id);
    assert.equal(row.status, "open");
    assert.deepEqual(limiterCalls[0], { key: "feedback:203.0.113.9" });

    // The email is optional.
    assert.equal((await sendFeedback({ request: feedbackRequest({ message: "Чудовий сайт" }), env })).status, 201);
    assert.equal(sqlite.prepare("SELECT email FROM feedback ORDER BY id DESC").get().email, null);
  } finally {
    sqlite.close();
  }
});

test("the form accepts only same-origin, well-formed messages and is rate limited", async () => {
  const { sqlite, env } = setup();
  try {
    const cases = [
      [feedbackRequest({ message: "hi" }, { origin: "https://example.com" }), 403],
      [feedbackRequest({ message: "hi", extra: "field" }), 400],
      [feedbackRequest({ message: "   " }), 422],
      [feedbackRequest({ message: "x".repeat(2001) }), 422],
      [feedbackRequest({ message: "hi", email: "not an email" }), 422],
    ];
    for (const [request, status] of cases) {
      assert.equal((await sendFeedback({ request, env })).status, status);
    }
    env.REPORT_RATE_LIMITER.allow = false;
    assert.equal((await sendFeedback({ request: feedbackRequest({ message: "hi" }), env })).status, 429);
    delete env.REPORT_RATE_LIMITER;
    assert.equal((await sendFeedback({ request: feedbackRequest({ message: "hi" }), env })).status, 503);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM feedback").get().n, 0);
  } finally {
    sqlite.close();
  }
});

test("validation ignores a foreign page and a bad story id instead of failing", () => {
  const result = validateFeedback({ message: "ok", page: "https://example.com/x", storyId: "abc" });
  assert.equal(result.ok, true);
  assert.equal(result.page, null);
  assert.equal(result.storyId, null);
  assert.equal(validateFeedback({ message: "a\u0000b" }).message, "ab");
});

test("only administrators list messages, and each is handled once", async () => {
  const { sqlite, env, story } = setup();
  try {
    await sendFeedback({ request: feedbackRequest({ message: "First", storyId: story.id }), env });
    await sendFeedback({ request: feedbackRequest({ message: "Second", email: "a@b.co" }), env });

    assert.equal((await listFeedback(await adminContext(env, { role: "publisher" }))).status, 403);
    const listed = await (await listFeedback(await adminContext(env))).json();
    assert.equal(listed.messages.length, 2);
    const first = listed.messages.find((item) => item.message === "First");
    assert.equal(first.storyTitle, story.title);
    const second = listed.messages.find((item) => item.message === "Second");
    assert.equal(second.email, "a@b.co");

    const resolve = async (id, body) => resolveFeedback(await adminContext(env, {
      method: "POST", path: `/api/admin/feedback/${id}/resolve`, params: { id: String(id) }, body,
    }));
    assert.equal((await resolve(first.feedbackId, { action: "archive" })).status, 400);
    assert.equal((await resolve(first.feedbackId, { action: "done" })).status, 200);
    assert.equal((await resolve(first.feedbackId, { action: "done" })).status, 409);
    assert.equal(sqlite.prepare("SELECT resolved_by_email FROM feedback WHERE id = ?").get(first.feedbackId).resolved_by_email, "admin@example.com");

    // Deleting removes the row and its email for good.
    assert.equal((await resolve(second.feedbackId, { action: "delete" })).status, 200);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM feedback WHERE email IS NOT NULL").get().n, 0);
    assert.equal((await (await listFeedback(await adminContext(env))).json()).messages.length, 0);
  } finally {
    sqlite.close();
  }
});
