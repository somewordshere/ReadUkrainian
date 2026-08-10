#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { delimiter, resolve } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
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
const VOICE_NAME = "uk_UA-ukrainian_tts-medium";
const VOICE_MODEL_URL =
  "https://huggingface.co/rhasspy/piper-voices/tree/main/uk/uk_UA/ukrainian_tts/medium";
const STATIC_VOICES = Object.freeze({
  "lada-medium": Object.freeze({ speakerId: 0, speakerName: "lada" }),
  mykyta: Object.freeze({ speakerId: 1, speakerName: "mykyta" }),
  tetiana: Object.freeze({ speakerId: 2, speakerName: "tetiana" }),
});
const DEFAULT_STATIC_VOICE_ID = "tetiana";
const PIPER_VERSION = "1.5.0";
const FFMPEG_BRIDGE_VERSION = "0.6.0";
const MANIFEST_SCHEMA_VERSION = 2;

function usage() {
  return `Generate static Ukrainian pronunciation assets.

Usage:
  node scripts/speech/generate-speech-assets.mjs [options]

Options:
  --plan                         Collect and validate words without synthesizing audio.
  --source production|seed       Content source (default: production).
  --api-base URL                 Published site origin (default: ${DEFAULT_API_BASE}).
  --allow-seed-fallback          Use data/content-seed.json if the production API fails.
  --seed PATH                    Seed fallback path (default: data/content-seed.json).
  --output PATH                  Generated asset root (default: public/speech).
  --build-dir PATH               Ignored build/cache directory (default: .speech-build).
  --python PATH                  Python 3.10+ executable used for Piper.
  --bootstrap                    Install pinned build-only dependencies and download the voice.
  --voice-id ID                  lada-medium, mykyta, or tetiana (default: tetiana).
  --speaker-id NUMBER            Compatibility alias for voice IDs: 0, 1, or 2.
  --concurrency NUMBER           Concurrent production story requests (default: 8).
  --help                         Show this help.

Production is always attempted first. Seed fallback is deliberately opt-in so a deploy
cannot silently omit newly published admin content.
`;
}

function parsePositiveInteger(rawValue, label, { allowZero = false } = {}) {
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`${label} must be ${allowZero ? "a non-negative" : "a positive"} integer.`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    plan: false,
    source: "production",
    apiBase: DEFAULT_API_BASE,
    allowSeedFallback: false,
    seed: DEFAULT_SEED,
    output: DEFAULT_OUTPUT,
    buildDir: DEFAULT_BUILD_DIR,
    python: process.env.SPEECH_BUILD_PYTHON || "python",
    bootstrap: false,
    voiceId: DEFAULT_STATIC_VOICE_ID,
    speakerId: STATIC_VOICES[DEFAULT_STATIC_VOICE_ID].speakerId,
    concurrency: 8,
  };
  let requestedVoiceId = null;
  let requestedSpeakerId = null;

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
      case "--allow-seed-fallback":
        options.allowSeedFallback = true;
        break;
      case "--bootstrap":
        options.bootstrap = true;
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
      case "--python":
        options.python = resolve(nextValue());
        break;
      case "--voice-id":
        requestedVoiceId = nextValue();
        break;
      case "--speaker-id":
        requestedSpeakerId = parsePositiveInteger(nextValue(), "--speaker-id", { allowZero: true });
        break;
      case "--concurrency":
        options.concurrency = parsePositiveInteger(nextValue(), "--concurrency");
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

  if (requestedVoiceId && !Object.hasOwn(STATIC_VOICES, requestedVoiceId)) {
    throw new Error("--voice-id must be lada-medium, mykyta, or tetiana.");
  }

  const speakerVoiceId = requestedSpeakerId === null
    ? null
    : Object.keys(STATIC_VOICES).find(
        (voiceId) => STATIC_VOICES[voiceId].speakerId === requestedSpeakerId
      );
  if (requestedSpeakerId !== null && !speakerVoiceId) {
    throw new Error("--speaker-id must be 0 (lada-medium), 1 (mykyta), or 2 (tetiana).");
  }
  if (requestedVoiceId && speakerVoiceId && requestedVoiceId !== speakerVoiceId) {
    throw new Error("--voice-id and --speaker-id select different voices.");
  }

  options.voiceId = requestedVoiceId || speakerVoiceId || DEFAULT_STATIC_VOICE_ID;
  options.speakerId = STATIC_VOICES[options.voiceId].speakerId;

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

function commandLabel(command, args) {
  return [command, ...args].map((part) => JSON.stringify(part)).join(" ");
}

