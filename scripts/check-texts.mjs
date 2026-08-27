#!/usr/bin/env node

// Measure reading texts against the mechanical rules in prompts/*-story-generation.md.
//
// This exists because a 2026-08-25 A/B test showed that a prompt cannot enforce
// anything requiring arithmetic. Writing to a word count without counting gave a
// spread of ±25 words under two different prompt versions; the same model with a
// counter hit the band 11 times out of 11. Word count, sentence extremes and
// cross-text repetition belong here, not in an instruction.
//
// Usage:
//   node scripts/check-texts.mjs [--level A2] [--range 61-103] [--quiet]
//
// Exits non-zero if any text fails a hard rule.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import vm from "node:vm";

const ROOT = resolve(import.meta.dirname, "..");

const PARADE_TOPICS = new Set([16, 46, 67]);
const PARADE_BAND = [180, 220];
const FLOOR = { A1: 75, A2: 121 };
const CEILING = { A1: 120, A2: 145 };
const DEFAULT_TARGET = { A1: 95, A2: 125 };

function parseArgs(argv) {
  const options = { level: "A2", from: 1, to: Infinity, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--level") options.level = argv[++i];
    else if (argv[i] === "--range") {
      const [a, b] = argv[++i].split("-").map(Number);
      options.from = a;
      options.to = b ?? a;
    } else if (argv[i] === "--quiet") options.quiet = true;
  }
  return options;
}

function loadStories(level) {
  const context = {};
  context.window = context;
  vm.createContext(context);
  const files = [
    "public/js/data/stories.js",
    `public/js/data/${level.toLowerCase()}-stories.js`,
  ];
  let source = "";
  for (const file of files) source += `\n${readFileSync(resolve(ROOT, file), "utf8")}`;
  source += "\nglobalThis.__stories = storiesByLevel;";
  vm.runInContext(source, context, { filename: "stories-bundle.js" });
  return context.__stories[level] || [];
}

// Topic specs live in prompts/, which is gitignored. Degrade to measurement-only
// when they are absent rather than failing.
function loadTargets(level) {
  const file = resolve(ROOT, `prompts/topics/${level.toLowerCase()}-topics-001-103.md`);
  const fallback = resolve(ROOT, `prompts/topics/${level.toLowerCase()}-topics-001-040.md`);
  const path = existsSync(file) ? file : existsSync(fallback) ? fallback : null;
  if (!path) return null;
  const text = readFileSync(path, "utf8");
  const targets = {};
  const pattern = /^### (\d+)\. .*$\n(?:.*\n)*?Desired length: about (\d+)/gm;
  let match;
  while ((match = pattern.exec(text))) {
    targets[Number(match[1])] = Math.max(FLOOR[level], Number(match[2]));
  }
  return Object.keys(targets).length ? targets : null;
}

