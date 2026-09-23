import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { CONTENT_SECURITY_POLICY, INLINE_SCRIPT_HASHES } from "../src/security-headers.js";
import worker, * as workerModule from "../src/worker.js";

const { handleRequest } = workerModule;

const PUBLIC_DIRECTORY = new URL("../public/", import.meta.url);
const HTML_PAGES = readdirSync(PUBLIC_DIRECTORY).filter((file) => file.endsWith(".html"));

function assetEnvironment(contentType = "text/html; charset=utf-8", requests = []) {
  return {
    ADMIN_ENABLED: "true",
    ASSETS: {
      async fetch(request) {
        requests.push(request);
        return new Response("<!doctype html>", {
          headers: { "content-type": contentType, etag: '"abc"', "last-modified": "Wed, 23 Sep 2026 00:00:00 GMT" },
        });
      },
    },
  };
}

test("every inline script in the public pages is allowed by its CSP hash", () => {
  const found = [];
  for (const page of HTML_PAGES) {
    const html = readFileSync(new URL(page, PUBLIC_DIRECTORY), "utf8");
    for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      found.push(`sha256-${createHash("sha256").update(match[1], "utf8").digest("base64")}`);
    }
  }

  assert.deepEqual([...new Set(found)].sort(), [...INLINE_SCRIPT_HASHES].sort());
  for (const hash of found) assert.ok(CONTENT_SECURITY_POLICY.includes(`'${hash}'`));
});

test("the public pages use no inline handlers or style attributes the CSP would block", () => {
  for (const page of HTML_PAGES) {
    const html = readFileSync(new URL(page, PUBLIC_DIRECTORY), "utf8");
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${page} has an inline event handler`);
    assert.doesNotMatch(html, /\sstyle\s*=|<style[\s>]/i, `${page} has inline styles`);
  }
});

test("pages leave the Worker with the security headers", async () => {
  const response = await handleRequest(new Request("https://readukrainianapp.com/story.html"), assetEnvironment());

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.ok(response.headers.get("content-security-policy").startsWith(CONTENT_SECURITY_POLICY.split(";")[0]));
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(response.headers.get("strict-transport-security"), /max-age=\d+/);
  assert.equal(await response.text(), "<!doctype html>");
});

test("API responses carry them too, and admin API responses stay uncached", async () => {
  const env = assetEnvironment();
  const missing = await handleRequest(new Request("https://readukrainianapp.com/api/nothing"), env);
  assert.equal(missing.headers.get("x-content-type-options"), "nosniff");
  assert.equal(missing.headers.get("x-frame-options"), "DENY");

  const admin = await handleRequest(new Request("https://readukrainianapp.com/api/admin/nothing"), env);
  assert.equal(admin.headers.get("cache-control"), "no-store");
  assert.equal(admin.headers.get("x-frame-options"), "DENY");
});

test("static files skip the Worker, pages and the API do not", () => {
  const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const rules = JSON.parse(config.match(/"run_worker_first":\s*(\[[^\]]*\])/)[1]);

  assert.ok(rules.includes("/*"));
  for (const directory of ["css", "js", "fonts", "icons", "speech"]) {
    assert.ok(rules.includes(`!/${directory}/*`), `/${directory} should bypass the Worker`);
  }
  assert.ok(!rules.some((rule) => /^!\/(api|admin)/.test(rule)));
});

test("the Worker entry module exports only handlers, as workerd requires", () => {
  for (const [name, value] of Object.entries(workerModule)) {
    const isHandler = typeof value === "function"
      || (value && typeof value === "object" && typeof value.fetch === "function");
    assert.ok(isHandler, `src/worker.js exports ${name}, which is not a handler; workerd would refuse to start`);
  }
  assert.equal(typeof worker.fetch, "function");
});

test("each page gets a fresh CSP nonce for the script Cloudflare injects", async () => {
  const nonceOf = (response) => response.headers.get("content-security-policy").match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1];
  const env = assetEnvironment();
  const [first, second] = await Promise.all([
    handleRequest(new Request("https://readukrainianapp.com/"), env),
    handleRequest(new Request("https://readukrainianapp.com/story.html"), env),
  ]);

  assert.ok(nonceOf(first) && nonceOf(second));
  assert.notEqual(nonceOf(first), nonceOf(second));
  // The page's own inline script is still allowed by its hash.
  for (const hash of INLINE_SCRIPT_HASHES) assert.ok(first.headers.get("content-security-policy").includes(`'${hash}'`));
});

test("pages are always sent in full so a cached body never meets a new nonce", async () => {
  const requests = [];
  const env = assetEnvironment("text/html; charset=utf-8", requests);
  const response = await handleRequest(new Request("https://readukrainianapp.com/story.html", {
    headers: { "if-none-match": '"abc"', "if-modified-since": "Wed, 23 Sep 2026 00:00:00 GMT" },
  }), env);

  assert.equal(requests[0].headers.get("if-none-match"), null);
  assert.equal(requests[0].headers.get("if-modified-since"), null);
  assert.equal(response.headers.get("etag"), null);
  assert.equal(response.headers.get("last-modified"), null);
});

test("non-page responses keep their validators and carry no nonce", async () => {
  const requests = [];
  const env = assetEnvironment("image/svg+xml", requests);
  const response = await handleRequest(new Request("https://readukrainianapp.com/icon.svg", {
    headers: { "if-none-match": '"abc"' },
  }), env);

  assert.equal(requests[0].headers.get("if-none-match"), '"abc"');
  assert.equal(response.headers.get("etag"), '"abc"');
  assert.equal(response.headers.get("content-security-policy"), CONTENT_SECURITY_POLICY);
});
