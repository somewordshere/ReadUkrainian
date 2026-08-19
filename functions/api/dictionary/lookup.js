import { lookupDictionaryWord } from "../../_shared/dictionary.js";
import { error, json, readLimitedJson } from "../../_shared/http.js";

const MAX_REQUEST_BYTES = 1024;
const MAX_WORD_CHARACTERS = 80;
const SOURCE_LANGUAGE = "uk";
const NO_STORE_HEADERS = Object.freeze({ "cache-control": "no-store" });

function noStoreError(status, message) {
  return error(status, message, { headers: NO_STORE_HEADERS });
}

function isSameOrigin(request) {
  const origin = request.headers.get("origin");
  return Boolean(origin) && origin === new URL(request.url).origin;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, message: "The request body must contain text, targetLanguage, and optionally storyId." };
  }

  const keys = Object.keys(payload);
  const allowedKeys = new Set(["text", "targetLanguage", "storyId"]);
  if (
    keys.length < 2
    || keys.length > 3
    || keys.some((key) => !allowedKeys.has(key))
    || !Object.hasOwn(payload, "text")
    || !Object.hasOwn(payload, "targetLanguage")
    || typeof payload.text !== "string"
    || typeof payload.targetLanguage !== "string"
  ) {
    return { ok: false, message: "The request body must contain only text and targetLanguage." };
  }

  if (!payload.text.trim() || payload.text.length > MAX_WORD_CHARACTERS) {
    return { ok: false, status: 422, message: "Select one Ukrainian word of up to 80 characters." };
  }

  const targetLanguage = payload.targetLanguage.trim().toLowerCase();
  if (!/^[a-z]{2}$/u.test(targetLanguage)) {
    return { ok: false, message: "targetLanguage must be a two-letter language code." };
  }

  let storyId = null;
  if (Object.hasOwn(payload, "storyId")) {
    storyId = Number(payload.storyId);
    if (!Number.isSafeInteger(storyId) || storyId < 1) {
      return { ok: false, message: "storyId must be a positive integer." };
    }
  }

  return { ok: true, text: payload.text, targetLanguage, storyId };
}

export async function onRequestPost(context) {
  if (!isSameOrigin(context.request)) {
    return noStoreError(403, "Same-origin dictionary requests are required.");
  }

  const parsed = await readLimitedJson(context.request, MAX_REQUEST_BYTES);
  if (!parsed.ok) {
    return noStoreError(parsed.status, parsed.message);
  }

  const validation = validatePayload(parsed.value);
  if (!validation.ok) {
    return noStoreError(validation.status || 400, validation.message);
  }

  let result;
  try {
    result = await lookupDictionaryWord(context.env.DB, {
      text: validation.text,
      sourceLanguage: SOURCE_LANGUAGE,
      targetLanguage: validation.targetLanguage,
      storyId: validation.storyId,
    });
  } catch (lookupError) {
    if (lookupError instanceof TypeError) {
      return noStoreError(422, lookupError.message);
    }

    console.error(JSON.stringify({
      message: "dictionary_lookup_failed",
      sourceLanguage: SOURCE_LANGUAGE,
      targetLanguage: validation.targetLanguage,
      ...(validation.storyId ? { storyId: validation.storyId } : {}),
      error: lookupError instanceof Error ? lookupError.message : String(lookupError),
    }));
    return noStoreError(503, "The dictionary is temporarily unavailable.");
  }

  if (!result.supported) {
    return noStoreError(400, "This dictionary language pair is not available.");
  }

  return json({
    query: {
      text: result.normalizedWord,
      sourceLanguage: SOURCE_LANGUAGE,
      targetLanguage: validation.targetLanguage,
    },
    entries: result.entries,
    attribution: result.attribution,
    attributions: result.attributions,
  }, { headers: NO_STORE_HEADERS });
}
