#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import {
  GOOGLE_AUDIO_CONFIG,
  GOOGLE_REQUEST_VERSION,
  GOOGLE_TTS_ENDPOINT,
  decodeGoogleAudio,
  googleSpeechRequestInit,
  isMp3,
} from "../../functions/_shared/google-speech.js";
import { resolveSpeechVoice, DEFAULT_SPEECH_VOICE_ID } from "../../functions/_shared/speech-voices.js";
import { applyStress } from "../../public/js/app/story-words.mjs";
import {
  SPEECH_CANONICALIZATION_VERSION,
  extractCanonicalSpeechWords,
  speechAssetFilename,
} from "./normalization.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
const DEFAULT_API_BASE = "https://readukrainianapp.com";
const DEFAULT_SEED = resolve(PROJECT_ROOT, "data/content-seed.json");
const DEFAULT_OUTPUT = resolve(PROJECT_ROOT, "public/speech");
const DEFAULT_BUILD_DIR = resolve(PROJECT_ROOT, ".speech-build");
const STRESS_MAP_PATH = resolve(PROJECT_ROOT, "public/js/data/stress-map.json");
const DEV_VARS_PATH = resolve(PROJECT_ROOT, ".dev.vars");
const MANIFEST_SCHEMA_VERSION = 3;
// Comfortably under Google's per-minute Text-to-Speech quota.
const DEFAULT_REQUESTS_PER_MINUTE = 200;
// This script calls Google outside the Worker's speech budget. A full run is
// about 28,000 characters; the Worker's monthly limit (900,000) leaves 100,000
// of Google's 1,000,000 free characters for runs like this, so one run may not
// exceed that without an explicit --max-characters.
const DEFAULT_MAX_CHARACTERS = 100_000;
const SYNTHESIS_CONCURRENCY = 4;
const MAX_ATTEMPTS = 6;
const MIN_AUDIO_BYTES = 512;

function usage() {
  return `Generate static Ukrainian pronunciation assets with Google Cloud Text-to-Speech.

Usage:
  node scripts/speech/generate-speech-assets.mjs [options]

Options:
  --plan                         Collect and validate words without synthesizing audio.
  --sample WORD[,WORD...]        Render the words with the chosen voice, with and without
                                 stress marks, into .speech-build/samples/ to listen to.
  --source production|seed       Content source (default: production).
  --api-base URL                 Published site origin (default: ${DEFAULT_API_BASE}).
  --allow-seed-fallback          Use data/content-seed.json if the production API fails.
  --seed PATH                    Seed fallback path (default: data/content-seed.json).
  --output PATH                  Generated asset root (default: public/speech).
  --build-dir PATH               Ignored build/cache directory (default: .speech-build).
  --voice-id ID                  Site voice to generate (default: ${DEFAULT_SPEECH_VOICE_ID}).
  --stress                       Send stress marks from public/js/data/stress-map.json.
  --requests-per-minute NUMBER   Google request pace (default: ${DEFAULT_REQUESTS_PER_MINUTE}).
  --concurrency NUMBER           Concurrent production story requests (default: 8).
  --max-characters NUMBER        Refuse to send more than this to Google in one run
                                 (default: ${DEFAULT_MAX_CHARACTERS}).
  --help                         Show this help.

GOOGLE_TTS_API_KEY comes from the environment or .dev.vars.
Runs are resumable: finished words are kept in the build directory, and words whose
published audio is still current are reused instead of synthesized again.
`;
}

