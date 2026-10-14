import assert from "node:assert/strict";
import test from "node:test";
import { productionRequest } from "../scripts/release-probe/worker.mjs";

test("release preview forwards only public reads to the fixed production origin", async () => {
  for (const path of ["/api/content", "/api/content/story?level=A1&text=15", "/js/app/version.js"]) {
    const upstream = productionRequest(new Request(`https://untrusted.invalid${path}`, { headers: { authorization: "private", cookie: "private", "x-target": "https://untrusted.invalid" } }));
    assert.equal(upstream.url, `https://readukrainianapp.com${path}`);
    assert.equal(upstream.headers.get("authorization"), null);
    assert.equal(upstream.headers.get("cookie"), null);
    assert.equal(upstream.redirect, "manual");
  }
  const upstream = productionRequest(new Request("https://test.invalid/api/dictionary/lookup", { method: "POST", body: JSON.stringify({text:"мама",targetLanguage:"en"}) }));
  assert.equal(upstream.headers.get("origin"), "https://readukrainianapp.com");
  assert.deepEqual(await upstream.json(), {text:"мама",targetLanguage:"en"});
  const speech = productionRequest(new Request("https://test.invalid/api/speech", { method: "POST", headers: { cookie: "private" }, body: JSON.stringify({storyId:1,text:"мама"}) }));
  assert.equal(speech.url, "https://readukrainianapp.com/api/speech");
  assert.equal(speech.headers.get("origin"), "https://readukrainianapp.com");
  assert.equal(speech.headers.get("cookie"), null);
  assert.deepEqual(await speech.json(), {storyId:1,text:"мама"});
});

test("release preview cannot relay editorial mutations or arbitrary paths", () => {
  for (const path of ["/api/admin/texts", "/api/admin/login", "/", "//untrusted.invalid", "/api/content"]) {
    assert.equal(productionRequest(new Request(`https://test.invalid${path}`, { method: "POST", body: "{}" })), null);
  }
  assert.equal(productionRequest(new Request("https://test.invalid/api/content", {method:"DELETE"})), null);
  assert.equal(productionRequest(new Request("https://test.invalid/api/speech")), null);
  assert.equal(productionRequest(new Request("https://test.invalid/api/admin/settings/speech", { method: "POST", body: "{}" })), null);
});
