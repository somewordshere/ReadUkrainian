import {
  GOOGLE_AUDIO_CONFIG,
  GOOGLE_REQUEST_VERSION,
  GOOGLE_TTS_ENDPOINT,
  decodeGoogleAudio,
  getGoogleApiKey,
  googleSpeechRequestInit,
  isMp3,
} from "../_shared/google-speech.js";
import {
  checkRateLimit,
  clientAddress,
  declaresTooMuch,
  decodeJson,
  hasMediaType,
  noStoreError,
  readLimitedBytes,
  readLimitedJson,
} from "../_shared/http.js";
import { getSpeechSetting, resolveLearnerSpeechVoice } from "../_shared/speech-settings.js";
import {
  DEFAULT_SPEECH_VOICE_ID,
  resolveSpeechVoice,
} from "../_shared/speech-voices.js";
import { getStoryById } from "../_shared/texts.js";
import { canonicalizeUkrainianWord, extractUkrainianWords } from "../_shared/ukrainian-word.js";

const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_PROVIDER_AUDIO_BYTES = 2 * 1024 * 1024;
// Base64 inflates the audio by a third, plus a little JSON around it.
const MAX_PROVIDER_JSON_BYTES = Math.ceil((MAX_PROVIDER_AUDIO_BYTES * 4) / 3) + 1024;
const SPEECH_ASSET_FORMAT = "mp3";
const SPEECH_CONTENT_TYPE = "audio/mpeg";
const IMMUTABLE_CACHE_SECONDS = 365 * 24 * 60 * 60;
const PROVIDER_TIMEOUT_MS = 8_000;

const AUDIO_CONTENT_TYPES = new Set(["audio/mpeg", "audio/mp3", "audio/x-mpeg"]);

// Selection and story text are compared with the same normalizer the dictionary
// uses, so a word the dictionary finds is a word pronunciation accepts.
export function canonicalizeSpeechWord(value) {
  return canonicalizeUkrainianWord(value);
}

function storyContainsWord(story, canonicalWord) {
  return extractUkrainianWords((story?.paragraphs || []).join(" ")).includes(canonicalWord);
}

function parseStoryId(value) {
  if (Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    const storyId = Number(value);
    return Number.isSafeInteger(storyId) && storyId > 0 ? storyId : null;
  }

  return null;
}

async function readProviderAudio(response) {
  if (
    !response.ok ||
    !AUDIO_CONTENT_TYPES.has(response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase()) ||
    declaresTooMuch(response.headers, MAX_PROVIDER_AUDIO_BYTES)
  ) {
    return null;
  }

  const bytes = await readLimitedBytes(response.body, MAX_PROVIDER_AUDIO_BYTES);
  if (!bytes?.byteLength || !isMp3(bytes)) return null;

  return { bytes, contentType: SPEECH_CONTENT_TYPE };
}

