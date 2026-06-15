import { clearSessionCookie, json } from "../../_shared/http.js";

export async function onRequestPost() {
  return json(
    { ok: true },
    {
      headers: {
        "set-cookie": clearSessionCookie(),
      },
    }
  );
}
