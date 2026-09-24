// Report a dictionary pair's installed and available source revisions, in
// GITHUB_OUTPUT format, so a workflow can skip the multi-gigabyte download when
// nothing is newer.
//
//   node scripts/dictionary/source-revision.mjs --target en|de|pl
//
// Same version signals as the admin check (functions/api/admin/dictionary/
// check-update.js): the English and German Kaikki pages state their dump dates;
// the Polish extract is versioned by its Last-Modified date.
import { readFileSync, readdirSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { target: { type: "string" } } });
const target = values.target;
if (!["en", "de", "pl"].includes(target)) throw new Error("--target must be en, de or pl");

const PAGES = {
  en: { url: "https://kaikki.org/dictionary/Ukrainian/", pattern: /enwiktionary dump dated\s+([0-9]{4}-[0-9]{2}-[0-9]{2})/iu },
  de: { url: "https://kaikki.org/dewiktionary/Ukrainisch/", pattern: /dewiktionary dump dated\s+([0-9]{4}-[0-9]{2}-[0-9]{2})/iu },
};

async function availableRevision() {
  const page = PAGES[target];
  if (!page) {
    const response = await fetch(`https://kaikki.org/dictionary/downloads/${target}/${target}-extract.jsonl.gz`, { method: "HEAD" });
    if (!response.ok) throw new Error(`Kaikki returned HTTP ${response.status}`);
    const date = new Date(response.headers.get("last-modified"));
    if (Number.isNaN(date.getTime())) throw new Error(`The ${target} extract has no Last-Modified date`);
    return date.toISOString().slice(0, 10);
  }
  const response = await fetch(page.url, { headers: { accept: "text/html" } });
  if (!response.ok) throw new Error(`Kaikki returned HTTP ${response.status}`);
  const revision = (await response.text()).match(page.pattern)?.[1];
  if (!revision) throw new Error(`The ${target} Kaikki page did not state a dump date`);
  return revision;
}

// The last revision any migration recorded for this pair.
function installedRevision() {
  const directory = new URL("../../migrations/", import.meta.url);
  const pattern = new RegExp(`dictionary_language_pairs[^;]*?VALUES \\('uk', '${target}',[^;]*?'([0-9]{4}-[0-9]{2}-[0-9]{2})'`, "g");
  let revision = null;
  for (const name of readdirSync(directory).filter((file) => file.endsWith(".sql")).sort()) {
    for (const match of readFileSync(new URL(name, directory), "utf8").matchAll(pattern)) revision = match[1];
  }
  return revision;
}

const available = await availableRevision();
const installed = installedRevision();
console.log(`available=${available}`);
console.log(`installed=${installed || ""}`);
console.log(`update=${Boolean(!installed || available > installed)}`);