function parsePositiveInteger(rawValue, label) {
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    plan: false,
    sample: null,
    source: "production",
    apiBase: DEFAULT_API_BASE,
    allowSeedFallback: false,
    seed: DEFAULT_SEED,
    output: DEFAULT_OUTPUT,
    buildDir: DEFAULT_BUILD_DIR,
    voiceId: DEFAULT_SPEECH_VOICE_ID,
    stress: false,
    requestsPerMinute: DEFAULT_REQUESTS_PER_MINUTE,
    concurrency: 8,
    maxCharacters: DEFAULT_MAX_CHARACTERS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const nextValue = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      index += 1;
      return value;
    };

    switch (argument) {
      case "--plan":
        options.plan = true;
        break;
      case "--sample":
        options.sample = nextValue().split(",").map((word) => word.trim()).filter(Boolean);
        break;
      case "--allow-seed-fallback":
        options.allowSeedFallback = true;
        break;
      case "--stress":
        options.stress = true;
        break;
      case "--api-base":
        options.apiBase = nextValue().replace(/\/+$/u, "");
        break;
      case "--source": {
        const source = nextValue();
        if (source !== "production" && source !== "seed") {
          throw new Error("--source must be production or seed.");
        }
        options.source = source;
        break;
      }
      case "--seed":
        options.seed = resolve(nextValue());
        break;
      case "--output":
        options.output = resolve(nextValue());
        break;
      case "--build-dir":
        options.buildDir = resolve(nextValue());
        break;
      case "--voice-id":
        options.voiceId = nextValue();
        break;
      case "--requests-per-minute":
        options.requestsPerMinute = parsePositiveInteger(nextValue(), "--requests-per-minute");
        break;
      case "--concurrency":
        options.concurrency = parsePositiveInteger(nextValue(), "--concurrency");
        break;
      case "--max-characters":
        options.maxCharacters = parsePositiveInteger(nextValue(), "--max-characters");
        break;
      case "--help":
      case "-h":
        process.stdout.write(usage());
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${argument}\n\n${usage()}`);
    }
  }

  if (!resolveSpeechVoice(options.voiceId)) {
    throw new Error(`Unknown --voice-id ${JSON.stringify(options.voiceId)}; see functions/_shared/speech-voices.js.`);
  }

  return options;
}

async function fetchJson(url, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let response;

  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(`${label} request failed: ${error.message}`, { cause: error });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}.`);
  }

  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${label} did not return valid JSON.`, { cause: error });
  }
}

async function mapConcurrent(items, concurrency, callback) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await callback(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

async function loadProductionStories(apiBase, concurrency) {
  const indexPayload = await fetchJson(`${apiBase}/api/content`, "Published content index");
  if (!Array.isArray(indexPayload?.levels)) {
    throw new Error("Published content index has no levels array.");
  }

  const summaries = indexPayload.levels
    .flatMap((level) => (Array.isArray(level?.texts) ? level.texts : []))
    .filter((story) => story?.active !== false)
    .map((story) => ({ storyId: Number(story?.storyId) }))
    .filter((story) => Number.isSafeInteger(story.storyId) && story.storyId > 0);

  if (summaries.length === 0) {
    throw new Error("Published content index contains no active story IDs.");
  }

  const storyIds = [...new Set(summaries.map(({ storyId }) => storyId))].sort((a, b) => a - b);
  const stories = await mapConcurrent(storyIds, concurrency, async (storyId) => {
    const payload = await fetchJson(
      `${apiBase}/api/content/story?id=${encodeURIComponent(storyId)}`,
      `Published story ${storyId}`
    );
    const story = payload?.story;
    if (!story || story.active === false || !Array.isArray(story.paragraphs)) {
      throw new Error(`Published story ${storyId} has an invalid payload.`);
    }
    return {
      sourceId: String(storyId),
      paragraphs: story.paragraphs.map(String),
    };
  });

  return {
    stories,
    source: {
      kind: "production-api",
      apiBase,
    },
  };
}

async function loadSeedStories(seedPath, productionError) {
  let payload;
  try {
    payload = JSON.parse(await readFile(seedPath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read seed fallback ${seedPath}: ${error.message}`, { cause: error });
  }

  if (!Array.isArray(payload)) {
    throw new Error("Seed fallback must contain an array of stories.");
  }

  const stories = payload
    .filter((story) => story?.active !== false && Array.isArray(story?.paragraphs))
    .map((story, index) => ({
      sourceId: `${String(story.level || "unknown")}:${Number(story.sortOrder) || index + 1}`,
      paragraphs: story.paragraphs.map(String),
    }));

  if (stories.length === 0) {
    throw new Error("Seed fallback contains no active stories.");
  }

  return {
    stories,
    source: {
      kind: "seed-fallback",
      seedFile: seedPath.split(/[\\/]/u).at(-1),
      warning:
        "Production API was unavailable. Assets may omit stories published through the admin UI after this seed was created.",
      fallbackReason: productionError.message.startsWith("Production API was intentionally skipped")
        ? "explicit-seed-source"
        : "production-api-unavailable",
    },
  };
}

