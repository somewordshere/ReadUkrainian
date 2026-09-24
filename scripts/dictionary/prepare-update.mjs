// Prepare a reviewed dictionary update as a complete release candidate.
//
//   node scripts/dictionary/prepare-update.mjs --target en|de|pl --revision YYYY-MM-DD \
//     [--en-raw raw-wiktextract-data.jsonl.gz] [--de-raw de-extract.jsonl.gz] \
//     [--pl-raw pl-extract.jsonl.gz] --work DIR
//
// (--en-extract / --de-extract / --pl-extract accept already-filtered Ukrainian
// JSONL instead.) German also needs the English extract, whose richer inflection
// tables supply forms; Polish needs only its own, since its entries use the word
// forms the installed English dictionary shares. The update only adds rows for words the stories use (--scope story) that
// no earlier migration already added (--since), so reviewed entries are never
// replaced. On success it writes the next migration, the release manifest and
// version bump, and a Markdown summary for the reviewer (--summary, default
// DIR/summary.md). It changes nothing if the installed revision is current.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { analyzeDictionaryCoverage } from "../../functions/_shared/dictionary-workflow.js";
import {
  collectLemmas,
  databaseLookup,
  mostFrequentWords,
  storyWordFrequency,
} from "../lib/dictionary-guards.mjs";
import { bumpRelease, currentVersion, nextVersion } from "../lib/bump-release.mjs";
import { loadReleaseManifest } from "../lib/release-manifest.mjs";
import { sqlHash } from "../lib/release-validation.mjs";
import { seedDatabase } from "../lib/seed-database.mjs";

const SOURCES = {
  en: { edition: "en", url: "https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz", name: "English" },
  de: { edition: "de", url: "https://kaikki.org/dictionary/downloads/de/de-extract.jsonl.gz", name: "German", formsFrom: "en" },
  pl: { edition: "pl", url: "https://kaikki.org/dictionary/downloads/pl/pl-extract.jsonl.gz", name: "Polish" },
};

const { values } = parseArgs({
  options: {
    target: { type: "string" },
    revision: { type: "string" },
    "en-raw": { type: "string" },
    "de-raw": { type: "string" },
    "pl-raw": { type: "string" },
    "en-extract": { type: "string" },
    "de-extract": { type: "string" },
    "pl-extract": { type: "string" },
    work: { type: "string" },
    summary: { type: "string" },
  },
});
const target = values.target;
if (!SOURCES[target]) throw new Error("--target must be en, de or pl");
if (!/^\d{4}-\d{2}-\d{2}$/.test(values.revision || "")) throw new Error("--revision YYYY-MM-DD is required");
if (!values.work) throw new Error("--work DIR is required");

