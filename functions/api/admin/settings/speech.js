import { requirePermission } from "../../../_shared/auth.js";
import {
  GOOGLE_TTS_ENDPOINT,
  GOOGLE_VOICES_ENDPOINT,
  decodeGoogleAudio,
  getGoogleApiKey,
  googleSpeechRequestInit,
  googleVoicesRequestInit,
} from "../../../_shared/google-speech.js";
import {
  edgeCache,
  json,
  noStoreError,
  readLimitedJson,
  requireSameOrigin,
  runInBackground,
} from "../../../_shared/http.js";
import {
  readSpeechBudgetUsage,
  releaseSpeechBudget,
  reserveSpeechBudget,
  speechBudgetLimits,
  speechBudgetPeriod,
} from "../../../_shared/speech-budget.js";
import {
  getSpeechSetting,
  listEnabledSpeechVoiceIds,
  saveSpeechSetting,
  saveSpeechVoiceOption,
} from "../../../_shared/speech-settings.js";
import {
  compareSpeechVoices,
  resolveSpeechVoice,
} from "../../../_shared/speech-voices.js";

const MAX_REQUEST_BYTES = 1024;
const MAX_PREVIEW_CHARACTERS = 200;
const GOOGLE_TIMEOUT_MS = 8_000;
const NO_STORE_HEADERS = Object.freeze({ "cache-control": "no-store" });
const GENDERS = Object.freeze({ FEMALE: "female", MALE: "male" });
// Google's Ukrainian voice list changes a few times a year; one call a day
// keeps every settings load and toggle from waiting on it.
const VOICE_CATALOG_CACHE_SECONDS = 24 * 60 * 60;

function hasExactKeys(payload, keys) {
  return Boolean(payload)
    && typeof payload === "object"
    && !Array.isArray(payload)
    && Object.keys(payload).length === keys.length
    && keys.every((key) => Object.hasOwn(payload, key));
}

function validateVoiceToggle(payload) {
  if (
    !hasExactKeys(payload, ["voiceId", "enabled"])
    || typeof payload.voiceId !== "string"
    || typeof payload.enabled !== "boolean"
  ) {
    return { ok: false, message: "The request body must contain only voiceId and enabled." };
  }

  const voice = resolveSpeechVoice(payload.voiceId);

  if (!voice) {
    return { ok: false, message: "Unsupported speech voice." };
  }

  return { ok: true, voiceId: voice.id, enabled: payload.enabled };
}

function googleFetch(context, url, init) {
  const fetchImpl = context.fetch || globalThis.fetch;
  return fetchImpl(url, { ...init, signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) });
}

function voiceCatalogCacheKey(requestUrl) {
  return new Request(new URL("/__admin-cache/google-voices/uk-UA", requestUrl), { method: "GET" });
}

async function readCachedVoiceCatalog(cache, cacheKey) {
  try {
    const cached = await cache.match(cacheKey);
    const catalog = cached ? await cached.json() : null;
    return Array.isArray(catalog) ? catalog : null;
  } catch {
    return null;
  }
}

// Every Ukrainian voice Google offers, as [{ id, gender }], cached for a day.
async function fetchVoiceCatalog(context) {
  const cache = edgeCache(context);
  const cacheKey = cache ? voiceCatalogCacheKey(context.request.url) : null;
  const cached = cache ? await readCachedVoiceCatalog(cache, cacheKey) : null;
  if (cached) return cached;

  const key = getGoogleApiKey(context.env);
  if (!key) throw new Error("GOOGLE_TTS_API_KEY is not configured.");

  const response = await googleFetch(context, GOOGLE_VOICES_ENDPOINT, googleVoicesRequestInit({ key }));
  if (!response.ok) throw new Error(`Google returned HTTP ${response.status}.`);

  const payload = await response.json();
  const catalog = (Array.isArray(payload?.voices) ? payload.voices : [])
    .filter((voice) => resolveSpeechVoice(voice?.name))
    .map((voice) => ({ id: voice.name, gender: GENDERS[voice.ssmlGender] || null }));

  if (cache && catalog.length) {
    const stored = Response.json(catalog, {
      headers: { "cache-control": `public, max-age=${VOICE_CATALOG_CACHE_SECONDS}` },
    });
    await runInBackground(context, cache.put(cacheKey, stored).catch(() => undefined));
  }
  return catalog;
}

// How much of the day's and month's Google budget is spent, for the admin.
async function readBudget(context) {
  const limits = speechBudgetLimits(context.env);
  if (!limits) return null;
  const usage = await readSpeechBudgetUsage(context.env.DB, speechBudgetPeriod());
  return {
    today: { used: usage.today, limit: limits.daily },
    month: { used: usage.month, limit: limits.monthly },
  };
}

