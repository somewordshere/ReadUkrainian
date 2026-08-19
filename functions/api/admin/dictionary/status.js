import { requirePermission } from "../../../_shared/auth.js";
import { json } from "../../../_shared/http.js";

export async function onRequestGet(context) {
  const auth = await requirePermission(context, "dictionary_suggest");
  if (!auth.ok) return auth.response;

  const [pair, pending] = await Promise.all([
    context.env.DB.prepare(`
      SELECT
        source_language AS sourceLanguage,
        target_language AS targetLanguage,
        source_name AS sourceName,
        source_url AS sourceUrl,
        source_revision AS currentRevision,
        available_revision AS availableRevision,
        last_checked_at AS lastCheckedAt
      FROM dictionary_language_pairs
      WHERE source_language = 'uk' AND target_language = 'en'
      LIMIT 1
    `).first(),
    context.env.DB.prepare(`
      SELECT COUNT(*) AS pendingCount
      FROM dictionary_suggestions
      WHERE status = 'pending'
    `).first(),
  ]);

  return json({
    dictionary: pair || null,
    pendingSuggestions: Number(pending?.pendingCount || 0),
  });
}