async function readGoogleAudio(response) {
  if (
    !response.ok ||
    !hasMediaType(response.headers, "application/json") ||
    declaresTooMuch(response.headers, MAX_PROVIDER_JSON_BYTES)
  ) {
    return null;
  }

  const body = await readLimitedBytes(response.body, MAX_PROVIDER_JSON_BYTES);
  const parsed = body ? decodeJson(body) : { ok: false };
  const bytes = parsed.ok ? decodeGoogleAudio(parsed.value) : null;
  return bytes ? { bytes, contentType: SPEECH_CONTENT_TYPE } : null;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function buildSpeechAssetPath(
  canonicalWord,
  voiceId = DEFAULT_SPEECH_VOICE_ID
) {
  const voiceConfig = resolveSpeechVoice(voiceId);
  if (!voiceConfig) {
    throw new TypeError(`Unsupported speech voice: ${JSON.stringify(voiceId)}`);
  }
  const hash = await sha256Hex(canonicalWord);
  return `/speech/${voiceConfig.id}/${hash}.${SPEECH_ASSET_FORMAT}`;
}

async function buildProviderCacheRequest(requestUrl, canonicalWord, voiceConfig) {
  const cacheIdentity = [
    "google",
    GOOGLE_REQUEST_VERSION,
    JSON.stringify(GOOGLE_AUDIO_CONFIG),
    voiceConfig.id,
    voiceConfig.providerVoice,
    canonicalWord,
  ].join("\u0000");
  const hash = await sha256Hex(cacheIdentity);
  return new Request(
    new URL(`/__speech-cache/google/${hash}.mp3`, requestUrl),
    { method: "GET" }
  );
}

function getCache(context) {
  if (Object.prototype.hasOwnProperty.call(context, "cache")) {
    return context.cache;
  }
  return globalThis.caches?.default || null;
}

function speechAudioResponse(sourceResponse, source, cacheStatus, voiceId) {
  const headers = new Headers({
    "cache-control": `public, max-age=${IMMUTABLE_CACHE_SECONDS}, immutable`,
    "content-type": SPEECH_CONTENT_TYPE,
    "x-content-type-options": "nosniff",
    "x-speech-cache": cacheStatus,
    "x-speech-source": source,
    "x-speech-voice": voiceId,
  });

  for (const headerName of ["content-length", "etag", "last-modified"]) {
    const value = sourceResponse.headers.get(headerName);
    if (value) headers.set(headerName, value);
  }

  return new Response(sourceResponse.body, {
    status: 200,
    headers,
  });
}

function bufferedAudioResponse(audio) {
  return new Response(audio.bytes, {
    headers: {
      "cache-control": `public, max-age=${IMMUTABLE_CACHE_SECONDS}, immutable`,
      "content-length": String(audio.bytes.byteLength),
      "content-type": audio.contentType,
      "x-content-type-options": "nosniff",
      "x-speech-source": "google",
    },
  });
}

function parseCharacterLimit(value) {
  const rawLimit = String(value ?? "").trim();
  if (!/^\d+$/.test(rawLimit)) return null;

  const limit = Number(rawLimit);
  return Number.isSafeInteger(limit) && limit > 0 ? limit : null;
}

// A keyed hash of the client's address for today. The key keeps the table from
// being reversed into addresses by hashing all of IPv4, and the day in the
// input means yesterday's rows cannot be linked to today's.
async function hashSpeechClient(secret, day, address) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`speech-client|${day}|${address}`)
  );
  return Array.from(new Uint8Array(signature).slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// One client's share of the day's live Google budget, so a single script cannot
// spend the whole site's pronunciation quota. Reserved before the site-wide
// budget; atomic like it.
async function reserveClientSpeechQuota(env, day, client, characterCount, clientLimit) {
  const row = await env.DB
    .prepare(`
      INSERT INTO speech_usage_client_daily (day, client_hash, characters_used)
      SELECT ?1, ?2, ?3
      WHERE ?3 <= ?4
      ON CONFLICT(day, client_hash) DO UPDATE SET
        characters_used = speech_usage_client_daily.characters_used + excluded.characters_used
      WHERE speech_usage_client_daily.characters_used + excluded.characters_used <= ?4
      RETURNING characters_used
    `)
    .bind(day, client, characterCount, clientLimit)
    .first();

  return Boolean(row);
}

function releaseClientSpeechQuota(env, day, client, characterCount) {
  return env.DB
    .prepare(`
      UPDATE speech_usage_client_daily
      SET characters_used = MAX(0, characters_used - ?3)
      WHERE day = ?1 AND client_hash = ?2
    `)
    .bind(day, client, characterCount)
    .run();
}

function releaseDailySpeechQuota(env, day, characterCount) {
  return env.DB
    .prepare(`
      UPDATE speech_usage_daily
      SET characters_used = MAX(0, characters_used - ?2), updated_at = CURRENT_TIMESTAMP
      WHERE day = ?1
    `)
    .bind(day, characterCount)
    .run();
}

// Only today's client rows are ever needed.
function forgetEarlierSpeechClients(env, day) {
  return env.DB
    .prepare("DELETE FROM speech_usage_client_daily WHERE day < ?1")
    .bind(day)
    .run();
}

function inBackground(context, promise) {
  const settled = promise.catch((backgroundError) => {
    console.error(JSON.stringify({
      message: "speech_quota_bookkeeping_failed",
      error: backgroundError instanceof Error ? backgroundError.message : String(backgroundError),
    }));
  });
  if (typeof context.waitUntil === "function") {
    context.waitUntil(settled);
    return Promise.resolve();
  }
  return settled;
}

async function reserveDailySpeechQuota(env, day, characterCount, dailyLimit) {
  const row = await env.DB
    .prepare(`
      INSERT INTO speech_usage_daily (day, characters_used, updated_at)
      SELECT ?1, ?2, CURRENT_TIMESTAMP
      WHERE ?2 <= ?3
      ON CONFLICT(day) DO UPDATE SET
        characters_used = speech_usage_daily.characters_used + excluded.characters_used,
        updated_at = CURRENT_TIMESTAMP
      WHERE speech_usage_daily.characters_used + excluded.characters_used <= ?3
      RETURNING characters_used
    `)
    .bind(day, characterCount, dailyLimit)
    .first();

  return Boolean(row);
}

function secondsUntilNextUtcDay() {
  const now = new Date();
  const tomorrow = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1
  );
  return Math.max(60, Math.ceil((tomorrow - now.getTime()) / 1000));
}

