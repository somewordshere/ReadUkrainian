// Learner reports of wrong or missing translations (see functions/api/dictionary/report.js).
import { requirePermission } from "../../../_shared/auth.js";
import { error, json, readLimitedJson } from "../../../_shared/http.js";
import { requireSameOrigin } from "./_shared.js";

const MAX_OPEN_REPORTS = 100;
const RESOLUTIONS = new Set(["fixed", "dismissed"]);

function toReport(row) {
  let shown = [];
  try {
    shown = JSON.parse(row.shownJson);
  } catch {
    shown = [];
  }
  return {
    reportId: row.id,
    word: row.word,
    targetLanguage: row.targetLanguage,
    storyId: row.storyId,
    storyTitle: row.storyTitle,
    shown,
    reports: row.reports,
    firstReportedAt: row.createdAt,
    lastReportedAt: row.lastReportedAt,
  };
}

export async function onRequestGet(context) {
  const auth = await requirePermission(context, "dictionary_approve");
  if (!auth.ok) return auth.response;

  const { results } = await context.env.DB.prepare(`
    SELECT report.id, report.normalized_word AS word, report.target_language AS targetLanguage,
      report.story_id AS storyId, story.title AS storyTitle, report.shown_json AS shownJson,
      report.reports, report.created_at AS createdAt, report.last_reported_at AS lastReportedAt
    FROM dictionary_reports AS report
    LEFT JOIN texts AS story ON story.id = report.story_id
    WHERE report.status = 'open'
    ORDER BY report.reports DESC, report.last_reported_at DESC
    LIMIT ?1
  `).bind(MAX_OPEN_REPORTS).all();

  return json({ reports: (results || []).map(toReport) }, { headers: { "cache-control": "no-store" } });
}

export async function onResolvePost(context) {
  const auth = await requirePermission(context, "dictionary_approve");
  if (!auth.ok) return auth.response;
  const originError = requireSameOrigin(context.request);
  if (originError) return originError;

  const reportId = Number(context.params.id);
  if (!Number.isSafeInteger(reportId) || reportId < 1) {
    return error(400, "Invalid report ID.");
  }

  const parsed = await readLimitedJson(context.request, 256);
  if (!parsed.ok) return error(parsed.status, parsed.message);
  const status = parsed.value?.status;
  if (Object.keys(parsed.value || {}).length !== 1 || !RESOLUTIONS.has(status)) {
    return error(400, "The request body must contain only status: fixed or dismissed.");
  }

  const result = await context.env.DB.prepare(`
    UPDATE dictionary_reports
    SET status = ?1, resolved_at = CURRENT_TIMESTAMP, resolved_by_email = ?2
    WHERE id = ?3 AND status = 'open'
  `).bind(status, auth.session.email, reportId).run();

  if (!result?.meta?.changes) {
    return error(409, "This report was already resolved or does not exist.");
  }
  return json({ reportId, status });
}
