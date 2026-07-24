import assert from "node:assert/strict";
import test from "node:test";

import { handleRequest } from "../src/worker.js";

function createAssetEnvironment() {
  const requests = [];

  return {
    requests,
    env: {
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

  assert.equal(contentResponse.status, 405);
  assert.equal(contentResponse.headers.get("allow"), "GET");
  assert.deepEqual(await contentResponse.json(), { error: "Method not allowed." });
  assert.equal(textResponse.status, 405);
  assert.equal(textResponse.headers.get("allow"), "GET, PUT");
});
