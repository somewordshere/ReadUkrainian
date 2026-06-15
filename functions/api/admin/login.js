import { createSessionCookie, error, json, readJson } from "../../_shared/http.js";
import {
  createSessionToken,
  getSessionDurationSeconds,
  verifyPassword,
} from "../../_shared/auth.js";

export async function onRequestPost(context) {
  const payload = await readJson(context.request);
  const email = String(payload?.email || "").trim().toLowerCase();
  const password = String(payload?.password || "");

  if (!email || !password) {
    return error(400, "Email and password are required.");
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
        "set-cookie": createSessionCookie(token, getSessionDurationSeconds()),
      },
    }
  );
}
