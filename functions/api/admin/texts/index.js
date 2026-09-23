import { requirePermission } from "../../../_shared/auth.js";
import { error, json } from "../../../_shared/http.js";
import { createTextDraft, listAdminTextSummaries, validateTextPayload } from "../../../_shared/texts.js";
import { readEditorJson } from "./_request.js";

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

  const body = await readEditorJson(context.request);
  if (body.response) return body.response;

  const validation = validateTextPayload(body.payload, { allowLevel: true });

  if (!validation.ok) {
    return error(400, validation.message);
  }

  const story = await createTextDraft(context.env.DB, validation.value, auth.session);
  return json({ story }, { status: 201 });
}
