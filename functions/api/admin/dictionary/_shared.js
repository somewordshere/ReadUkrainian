import { error } from "../../../_shared/http.js";

export function requireSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return error(403, "Same-origin dictionary administration requests are required.");
  }
  return null;
}

export async function getSuggestion(db, suggestionId) {
  return db.prepare(`
    SELECT
      id AS suggestionId,
      source_language AS sourceLanguage,
      target_language AS targetLanguage,
      display_form AS displayForm,
      normalized_form AS normalizedForm,
      lemma,
      normalized_lemma AS normalizedLemma,
      part_of_speech AS partOfSpeech,
      tags_json AS tagsJson,
      translation,
      explanation,
      status,
      suggested_by_email AS suggestedByEmail,
      suggested_at AS suggestedAt,
      reviewed_by_email AS reviewedByEmail,
      reviewed_at AS reviewedAt,
      review_note AS reviewNote
    FROM dictionary_suggestions
    WHERE id = ?1
    LIMIT 1
  `).bind(suggestionId).first();
}
