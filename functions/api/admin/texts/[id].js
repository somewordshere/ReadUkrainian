import { requirePermission } from "../../../_shared/auth.js";
import { error, json } from "../../../_shared/http.js";
import {
  EditConflictError,
  getAdminStoryById,
  saveTextDraft,
  validateTextPayload,
} from "../../../_shared/texts.js";
import { baseVersionOf, readEditorJson } from "./_request.js";

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

  let story;
  try {
    story = await saveTextDraft(
      context.env.DB,
      storyId,
      validation.value,
      auth.session,
      baseVersionOf(body.payload)
    );
  } catch (saveError) {
    if (saveError instanceof EditConflictError) return error(409, saveError.message);
    throw saveError;
  }
  if (!story) {
    return error(404, "Story not found.");
  }

  return json({ story });
}
