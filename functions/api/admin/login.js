import {
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

  const rateLimitResult = await checkLoginRateLimit(context.env, context.request);
  if (rateLimitResult === false) {
    return error(429, "Too many login attempts. Try again in a minute.", {
      headers: { "retry-after": "60" },
    });
  }

  const user = await context.env.DB.prepare(`
    SELECT id, email, password_hash, role, is_active
    FROM users
    WHERE email = ?1
    LIMIT 1
  `)
    .bind(email)
    .first();

  if (!user || !user.is_active) {
    return error(401, "Invalid credentials.");
  }

  const valid = await verifyPassword(password, user.password_hash);

  if (!valid) {
    return error(401, "Invalid credentials.");
  }

  if (!context.env.SESSION_SECRET) {
    return error(500, "SESSION_SECRET is not configured.");
  }

  const token = await createSessionToken(context.env.SESSION_SECRET, {
    userId: user.id,
    email: user.email,
    role: user.role,
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

async function checkLoginRateLimit(env, request) {
  if (
    !env.ADMIN_LOGIN_RATE_LIMITER ||
    typeof env.ADMIN_LOGIN_RATE_LIMITER.limit !== "function"
  ) {
    return null;
  }

  const clientAddress = request.headers.get("cf-connecting-ip") || "unknown";
  const result = await env.ADMIN_LOGIN_RATE_LIMITER.limit({
    key: `admin-login:${clientAddress}`,
  });

  return typeof result?.success === "boolean" ? result.success : null;
}
