import { clearSessionCookie, json } from "../../_shared/http.js";

export async function onRequestPost(context) {
  const requestUrl = new URL(context.request.url);
  return json(
    { ok: true },
    {
      headers: {
        "set-cookie": clearSessionCookie({ secure: requestUrl.protocol === "https:" }),
      },
    }
  );
}
