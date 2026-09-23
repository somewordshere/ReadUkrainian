import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { CONTENT_SECURITY_POLICY, INLINE_SCRIPT_HASHES, handleRequest } from "../src/worker.js";

const PUBLIC_DIRECTORY = new URL("../public/", import.meta.url);
const HTML_PAGES = readdirSync(PUBLIC_DIRECTORY).filter((file) => file.endsWith(".html"));

function assetEnvironment(contentType = "text/html; charset=utf-8") {
  return {
    ADMIN_ENABLED: "true",
    ASSETS: {
      async fetch() {
        return new Response("<!doctype html>", { headers: { "content-type": contentType } });
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
  assert.equal(response.headers.get("content-security-policy"), CONTENT_SECURITY_POLICY);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
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
