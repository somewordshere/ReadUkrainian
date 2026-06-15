import { json } from "../../_shared/http.js";
import { requireAdmin } from "../../_shared/auth.js";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);

  if (!auth.ok) {
    return json({ authenticated: false }, { status: 401 });
  }

  return json({
    authenticated: true,
    user: {
      id: auth.session.userId,
      email: auth.session.email,
      role: auth.session.role,
    },
  });
}
