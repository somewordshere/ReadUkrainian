// A learner flags the translation shown for a word as wrong or missing.
// The server records what the dictionary shows for that word itself, so a report
// carries no free text and cannot be used to store arbitrary content.
import { lookupDictionaryWord } from "../../_shared/dictionary.js";
import { error, json, readLimitedJson } from "../../_shared/http.js";
import { getStoryById } from "../../_shared/texts.js";
import { canonicalizeUkrainianWord, extractUkrainianWords } from "../../_shared/ukrainian-word.js";

const MAX_REQUEST_BYTES = 1024;
const MAX_WORD_CHARACTERS = 80;
const TARGET_LANGUAGES = new Set(["en", "de"]);
// New words reported per day across the site; repeats only raise a count.
const MAX_NEW_REPORTS_PER_DAY = 200;
const NO_STORE_HEADERS = Object.freeze({ "cache-control": "no-store" });

function noStoreError(status, message, headers = {}) {
  return error(status, message, { headers: { ...NO_STORE_HEADERS, ...headers } });
}

function isSameOrigin(request) {
  const origin = request.headers.get("origin");
  return Boolean(origin) && origin === new URL(request.url).origin;
}

function validatePayload(payload) {
  const keys = payload && typeof payload === "object" && !Array.isArray(payload) ? Object.keys(payload) : [];
  if (
    keys.length !== 3
    || !["text", "targetLanguage", "storyId"].every((key) => keys.includes(key))
    || typeof payload.text !== "string"
    || typeof payload.targetLanguage !== "string"
  ) {
    return { ok: false, message: "The request body must contain only text, targetLanguage and storyId." };
  }

  const word = payload.text.length <= MAX_WORD_CHARACTERS ? canonicalizeUkrainianWord(payload.text) : null;
  if (!word) {
    return { ok: false, status: 422, message: "Select one Ukrainian word of up to 80 characters." };
  }

  const targetLanguage = payload.targetLanguage.trim().toLowerCase();
  if (!TARGET_LANGUAGES.has(targetLanguage)) {
    return { ok: false, message: "targetLanguage must be en or de." };
  }

  const storyId = Number(payload.storyId);
  if (!Number.isSafeInteger(storyId) || storyId < 1) {
    return { ok: false, message: "storyId must be a positive integer." };
  }

  return { ok: true, word, targetLanguage, storyId };
}

async function withinRateLimit(env, request) {
  if (typeof env.REPORT_RATE_LIMITER?.limit !== "function") return null;
  const client = request.headers.get("cf-connecting-ip") || "unknown";
  const result = await env.REPORT_RATE_LIMITER.limit({ key: `dictionary-report:${client}` });
  return typeof result?.success === "boolean" ? result.success : null;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) {
    return noStoreError(403, "Same-origin report requests are required.");
  }

  const parsed = await readLimitedJson(request, MAX_REQUEST_BYTES);
  if (!parsed.ok) {
    return noStoreError(parsed.status, parsed.message);
  }

  const validation = validatePayload(parsed.value);
  if (!validation.ok) {
    return noStoreError(validation.status || 400, validation.message);
  }
  const { word, targetLanguage, storyId } = validation;

  try {
    const allowed = await withinRateLimit(env, request);
    if (allowed === null) return noStoreError(503, "Reports are temporarily unavailable.");
    if (!allowed) {
      return noStoreError(429, "Too many reports. Please try again later.", { "retry-after": "60" });
    }

    const story = await getStoryById(env.DB, storyId);
    if (!story?.active || !extractUkrainianWords((story.paragraphs || []).join(" ")).includes(word)) {
      return noStoreError(404, "The word was not found in the published story.");
    }

    const existing = await env.DB
      .prepare("SELECT id FROM dictionary_reports WHERE normalized_word = ?1 AND target_language = ?2 AND status = 'open'")
      .bind(word, targetLanguage)
      .first();
    if (!existing) {
      const today = await env.DB
        .prepare("SELECT COUNT(*) AS count FROM dictionary_reports WHERE created_at >= date('now')")
        .first();
      if (Number(today?.count) >= MAX_NEW_REPORTS_PER_DAY) {
        return noStoreError(429, "The daily report limit has been reached.", { "retry-after": "3600" });
      }
    }

    const result = await lookupDictionaryWord(env.DB, { text: word, targetLanguage, storyId });
    const shown = result.entries.slice(0, 6).map((entry) => ({
      lemma: entry.lemma,
      partOfSpeech: entry.partOfSpeech,
      translations: entry.translations.slice(0, 3).map((translation) => translation.text),
    }));

    await env.DB
      .prepare(`
        INSERT INTO dictionary_reports (normalized_word, target_language, story_id, shown_json)
        VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT (normalized_word, target_language) WHERE status = 'open' DO UPDATE SET
          reports = dictionary_reports.reports + 1,
          story_id = excluded.story_id,
          shown_json = excluded.shown_json,
          last_reported_at = CURRENT_TIMESTAMP
      `)
      .bind(word, targetLanguage, storyId, JSON.stringify(shown))
      .run();
  } catch (reportError) {
    console.error(JSON.stringify({
      message: "dictionary_report_failed",
      targetLanguage,
      storyId,
      error: reportError instanceof Error ? reportError.message : String(reportError),
    }));
    return noStoreError(503, "Reports are temporarily unavailable.");
  }

  return json({ reported: true }, { status: 202, headers: NO_STORE_HEADERS });
}
