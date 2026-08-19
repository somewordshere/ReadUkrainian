import assert from "node:assert/strict";
import test from "node:test";

import { handleRequest } from "../src/worker.js";

function createAssetEnvironment() {
  const requests = [];

  return {
    requests,
    env: {
      ADMIN_ENABLED: "true",
      ASSETS: {
        fetch(request) {
          requests.push(request);
          return new Response("asset response", {
            headers: { "content-type": "text/plain" },
          });
        },
      },
    },
  };
}

test("passes non-API requests to the static asset binding", async () => {
  const { env, requests } = createAssetEnvironment();
  const response = await handleRequest(new Request("https://example.com/story.html"), env);

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "asset response");
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0].url).pathname, "/story.html");
});

test("redirects www requests to the canonical domain", async () => {
  const { env, requests } = createAssetEnvironment();
  const response = await handleRequest(
    new Request("http://www.readukrainianapp.com/story.html?level=a1"),
    env
  );

  assert.equal(response.status, 308);
  assert.equal(
    response.headers.get("location"),
    "https://readukrainianapp.com/story.html?level=a1"
  );
  assert.equal(requests.length, 0);
});

test("returns non-cacheable 404 responses when admin access is disabled", async () => {
  const { env, requests } = createAssetEnvironment();
  env.ADMIN_ENABLED = "false";

  const responses = await Promise.all([
    handleRequest(new Request("https://example.com/admin"), env),
    handleRequest(new Request("https://example.com/admin.html"), env),
    handleRequest(new Request("https://example.com/admin/settings"), env),
    handleRequest(new Request("https://example.com/api/admin/login", { method: "POST" }), env),
  ]);

  for (const response of responses) {
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }

  assert.equal(requests.length, 0);
  assert.equal(await responses[0].text(), "Not found.");
  assert.deepEqual(await responses[3].json(), { error: "Not found." });
});

test("returns JSON 404 responses for unknown API routes", async () => {
  const { env, requests } = createAssetEnvironment();
  const response = await handleRequest(new Request("https://example.com/api/unknown"), env);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Not found." });
  assert.equal(requests.length, 0);
});

test("returns 405 with allowed methods for known API routes", async () => {
  const { env } = createAssetEnvironment();
  const contentResponse = await handleRequest(
    new Request("https://example.com/api/content", { method: "POST" }),
    env
  );
  const textResponse = await handleRequest(
    new Request("https://example.com/api/admin/texts/12", { method: "DELETE" }),
    env
  );
  const publishResponse = await handleRequest(
    new Request("https://example.com/api/admin/texts/12/publish", { method: "GET" }),
    env
  );
  const revisionsResponse = await handleRequest(
    new Request("https://example.com/api/admin/texts/12/revisions", { method: "POST" }),
    env
  );
  const speechResponse = await handleRequest(
    new Request("https://example.com/api/speech"),
    env
  );
  const dictionaryResponse = await handleRequest(
    new Request("https://example.com/api/dictionary/lookup"),
    env
  );
  const settingsResponse = await handleRequest(
    new Request("https://example.com/api/admin/settings/speech", { method: "DELETE" }),
    env
  );
  const dictionaryStatusResponse = await handleRequest(
    new Request("https://example.com/api/admin/dictionary/status", { method: "POST" }),
    env
  );
  const dictionaryRefreshResponse = await handleRequest(
    new Request("https://example.com/api/admin/dictionary/check-update"),
    env
  );

  assert.equal(contentResponse.status, 405);
  assert.equal(contentResponse.headers.get("allow"), "GET");
  assert.deepEqual(await contentResponse.json(), { error: "Method not allowed." });
  assert.equal(textResponse.status, 405);
  assert.equal(textResponse.headers.get("allow"), "GET, PUT");
  assert.equal(publishResponse.status, 405);
  assert.equal(publishResponse.headers.get("allow"), "POST");
  assert.equal(revisionsResponse.status, 405);
  assert.equal(revisionsResponse.headers.get("allow"), "GET");
  assert.equal(speechResponse.status, 405);
  assert.equal(speechResponse.headers.get("allow"), "POST");
  assert.equal(dictionaryResponse.status, 405);
  assert.equal(dictionaryResponse.headers.get("allow"), "POST");
  assert.equal(settingsResponse.status, 405);
  assert.equal(settingsResponse.headers.get("allow"), "GET, PUT");
  assert.equal(settingsResponse.headers.get("cache-control"), "no-store");
  assert.equal(dictionaryStatusResponse.status, 405);
  assert.equal(dictionaryStatusResponse.headers.get("allow"), "GET");
  assert.equal(dictionaryRefreshResponse.status, 405);
  assert.equal(dictionaryRefreshResponse.headers.get("allow"), "POST");
});
