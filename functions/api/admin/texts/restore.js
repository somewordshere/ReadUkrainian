import { requirePermission } from "../../../_shared/auth.js";
import { error, json } from "../../../_shared/http.js";
import { restoreTextRevision } from "../../../_shared/texts.js";

export async function onRequestPost(context) {
  const auth = await requirePermission(context, "restore");
  if (!auth.ok) return auth.response;

  const storyId = Number(context.params.id);
  const revisionId = Number(context.params.revisionId);

  if (!Number.isInteger(storyId) || !Number.isInteger(revisionId)) {
    return error(400, "Invalid story or revision ID.");
  }

  try {
    const story = await restoreTextRevision(
      context.env.DB,
      storyId,
      revisionId,
      auth.session
    );

    if (!story) return error(404, "Story or revision not found.");
    return json({ story });
  } catch (caughtError) {
    return error(409, caughtError.message || "The revision could not be restored.");
  }
}
