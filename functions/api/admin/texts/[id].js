import { requireAdmin } from "../../../_shared/auth.js";
import { error, json, readJson } from "../../../_shared/http.js";
import { getTextById, updateText, validateTextPayload } from "../../../_shared/texts.js";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) {
    return auth.response;
  }

  const id = Number(context.params.id);

  if (!Number.isInteger(id)) {
    return error(400, "Invalid text id.");
  }

  const text = await getTextById(context.env.DB, id);

  if (!text) {
    return error(404, "Text not found.");
  }

  return json({ text });
}

export async function onRequestPut(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) {
    return auth.response;
  }

  const id = Number(context.params.id);

  if (!Number.isInteger(id)) {
    return error(400, "Invalid text id.");
  }

  const existing = await getTextById(context.env.DB, id);

  if (!existing) {
    return error(404, "Text not found.");
  }

  const payload = await readJson(context.request);
  const validation = validateTextPayload(payload, { allowLevel: false });

  if (!validation.ok) {
    return error(400, validation.message);
  }

  const text = await updateText(context.env.DB, id, validation.value);
  return json({ text });
}