async function run(command, args, options = {}) {
  process.stdout.write(`> ${commandLabel(command, args)}\n`);
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} failed (${signal || `exit ${code}`}).`));
    });
  });
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function prepareBuildRuntime(options) {
  const pythonPackages = resolve(options.buildDir, "python-packages");
  const modelDir = resolve(options.buildDir, "models");
  const modelPath = resolve(modelDir, `${VOICE_NAME}.onnx`);
  const modelConfigPath = `${modelPath}.json`;
  await mkdir(options.buildDir, { recursive: true });

  const pythonPath = [pythonPackages, process.env.PYTHONPATH].filter(Boolean).join(delimiter);
  const env = { ...process.env, PYTHONPATH: pythonPath };

  if (options.bootstrap) {
    await mkdir(pythonPackages, { recursive: true });
    await run(
      options.python,
      [
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-input",
        "--target",
        pythonPackages,
        `piper-tts==${PIPER_VERSION}`,
        `imageio-ffmpeg==${FFMPEG_BRIDGE_VERSION}`,
      ],
      { env }
    );
    await mkdir(modelDir, { recursive: true });
    await run(
      options.python,
      ["-m", "piper.download_voices", "--data-dir", modelDir, VOICE_NAME],
      { env }
    );
  }

  if (!(await pathExists(modelPath)) || !(await pathExists(modelConfigPath))) {
    throw new Error(
      `Piper model is missing at ${modelPath}. Use --bootstrap on a network-enabled build machine.`
    );
  }

  return { env, modelPath };
}

async function validateStagedAssets(stagingDir, jobs) {
  let totalBytes = 0;
  const assetSizes = {};

  for (const job of jobs) {
    const assetPath = resolve(stagingDir, job.filename);
    const assetStat = await stat(assetPath);
    if (!assetStat.isFile() || assetStat.size < 128) {
      throw new Error(`Invalid or empty generated asset: ${job.filename}`);
    }
    totalBytes += assetStat.size;
    assetSizes[job.word] = assetStat.size;
  }

  return { totalBytes, assetSizes };
}

async function writeJsonAtomically(path, value) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

async function publishAssets(options, collection, plan, sourceDigest) {
  const runtime = await prepareBuildRuntime(options);
  const stagingDir = resolve(
    options.buildDir,
    "staging",
    options.voiceId,
    sourceDigest
  );
  const jobsPath = resolve(
    options.buildDir,
    `jobs-${options.voiceId}-${sourceDigest}.json`
  );
  await mkdir(stagingDir, { recursive: true });
  await writeJsonAtomically(jobsPath, {
    voice: VOICE_NAME,
    voiceId: options.voiceId,
    speakerId: options.speakerId,
    // Prove the live story's observed first word before committing to the full batch.
    jobs: [...plan.jobs]
      .sort((left, right) => Number(right.word === "наша") - Number(left.word === "наша"))
      .map(({ word, filename }) => ({ word, filename })),
  });

  await run(
    options.python,
    [
      resolve(import.meta.dirname, "synthesize_piper.py"),
      "--model",
      runtime.modelPath,
      "--jobs",
      jobsPath,
      "--output",
      stagingDir,
      "--speaker-id",
      String(options.speakerId),
    ],
    { env: runtime.env }
  );

  const validation = await validateStagedAssets(stagingDir, plan.jobs);
  const voiceOutput = resolve(options.output, options.voiceId);
  await mkdir(voiceOutput, { recursive: true });

  for (const job of plan.jobs) {
    await copyFile(resolve(stagingDir, job.filename), resolve(voiceOutput, job.filename));
  }

  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    canonicalization: SPEECH_CANONICALIZATION_VERSION,
    voice: {
      id: options.voiceId,
      engine: "Piper",
      engineVersion: PIPER_VERSION,
      model: VOICE_NAME,
      modelUrl: VOICE_MODEL_URL,
      speakerId: options.speakerId,
      speakerName: STATIC_VOICES[options.voiceId].speakerName,
    },
    audio: {
      extension: "mp3",
      mimeType: "audio/mpeg",
      codec: "MP3",
      bitrateKbps: 32,
      sampleRateHz: 22050,
      channels: 1,
    },
    source: {
      ...collection.source,
      storyCount: collection.stories.length,
      digestSha256: sourceDigest,
    },
    tokenCount: plan.tokenCount,
    assetCount: plan.jobs.length,
    totalBytes: validation.totalBytes,
    assets: Object.fromEntries(
      plan.jobs.map((job) => [
        job.word,
        {
          file: job.filename,
          bytes: validation.assetSizes[job.word],
          occurrences: job.occurrences,
        },
      ])
    ),
  };

  // The manifest is the commit marker. It is published only after every audio file validates.
  await writeJsonAtomically(resolve(voiceOutput, "manifest.json"), manifest);
  return manifest;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const collection = await collectStories(options);
  const plan = buildWordPlan(collection.stories);
  const sourceDigest = stableSourceDigest(collection.stories);
  const sample = plan.jobs.slice(0, 12);
  const hasNasha = plan.jobs.some(({ word }) => word === "наша");

  const summary = {
    mode: options.plan ? "plan" : "generate",
    source: collection.source,
    storyCount: collection.stories.length,
    tokenCount: plan.tokenCount,
    uniqueWordCount: plan.jobs.length,
    sourceDigestSha256: sourceDigest,
    voice: {
      id: options.voiceId,
      model: VOICE_NAME,
      speakerId: options.speakerId,
      speakerName: STATIC_VOICES[options.voiceId].speakerName,
    },
    includesCanonicalNasha: hasNasha,
    sample,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (!hasNasha) {
    throw new Error('Required live-story coverage check failed: canonical word "наша" is absent.');
  }

  if (options.plan) return;

  const manifest = await publishAssets(options, collection, plan, sourceDigest);
  process.stdout.write(
    `Published ${manifest.assetCount} MP3 assets (${manifest.totalBytes} bytes) to ${resolve(options.output, options.voiceId)}.\n`
  );
}

main().catch((error) => {
  process.stderr.write(`speech asset generation failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
