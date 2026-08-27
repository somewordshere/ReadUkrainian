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

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function readLimitedJson(request, maximumBytes) {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();

  if (contentType !== "application/json") {
    return { ok: false, status: 415, message: "Content-Type must be application/json." };
  }

  const declaredLength = Number(request.headers.get("content-length"));

  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
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

      if (totalBytes > maximumBytes) {
        await reader.cancel();
        return { ok: false, status: 413, message: "Request body is too large." };
      }

      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, message: "Invalid JSON request body." };
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
    return {
      ok: true,
      value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    };
  } catch {
    return { ok: false, status: 400, message: "Invalid JSON request body." };
  }
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
