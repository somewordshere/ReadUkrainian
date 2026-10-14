// Writes public/sitemap.xml from the published stories in data/content-seed.json, so
// search engines find every story. Run after a content batch:
//
//   node scripts/build-sitemap.mjs
//
// tests/sitemap.test.mjs fails when the committed sitemap no longer matches the seed.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { LEVELS_BY_ID } from "../functions/_shared/levels.js";

const SITE = "https://readukrainianapp.com";
const root = new URL("../", import.meta.url);

const escapeXml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function buildSitemap(seed = JSON.parse(readFileSync(new URL("data/content-seed.json", root), "utf8"))) {
  const stories = seed
    .filter((story) => story?.active !== false && LEVELS_BY_ID[story.level]?.active === true)
    .sort((a, b) => a.level.localeCompare(b.level) || a.sortOrder - b.sortOrder);
  // Cloudflare's asset handling redirects /page.html to /page, so the sitemap lists
  // the address a page is actually served at.
  const urls = [
    `${SITE}/`,
    `${SITE}/about`,
    ...stories.map((story) => `${SITE}/story?level=${encodeURIComponent(story.level)}&order=${story.sortOrder}`),
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`),
    "</urlset>",
    "",
  ].join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const xml = buildSitemap();
  writeFileSync(new URL("public/sitemap.xml", root), xml, "utf8");
  console.log(`public/sitemap.xml: ${xml.split("<url>").length - 1} addresses`);
}
