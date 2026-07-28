import { json } from "../../_shared/http.js";
import { getPermissionsForRole, requireAdmin } from "../../_shared/auth.js";

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
      permissions: getPermissionsForRole(auth.session.role),
    },
  });
}
