import { error } from "../_shared/http.js";
import { getSpeechSetting } from "../_shared/speech-settings.js";
import {
  DEFAULT_SPEECH_VOICE_ID,
  resolveSpeechVoice,
} from "../_shared/speech-voices.js";
import { getStoryById } from "../_shared/texts.js";

const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_PROVIDER_JSON_BYTES = 32 * 1024;
const MAX_PROVIDER_AUDIO_BYTES = 2 * 1024 * 1024;
const SPEECH_ASSET_FORMAT = "mp3";
const SPEECH_CONTENT_TYPE = "audio/mpeg";
const IMMUTABLE_CACHE_SECONDS = 365 * 24 * 60 * 60;

const TTS_AI_CREATE_URL = "https://api.tts.ai/v1/tts/";
const TTS_AI_RESULTS_URL = "https://api.tts.ai/v1/speech/results/";
const TTS_AI_AUDIO_HOSTS = new Set(["api.tts.ai", "cdn.tts.ai"]);
const TTS_AI_LANGUAGE = "uk";
const TTS_AI_SPEED = 0.9;
const MAX_POLL_ATTEMPTS = 8;
const POLL_DELAY_MS = 750;
const PROVIDER_TOTAL_TIMEOUT_MS = 12_000;
const PROVIDER_FETCH_TIMEOUT_MS = 5_000;

const APOSTROPHE_VARIANTS = /[\u2019\u2018\u02BC\uFF07\u0060\u00B4]/gu;
const HYPHEN_VARIANTS = /[\u2010\u2011\u2012\u2013\u2014\u2212]/gu;
const UKRAINIAN_WORD_SOURCE = "[а-щьюяєіїґ]+(?:['-][а-щьюяєіїґ]+)*";
const UKRAINIAN_WORD_PATTERN = new RegExp(`^${UKRAINIAN_WORD_SOURCE}$`, "u");
const SELECTED_WORD_PATTERN = new RegExp(
  `^[\\s\\p{P}\\p{S}]*(?<word>${UKRAINIAN_WORD_SOURCE})[\\s\\p{P}\\p{S}]*$`,
  "u"
);
const STORY_TOKEN_PATTERN =
  /[\p{L}\p{M}\p{N}]+(?:['-][\p{L}\p{M}\p{N}]+)*/gu;
const UUID_PATTERN = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu;
const AUDIO_CONTENT_TYPES = new Map([
  ["audio/mpeg", "audio/mpeg"],
  ["audio/mp3", "audio/mpeg"],
  ["audio/x-mpeg", "audio/mpeg"],
  ["audio/wav", "audio/wav"],
  ["audio/wave", "audio/wav"],
  ["audio/x-wav", "audio/wav"],
  ["audio/vnd.wave", "audio/wav"],
]);
const PENDING_JOB_STATUSES = new Set(["pending", "queued", "processing"]);

function normalizeJoiners(value) {
  return value
    .replace(APOSTROPHE_VARIANTS, "'")
    .replace(HYPHEN_VARIANTS, "-");
}

function normalizeForSpeech(value) {
  return normalizeJoiners(
    String(value || "")
      .normalize("NFC")
      .trim()
      .toLocaleLowerCase("uk-UA")
  ).normalize("NFC");
}

export function canonicalizeSpeechWord(value) {
  const normalized = normalizeForSpeech(value);
  const match = normalized.match(SELECTED_WORD_PATTERN);
  return match?.groups?.word || null;
}

function storyContainsWord(story, canonicalWord) {
  const normalizedStory = normalizeForSpeech((story?.paragraphs || []).join(" "));

  for (const match of normalizedStory.matchAll(STORY_TOKEN_PATTERN)) {
    if (
      UKRAINIAN_WORD_PATTERN.test(match[0]) &&
      match[0] === canonicalWord
    ) {
      return true;
    }
  }

  return false;
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

async function readLimitedRequestJson(request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return { ok: false, status: 415, message: "Content-Type must be application/json." };
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return { ok: false, status: 413, message: "Request body is too large." };
  }

  if (!request.body) {
    return { ok: false, status: 400, message: "A JSON request body is required." };
  }

  const bytes = await readLimitedBody(request.body, MAX_REQUEST_BYTES);
  if (!bytes) {
    return { ok: false, status: 413, message: "Request body is too large." };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(new TextDecoder().decode(bytes)),
    };
  } catch {
    return { ok: false, status: 400, message: "Invalid JSON request body." };
  }
}

async function readLimitedBody(body, maximumBytes) {
  if (!body) return null;

  const reader = body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readProviderJson(response) {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    !response.ok ||
    contentType !== "application/json" ||
    (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_JSON_BYTES)
  ) {
    return null;
  }

  const bytes = await readLimitedBody(response.body, MAX_PROVIDER_JSON_BYTES);
  if (!bytes) return null;

  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

async function readProviderAudio(response) {
  const declaredContentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    !response.ok ||
    !AUDIO_CONTENT_TYPES.has(declaredContentType) ||
    (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_AUDIO_BYTES)
  ) {
    return null;
  }

  const bytes = await readLimitedBody(response.body, MAX_PROVIDER_AUDIO_BYTES);
  if (!bytes?.byteLength) return null;

  const isWave =
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45;
  const isMp3 =
    (bytes.byteLength >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
    (bytes.byteLength >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);

  return {
    bytes,
    contentType: isWave
      ? "audio/wav"
      : isMp3
        ? "audio/mpeg"
        : AUDIO_CONTENT_TYPES.get(declaredContentType),
  };
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
    "tts.ai",
    voiceConfig.providerModel,
    voiceConfig.id,
    voiceConfig.providerVoice,
    "", // Preserve the former speaker slot so verified Lada cache entries remain reusable.
    TTS_AI_LANGUAGE,
    voiceConfig.providerFormat,
    String(TTS_AI_SPEED),
    canonicalWord,
  ].join("\u0000");
  const hash = await sha256Hex(cacheIdentity);
  return new Request(
    new URL(`/__speech-cache/tts-ai/${hash}.mp3`, requestUrl),
    { method: "GET" }
  );
}

function getCache(context) {
  if (Object.prototype.hasOwnProperty.call(context, "cache")) {
    return context.cache;
  }
  return globalThis.caches?.default || null;
}

function noStoreError(status, message, headers = {}) {
  return error(status, message, {
    headers: {
      ...headers,
      "cache-control": "no-store",
    },
  });
}

function speechAudioResponse(sourceResponse, source, cacheStatus, voiceId) {
  const sourceContentType = sourceResponse.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  const headers = new Headers({
    "cache-control": `public, max-age=${IMMUTABLE_CACHE_SECONDS}, immutable`,
    "content-type": AUDIO_CONTENT_TYPES.get(sourceContentType) || SPEECH_CONTENT_TYPE,
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
      "x-speech-source": "tts-ai",
    },
  });
}