async function buildResponse(context, setting) {
  const [enabledIds, budget] = await Promise.all([
    listEnabledSpeechVoiceIds(context.env.DB),
    readBudget(context).catch(() => null),
  ]);
  enabledIds.add(setting.voiceId);

  let catalog = [];
  let catalogError = null;
  try {
    catalog = await fetchVoiceCatalog(context);
  } catch (catalogFailure) {
    catalogError = `Could not load Google's voice list: ${catalogFailure.message}`;
  }

  // Keep shortlisted voices visible even if Google's list is unavailable.
  const genders = new Map(catalog.map((voice) => [voice.id, voice.gender]));
  const ids = new Set([...catalog.map((voice) => voice.id), ...enabledIds]);
  const voices = [...ids]
    .map((id) => resolveSpeechVoice(id))
    .filter(Boolean)
    .sort(compareSpeechVoices)
    .map((voice) => ({
      id: voice.id,
      label: voice.label,
      family: voice.family,
      gender: genders.get(voice.id) || null,
      enabled: enabledIds.has(voice.id),
      site: voice.id === setting.voiceId,
    }));

  return { setting, voices, catalogError, budget };
}

async function readAdminJson(context) {
  const auth = await requirePermission(context, "settings");

  if (!auth.ok) {
    return { response: auth.response };
  }

  const originError = requireSameOrigin(context.request, "Same-origin settings requests are required.");
  if (originError) {
    return { response: originError };
  }

  const parsed = await readLimitedJson(context.request, MAX_REQUEST_BYTES);

  if (!parsed.ok) {
    return { response: noStoreError(parsed.status, parsed.message) };
  }

  return { auth, payload: parsed.value };
}

export async function onRequestGet(context) {
  const auth = await requirePermission(context, "settings");

  if (!auth.ok) {
    return auth.response;
  }

  const setting = await getSpeechSetting(context.env.DB);
  return json(await buildResponse(context, setting), { headers: NO_STORE_HEADERS });
}

// Sets the site voice and whether learners hear pronunciation at all.
export async function onRequestPut(context) {
  const request = await readAdminJson(context);
  if (request.response) return request.response;

  const validation = validateVoiceToggle(request.payload);

  if (!validation.ok) {
    return noStoreError(400, validation.message);
  }

  const [current, enabledIds] = await Promise.all([
    getSpeechSetting(context.env.DB),
    listEnabledSpeechVoiceIds(context.env.DB),
  ]);
  if (validation.voiceId !== current.voiceId && !enabledIds.has(validation.voiceId)) {
    return noStoreError(409, "Enable the voice before making it the site voice.");
  }

  const setting = await saveSpeechSetting(
    context.env.DB,
    { voiceId: validation.voiceId, enabled: validation.enabled },
    request.auth.session
  );

  return json(await buildResponse(context, setting), { headers: NO_STORE_HEADERS });
}

// Adds a voice to, or removes it from, the shortlist.
export async function onVoiceOptionPut(context) {
  const request = await readAdminJson(context);
  if (request.response) return request.response;

  const validation = validateVoiceToggle(request.payload);

  if (!validation.ok) {
    return noStoreError(400, validation.message);
  }

  const setting = await getSpeechSetting(context.env.DB);
  if (!validation.enabled && validation.voiceId === setting.voiceId) {
    return noStoreError(409, "This is the site voice. Choose another site voice before disabling it.");
  }

  await saveSpeechVoiceOption(context.env.DB, validation, request.auth.session);
  return json(await buildResponse(context, setting), { headers: NO_STORE_HEADERS });
}

// Speaks any short text in any Ukrainian voice, so the admin can audition voices.
export async function onPreviewPost(context) {
  const request = await readAdminJson(context);
  if (request.response) return request.response;

  const payload = request.payload;
  if (!hasExactKeys(payload, ["voiceId", "text"]) || typeof payload.text !== "string") {
    return noStoreError(400, "The request body must contain only voiceId and text.");
  }

  const voice = resolveSpeechVoice(payload.voiceId);
  const text = payload.text.trim();

  if (!voice) {
    return noStoreError(400, "Unsupported speech voice.");
  }
  if (!text || text.length > MAX_PREVIEW_CHARACTERS) {
    return noStoreError(400, `Preview text must be 1 to ${MAX_PREVIEW_CHARACTERS} characters.`);
  }

  const key = getGoogleApiKey(context.env);
  if (!key) {
    return noStoreError(503, "GOOGLE_TTS_API_KEY is not configured.");
  }

  // Previews are paid Google calls too, so they draw on the same budget as
  // learners' pronunciation and can never push the site past it.
  const limits = speechBudgetLimits(context.env);
  if (!limits) {
    return noStoreError(503, "The speech budget is not configured.");
  }
  const period = speechBudgetPeriod();
  const refusedLimit = await reserveSpeechBudget(context.env.DB, period, text.length, limits);
  if (refusedLimit) {
    return noStoreError(
      429,
      refusedLimit === "monthly"
        ? "This month's speech budget is used up, so previews are paused until next month."
        : "Today's speech budget is used up, so previews are paused until tomorrow (UTC)."
    );
  }

  let bytes = null;
  try {
    const response = await googleFetch(context, GOOGLE_TTS_ENDPOINT, googleSpeechRequestInit({ key, text, voice }));
    if (response.ok) bytes = decodeGoogleAudio(await response.json());
  } catch {
    bytes = null;
  }

  if (!bytes) {
    await runInBackground(context, releaseSpeechBudget(context.env.DB, period, text.length).catch(() => undefined));
    return noStoreError(502, "Google could not speak this text.");
  }

  return new Response(bytes, {
    headers: {
      ...NO_STORE_HEADERS,
      "content-type": "audio/mpeg",
      "x-content-type-options": "nosniff",
    },
  });
}
