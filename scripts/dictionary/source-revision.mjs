// Report a dictionary pair's installed and available source revisions, in
// GITHUB_OUTPUT format, so a workflow can skip the multi-gigabyte download when
// nothing is newer.
//
//   node scripts/dictionary/source-revision.mjs --target en|de
//
// Same version signals as the admin check (functions/api/admin/dictionary/
// check-update.js): the English Kaikki page states its dump date; the German
// extract is versioned by its Last-Modified date.
import { readFileSync, readdirSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { target: { type: "string" } } });
const target = values.target;
if (!["en", "de"].includes(target)) throw new Error("--target must be en or de");

async function availableRevision() {
  if (target === "de") {
    const response = await fetch("https://kaikki.org/dictionary/downloads/de/de-extract.jsonl.gz", { method: "HEAD" });
    if (!response.ok) throw new Error(`Kaikki returned HTTP ${response.status}`);
    const date = new Date(response.headers.get("last-modified"));
    if (Number.isNaN(date.getTime())) throw new Error("The German extract has no Last-Modified date");
    return date.toISOString().slice(0, 10);
  }
  const response = await fetch("https://kaikki.org/dictionary/Ukrainian/", { headers: { accept: "text/html" } });
  if (!response.ok) throw new Error(`Kaikki returned HTTP ${response.status}`);
  const revision = (await response.text()).match(/enwiktionary dump dated\s+([0-9]{4}-[0-9]{2}-[0-9]{2})/iu)?.[1];
  if (!revision) throw new Error("The English Kaikki page did not state a dump date");
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
