export function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}

export function error(status, message) {
  return json({ error: message }, { status });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function getCookie(request, name) {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
  const target = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return target ? decodeURIComponent(target.slice(name.length + 1)) : null;
}

export function createSessionCookie(value, maxAgeSeconds) {
  return [
    `admin_session=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Secure",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

export function clearSessionCookie() {
  return [
    "admin_session=",
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Secure",
    "Max-Age=0",
  ].join("; ");
}
