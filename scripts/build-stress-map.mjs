// Build public/js/data/stress-map.json: where the stress falls in every word
// that appears in the stories, taken from Wiktionary's stressed forms.
//
//   node scripts/build-stress-map.mjs [--source uk-en.jsonl] [--content data/content-seed.json]
//
// The source is the Ukrainian-only Kaikki extract made by
// scripts/dictionary/extract-raw-ukrainian.mjs. A word is marked when the
// Wiktionary forms spelled that way agree on the stress, or when the word's own
// headword settles it (коли́ the conjunction beats ко́ли, a form of «кола»).
// Remaining homographs go to the word whose other forms the stories actually use
// (сім'я́ "family" has сім'ї, сім'єю…; сі́м'я "seed" has none). Genuine homographs
// such as ру́ки / руки́ stay unmarked rather than risk a wrong mark. Affixes,
// multi-word phrases, dated or rare entries and short infinitives (люби́ть) are
// ignored; proper names win only for words the stories always capitalise (Ки́їв).
// Re-run after story text changes; new words simply show without a mark.
import fs from "node:fs";
import readline from "node:readline";
import { parseArgs } from "node:util";

import { countVowels, stressKey, tokenizeParagraph } from "../public/js/app/story-words.mjs";

const { values } = parseArgs({
  options: {
    source: { type: "string", default: ".local-release/raw/uk-en-v2.jsonl" },
    content: { type: "string", default: "data/content-seed.json" },
    output: { type: "string", default: "public/js/data/stress-map.json" },
    overrides: { type: "string", default: "data/stress-overrides.json" },
  },
});

const SKIPPED_FORM_TAGS = new Set(["romanization", "table-tags", "inflection-template", "class"]);
const MARGINAL_TAGS = new Set(["dated", "obsolete", "archaic", "rare", "nonstandard", "dialectal", "historical"]);
const SKIPPED_POS = new Set(["suffix", "prefix", "infix", "interfix", "affix", "circumfix", "character", "punct", "symbol"]);
const ACUTE = "\u0301";
const GRAVE = /\u0300/gu;
const VOWEL = /[аеєиіїоуюя]/iu;

// Every word the stories use, keyed the way the reader looks them up.
const stories = JSON.parse(fs.readFileSync(values.content, "utf8"));
const vocabulary = new Map();
const writtenLowerCase = new Set();
for (const story of stories) {
  for (const paragraph of story.paragraphs || []) {
    for (const piece of tokenizeParagraph(paragraph)) {
      if (!piece.word) continue;
      const key = stressKey(piece.text);
      vocabulary.set(key, (vocabulary.get(key) || 0) + 1);
      if (piece.text[0] === key[0]) writtenLowerCase.add(key);
    }
  }
}

// key -> Map(pattern -> { common, headword, entries }), where a pattern is a JSON
// array of stressed letter indexes, "common" means it was seen spelled in lower
// case (not only as a proper name), "headword" means it spells the headword of a
// non-inflected entry, and "entries" are the Wiktionary entries that produced it.
const readings = new Map();
// entry number -> story words that entry has a stressed form for
const entryWords = new Map();

// "ма́ма" -> { letters: ["м","а","м","а"], positions: [1] }
function readStressedWord(word) {
  const letters = [];
  const positions = [];
  for (const character of word.replace(GRAVE, "").normalize("NFC")) {
    if (character === ACUTE) {
      if (letters.length) positions.push(letters.length - 1);
    } else {
      letters.push(character);
    }
  }
  return { letters, positions };
}

function recordStressedForm(form, entryNumber, { headwordKey = null } = {}) {
  for (const piece of tokenizeParagraph(form.replace(GRAVE, ""))) {
    if (!piece.word || !piece.text.includes(ACUTE)) continue;

    const { letters, positions } = readStressedWord(piece.text);
    const key = stressKey(letters.join(""));
    if (!vocabulary.has(key) || countVowels(key) < 2) continue;
    if (positions.length === 0 || !positions.every((index) => VOWEL.test(letters[index]))) continue;

    const pattern = JSON.stringify(positions);
    if (!readings.has(key)) readings.set(key, new Map());
    const reading = readings.get(key).get(pattern) || { common: false, headword: false, entries: new Set() };
    reading.common ||= letters[0] === letters[0].toLocaleLowerCase("uk-UA");
    reading.headword ||= key === headwordKey;
    reading.entries.add(entryNumber);
    readings.get(key).set(pattern, reading);
    if (!entryWords.has(entryNumber)) entryWords.set(entryNumber, new Set());
    entryWords.get(entryNumber).add(key);
  }
}

function isMarginal(tags = []) {
  return tags.some((tag) => MARGINAL_TAGS.has(tag));
}

