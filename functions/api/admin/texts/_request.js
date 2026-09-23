import { error, readLimitedJson, requireSameOrigin } from "../../../_shared/http.js";

// A story with its quiz is a few kilobytes; this leaves ample room while
// keeping one request from holding megabytes in the Worker.
const MAX_STORY_REQUEST_BYTES = 256 * 1024;

export function requireEditorOrigin(request) {
  return requireSameOrigin(request, "Same-origin editor requests are required.");
}

// Same-origin check, then a size-limited JSON body. Returns { response } to
// send back, or { payload }.
export async function readEditorJson(request) {
  const originError = requireEditorOrigin(request);
  if (originError) return { response: originError };

  const parsed = await readLimitedJson(request, MAX_STORY_REQUEST_BYTES);
  if (!parsed.ok) return { response: error(parsed.status, parsed.message) };
  return { payload: parsed.value };
}
