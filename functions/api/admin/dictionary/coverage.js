import { requirePermission } from "../../../_shared/auth.js";
import { analyzeDictionaryCoverage } from "../../../_shared/dictionary-workflow.js";
import { error, json, readLimitedJson } from "../../../_shared/http.js";
import { requireSameOrigin } from "./_shared.js";

const MAX_REQUEST_BYTES = 128 * 1024;

export async function onRequestPost(context) {
  const auth = await requirePermission(context, "dictionary_suggest");
  if (!auth.ok) return auth.response;

  const originError = requireSameOrigin(context.request);
  if (originError) return originError;

  const parsed = await readLimitedJson(context.request, MAX_REQUEST_BYTES);
  if (!parsed.ok) return error(parsed.status, parsed.message);
  const payload = parsed.value;
  if (
    !payload
    || typeof payload !== "object"
    || Array.isArray(payload)
    || Object.keys(payload).some((key) => !["paragraphs", "targetLanguage"].includes(key))
    || !Array.isArray(payload.paragraphs)
    || payload.paragraphs.some((paragraph) => typeof paragraph !== "string")
  ) {
    return error(400, "Paragraphs and targetLanguage are required.");
  }

  const targetLanguage = String(payload.targetLanguage || "en").trim().toLowerCase();
  if (!/^[a-z]{2}$/u.test(targetLanguage)) {
    return error(400, "Target language must be a two-letter language code.");
  }

  const coverage = await analyzeDictionaryCoverage(context.env.DB, payload.paragraphs, {
    targetLanguage,
  });
  return json({ coverage });
}
