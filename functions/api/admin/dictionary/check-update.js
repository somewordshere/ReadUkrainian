import { requirePermission } from "../../../_shared/auth.js";
import { error, json } from "../../../_shared/http.js";
import { requireSameOrigin } from "./_shared.js";

const KAIKKI_UKRAINIAN_URL = "https://kaikki.org/dictionary/Ukrainian/";
const MAX_SOURCE_PAGE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 8000;

async function readLimitedText(response, maximumBytes) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error("The upstream version page is too large.");
  }

  if (!response.body) throw new Error("The upstream version page is empty.");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error("The upstream version page is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function onRequestPost(context) {
  const auth = await requirePermission(context, "settings");
  if (!auth.ok) return auth.response;

  const originError = requireSameOrigin(context.request);
  if (originError) return originError;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let page;
  try {
    const response = await fetch(KAIKKI_UKRAINIAN_URL, {
      headers: { accept: "text/html" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Upstream returned HTTP ${response.status}.`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("text/html")) {
      throw new Error("Upstream returned an unexpected content type.");
    }
    page = await readLimitedText(response, MAX_SOURCE_PAGE_BYTES);
  } catch (checkError) {
    console.error(JSON.stringify({
      message: "dictionary_update_check_failed",
      source: "kaikki-ukrainian",
      error: checkError instanceof Error ? checkError.message : String(checkError),
    }));
    return error(502, "Could not check the dictionary source for updates.");
  } finally {
    clearTimeout(timeout);
  }

  const availableRevision = page.match(/enwiktionary dump dated\s+(\d{4}-\d{2}-\d{2})/iu)?.[1];
  if (!availableRevision) {
    return error(502, "The dictionary source did not report a recognizable version.");
  }

  const checkedAt = new Date().toISOString();
  await context.env.DB.prepare(`
    UPDATE dictionary_language_pairs
    SET available_revision = ?1,
        last_checked_at = ?2
    WHERE source_language = 'uk' AND target_language = 'en'
  `).bind(availableRevision, checkedAt).run();

  const pair = await context.env.DB.prepare(`
    SELECT source_revision AS currentRevision
    FROM dictionary_language_pairs
    WHERE source_language = 'uk' AND target_language = 'en'
    LIMIT 1
  `).first();

  return json({
    currentRevision: pair?.currentRevision || null,
    availableRevision,
    lastCheckedAt: checkedAt,
    updateAvailable: Boolean(pair?.currentRevision && availableRevision > pair.currentRevision),
  });
}