async function collectStories(options) {
  if (options.source === "seed") {
    return loadSeedStories(
      options.seed,
      new Error("Production API was intentionally skipped with --source seed.")
    );
  }

  try {
    return await loadProductionStories(options.apiBase, options.concurrency);
  } catch (error) {
    if (!options.allowSeedFallback) {
      throw new Error(
        `${error.message} Re-run only with --allow-seed-fallback if stale admin coverage is acceptable.`,
        { cause: error }
      );
    }
    process.stderr.write(`WARNING: ${error.message}\nWARNING: using explicit local seed fallback.\n`);
    return loadSeedStories(options.seed, error);
  }
}

function stableSourceDigest(stories) {
  const canonicalSource = stories
    .map((story) => ({ sourceId: story.sourceId, paragraphs: story.paragraphs }))
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId, "en"));
  return createHash("sha256").update(JSON.stringify(canonicalSource), "utf8").digest("hex");
}

function buildWordPlan(stories) {
  const occurrences = new Map();
  let tokenCount = 0;

  for (const story of stories) {
    for (const word of extractCanonicalSpeechWords(story.paragraphs.join(" "))) {
      tokenCount += 1;
      occurrences.set(word, (occurrences.get(word) || 0) + 1);
    }
  }

  const words = [...occurrences.keys()].sort((left, right) => left.localeCompare(right, "uk"));
  const jobs = words.map((word) => ({
    word,
    filename: speechAssetFilename(word),
    occurrences: occurrences.get(word),
  }));

  return { jobs, tokenCount };
}

async function writeJsonAtomically(path, value) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function readDevVars() {
  let text;
  try {
    text = await readFile(DEV_VARS_PATH, "utf8");
  } catch {
    return {};
  }
  const values = {};
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/u);
    if (match) values[match[1]] = match[2].replace(/^(["'])(.*)\1$/u, "$2");
  }
  return values;
}

async function loadGoogleApiKey() {
  const devVars = await readDevVars();
  const key = (process.env.GOOGLE_TTS_API_KEY || devVars.GOOGLE_TTS_API_KEY || "").trim();
  if (!key) {
    throw new Error("Set GOOGLE_TTS_API_KEY in the environment or .dev.vars.");
  }
  return key;
}

// Paces requests to the Google quota and retries throttling and transient failures.
function createSynthesizer(key, requestsPerMinute) {
  const interval = Math.ceil(60_000 / requestsPerMinute);
  let nextStart = 0;

  return async function synthesize(text, voice) {
    for (let attempt = 1; ; attempt += 1) {
      const wait = nextStart - Date.now();
      nextStart = Math.max(nextStart, Date.now()) + interval;
      if (wait > 0) await sleep(wait);

      let response;
      try {
        response = await fetch(
          GOOGLE_TTS_ENDPOINT,
          googleSpeechRequestInit({ key, text, voice, signal: AbortSignal.timeout(30_000) })
        );
      } catch (error) {
        if (attempt >= MAX_ATTEMPTS) throw new Error(`Google request failed: ${error.message}`, { cause: error });
        await sleep(5_000 * attempt);
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        throw new Error(`Google rejected the key (HTTP ${response.status}): ${await response.text()}`);
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt >= MAX_ATTEMPTS) throw new Error(`Google kept returning HTTP ${response.status}.`);
        const retryAfter = Number(response.headers.get("retry-after"));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 15_000 * attempt;
        process.stderr.write(`Google HTTP ${response.status}; retrying in ${Math.round(delay / 1000)}s.\n`);
        await sleep(delay);
        continue;
      }
      if (!response.ok) {
        throw new Error(`Google returned HTTP ${response.status} for ${JSON.stringify(text)}: ${await response.text()}`);
      }

      const bytes = decodeGoogleAudio(await response.json());
      if (!bytes || bytes.byteLength < MIN_AUDIO_BYTES) {
        throw new Error(`Google returned invalid audio for ${JSON.stringify(text)}.`);
      }
      return bytes;
    }
  };
}

