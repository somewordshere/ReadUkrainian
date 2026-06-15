import { error, json } from "../../_shared/http.js";
import { getStoryByLevelAndNumber } from "../../_shared/texts.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const level = url.searchParams.get("level");
  const storyNumber = Number(url.searchParams.get("text"));

  if (!level || !Number.isInteger(storyNumber) || storyNumber < 1) {
    return error(400, "Valid level and text number are required.");
  }

  const story = await getStoryByLevelAndNumber(context.env.DB, level, storyNumber);

  if (!story || !story.active) {
    return error(404, "Story not found.");
  }

  return json({ story });
}
