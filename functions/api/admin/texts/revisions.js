import { requirePermission } from "../../../_shared/auth.js";
import { error, json } from "../../../_shared/http.js";
import { getAdminStoryById, listTextRevisions } from "../../../_shared/texts.js";

export async function onRequestGet(context) {
  const auth = await requirePermission(context, "read");
  if (!auth.ok) return auth.response;

  const storyId = Number(context.params.id);
  if (!Number.isInteger(storyId)) return error(400, "Invalid story ID.");

  const story = await getAdminStoryById(context.env.DB, storyId);
  if (!story) return error(404, "Story not found.");

  const revisions = await listTextRevisions(context.env.DB, storyId);
  return json({ revisions });
}
