// A reader sends a message from the feedback form on the About page. The message
// and an optional email (for a reply) are stored for the admin's Feedback card.
import {
  checkRateLimit,
  clientAddress,
  json,
  noStoreError,
  readLimitedJson,
  requireSameOrigin,
} from "../_shared/http.js";

const MAX_REQUEST_BYTES = 12 * 1024;
const MAX_MESSAGE_CHARACTERS = 2000;
const MAX_EMAIL_CHARACTERS = 254;
const MAX_PAGE_CHARACTERS = 200;
// New messages per day across the site, so a script cannot fill the table.
const MAX_MESSAGES_PER_DAY = 100;
const NO_STORE_HEADERS = Object.freeze({ "cache-control": "no-store" });
// Deliberately loose: one @, no spaces, a dot in the domain. Replies are read by a person.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const ALLOWED_KEYS = new Set(["message", "email", "page", "storyId"]);

function cleanText(value) {
  // Control characters other than line breaks and tabs have no place in a message.
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "").trim();
}

export function validateFeedback(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, message: "The request body must be a JSON object." };
  }
  if (Object.keys(payload).some((key) => !ALLOWED_KEYS.has(key))) {
    return { ok: false, message: "The request body may contain only message, email, page and storyId." };
  }

  const message = typeof payload.message === "string" ? cleanText(payload.message) : "";
  if (!message) return { ok: false, status: 422, message: "Please write a message." };
  if ([...message].length > MAX_MESSAGE_CHARACTERS) {
    return { ok: false, status: 422, message: `The message can be at most ${MAX_MESSAGE_CHARACTERS} characters long.` };
  }

  let email = null;
  if (payload.email !== undefined && payload.email !== null && payload.email !== "") {
    email = typeof payload.email === "string" ? payload.email.trim() : "";
    if (email.length > MAX_EMAIL_CHARACTERS || !EMAIL_PATTERN.test(email)) {
      return { ok: false, status: 422, message: "The email address does not look right. Leave it empty if you do not want a reply." };
    }
  }

  let page = null;
  if (typeof payload.page === "string" && payload.page.startsWith("/")) {
    page = payload.page.slice(0, MAX_PAGE_CHARACTERS);
  }

  let storyId = null;
  if (payload.storyId !== undefined && payload.storyId !== null) {
    const id = Number(payload.storyId);
    if (Number.isSafeInteger(id) && id > 0) storyId = id;
  }

  return { ok: true, message, email, page, storyId };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const originError = requireSameOrigin(request, "Same-origin feedback requests are required.");
  if (originError) return originError;

  const parsed = await readLimitedJson(request, MAX_REQUEST_BYTES);
  if (!parsed.ok) return noStoreError(parsed.status, parsed.message);

  const feedback = validateFeedback(parsed.value);
  if (!feedback.ok) return noStoreError(feedback.status || 400, feedback.message);

  try {
    const allowed = await checkRateLimit(env.REPORT_RATE_LIMITER, `feedback:${clientAddress(request) || "unknown"}`);
    if (allowed === null) return noStoreError(503, "Feedback is temporarily unavailable.");
    if (!allowed) return noStoreError(429, "Too many messages. Please try again in a minute.", { "retry-after": "60" });

    const today = await env.DB
      .prepare("SELECT COUNT(*) AS count FROM feedback WHERE created_at >= date('now')")
      .first();
    if (Number(today?.count) >= MAX_MESSAGES_PER_DAY) {
      return noStoreError(429, "The site has received too many messages today. Please try again tomorrow.", { "retry-after": "3600" });
    }

    await env.DB
      .prepare("INSERT INTO feedback (message, email, page, story_id) VALUES (?1, ?2, ?3, ?4)")
      .bind(feedback.message, feedback.email, feedback.page, feedback.storyId)
      .run();
  } catch (feedbackError) {
    console.error(JSON.stringify({
      message: "feedback_failed",
      error: feedbackError instanceof Error ? feedbackError.message : String(feedbackError),
    }));
    return noStoreError(503, "Feedback is temporarily unavailable.");
  }

  return json({ received: true }, { status: 201, headers: NO_STORE_HEADERS });
}
