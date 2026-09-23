import { requirePermission } from "../../../_shared/auth.js";
import { error, json } from "../../../_shared/http.js";
import { getAdminStoryById, saveTextDraft, validateTextPayload } from "../../../_shared/texts.js";
import { readEditorJson } from "./_request.js";

export async function onRequestGet(context) {
  const auth = await requirePermission(context, "read");
  if (!auth.ok) {
    return auth.response;
  }

  const storyId = Number(context.params.id);

  if (!Number.isInteger(storyId)) {
    return error(400, "Invalid story ID.");
  }

  const story = await getAdminStoryById(context.env.DB, storyId);

  if (!story) {
    return error(404, "Story not found.");
  }

  return json({ story });
}

export async function onRequestPut(context) {
  const auth = await requirePermission(context, "edit");
  if (!auth.ok) {
    return auth.response;
  }

  const storyId = Number(context.params.id);

  if (!Number.isInteger(storyId)) {
    return error(400, "Invalid story ID.");
  }

  const body = await readEditorJson(context.request);
  if (body.response) return body.response;

  const validation = validateTextPayload(body.payload, { allowLevel: true });

  if (!validation.ok) {
    return error(400, validation.message);
  }

  // saveTextDraft reads the row itself and returns null for an unknown story.
  const story = await saveTextDraft(context.env.DB, storyId, validation.value, auth.session);
  if (!story) {
    return error(404, "Story not found.");
  }

  return json({ story });
}
