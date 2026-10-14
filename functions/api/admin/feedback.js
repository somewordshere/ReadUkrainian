// Readers' messages from the feedback form (see functions/api/feedback.js).
import { requirePermission } from "../../_shared/auth.js";
import { error, json, readLimitedJson, requireSameOrigin } from "../../_shared/http.js";

const MAX_OPEN_MESSAGES = 100;
const ACTIONS = new Set(["done", "delete"]);

function toMessage(row) {
  return {
    feedbackId: row.id,
    message: row.message,
    email: row.email,
    page: row.page,
    storyId: row.storyId,
    storyTitle: row.storyTitle,
    createdAt: row.createdAt,
  };
}

export async function onRequestGet(context) {
  const auth = await requirePermission(context, "settings");
  if (!auth.ok) return auth.response;

  const { results } = await context.env.DB.prepare(`
    SELECT feedback.id, feedback.message, feedback.email, feedback.page,
      feedback.story_id AS storyId, story.title AS storyTitle, feedback.created_at AS createdAt
    FROM feedback
    LEFT JOIN texts AS story ON story.id = feedback.story_id
    WHERE feedback.status = 'open'
    ORDER BY feedback.created_at DESC, feedback.id DESC
    LIMIT ?1
  `).bind(MAX_OPEN_MESSAGES).all();

  return json({ messages: (results || []).map(toMessage) }, { headers: { "cache-control": "no-store" } });
}

// «done» keeps the message for the record; «delete» removes it, and its email with it.
export async function onResolvePost(context) {
  const auth = await requirePermission(context, "settings");
  if (!auth.ok) return auth.response;
  const originError = requireSameOrigin(context.request);
  if (originError) return originError;

  const feedbackId = Number(context.params.id);
  if (!Number.isSafeInteger(feedbackId) || feedbackId < 1) {
    return error(400, "Invalid message ID.");
  }

  const parsed = await readLimitedJson(context.request, 256);
  if (!parsed.ok) return error(parsed.status, parsed.message);
  const action = parsed.value?.action;
  if (Object.keys(parsed.value || {}).length !== 1 || !ACTIONS.has(action)) {
    return error(400, "The request body must contain only action: done or delete.");
  }

  const result = action === "delete"
    ? await context.env.DB.prepare("DELETE FROM feedback WHERE id = ?1").bind(feedbackId).run()
    : await context.env.DB.prepare(`
        UPDATE feedback
        SET status = 'done', resolved_at = CURRENT_TIMESTAMP, resolved_by_email = ?1
        WHERE id = ?2 AND status = 'open'
      `).bind(auth.session.email, feedbackId).run();

  if (!result?.meta?.changes) {
    return error(409, "This message was already handled or does not exist.");
  }
  return json({ feedbackId, action });
}
