import { json } from "../_shared/http.js";
import { groupStories, listStorySummaries } from "../_shared/texts.js";

export async function onRequestGet(context) {
  const stories = await listStorySummaries(context.env.DB);
  return json({ levels: groupStories(stories) });
}