async function loadStressMap() {
  return JSON.parse(await readFile(STRESS_MAP_PATH, "utf8"));
}

function synthesisIdentity(voice, stress) {
  return {
    provider: "google",
    requestVersion: GOOGLE_REQUEST_VERSION,
    audioConfig: GOOGLE_AUDIO_CONFIG,
    providerVoice: voice.providerVoice,
    stressMarks: stress,
  };
}

async function readPublishedManifest(voiceOutput) {
  try {
    return JSON.parse(await readFile(resolve(voiceOutput, "manifest.json"), "utf8"));
  } catch {
    return null;
  }
}

function formatDuration(milliseconds) {
  const minutes = Math.round(milliseconds / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

async function publishAssets(options, collection, plan, sourceDigest) {
  const voice = resolveSpeechVoice(options.voiceId);
  const identity = synthesisIdentity(voice, options.stress);
  const identityHash = sha256(JSON.stringify(identity));
  const stressMap = options.stress ? await loadStressMap() : null;
  const voiceOutput = resolve(options.output, voice.id);
  const stagingDir = resolve(options.buildDir, "google",`${voice.id}-${identityHash.slice(0, 16)}`);
  await mkdir(stagingDir, { recursive: true });
  await mkdir(voiceOutput, { recursive: true });

  const published = await readPublishedManifest(voiceOutput);
  const publishedIsCurrent = published?.identityHash === identityHash;

  const jobs = plan.jobs.map((job) => {
    const text = stressMap ? applyStress(job.word, stressMap) : job.word;
    return { ...job, text, staged: resolve(stagingDir, `${sha256(text)}.mp3`) };
  });

  let reused = 0;
  const pending = [];
  for (const job of jobs) {
    if (await pathExists(job.staged)) continue;
    const publishedFile = resolve(voiceOutput, job.filename);
    if (publishedIsCurrent && published.assets?.[job.word]?.text === job.text && await pathExists(publishedFile)) {
      await copyFile(publishedFile, job.staged);
      reused += 1;
      continue;
    }
    pending.push(job);
  }

  const characters = pending.reduce((total, job) => total + job.text.length, 0);
  process.stdout.write(
    `${jobs.length - pending.length} words already done (${reused} reused from public/speech); ` +
      `${pending.length} to synthesize, ${characters} characters, ` +
      `about ${formatDuration((pending.length * 60_000) / options.requestsPerMinute)}.\n`
  );

  assertWithinCharacterBudget(characters, options);

  if (pending.length) {
    const synthesize = createSynthesizer(await loadGoogleApiKey(), options.requestsPerMinute);
    const startedAt = Date.now();
    let done = 0;
    await mapConcurrent(pending, SYNTHESIS_CONCURRENCY, async (job) => {
      const bytes = await synthesize(job.text, voice);
      const temporaryPath = `${job.staged}.${process.pid}.tmp`;
      await writeFile(temporaryPath, bytes);
      await rename(temporaryPath, job.staged);

      done += 1;
      if (done === 1 || done % 250 === 0 || done === pending.length) {
        const remaining = ((Date.now() - startedAt) / done) * (pending.length - done);
        process.stdout.write(`  ${done}/${pending.length} (${job.word}); ${formatDuration(remaining)} left\n`);
      }
    });
  }

  const assets = {};
  let totalBytes = 0;
  const wanted = new Set();
  for (const job of jobs) {
    const bytes = await readFile(job.staged);
    if (bytes.byteLength < MIN_AUDIO_BYTES || !isMp3(bytes)) {
      throw new Error(`Invalid staged audio for ${JSON.stringify(job.word)}; delete ${job.staged} and re-run.`);
    }
    await copyFile(job.staged, resolve(voiceOutput, job.filename));
    wanted.add(job.filename);
    totalBytes += bytes.byteLength;
    assets[job.word] = { file: job.filename, text: job.text, bytes: bytes.byteLength, occurrences: job.occurrences };
  }

  // Words no longer in any published story would otherwise ship forever.
  let removed = 0;
  for (const name of await readdir(voiceOutput)) {
    if (name.endsWith(".mp3") && !wanted.has(name)) {
      await unlink(resolve(voiceOutput, name));
      removed += 1;
    }
  }

  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    canonicalization: SPEECH_CANONICALIZATION_VERSION,
    voice: { id: voice.id, ...identity },
    identityHash,
    audio: { extension: "mp3", mimeType: "audio/mpeg" },
    source: {
      ...collection.source,
      storyCount: collection.stories.length,
      digestSha256: sourceDigest,
    },
    tokenCount: plan.tokenCount,
    assetCount: jobs.length,
    totalBytes,
    assets,
  };

  // The manifest is the commit marker. It is published only after every audio file validates.
  await writeJsonAtomically(resolve(voiceOutput, "manifest.json"), manifest);
  return { manifest, removed };
}

function assertWithinCharacterBudget(characters, options) {
  if (characters > options.maxCharacters) {
    throw new Error(
      `This run would send ${characters} characters to Google, more than --max-characters ` +
        `(${options.maxCharacters}). Check the plan, then pass a higher --max-characters if it is intended.`
    );
  }
}

async function renderSamples(options) {
  const voice = resolveSpeechVoice(options.voiceId);
  const stressMap = await loadStressMap();
  const texts = options.sample.flatMap((word) => {
    const stressed = applyStress(word, stressMap);
    return stressed === word ? [word] : [word, stressed];
  });
  assertWithinCharacterBudget(texts.reduce((total, text) => total + text.length, 0), options);
  const synthesize = createSynthesizer(await loadGoogleApiKey(), options.requestsPerMinute);
  const sampleDir = resolve(options.buildDir, "samples");
  await mkdir(sampleDir, { recursive: true });

  for (const word of options.sample) {
    const stressed = applyStress(word, stressMap);
    const variants = stressed === word ? [["plain", word]] : [["plain", word], ["stressed", stressed]];
    for (const [label, text] of variants) {
      const name = `${word}-${voice.id}-${label}.mp3`;
      await writeFile(resolve(sampleDir, name), await synthesize(text, voice));
      process.stdout.write(`${resolve(sampleDir, name)}  (${text})\n`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.sample) {
    await renderSamples(options);
    return;
  }

  const collection = await collectStories(options);
  const plan = buildWordPlan(collection.stories);
  const sourceDigest = stableSourceDigest(collection.stories);
  const hasNasha = plan.jobs.some(({ word }) => word === "наша");

  const summary = {
    mode: options.plan ? "plan" : "generate",
    source: collection.source,
    storyCount: collection.stories.length,
    tokenCount: plan.tokenCount,
    uniqueWordCount: plan.jobs.length,
    characterCount: plan.jobs.reduce((total, { word }) => total + word.length, 0),
    sourceDigestSha256: sourceDigest,
    voice: resolveSpeechVoice(options.voiceId),
    stressMarks: options.stress,
    includesCanonicalNasha: hasNasha,
    sample: plan.jobs.slice(0, 12),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (!hasNasha) {
    throw new Error('Required live-story coverage check failed: canonical word "наша" is absent.');
  }

  if (options.plan) return;

  const { manifest, removed } = await publishAssets(options, collection, plan, sourceDigest);
  process.stdout.write(
    `Published ${manifest.assetCount} MP3 assets (${manifest.totalBytes} bytes, ${removed} stale removed) ` +
      `to ${resolve(options.output, options.voiceId)}.\n`
  );
}

main().catch((error) => {
  process.stderr.write(`speech asset generation failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
