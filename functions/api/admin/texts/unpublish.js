import { requirePermission } from "../../../_shared/auth.js";
import { error, json } from "../../../_shared/http.js";
import { EditConflictError, unpublishText } from "../../../_shared/texts.js";
import { requireEditorOrigin } from "./_request.js";

export async function onRequestPost(context) {
  const auth = await requirePermission(context, "publish");
  if (!auth.ok) return auth.response;
  const originError = requireEditorOrigin(context.request);
  if (originError) return originError;

  const storyId = Number(context.params.id);
  if (!Number.isInteger(storyId)) return error(400, "Invalid story ID.");

  let story;
  try {
    story = await unpublishText(context.env.DB, storyId, auth.session);
  } catch (unpublishError) {
    if (unpublishError instanceof EditConflictError) return error(409, unpublishError.message);
    throw unpublishError;
  }
  if (!story) return error(404, "Story not found.");

  return json({ story });
}
