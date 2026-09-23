import {
  checkRateLimit,
  clientAddress,
  createSessionCookie,
  error,
  json,
  readLimitedJson,
} from "../../_shared/http.js";
import {
  createSessionToken,
  getSessionDurationSeconds,
  verifyPassword,
} from "../../_shared/auth.js";

const MAX_LOGIN_REQUEST_BYTES = 2 * 1024;
// The hash of a random password nobody knows, in the same format and iteration
// count as real ones. An unknown email is checked against it, so every failed
// login costs the same PBKDF2 work and response time cannot reveal which email
// addresses have accounts.
const UNKNOWN_USER_HASH =
  "pbkdf2_sha256$600000$xh1d-tKhcUHcRzS1MVlpOg$_a8W8Y6vsgUWs9Alr7EEarOtF77_yqnF1LHbxk1VG4I";

export async function onRequestPost(context) {
  const requestUrl = new URL(context.request.url);
  const parsed = await readLimitedJson(context.request, MAX_LOGIN_REQUEST_BYTES);

  if (!parsed.ok) {
    return error(parsed.status, parsed.message);
  }

  const payload = parsed.value;
  const email = String(payload?.email || "").trim().toLowerCase();
  const password = String(payload?.password || "");

  if (!email || !password) {
    return error(400, "Email and password are required.");
  }

  const rateLimitResult = await checkRateLimit(
    context.env.ADMIN_LOGIN_RATE_LIMITER,
    `admin-login:${clientAddress(context.request) || "unknown"}`
  );
  if (rateLimitResult === null) {
    return error(503, "Sign-in is temporarily unavailable.");
  }
  if (!rateLimitResult) {
    return error(429, "Too many login attempts. Try again in a minute.", {
      headers: { "retry-after": "60" },
    });
  }

  const user = await context.env.DB.prepare(`
    SELECT id, email, password_hash, role, is_active, session_version
    FROM users
    WHERE email = ?1
    LIMIT 1
  `)
    .bind(email)
    .first();

  const valid = await verifyPassword(password, user?.password_hash || UNKNOWN_USER_HASH);

  if (!user || !user.is_active || !valid) {
    return error(401, "Invalid credentials.");
  }

  if (!context.env.SESSION_SECRET) {
    return error(500, "SESSION_SECRET is not configured.");
  }

  const token = await createSessionToken(context.env.SESSION_SECRET, {
    userId: user.id,
    email: user.email,
    role: user.role,
    sv: Number(user.session_version) || 1,
  });

  return json(
    {
      ok: true,
      user: { id: user.id, email: user.email, role: user.role },
    },
    {
      headers: {
        "set-cookie": createSessionCookie(token, getSessionDurationSeconds(), {
          secure: requestUrl.protocol === "https:",
        }),
      },
    }
  );
}
