import { requirePermission } from "../../../_shared/auth.js";
import { normalizeSuggestionRow } from "../../../_shared/dictionary-workflow.js";
import { error, json, readLimitedJson } from "../../../_shared/http.js";
import { getSuggestion, requireSameOrigin } from "./_shared.js";

const MAX_REQUEST_BYTES = 2048;

async function readReviewNote(request) {
  const parsed = await readLimitedJson(request, MAX_REQUEST_BYTES);
  if (!parsed.ok) return parsed;
  if (
    !parsed.value
    || typeof parsed.value !== "object"
    || Array.isArray(parsed.value)
    || Object.keys(parsed.value).some((key) => key !== "note")
  ) {
    return { ok: false, status: 400, message: "Only a review note may be provided." };
  }
  const note = String(parsed.value.note || "").trim();
  if (note.length > 500) {
    return { ok: false, status: 400, message: "Review note must not exceed 500 characters." };
  }
  return { ok: true, note };
}

export async function reviewSuggestion(context, decision) {
  const auth = await requirePermission(context, "dictionary_approve");
  if (!auth.ok) return auth.response;
  const originError = requireSameOrigin(context.request);
  if (originError) return originError;

  const suggestionId = Number(context.params.id);
  if (!Number.isSafeInteger(suggestionId) || suggestionId < 1) {
    return error(400, "Invalid dictionary suggestion ID.");
  }
  const noteResult = await readReviewNote(context.request);
  if (!noteResult.ok) return error(noteResult.status, noteResult.message);

  const suggestion = await getSuggestion(context.env.DB, suggestionId);
  if (!suggestion) return error(404, "Dictionary suggestion not found.");
  if (suggestion.status !== "pending") return error(409, "This suggestion has already been reviewed.");

  const now = new Date().toISOString();
  if (decision === "rejected") {
    await context.env.DB.prepare(`
      UPDATE dictionary_suggestions
      SET status = 'rejected', reviewed_by_user_id = ?1,
          reviewed_by_email = ?2, reviewed_at = ?3, review_note = ?4
      WHERE id = ?5 AND status = 'pending'
    `).bind(
      auth.session.userId,
      auth.session.email,
      now,
      noteResult.note || null,
      suggestionId
    ).run();
    return json({ suggestion: { ...normalizeSuggestionRow(suggestion), status: "rejected" } });
  }

  const lexemeId = `curated-lexeme-${suggestionId}`;
  const senseId = `curated-sense-${suggestionId}`;
  await context.env.DB.batch([
    context.env.DB.prepare(`
      INSERT INTO dictionary_lexemes (
        id, source_language, lemma, normalized_lemma, part_of_speech,
        source_entry_id, source_id, review_status
      ) VALUES (?1, 'uk', ?2, ?3, ?4, ?5, 'readukrainian-curated', 'approved')
    `).bind(
      lexemeId,
      suggestion.lemma,
      suggestion.normalizedLemma,
      suggestion.partOfSpeech,
      `curated-suggestion-${suggestionId}`
    ),
    context.env.DB.prepare(`
      INSERT INTO dictionary_forms (
        lexeme_id, source_language, normalized_form, display_form, tags_json
      ) VALUES (?1, 'uk', ?2, ?3, ?4)
    `).bind(lexemeId, suggestion.normalizedForm, suggestion.displayForm, suggestion.tagsJson),
    context.env.DB.prepare(`
      INSERT INTO dictionary_senses (
        id, lexeme_id, sense_order, usage_tags_json
      ) VALUES (?1, ?2, 1, '[]')
    `).bind(senseId, lexemeId),
    context.env.DB.prepare(`
      INSERT INTO dictionary_translations (
        sense_id, target_language, translation, translation_order,
        source_id, review_status
      ) VALUES (?1, ?2, ?3, 1, 'readukrainian-curated', 'approved')
    `).bind(senseId, suggestion.targetLanguage, suggestion.translation),
    context.env.DB.prepare(`
      UPDATE dictionary_suggestions
      SET status = 'approved', reviewed_by_user_id = ?1,
          reviewed_by_email = ?2, reviewed_at = ?3, review_note = ?4
      WHERE id = ?5 AND status = 'pending'
    `).bind(
      auth.session.userId,
      auth.session.email,
      now,
      noteResult.note || null,
      suggestionId
    ),
  ]);

  return json({ suggestion: { ...normalizeSuggestionRow(suggestion), status: "approved" } });
}