const root = fileURLToPath(new URL("../../", import.meta.url));
const migrationsDir = join(root, "migrations");
const work = resolve(values.work);
mkdirSync(work, { recursive: true });
const summaryPath = resolve(values.summary || join(work, "summary.md"));
const run = (script, args) => {
  const result = spawnSync(process.execPath, [join(root, script), ...args], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${script} failed`);
};

// The installed revision is the last one any migration recorded for this pair.
function installedRevision() {
  const pattern = new RegExp(`dictionary_language_pairs[^;]*?VALUES \\('uk', '${target}',[^;]*?'(\\d{4}-\\d{2}-\\d{2})'`, "g");
  let revision = null;
  for (const name of readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort()) {
    for (const match of readFileSync(join(migrationsDir, name), "utf8").matchAll(pattern)) revision = match[1];
  }
  return revision;
}

const installed = installedRevision();
if (installed && values.revision <= installed) {
  writeFileSync(summaryPath, `No ${SOURCES[target].name} dictionary update: the installed source (${installed}) is not older than ${values.revision}.\n`);
  console.log(`Installed ${target} revision ${installed} is current; nothing to prepare.`);
  process.exit(0);
}

// 1. Ukrainian entries only, streamed out of the multi-gigabyte downloads.
function extract(edition) {
  const given = values[`${edition}-extract`];
  if (given) return resolve(given);
  const raw = values[`${edition}-raw`];
  if (!raw) throw new Error(`--${edition}-raw or --${edition}-extract is required`);
  const output = join(work, `uk-${edition}-${values.revision}.jsonl`);
  if (!existsSync(output)) {
    run("scripts/dictionary/extract-raw-ukrainian.mjs", [
      "--source", resolve(raw), "--edition", edition, "--revision", values.revision,
      "--source-url", SOURCES[edition].url, "--output", output,
    ]);
  }
  return output;
}
const targetExtract = extract(target);
const formsExtract = SOURCES[target].formsFrom ? extract(SOURCES[target].formsFrom) : null;

// 2. Story-scope rows that no earlier migration already added.
const since = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort()
  .flatMap((file) => ["--since", join(migrationsDir, file)]);
const candidate = join(work, `candidate-${target}-${values.revision}-${Date.now()}.sql`);
run("scripts/dictionary/build-dictionary-seed.mjs", [
  "--source", targetExtract, "--revision", values.revision, "--target", target, "--scope", "story",
  ...(formsExtract ? ["--forms-source", formsExtract] : []),
  ...since, "--output", candidate,
]);
const sql = readFileSync(candidate, "utf8");

// 3. Existing rows untouched, coverage not reduced, known bad pairings absent.
run("scripts/dictionary/validate-rebuild.mjs", [`--${target}`, candidate, "--output", join(work, `validation-${Date.now()}.json`)]);

// 4. What a reviewer needs to know.
const statements = sql.split("\n").filter((line) => line.startsWith("INSERT"));
const count = (table) => statements.filter((line) => line.includes(`INTO ${table} `)).length;
const newForms = [...new Set(
  statements.filter((line) => line.includes("INTO dictionary_forms ")).map((line) => line.match(/VALUES \('[^']*', 'uk', '([^']*)'/)?.[1]).filter(Boolean)
)].sort((a, b) => a.localeCompare(b, "uk"));
const stories = JSON.parse(readFileSync(join(root, "data/content-seed.json"), "utf8")).filter((story) => story.active !== false);
const paragraphs = stories.flatMap((story) => story.paragraphs || []);
// The guards already failed the build if one of the 300 most used words gained a
// meaning; the next most used words are listed for the reviewer instead.
const frequency = storyWordFrequency(stories);
const attentionWords = mostFrequentWords(frequency, 500);
const { sqlite, db } = seedDatabase();
let before;
let after;
const attention = [];
try {
  const lookup = databaseLookup(db);
  before = await analyzeDictionaryCoverage(db, paragraphs, { targetLanguage: target });
  const lemmasBefore = await collectLemmas(lookup, attentionWords, [target]);
  sqlite.exec(sql);
  after = await analyzeDictionaryCoverage(db, paragraphs, { targetLanguage: target });
  const lemmasAfter = await collectLemmas(lookup, attentionWords, [target]);
  for (const word of attentionWords) {
    const key = `${target}\u0000${word}`;
    const added = lemmasAfter.get(key).filter((lemma) => !lemmasBefore.get(key).includes(lemma));
    if (added.length) attention.push(`«${word}» (${frequency.get(word)} uses): now also ${added.map((lemma) => `«${lemma}»`).join(", ")}`);
  }
} finally {
  sqlite.close();
}
const newlyCovered = before.missing.map((item) => item.word).filter((word) => !after.missing.some((item) => item.word === word));

// 5. The release: next migration, manifest, version bump and changelog line.
const lastNumber = Math.max(...readdirSync(migrationsDir).map((file) => Number(file.slice(0, 4))).filter(Number.isFinite));
const migrationName = `${String(lastNumber + 1).padStart(4, "0")}_dictionary_uk_${target}_update_${values.revision.replaceAll("-", "_")}.sql`;
const migrationText = `-- ${SOURCES[target].name} dictionary update to the ${values.revision} source, prepared by scripts/dictionary/prepare-update.mjs.\n-- Adds story-word entries no earlier migration contains; existing rows are never replaced.\n${sql}`;
writeFileSync(join(migrationsDir, migrationName), migrationText, { flag: "wx" });

const previous = loadReleaseManifest(currentVersion());
const version = nextVersion(previous.version);
bumpRelease({
  version,
  changelogLine: `Updated the ${SOURCES[target].name} dictionary to the ${values.revision} Wiktionary source${newlyCovered.length ? `, adding translations for ${newlyCovered.length} story ${newlyCovered.length === 1 ? "word" : "words"}` : ""}.`,
  manifest: {
    ...previous,
    summary: `Dictionary release: ${SOURCES[target].name} source ${installed || "unknown"} -> ${values.revision}, applied by ${migrationName}. Story content is unchanged, so the reviewed content baseline carries over.`,
    releaseMigrations: [migrationName],
    migrations: [...previous.migrations, { name: migrationName, sha256: sqlHash(migrationText) }],
  },
});

const list = (words, limit = 60) => words.length
  ? words.slice(0, limit).join(", ") + (words.length > limit ? `, … (${words.length - limit} more)` : "")
  : "none";
writeFileSync(summaryPath, `## ${SOURCES[target].name} dictionary update: ${installed || "?"} → ${values.revision}

Release **${version}** · migration \`${migrationName}\`

**Needs your attention:** ${attention.length
    ? `common story words that gain another entry. Check each new meaning is right:\n\n${attention.map((line) => `- ${line}`).join("\n")}`
    : "none of the 500 most used story words gains a new entry."}

| Rows added | |
|---|---|
| Lexemes | ${count("dictionary_lexemes")} |
| Word forms | ${count("dictionary_forms")} |
| Senses | ${count("dictionary_senses")} |
| Translations | ${count("dictionary_translations")} |

**Story coverage (${target}):** ${before.coveredUniqueWords} → ${after.coveredUniqueWords} of ${after.totalUniqueWords} words (${after.coveragePercent}%).

**Story words that gain a translation:** ${list(newlyCovered)}

**Story words with new or extra entries:** ${list(newForms)}

Validation passed: every existing dictionary row is unchanged, coverage did not drop, foreign keys hold, and the dictionary guards found nothing (canary words unchanged, no entry over its form limit, no unreviewed word filed under another entry, no unknown form tags). New meanings come straight from Wiktionary and are otherwise **not reviewed**: check the list under "Needs your attention" before merging.

To publish: merge this branch, then run the **Release production** workflow.
`);
console.log(readFileSync(summaryPath, "utf8"));
