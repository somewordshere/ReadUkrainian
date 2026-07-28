import { requirePermission } from "../../../_shared/auth.js";
import { error, json, readJson } from "../../../_shared/http.js";
import { getAdminStoryById, saveTextDraft, validateTextPayload } from "../../../_shared/texts.js";

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

  const existing = await getAdminStoryById(context.env.DB, storyId);

  if (!existing) {
    return error(404, "Story not found.");
  }

  const payload = await readJson(context.request);
  const validation = validateTextPayload(payload, { allowLevel: true });

  if (!validation.ok) {
    return error(400, validation.message);
  }

  const story = await saveTextDraft(context.env.DB, storyId, validation.value, auth.session);
  return json({ story });
}