function getDailyCharacterLimit(env) {
  const rawLimit = String(env.SPEECH_DAILY_CHARACTER_LIMIT ?? "").trim();
  if (!/^\d+$/.test(rawLimit)) return null;

  const limit = Number(rawLimit);
  return Number.isSafeInteger(limit) && limit > 0 ? limit : null;
}

async function reserveDailySpeechQuota(env, characterCount, dailyLimit) {
  const day = new Date().toISOString().slice(0, 10);
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

async function checkRateLimit(env) {
  if (!env.SPEECH_RATE_LIMITER || typeof env.SPEECH_RATE_LIMITER.limit !== "function") {
    return null;
  }

  const result = await env.SPEECH_RATE_LIMITER.limit({
    key: "speech:tts-ai",
  });
  return typeof result?.success === "boolean" ? result.success : null;
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

function validateResultUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return null;

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !TTS_AI_AUDIO_HOSTS.has(url.hostname) ||
      (url.port && url.port !== "443") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

async function fetchTtsAiAudio(context, canonicalWord, voiceConfig) {
  const fetchImpl = context.fetch || globalThis.fetch;
  const sleep = context.sleep || ((milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const now = context.now || Date.now;
  if (typeof fetchImpl !== "function") throw new Error("Fetch unavailable.");

  const deadline = now() + PROVIDER_TOTAL_TIMEOUT_MS;
  const remainingTimeout = () =>
    Math.min(PROVIDER_FETCH_TIMEOUT_MS, deadline - now());
  const requestSignal = context.request.signal;

  const providerPayload = {
    model: voiceConfig.providerModel,
    voice: voiceConfig.providerVoice,
    language: TTS_AI_LANGUAGE,
    text: canonicalWord,
    format: voiceConfig.providerFormat,
    speed: TTS_AI_SPEED,
  };

  const createResponse = await fetchWithTimeout(
    fetchImpl,
    TTS_AI_CREATE_URL,
    {
      method: "POST",
      headers: {
        accept: "audio/*, application/json",
        "content-type": "application/json",
      },
      redirect: "manual",
      body: JSON.stringify(providerPayload),
    },
    remainingTimeout(),
    requestSignal
  );

  if (!createResponse.ok) {
    throw new Error(`TTS create request returned HTTP ${createResponse.status}.`);
  }

  const createContentType = createResponse.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (AUDIO_CONTENT_TYPES.has(createContentType)) {
    const audio = await readProviderAudio(createResponse);
    if (!audio) throw new Error("Invalid provider audio.");
    return audio;
  }

  const createPayload = await readProviderJson(createResponse);
  const uuid = typeof createPayload?.uuid === "string"
    ? createPayload.uuid.trim()
    : "";
  if (!UUID_PATTERN.test(uuid)) {
    throw new Error("Invalid provider job.");
  }

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      const remaining = deadline - now();
      if (remaining <= POLL_DELAY_MS) break;
      await sleep(POLL_DELAY_MS);
    }

    const pollUrl = new URL(TTS_AI_RESULTS_URL);
    pollUrl.searchParams.set("uuid", uuid);
    const pollResponse = await fetchWithTimeout(
      fetchImpl,
      pollUrl,
      {
        method: "GET",
        headers: { accept: "application/json" },
        redirect: "manual",
      },
      remainingTimeout(),
      requestSignal
    );
    if (!pollResponse.ok) {
      throw new Error(`TTS status request returned HTTP ${pollResponse.status}.`);
    }
    const pollPayload = await readProviderJson(pollResponse);
    if (!pollPayload) throw new Error("Invalid provider status.");

    const status = String(pollPayload.status || "").trim().toLowerCase();
    if (status === "completed") {
      const resultUrl = validateResultUrl(pollPayload.result_url);
      if (!resultUrl) throw new Error("Invalid provider result URL.");

      const audioResponse = await fetchWithTimeout(
        fetchImpl,
        resultUrl,
        {
          method: "GET",
          headers: { accept: "audio/*" },
          redirect: "manual",
        },
        remainingTimeout(),
        requestSignal
      );
      if (!audioResponse.ok) {
        throw new Error(`TTS audio request returned HTTP ${audioResponse.status}.`);
      }
      const audio = await readProviderAudio(audioResponse);
      if (!audio) throw new Error("Invalid provider result audio.");
      return audio;
    }

    if (!PENDING_JOB_STATUSES.has(status)) {
      throw new Error("Provider job failed.");
    }
  }

  throw new Error("Provider job timed out.");
}

export async function onRequestPost(context) {
  const requestUrl = new URL(context.request.url);
  const origin = context.request.headers.get("origin");
  if (origin !== requestUrl.origin) {
    return noStoreError(403, "Same-origin speech requests are required.");
  }

  const parsedBody = await readLimitedRequestJson(context.request);
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

  let speechSetting;
  try {
    speechSetting = await getSpeechSetting(context.env.DB);
  } catch {
    return noStoreError(503, "Pronunciation is temporarily unavailable.");
  }
  if (!speechSetting.enabled) {
    return noStoreError(404, "Pronunciation is disabled.", {
      "x-speech-disabled": "true",
    });
  }

  const voiceConfig = resolveSpeechVoice(speechSetting.voiceId);
  if (!voiceConfig) {
    return noStoreError(503, "Pronunciation is temporarily unavailable.");
  }

  let story;
  try {
    story = await getStoryById(context.env.DB, storyId);
  } catch {
    return noStoreError(503, "Pronunciation is temporarily unavailable.");
  }

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
            "tts-ai",
            "HIT",
            voiceConfig.id
          );
        }
      }
    } catch {
      cacheRequest = null;
    }
  }

  const dailyLimit = getDailyCharacterLimit(context.env);
  if (!dailyLimit) {
    return noStoreError(503, "Pronunciation is temporarily unavailable.");
  }

  try {
    const rateLimitResult = await checkRateLimit(context.env);
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

  try {
    const quotaAvailable = await reserveDailySpeechQuota(
      context.env,
      canonicalWord.length,
      dailyLimit
    );
    if (!quotaAvailable) {
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

  let providerAudio;
  try {
    providerAudio = await fetchTtsAiAudio(context, canonicalWord, voiceConfig);
  } catch (providerError) {
    const providerErrorMessage = providerError instanceof Error
      ? providerError.message
      : "Unknown provider error.";
    console.error(JSON.stringify({
      message: "speech_provider_failed",
      provider: "tts-ai",
      model: voiceConfig.providerModel,
      voice: voiceConfig.id,
      error: providerErrorMessage,
    }));
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
    "tts-ai",
    "MISS",
    voiceConfig.id
  );
}
