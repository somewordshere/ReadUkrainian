import { requirePermission } from "../../../_shared/auth.js";
import { error, json } from "../../../_shared/http.js";
import { RevisionDataError, restoreTextRevision } from "../../../_shared/texts.js";
import { requireEditorOrigin } from "./_request.js";

export async function onRequestPost(context) {
  const auth = await requirePermission(context, "restore");
  if (!auth.ok) return auth.response;
  const originError = requireEditorOrigin(context.request);
  if (originError) return originError;

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
    // Only a checkpoint that fails validation is the editor's to know about;
    // database errors are logged, not echoed to the browser.
    if (caughtError instanceof RevisionDataError) {
      return error(409, caughtError.message);
    }
    console.error(JSON.stringify({
      message: "admin_restore_failed",
      storyId,
      revisionId,
      error: caughtError instanceof Error ? caughtError.message : String(caughtError),
    }));
    return error(500, "The revision could not be restored.");
  }
}
