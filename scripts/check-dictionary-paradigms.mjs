#!/usr/bin/env node
// Finds lexemes whose inflected forms belong to a different word.
//
// Kaikki/Wiktextract occasionally attaches one entry's inflection table to
// another entry. The result is invisible in the data — every row is
// well-formed — but a learner tapping «мама» gets «озимина» (winter cereals)
// alongside the correct entry, because озимина claims «мама» as a form.
//
// Signature: the stray forms share a stem with EACH OTHER that the lemma does
// not have. A plain lemma/form prefix test does not work — Ukrainian
// alternation (схід→сходи, стіл→столу, бути→є) looks identical to corruption.
//
// Legitimate suppletion still surfaces here and must be judged by eye; the
// point is that the candidate list is short enough to read.
// This reads historical English seeds only, not the database after later
// migrations. Known errors remain visible here after repair migration 0022.
import { readFileSync, existsSync } from "node:fs";

const SEEDS = [
  "migrations/0012_dictionary_uk_en_seed.sql",
  "migrations/0017_dictionary_uk_en_story_refresh.sql",
];
const MIN_FORMS = 3;    // fewer than this is not a paradigm
const MIN_STEM = 3;     // «мам» is 3 — do not raise without rechecking озимина

const LEXEME = /INTO dictionary_lexemes \([^)]*\) VALUES \('(lex_[0-9a-f]+)', 'uk', '([^']+)'/;
const FORM = /INTO dictionary_forms \([^)]*\) VALUES \('(lex_[0-9a-f]+)', 'uk', '([^']+)'/;

const shared = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };

const lemmas = new Map();
const forms = new Map();
for (const file of SEEDS) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const lex = line.match(LEXEME);
    if (lex) { lemmas.set(lex[1], lex[2]); continue; }
    const form = line.match(FORM);
    if (form) {
      if (!forms.has(form[1])) forms.set(form[1], new Set());
      forms.get(form[1]).add(form[2]);
    }
  }
}

const candidates = [];
for (const [id, set] of forms) {
  const lemma = lemmas.get(id);
  if (!lemma || set.size < MIN_FORMS) continue;
  const list = [...set];
  let stem = list[0];
  for (const f of list) stem = stem.slice(0, shared(stem, f));
  if (stem.length >= MIN_STEM && shared(stem, lemma) < 3) candidates.push({ lemma, stem, list, id });
}

console.log("Historical English seed scan (0012 + 0017); later repairs and live data are not evaluated.");
console.log(`${lemmas.size} lexemes · ${[...forms.values()].reduce((n, s) => n + s.size, 0)} forms`);
console.log(`${candidates.length} candidate(s) with a foreign paradigm:\n`);
for (const c of candidates) {
  console.log(`  ${c.lemma.padEnd(12)} <- [${c.stem}...] ${c.list.slice(0, 6).join(", ")}`);
  console.log(`  ${" ".repeat(12)}    ${c.id}`);
}
console.log("\nJudge by eye: suppletion (хтіти->хочу, схід->сходи) is correct data.");
console.log("Candidates are not a complete error count; mixed paradigms and other defects may be missed.");
