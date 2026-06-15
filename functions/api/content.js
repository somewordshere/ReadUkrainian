import { json } from "../_shared/http.js";
import { groupStories, listTexts } from "../_shared/texts.js";

export async function onRequestGet(context) {
  const stories = await listTexts(context.env.DB);
  return json({ levels: groupStories(stories) });
}
