import { requirePermission } from "../../../_shared/auth.js";
import { error, json, readJson } from "../../../_shared/http.js";
import { createTextDraft, listAdminTextSummaries, validateTextPayload } from "../../../_shared/texts.js";

export async function onRequestGet(context) {
  const auth = await requirePermission(context, "read");
  if (!auth.ok) {
    return auth.response;
  }

  const stories = await listAdminTextSummaries(context.env.DB);
  return json({ stories });
}

export async function onRequestPost(context) {
  const auth = await requirePermission(context, "edit");
  if (!auth.ok) {
    return auth.response;
  }

  const payload = await readJson(context.request);
  const validation = validateTextPayload(payload, { allowLevel: true });

  if (!validation.ok) {
    return error(400, validation.message);
  }

  const story = await createTextDraft(context.env.DB, validation.value, auth.session);
  return json({ story }, { status: 201 });
}
