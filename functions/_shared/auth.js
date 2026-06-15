import { error, getCookie } from "./http.js";

const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 14;

function toBase64Url(bytes) {
  const binary = Array.from(bytes, (value) => String.fromCharCode(value)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeText(value) {
  return new TextEncoder().encode(value);
}

function decodeText(bytes) {
  return new TextDecoder().decode(bytes);
}

async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    encodeText(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signValue(secret, value) {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encodeText(value));
  return toBase64Url(new Uint8Array(signature));
}

async function verifySignature(secret, value, signature) {
  const key = await importHmacKey(secret);
  return crypto.subtle.verify("HMAC", key, fromBase64Url(signature), encodeText(value));
}

async function derivePassword(secret, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encodeText(secret),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: fromBase64Url(salt),
      iterations,
    },
    keyMaterial,
    256
  );
  return toBase64Url(new Uint8Array(derived));
}

export async function verifyPassword(password, storedHash) {
  const [scheme, rawIterations, salt, expected] = String(storedHash || "").split("$");

  if (scheme !== "pbkdf2_sha256" || !rawIterations || !salt || !expected) {
    return false;
  }

  const iterations = Number(rawIterations);

  if (!Number.isFinite(iterations) || iterations < 1000 || iterations > 100000) {
    return false;
  }

  const actual = await derivePassword(password, salt, iterations);
  return actual === expected;
}

export async function createSessionToken(secret, payload) {
  const data = {
    ...payload,
    exp: Date.now() + SESSION_DURATION_SECONDS * 1000,
  };
  const encodedPayload = toBase64Url(encodeText(JSON.stringify(data)));
  const signature = await signValue(secret, encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function readSessionToken(secret, token) {
  if (!token || !token.includes(".")) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");
  const valid = await verifySignature(secret, encodedPayload, signature);

  if (!valid) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeText(fromBase64Url(encodedPayload)));
    if (payload.exp <= Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function requireAdmin(context) {
  const secret = context.env.SESSION_SECRET;

  if (!secret) {
    return { ok: false, response: error(500, "SESSION_SECRET is not configured.") };
  }

  const token = getCookie(context.request, "admin_session");
  const session = await readSessionToken(secret, token);

  if (!session?.userId) {
    return { ok: false, response: error(401, "Authentication required.") };
  }

  return { ok: true, session };
}

export function getSessionDurationSeconds() {
  return SESSION_DURATION_SECONDS;
}
