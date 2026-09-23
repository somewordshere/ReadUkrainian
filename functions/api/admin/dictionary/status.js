import { requirePermission } from "../../../_shared/auth.js";
import { getDatabaseVersion } from "../../../_shared/database-version.js";
import { json } from "../../../_shared/http.js";

export async function onRequestGet(context) {
  const auth = await requirePermission(context, "dictionary_suggest");
  if (!auth.ok) return auth.response;

  const [pairs, pending, database] = await Promise.all([
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
      WHERE source_language = 'uk' AND target_language IN ('en', 'de')
      ORDER BY CASE target_language WHEN 'en' THEN 0 ELSE 1 END
    `).all(),
    context.env.DB.prepare(`
      SELECT COUNT(*) AS pendingCount
      FROM dictionary_suggestions
      WHERE status = 'pending'
    `).first(),
    getDatabaseVersion(context.env.DB),
  ]);

  const dictionaries = (pairs?.results || []).map((pair) => ({
    ...pair,
    migration: database?.dictionaries[pair.targetLanguage] || null,
  }));
  return json({
    database: database && { latest: database.latest, count: database.count },
    dictionaries,
    // Kept for callers that only know the English pair.
    dictionary: dictionaries.find((pair) => pair.targetLanguage === "en") || null,
    pendingSuggestions: Number(pending?.pendingCount || 0),
  });
}
