import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildSitemap } from "../scripts/build-sitemap.mjs";

const committed = readFileSync(new URL("../public/sitemap.xml", import.meta.url), "utf8").replaceAll("\r\n", "\n");

test("the committed sitemap matches the published stories (run node scripts/build-sitemap.mjs)", () => {
  assert.equal(committed, buildSitemap());
});

test("the sitemap lists open levels only, with escaped addresses", () => {
  const xml = buildSitemap([
    { level: "A1", sortOrder: 2, active: true },
    { level: "A1", sortOrder: 1, active: true },
    { level: "A2", sortOrder: 1, active: false },
    { level: "B1", sortOrder: 1, active: true },
  ]);
  assert.match(xml, /\/story\?level=A1&amp;order=1<\/loc>[\s\S]*\/story\?level=A1&amp;order=2/);
  assert.ok(!xml.includes("level=A2"), "a disabled story is not listed");
  assert.ok(!xml.includes("level=B1"), "a hidden level is not listed");
  assert.ok(!xml.includes(".html"), "Cloudflare redirects .html addresses, so none are listed");
  assert.ok(xml.includes("<loc>https://readukrainianapp.com/about</loc>"));
});

test("robots.txt points to the sitemap", () => {
  const robots = readFileSync(new URL("../public/robots.txt", import.meta.url), "utf8");
  assert.match(robots, /^Sitemap: https:\/\/readukrainianapp\.com\/sitemap\.xml$/m);
});
