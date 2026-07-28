import { requirePermission } from "../../../_shared/auth.js";
import { error, json } from "../../../_shared/http.js";
import { unpublishText } from "../../../_shared/texts.js";

export async function onRequestPost(context) {
  const auth = await requirePermission(context, "publish");
  if (!auth.ok) return auth.response;

  const storyId = Number(context.params.id);
  if (!Number.isInteger(storyId)) return error(400, "Invalid story ID.");

  const story = await unpublishText(context.env.DB, storyId, auth.session);
  if (!story) return error(404, "Story not found.");

  return json({ story });
}
