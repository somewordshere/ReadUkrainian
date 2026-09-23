// Lists forms filed under one lemma that are themselves another lemma of the same
// part of speech (я under ти) and not yet reviewed, most used in stories first.
//
//   npm run dictionary:review-forms                  list unreviewed pairs
//   npm run dictionary:review-forms -- --approve     approve every listed pair
//   npm run dictionary:review-forms -- --with FILE   include a candidate migration
//
// Approve only after checking each pair is a real form of its lemma (люди of
// людина, є of бути). A wrong pair needs a repair migration instead, like
// migrations/0022_remove_incorrect_dictionary_forms.sql.
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import {
  crossingKey,
  formLemmaCrossings,
  loadGuardConfig,
  loadStoryWordFrequency,
} from "../lib/dictionary-guards.mjs";
import { seedDatabase } from "../lib/seed-database.mjs";

const { values } = parseArgs({ options: { approve: { type: "boolean" }, with: { type: "string", multiple: true } } });
const approvedPath = new URL("../../data/dictionary/approved-forms.json", import.meta.url);

const { sqlite } = seedDatabase();
let crossings;
try {
  for (const file of values.with || []) sqlite.exec(readFileSync(file, "utf8"));
  crossings = formLemmaCrossings(sqlite);
} finally {
  sqlite.close();
}

const { approvedForms } = loadGuardConfig();
const frequency = loadStoryWordFrequency();
const unreviewed = crossings
  .filter((crossing) => !approvedForms.has(crossingKey(crossing)))
  .sort((left, right) => (frequency.get(right.form) || 0) - (frequency.get(left.form) || 0));

for (const { language, pos, form, lemma } of unreviewed) {
  console.log(`${language}  ${pos.padEnd(6)} «${form}» → «${lemma}»  ${frequency.get(form) || 0} uses`);
}
console.log(`${unreviewed.length} unreviewed of ${crossings.length} pairs.`);

if (values.approve && unreviewed.length) {
  const file = JSON.parse(readFileSync(approvedPath, "utf8"));
  const pairs = [...file.pairs, ...unreviewed]
    .sort((left, right) => crossingKey(left).localeCompare(crossingKey(right), "uk"));
  writeFileSync(approvedPath, `${JSON.stringify({ ...file, pairs }, null, 2)}\n`);
  console.log(`Approved ${unreviewed.length} pairs in data/dictionary/approved-forms.json.`);
}
