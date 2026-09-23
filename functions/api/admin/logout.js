import { requireAdmin, revokeSessions } from "../../_shared/auth.js";
import { clearSessionCookie, json } from "../../_shared/http.js";

export async function onRequestPost(context) {
  const requestUrl = new URL(context.request.url);

  // Clearing the cookie alone would leave a copied cookie working until it
  // expires, so a signed-in logout also revokes the user's sessions. The cookie
  // is cleared even if that fails.
  try {
    const auth = await requireAdmin(context);
    if (auth.ok) await revokeSessions(context.env.DB, auth.session.userId);
  } catch (logoutError) {
    console.error(JSON.stringify({
      message: "admin_logout_revoke_failed",
      error: logoutError instanceof Error ? logoutError.message : String(logoutError),
    }));
  }

  return json(
    { ok: true },
    {
      headers: {
        "set-cookie": clearSessionCookie({ secure: requestUrl.protocol === "https:" }),
      },
    }
  );
}
