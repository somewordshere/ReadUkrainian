#!/usr/bin/env node

// Check what a running site serves against data/content-seed.json.
//
// The comparison itself lives in lib/content-drift.mjs and is unit tested; this
// only fetches. Run it after applying a content migration, or whenever the live
// site looks wrong. Exits non-zero on drift so it can gate a release.
//
// Usage:
//   node scripts/check-live-content.mjs [--origin https://readukrainianapp.com]
//   node scripts/check-live-content.mjs --deep     # also fetch every story

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import { findContentDrift, formatDrift } from "./lib/content-drift.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_ORIGIN = "https://readukrainianapp.com";

function parseArgs(argv) {
  const options = { origin: DEFAULT_ORIGIN, deep: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--origin" && argv[index + 1]) options.origin = argv[++index];
    else if (argv[index] === "--deep") options.deep = true;
    else throw new Error(`Unknown or incomplete option: ${argv[index]}`);
  }
  return options;
}

// The listing is cacheable, so ask for a fresh copy rather than checking a
// minute-old snapshot and reporting a problem that is already fixed.
const fresh = { headers: { "cache-control": "no-cache" } };

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const seed = JSON.parse(readFileSync(resolve(PROJECT_ROOT, "data/content-seed.json"), "utf8"));

  const response = await fetch(`${options.origin}/api/content`, fresh);
  if (!response.ok) throw new Error(`GET /api/content returned ${response.status}`);
  const { levels } = await response.json();

  const drift = findContentDrift(seed, levels);
  console.log(`${options.origin} — ${seed.filter((s) => s.active !== false).length} active stories in the repository`);
  console.log(formatDrift(drift));

  // The listing can look right while individual stories fail, so --deep opens
  // each one the way a learner would.
  const brokenStories = [];
  if (options.deep) {
    const hidden = new Set(drift.hiddenLevels);
    for (const story of seed.filter((s) => s.active !== false && !hidden.has(s.level))) {
      const url = `${options.origin}/api/content/story?level=${story.level}&text=${story.sortOrder}`;
      const storyResponse = await fetch(url, fresh);
      if (!storyResponse.ok) {
        brokenStories.push(`  ${story.level}#${story.sortOrder} «${story.title}» — HTTP ${storyResponse.status}`);
        continue;
      }
      const payload = await storyResponse.json();
      const questions = payload.story?.questions?.length ?? 0;
      if (JSON.stringify(payload.story?.paragraphs) !== JSON.stringify(story.paragraphs)) {
        brokenStories.push(`  ${story.level}#${story.sortOrder} «${story.title}» — text differs from the repository`);
      } else if (questions !== 5) {
        brokenStories.push(`  ${story.level}#${story.sortOrder} «${story.title}» — ${questions} questions, expected 5`);
      }
    }
    console.log(
      brokenStories.length
        ? `\nstories that do not open correctly:\n${brokenStories.join("\n")}`
        : "\nevery story opens with matching text and five questions"
    );
  }

  process.exitCode = drift.ok && !brokenStories.length ? 0 : 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