// A closing guillemet may follow the full stop: «…забудь.» Дощу…
function sentences(paragraph) {
  return paragraph
    .split(/(?<=[.!?…][»"]?)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function countWords(text) {
  return text.split(/\s+/).filter((token) => {
    const bare = token.replace(/^[«»"'([]+|[«»"'.,!?;:)\]…]+$/g, "");
    if (!bare) return false;
    return !/^[—–-]+$/.test(bare); // the em-dash copula is not a word
  }).length;
}

function measure(story) {
  const perParagraph = story.paragraphs.map((p) => sentences(p).map(countWords));
  const lengths = perParagraph.flat();
  return {
    words: story.paragraphs.reduce((sum, p) => sum + countWords(p), 0),
    sentenceCounts: perParagraph.map((p) => p.length),
    shortest: Math.min(...lengths),
    longest: Math.max(...lengths),
    over14: lengths.filter((l) => l > 14).length,
    isDialogue: story.paragraphs.length === 1,
  };
}

function ngrams(story, n) {
  const tokens = story.paragraphs
    .join(" ")
    .toLowerCase()
    .replace(/[«»""''.,!?;:()[\]—–…]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const set = new Set();
  for (let i = 0; i + n <= tokens.length; i += 1) set.add(tokens.slice(i, i + n).join(" "));
  return set;
}

function checkStory(story, index, level, targets) {
  const m = measure(story);
  const number = index + 1;
  const failures = [];
  const notes = [];

  if (targets) {
    const [lo, hi] = PARADE_TOPICS.has(number) && level === "A2"
      ? PARADE_BAND
      : [targets[number] ?? DEFAULT_TARGET[level], (targets[number] ?? DEFAULT_TARGET[level]) + 10];
    if (m.words < lo) failures.push(`${m.words} words, below band ${lo}-${hi}`);
    else if (m.words > hi) failures.push(`${m.words} words, above band ${lo}-${hi}`);
  } else if (m.words < FLOOR[level]) {
    failures.push(`${m.words} words, below the ${FLOOR[level]}-word floor`);
  } else if (m.words > CEILING[level] && !PARADE_TOPICS.has(number)) {
    failures.push(`${m.words} words, above the ${CEILING[level]}-word ceiling`);
  }

  if (level === "A2") {
    if (m.longest < 12) failures.push(`longest sentence ${m.longest}, needs 12 or more`);
    if (m.shortest >= 6) failures.push(`shortest sentence ${m.shortest}, needs 5 or fewer`);
  }
  if (m.over14) notes.push(`${m.over14} sentence(s) over 14 words`);

  // Dialogue is stored as one paragraph by convention; shape rules do not apply.
  if (!m.isDialogue) {
    const counts = m.sentenceCounts;
    if (counts.some((c) => c > 7)) failures.push(`paragraph over 7 sentences (${counts.join("/")})`);
    const landing = counts[counts.length - 1];
    const body = Math.min(...counts.slice(0, -1));
    if (landing > body) notes.push(`landing is not the shortest paragraph (${counts.join("/")})`);
  }

  const text = story.paragraphs.join(" ");
  if (/[ʼ’]/.test(text)) failures.push("apostrophe is not U+0027");
  if (/"/.test(text)) failures.push("ASCII double quotes, use «…»");

  return { number, title: story.title, m, failures, notes };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const level = options.level.toUpperCase();
  const stories = loadStories(level);
  const targets = loadTargets(level);

  if (!targets) {
    console.log(`note: no topic specs found for ${level} — checking floor/ceiling only.\n`);
  }

  const results = [];
  for (let i = 0; i < stories.length; i += 1) {
    const number = i + 1;
    if (number < options.from || number > options.to) continue;
    results.push(checkStory(stories[i], i, level, targets));
  }

  // Cross-text repetition. Reading does not catch this; two collisions survived a
  // careful manual pass in August 2025 and only a scan found them.
  const grams = stories.map((s) => ngrams(s, 5));
  const shared = [];
  for (const r of results) {
    const mine = grams[r.number - 1];
    for (let j = 0; j < stories.length; j += 1) {
      if (j === r.number - 1) continue;
      for (const g of mine) {
        if (grams[j].has(g)) { const [x, y] = [r.number, j + 1].sort((p, q) => p - q); shared.push(`${x} ↔ ${y}: «${g}»`); }
      }
    }
  }

  let failing = 0;
  for (const r of results) {
    const status = r.failures.length ? "FAIL" : r.notes.length ? "warn" : "ok";
    if (r.failures.length) failing += 1;
    if (options.quiet && status === "ok") continue;
    const shape = r.m.isDialogue ? "dialogue" : r.m.sentenceCounts.join("/");
    console.log(
      `${String(r.number).padStart(3)} ${status.padEnd(4)} ${String(r.m.words).padStart(3)}w  ${shape.padEnd(12)} ${r.m.shortest}-${r.m.longest}  ${r.title}`
    );
    for (const f of r.failures) console.log(`      ✗ ${f}`);
    for (const n of r.notes) console.log(`      · ${n}`);
  }

  console.log(`\n${results.length} texts checked · ${failing} failing`);
  if (shared.length) {
    console.log(`\nshared 5-grams (${shared.length}):`);
    for (const s of new Set(shared)) console.log(`  ${s}`);
  } else {
    console.log("no shared 5-grams");
  }

  process.exitCode = failing > 0 || shared.length > 0 ? 1 : 0;
}

main();
