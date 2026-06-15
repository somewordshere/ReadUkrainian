import { requireAdmin } from "../../../_shared/auth.js";
import { error, json, readJson } from "../../../_shared/http.js";
import { createText, listTexts, validateTextPayload } from "../../../_shared/texts.js";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) {
    return auth.response;
  }

  const stories = await listTexts(context.env.DB, { includeDisabled: true });
  return json({ texts: stories });
}

export async function onRequestPost(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) {
    return auth.response;
  }

  const payload = await readJson(context.request);
  const validation = validateTextPayload(payload, { allowLevel: true });

  if (!validation.ok) {
    return error(400, validation.message);
  }

  const text = await createText(context.env.DB, validation.value);
  return json({ text }, { status: 201 });
}
