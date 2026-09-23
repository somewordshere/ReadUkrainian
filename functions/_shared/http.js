// Published content changes only when an editor publishes, and the admin panel
// reads through /api/admin/* rather than these routes, so a short shared cache
// costs editors nothing while letting the CDN absorb repeat reads instead of
// D1. The window is the most a learner can lag behind a publish.
export const PUBLISHED_CONTENT_CACHE = "public, max-age=60, stale-while-revalidate=300";

// Errors must never be cached: a 404 for a story that is later published, or a
// rate-limit response, would otherwise stick around at the edge.
export const NO_STORE = "no-store";

export function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}

export function error(status, message, init = {}) {
  return json({ error: message }, { ...init, status });
}

export function noStoreError(status, message, headers = {}) {
  return error(status, message, { headers: { ...headers, "cache-control": NO_STORE } });
}

// Browsers always send Origin on POST/PUT, so a missing or foreign one means the
// request did not come from this site's own pages.
export function isSameOrigin(request) {
  const origin = request.headers.get("origin");
  return Boolean(origin) && origin === new URL(request.url).origin;
}

export function requireSameOrigin(request, message = "Same-origin requests are required.") {
  return isSameOrigin(request) ? null : noStoreError(403, message);
}

function mediaType(headers) {
  return headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() || "";
}

export function declaresTooMuch(headers, maximumBytes) {
  const declaredLength = Number(headers.get("content-length"));
  return Number.isFinite(declaredLength) && declaredLength > maximumBytes;
}

// Reads a whole body, but stops as soon as it passes maximumBytes. Returns null
// when the body is missing, too large or fails mid-stream.
export async function readLimitedBytes(stream, maximumBytes) {
  if (!stream) return null;

  const reader = stream.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function decodeJson(bytes) {
  try {
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { ok: false };
  }
}

export async function readLimitedJson(request, maximumBytes) {
  if (mediaType(request.headers) !== "application/json") {
    return { ok: false, status: 415, message: "Content-Type must be application/json." };
  }

  if (declaresTooMuch(request.headers, maximumBytes)) {
    return { ok: false, status: 413, message: "Request body is too large." };
  }

  if (!request.body) {
    return { ok: false, status: 400, message: "A JSON request body is required." };
  }

  const bytes = await readLimitedBytes(request.body, maximumBytes);
  if (!bytes) {
    return { ok: false, status: 413, message: "Request body is too large." };
  }

  const parsed = decodeJson(bytes);
  return parsed.ok
    ? parsed
    : { ok: false, status: 400, message: "Invalid JSON request body." };
}

export function hasMediaType(headers, expected) {
  return mediaType(headers) === expected;
}

// Every limiter in this app fails closed: a missing binding is a broken deploy,
// so callers treat null as "refuse" rather than running unprotected.
// Returns true (allowed), false (over the limit) or null (no usable limiter).
export async function checkRateLimit(limiter, key) {
  if (typeof limiter?.limit !== "function") return null;
  const result = await limiter.limit({ key });
  return typeof result?.success === "boolean" ? result.success : null;
}

function ipv6Prefix(address) {
  const [head, tail = ""] = address.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const missing = address.includes("::") ? 8 - headGroups.length - tailGroups.length : 0;
  const groups = [...headGroups, ...Array(Math.max(0, missing)).fill("0"), ...tailGroups];
  return `${groups.slice(0, 4).map((group) => group.toLowerCase().padStart(4, "0")).join(":")}::/64`;
}

// The client's address as Cloudflare saw it, with IPv6 reduced to its /64: one
// household or phone gets a whole /64 and can rotate through it freely.
// Null when the request did not come through Cloudflare's edge (a service
// binding such as the release probe, or a unit test).
export function clientAddress(request) {
  const address = request.headers.get("cf-connecting-ip")?.trim();
  if (!address) return null;
  return address.includes(":") ? ipv6Prefix(address) : address;
}

// The Workers edge cache, or the one a test injects as context.cache (which may
// be null to mean "no cache").
export function edgeCache(context) {
  if (Object.prototype.hasOwnProperty.call(context, "cache")) {
    return context.cache;
  }
  return globalThis.caches?.default || null;
}

// Hands background work to waitUntil when the runtime offers it, so the
// response is not held up; otherwise waits for it.
export async function runInBackground(context, promise) {
  if (typeof context.waitUntil === "function") {
    context.waitUntil(promise);
    return;
  }
  await promise;
}

export function getCookie(request, name) {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
  const target = cookies.find((cookie) => cookie.startsWith(`${name}=`));

  if (!target) {
    return null;
  }

  try {
    return decodeURIComponent(target.slice(name.length + 1));
  } catch {
    return null;
  }
}

function buildSessionCookie(parts, secure) {
  const cookieParts = [...parts];

  if (secure) {
    cookieParts.push("Secure");
  }

  return cookieParts.join("; ");
}

export function createSessionCookie(value, maxAgeSeconds, { secure = true } = {}) {
  return buildSessionCookie([
    `admin_session=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
  ], secure);
}

export function clearSessionCookie({ secure = true } = {}) {
  return buildSessionCookie([
    "admin_session=",
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
  ], secure);
}
