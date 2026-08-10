import { requirePermission } from "../../../_shared/auth.js";
import { error, json } from "../../../_shared/http.js";
import {
  getSpeechSetting,
  saveSpeechVoice,
} from "../../../_shared/speech-settings.js";
import {
  listPublicSpeechVoices,
  resolveSpeechVoice,
} from "../../../_shared/speech-voices.js";

const MAX_REQUEST_BYTES = 1024;
const NO_STORE_HEADERS = Object.freeze({ "cache-control": "no-store" });

function noStoreError(status, message) {
  return error(status, message, { headers: NO_STORE_HEADERS });
}

function isSameOrigin(request) {
  const origin = request.headers.get("origin");
  return Boolean(origin) && origin === new URL(request.url).origin;
}

async function readLimitedJson(request) {
  const declaredLength = Number(request.headers.get("content-length"));

  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return { ok: false, status: 413, message: "Request body is too large." };
  }

  if (!request.body) {
    return { ok: false, status: 400, message: "A JSON request body is required." };
  }

  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return { ok: false, status: 413, message: "Request body is too large." };
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, status: 400, message: "Invalid JSON request body." };
  }
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, message: "The request body must contain only voiceId." };
  }

  const keys = Object.keys(payload);

  if (keys.length !== 1 || keys[0] !== "voiceId" || typeof payload.voiceId !== "string") {
    return { ok: false, message: "The request body must contain only voiceId." };
  }

  const voice = resolveSpeechVoice(payload.voiceId);

  if (!voice) {
    return { ok: false, message: "Unsupported speech voice." };
  }

  return { ok: true, voiceId: voice.id };
}

function buildResponse(setting) {
  return {
    setting,
    voices: listPublicSpeechVoices(),
  };
}

export async function onRequestGet(context) {
  const auth = await requirePermission(context, "settings");

  if (!auth.ok) {
    return auth.response;
  }

  const setting = await getSpeechSetting(context.env.DB);
  return json(buildResponse(setting), { headers: NO_STORE_HEADERS });
}

export async function onRequestPut(context) {
  const auth = await requirePermission(context, "settings");

  if (!auth.ok) {
    return auth.response;
  }

  if (!isSameOrigin(context.request)) {
    return noStoreError(403, "Same-origin settings requests are required.");
  }

  const contentType = context.request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();

  if (contentType !== "application/json") {
    return noStoreError(415, "Content-Type must be application/json.");
  }

  const parsed = await readLimitedJson(context.request);

  if (!parsed.ok) {
    return noStoreError(parsed.status, parsed.message);
  }

  const validation = validatePayload(parsed.value);

  if (!validation.ok) {
    return noStoreError(400, validation.message);
  }

  const setting = await saveSpeechVoice(
    context.env.DB,
    validation.voiceId,
    auth.session
  );

  return json(buildResponse(setting), { headers: NO_STORE_HEADERS });
}
