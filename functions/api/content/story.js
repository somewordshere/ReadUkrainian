import { error, json } from "../../_shared/http.js";
import { getStoryById, getStoryByLevelAndOrder } from "../../_shared/texts.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const storyIdParam = url.searchParams.get("id");
  const storyId = storyIdParam ? Number(storyIdParam) : null;
  const level = url.searchParams.get("level");
  const legacyOrderParam = url.searchParams.get("text");
  const legacyOrder = legacyOrderParam ? Number(legacyOrderParam) : null;

  if (
    (!Number.isInteger(storyId) || storyId < 1) &&
    (!level || !Number.isInteger(legacyOrder) || legacyOrder < 1)
  ) {
    return error(400, "A valid story ID is required.");
  }

  const story = Number.isInteger(storyId) && storyId > 0
    ? await getStoryById(context.env.DB, storyId)
    : await getStoryByLevelAndOrder(context.env.DB, level, legacyOrder);

  if (!story || !story.active) {
    return error(404, "Story not found.");
  }

  return json({ story });
}