const lines = readline.createInterface({
  input: fs.createReadStream(values.source),
  crlfDelay: Infinity,
});
let entryNumber = 0;
for await (const line of lines) {
  entryNumber += 1;
  if (!line.includes(ACUTE)) continue;
  const entry = JSON.parse(line);
  if (SKIPPED_POS.has(entry.pos) || /\s/u.test(entry.word)) continue;
  const senses = entry.senses || [];
  if (senses.length && senses.every((sense) => isMarginal(sense.tags))) continue;

  const inflectedOnly = senses.length > 0 && senses.every((sense) => (sense.tags || []).includes("form-of"));
  const headwordKey = inflectedOnly ? null : stressKey(entry.word);
  let canonicalSeen = false;
  for (const form of entry.forms || []) {
    const tags = form.tags || [];
    if (typeof form.form !== "string" || isMarginal(tags)) continue;
    if (tags.some((tag) => SKIPPED_FORM_TAGS.has(tag))) continue;
    // Short infinitives (люби́ть beside люби́ти) collide with the far commoner
    // third person (лю́бить), so only the headword infinitive counts.
    if (tags.includes("infinitive") && stressKey(form.form) !== stressKey(entry.word)) continue;
    if (tags.includes("canonical")) {
      // A second canonical form is an accepted variant (за́вжди / завжди́); keep the first.
      if (canonicalSeen) continue;
      canonicalSeen = true;
    }
    recordStressedForm(form.form, entryNumber, { headwordKey });
  }
}

// How often the stories use the other words of a reading's entries, counting
// only words that the competing readings' entries cannot also explain.
function storySupport(reading, key, rivals) {
  const rivalWords = new Set();
  for (const rival of rivals) {
    for (const entry of rival.entries) {
      for (const word of entryWords.get(entry) || []) rivalWords.add(word);
    }
  }
  let best = 0;
  for (const entry of reading.entries) {
    let support = 0;
    for (const word of entryWords.get(entry) || []) {
      if (word !== key && !rivalWords.has(word)) support += vocabulary.get(word);
    }
    best = Math.max(best, support);
  }
  return best;
}

// Picks one stress pattern for a word, or null when it stays ambiguous.
function chooseReading(key, patterns) {
  let candidates = [...patterns];
  const wantCommon = writtenLowerCase.has(key);
  const preferred = candidates.filter(([, reading]) => reading.common === wantCommon);
  if (preferred.length) candidates = preferred;
  if (candidates.length > 1) {
    const headword = candidates.filter(([, reading]) => reading.headword);
    if (headword.length === 1) candidates = headword;
  }
  if (candidates.length > 1) {
    const ranked = candidates
      .map(([pattern, reading]) => ({
        pattern,
        support: storySupport(
          reading,
          key,
          candidates.filter(([other]) => other !== pattern).map(([, rival]) => rival)
        ),
      }))
      .sort((a, b) => b.support - a.support);
    // Only a clear winner: used at least twice, and three times as often as the rest.
    if (ranked[0].support >= 2 && ranked[0].support >= 3 * ranked[1].support) {
      return JSON.parse(ranked[0].pattern);
    }
  }
  return candidates.length === 1 ? JSON.parse(candidates[0][0]) : null;
}

const stressMap = {};
for (const [key, patterns] of readings) {
  const positions = chooseReading(key, patterns);
  if (positions) stressMap[key] = positions.length === 1 ? positions[0] : positions;
}

const overrides = JSON.parse(fs.readFileSync(values.overrides, "utf8"));
for (const [word, stressed] of Object.entries(overrides)) {
  if (word.startsWith("_")) continue;
  const { letters, positions } = readStressedWord(stressed);
  if (stressKey(letters.join("")) !== stressKey(word) || positions.length === 0) {
    throw new Error(`Override for "${word}" must be the same word with a stress mark, got "${stressed}"`);
  }
  stressMap[stressKey(word)] = positions.length === 1 ? positions[0] : positions;
}
const ambiguous = [...readings.keys()].filter((key) => !(key in stressMap));

const sortedMap = Object.fromEntries(
  Object.keys(stressMap).sort((a, b) => a.localeCompare(b, "uk")).map((key) => [key, stressMap[key]])
);
fs.writeFileSync(values.output, `${JSON.stringify(sortedMap)}\n`);

// Coverage report: counts are word occurrences in the stories, not dictionary entries.
const tally = { marked: 0, singleVowel: 0, ambiguous: 0, missing: 0 };
const missing = [];
for (const [key, count] of vocabulary) {
  if (countVowels(key) < 2) tally.singleVowel += count;
  else if (key in sortedMap) tally.marked += count;
  else if (readings.has(key)) tally.ambiguous += count;
  else {
    tally.missing += count;
    missing.push([key, count]);
  }
}
const total = Object.values(tally).reduce((sum, count) => sum + count, 0);
const percent = (count) => `${((count / total) * 100).toFixed(1)}%`;
missing.sort((a, b) => b[1] - a[1]);

console.log(`Wrote ${Object.keys(sortedMap).length} words to ${values.output}`);
console.log(`Word occurrences in stories: ${total}`);
console.log(`  marked:              ${tally.marked} (${percent(tally.marked)})`);
console.log(`  one vowel, no mark:  ${tally.singleVowel} (${percent(tally.singleVowel)})`);
console.log(`  homograph, unmarked: ${tally.ambiguous} (${percent(tally.ambiguous)})`);
console.log(`  not in Wiktionary:   ${tally.missing} (${percent(tally.missing)})`);
console.log(`Most frequent unmarked homographs: ${ambiguous.sort((a, b) => vocabulary.get(b) - vocabulary.get(a)).slice(0, 25).join(", ")}`);
console.log(`Most frequent missing: ${missing.slice(0, 25).map(([word, count]) => `${word}×${count}`).join(", ")}`);