async function fetchWithTimeout(fetchImpl, input, init, timeoutMs, requestSignal) {
  if (!(timeoutMs > 0)) throw new Error("Provider deadline exceeded.");

  const controller = new AbortController();
  const abortFromRequest = () => controller.abort();
  if (requestSignal?.aborted) {
    controller.abort();
  } else {
    requestSignal?.addEventListener("abort", abortFromRequest, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    requestSignal?.removeEventListener("abort", abortFromRequest);
  }
}

async function fetchGoogleAudio(context, key, canonicalWord, voiceConfig) {
  const fetchImpl = context.fetch || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("Fetch unavailable.");

  const response = await fetchWithTimeout(
    fetchImpl,
    GOOGLE_TTS_ENDPOINT,
    googleSpeechRequestInit({ key, text: canonicalWord, voice: voiceConfig }),
    PROVIDER_TIMEOUT_MS,
    context.request.signal
  );
  if (!response.ok) {
    throw new Error(`Google speech request returned HTTP ${response.status}.`);
  }

  const audio = await readGoogleAudio(response);
  if (!audio) throw new Error("Invalid provider audio.");
  return audio;
}

export async function onRequestPost(context) {
  const requestUrl = new URL(context.request.url);
  const origin = context.request.headers.get("origin");
  if (origin !== requestUrl.origin) {
    return noStoreError(403, "Same-origin speech requests are required.");
  }

  const parsedBody = await readLimitedJson(context.request, MAX_REQUEST_BYTES);
  if (!parsedBody.ok) {
    return noStoreError(parsedBody.status, parsedBody.message);
  }

  const storyId = parseStoryId(parsedBody.value?.storyId);
  if (!storyId) {
    return noStoreError(400, "A valid story ID is required.");
  }

  const canonicalWord = canonicalizeSpeechWord(parsedBody.value?.text);
  if (!canonicalWord) {
    return noStoreError(422, "Select one Ukrainian word, not a phrase.");
  }

  // The setting and the story do not depend on each other, so both D1 reads go
  // out together; the setting still decides first whether speech is on at all.
  const [settingResult, storyResult] = await Promise.allSettled([
    getSpeechSetting(context.env.DB),
    getStoryById(context.env.DB, storyId),
  ]);
  if (settingResult.status === "rejected") {
    return noStoreError(503, "Pronunciation is temporarily unavailable.");
  }
  const speechSetting = settingResult.value;
  if (!speechSetting.enabled) {
    return noStoreError(404, "Pronunciation is disabled.", {
      "x-speech-disabled": "true",
    });
  }

  // The learner's chosen voice counts only while it is on the admin's shortlist;
  // a stale or unknown choice quietly falls back to the site voice.
  let voiceConfig;
  try {
    voiceConfig = await resolveLearnerSpeechVoice(
      context.env.DB,
      speechSetting,
      parsedBody.value?.voiceId
    );
  } catch {
    voiceConfig = resolveSpeechVoice(speechSetting.voiceId);
  }
  if (!voiceConfig) {
    return noStoreError(503, "Pronunciation is temporarily unavailable.");
  }

  if (storyResult.status === "rejected") {
    return noStoreError(503, "Pronunciation is temporarily unavailable.");
  }
  const story = storyResult.value;

  if (!story?.active) {
    return noStoreError(404, "Published story not found.");
  }
  if (!storyContainsWord(story, canonicalWord)) {
    return noStoreError(404, "The selected word was not found in the published story.");
  }
  if (!context.env.ASSETS || typeof context.env.ASSETS.fetch !== "function") {
    return noStoreError(503, "Pronunciation is temporarily unavailable.");
  }

  const assetPath = await buildSpeechAssetPath(canonicalWord, voiceConfig.id);
  let assetResponse;
  try {
    assetResponse = await context.env.ASSETS.fetch(
      new Request(new URL(assetPath, context.request.url), {
        method: "GET",
        headers: { accept: SPEECH_CONTENT_TYPE },
      })
    );
  } catch {
    return noStoreError(503, "Pronunciation is temporarily unavailable.");
  }

  if (assetResponse.ok && assetResponse.body) {
    return speechAudioResponse(assetResponse, "static", "HIT", voiceConfig.id);
  }
  if (assetResponse.status !== 404) {
    return noStoreError(503, "Pronunciation is temporarily unavailable.");
  }

  const cache = getCache(context);
  let cacheRequest = null;
  if (cache) {
    try {
      cacheRequest = await buildProviderCacheRequest(
        context.request.url,
        canonicalWord,
        voiceConfig
      );
      const cachedResponse = await cache.match(cacheRequest);
      if (cachedResponse) {
        const cachedAudio = await readProviderAudio(cachedResponse);
        if (cachedAudio) {
          return speechAudioResponse(
            bufferedAudioResponse(cachedAudio),
            "google",
            "HIT",
            voiceConfig.id
          );
        }
      }
    } catch {
      cacheRequest = null;
    }
  }

  const dailyLimit = parseCharacterLimit(context.env.SPEECH_DAILY_CHARACTER_LIMIT);
  const clientLimit = parseCharacterLimit(context.env.SPEECH_CLIENT_DAILY_CHARACTER_LIMIT);
  const apiKey = getGoogleApiKey(context.env);
  if (!dailyLimit || !clientLimit || !apiKey || !context.env.SESSION_SECRET) {
    return noStoreError(503, "Pronunciation is temporarily unavailable.");
  }

  try {
    const rateLimitResult = await checkRateLimit(context.env.SPEECH_RATE_LIMITER, "speech:google");
    if (rateLimitResult === null) {
      return noStoreError(503, "Pronunciation is temporarily unavailable.");
    }
    if (!rateLimitResult) {
      return noStoreError(
        429,
        "Too many pronunciation requests. Please try again shortly.",
        { "retry-after": "60", "x-speech-limit": "rate" }
      );
    }
  } catch {
    return noStoreError(503, "Pronunciation is temporarily unavailable.");
  }

  const day = new Date().toISOString().slice(0, 10);
  const characters = canonicalWord.length;
  let client;
  try {
    client = await hashSpeechClient(
      context.env.SESSION_SECRET,
      day,
      clientAddress(context.request) || "unknown"
    );
    const clientQuotaAvailable = await reserveClientSpeechQuota(
      context.env,
      day,
      client,
      characters,
      clientLimit
    );
    if (!clientQuotaAvailable) {
      return noStoreError(429, "Your daily pronunciation limit has been reached.", {
        "retry-after": String(secondsUntilNextUtcDay()),
        "x-speech-limit": "client",
      });
    }

    const quotaAvailable = await reserveDailySpeechQuota(context.env, day, characters, dailyLimit);
    if (!quotaAvailable) {
      await inBackground(context, releaseClientSpeechQuota(context.env, day, client, characters));
      return noStoreError(
        429,
        "The daily pronunciation limit has been reached.",
        {
          "retry-after": String(secondsUntilNextUtcDay()),
          "x-speech-limit": "daily",
        }
      );
    }
  } catch {
    return noStoreError(503, "Pronunciation is temporarily unavailable.");
  }
  await inBackground(context, forgetEarlierSpeechClients(context.env, day));

  let providerAudio;
  try {
    providerAudio = await fetchGoogleAudio(context, apiKey, canonicalWord, voiceConfig);
  } catch (providerError) {
    const providerErrorMessage = providerError instanceof Error
      ? providerError.message
      : "Unknown provider error.";
    console.error(JSON.stringify({
      message: "speech_provider_failed",
      provider: "google",
      voice: voiceConfig.id,
      error: providerErrorMessage,
    }));
    // Nothing was spoken, so a Google outage must not use up the day's budget.
    await inBackground(context, Promise.all([
      releaseDailySpeechQuota(context.env, day, characters),
      releaseClientSpeechQuota(context.env, day, client, characters),
    ]));
    return noStoreError(502, "Pronunciation generation failed.");
  }

  const generatedResponse = bufferedAudioResponse(providerAudio);
  if (cache && cacheRequest) {
    const cacheWrite = cache
      .put(cacheRequest, generatedResponse.clone())
      .catch(() => undefined);
    if (typeof context.waitUntil === "function") {
      context.waitUntil(cacheWrite);
    } else {
      await cacheWrite;
    }
  }

  return speechAudioResponse(
    generatedResponse,
    "google",
    "MISS",
    voiceConfig.id
  );
}
