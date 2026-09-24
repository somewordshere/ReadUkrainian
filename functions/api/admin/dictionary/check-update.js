import { requirePermission } from "../../../_shared/auth.js";
import {
  declaresTooMuch,
  error,
  json,
  readLimitedBytes,
  readLimitedJson,
} from "../../../_shared/http.js";
import { requireSameOrigin } from "./_shared.js";

const MAX_SOURCE_PAGE_BYTES = 256 * 1024;
const MAX_REQUEST_BYTES = 1024;
const REQUEST_TIMEOUT_MS = 8000;

// Where each pair's upstream version is published. English Kaikki states the
// Wiktionary dump date on its Ukrainian page; the German and Polish extracts have
// no such page, so the download's Last-Modified date stands in as its version.
const SOURCES = Object.freeze({
  en: { kind: "page", url: "https://kaikki.org/dictionary/Ukrainian/" },
  de: { kind: "last-modified", url: "https://kaikki.org/dictionary/downloads/de/de-extract.jsonl.gz" },
  pl: { kind: "last-modified", url: "https://kaikki.org/dictionary/downloads/pl/pl-extract.jsonl.gz" },
});

async function readLimitedText(response, maximumBytes) {
  if (declaresTooMuch(response.headers, maximumBytes)) {
    throw new Error("The upstream version page is too large.");
  }
  const bytes = await readLimitedBytes(response.body, maximumBytes);
  if (!bytes) throw new Error("The upstream version page is empty or too large.");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function isoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

async function fetchAvailableRevision(source, signal) {
  // Workers reject redirect: "error" outright, so read redirects manually;
  // a 3xx is not ok and is refused below rather than followed.
  const response = await fetch(source.url, {
    method: source.kind === "page" ? "GET" : "HEAD",
    headers: source.kind === "page" ? { accept: "text/html" } : {},
    redirect: "manual",
    signal,
  });
  if (!response.ok) throw new Error(`Upstream returned HTTP ${response.status}.`);

  if (source.kind === "last-modified") {
    return isoDate(response.headers.get("last-modified"));
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("text/html")) {
    throw new Error("Upstream returned an unexpected content type.");
  }
  const page = await readLimitedText(response, MAX_SOURCE_PAGE_BYTES);
  return page.match(/enwiktionary dump dated\s+(\d{4}-\d{2}-\d{2})/iu)?.[1] || null;
}

export async function onRequestPost(context) {
  const auth = await requirePermission(context, "settings");
  if (!auth.ok) return auth.response;

  const originError = requireSameOrigin(context.request);
  if (originError) return originError;

  const parsed = await readLimitedJson(context.request, MAX_REQUEST_BYTES);
  if (!parsed.ok) return error(parsed.status, parsed.message);
  const targetLanguage = String(parsed.value?.targetLanguage || "en").toLowerCase();
  // Own keys only: "constructor" or "__proto__" must not resolve to a source.
  const source = Object.hasOwn(SOURCES, targetLanguage) ? SOURCES[targetLanguage] : null;
  if (!source) return error(400, "targetLanguage must be en, de or pl.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let availableRevision;
  try {
    availableRevision = await fetchAvailableRevision(source, controller.signal);
  } catch (checkError) {
    console.error(JSON.stringify({
      message: "dictionary_update_check_failed",
      source: `kaikki-${targetLanguage}`,
      error: checkError instanceof Error ? checkError.message : String(checkError),
    }));
    return error(502, "Could not check the dictionary source for updates.");
  } finally {
    clearTimeout(timeout);
  }

  if (!availableRevision) {
    return error(502, "The dictionary source did not report a recognizable version.");
  }

  const checkedAt = new Date().toISOString();
  await context.env.DB.prepare(`
    UPDATE dictionary_language_pairs
    SET available_revision = ?1,
        last_checked_at = ?2
    WHERE source_language = 'uk' AND target_language = ?3
  `).bind(availableRevision, checkedAt, targetLanguage).run();

  const pair = await context.env.DB.prepare(`
    SELECT source_revision AS currentRevision
    FROM dictionary_language_pairs
    WHERE source_language = 'uk' AND target_language = ?1
    LIMIT 1
  `).bind(targetLanguage).first();

  return json({
    targetLanguage,
    currentRevision: pair?.currentRevision || null,
    availableRevision,
    lastCheckedAt: checkedAt,
    updateAvailable: Boolean(pair?.currentRevision && availableRevision > pair.currentRevision),
  });
}
