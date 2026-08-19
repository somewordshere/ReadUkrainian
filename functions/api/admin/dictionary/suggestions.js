import { requirePermission } from "../../../_shared/auth.js";
import {
  normalizeSuggestionRow,
  validateDictionarySuggestion,
} from "../../../_shared/dictionary-workflow.js";
import { error, json, readLimitedJson } from "../../../_shared/http.js";
import { requireSameOrigin } from "./_shared.js";

const MAX_REQUEST_BYTES = 4096;

export async function onRequestGet(context) {
  const auth = await requirePermission(context, "dictionary_approve");
  if (!auth.ok) return auth.response;

  const result = await context.env.DB.prepare(`
    SELECT
      id AS suggestionId,
      target_language AS targetLanguage,
      display_form AS displayForm,
      lemma,
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
    WHERE status = 'pending'
    ORDER BY suggested_at ASC, id ASC
    LIMIT 200
  `).all();

  return json({ suggestions: (result.results || []).map(normalizeSuggestionRow) });
}

export async function onRequestPost(context) {
  const auth = await requirePermission(context, "dictionary_suggest");
  if (!auth.ok) return auth.response;

  const originError = requireSameOrigin(context.request);
  if (originError) return originError;

  const parsed = await readLimitedJson(context.request, MAX_REQUEST_BYTES);
  if (!parsed.ok) return error(parsed.status, parsed.message);
  const validation = validateDictionarySuggestion(parsed.value);
  if (!validation.ok) return error(400, validation.message);
  const suggestion = validation.value;

  const existing = await context.env.DB.prepare(`
    SELECT id
    FROM dictionary_suggestions
    WHERE source_language = 'uk'
      AND normalized_form = ?1
      AND target_language = ?2
      AND status = 'pending'
    LIMIT 1
  `).bind(suggestion.normalizedForm, suggestion.targetLanguage).first();
  if (existing) return error(409, "A pending suggestion already exists for this word.");

  const now = new Date().toISOString();
  const result = await context.env.DB.prepare(`
    INSERT INTO dictionary_suggestions (
      source_language, target_language, display_form, normalized_form,
      lemma, normalized_lemma, part_of_speech, tags_json,
      translation, explanation, status,
      suggested_by_user_id, suggested_by_email, suggested_at
    ) VALUES ('uk', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', ?10, ?11, ?12)
  `).bind(
    suggestion.targetLanguage,
    suggestion.displayForm,
    suggestion.normalizedForm,
    suggestion.lemma,
    suggestion.normalizedLemma,
    suggestion.partOfSpeech,
    JSON.stringify(suggestion.tags),
    suggestion.translation,
    suggestion.explanation || null,
    auth.session.userId,
    auth.session.email,
    now
  ).run();

  return json({ suggestionId: Number(result.meta.last_row_id), status: "pending" }, { status: 201 });
}
