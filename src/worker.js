import { onRequestGet as getContent } from "../functions/api/content.js";
import { onRequestGet as getStory } from "../functions/api/content/story.js";
import { onRequestPost as login } from "../functions/api/admin/login.js";
import { onRequestPost as logout } from "../functions/api/admin/logout.js";
import { onRequestGet as session } from "../functions/api/admin/session.js";
import {
  onRequestGet as listAdminTexts,
  onRequestPost as createAdminText,
} from "../functions/api/admin/texts/index.js";
import {
  onRequestGet as getAdminText,
  onRequestPut as updateAdminText,
} from "../functions/api/admin/texts/[id].js";

function buildContext(request, env, params = {}) {
  return { request, env, params };
}

function notFound() {
  return new Response(JSON.stringify({ error: "Not found." }), {
    status: 404,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/api/content" && request.method === "GET") {
      return getContent(buildContext(request, env));
    }

    if (pathname === "/api/content/story" && request.method === "GET") {
      return getStory(buildContext(request, env));
    }

    if (pathname === "/api/admin/login" && request.method === "POST") {
      return login(buildContext(request, env));
    }

    if (pathname === "/api/admin/logout" && request.method === "POST") {
      return logout(buildContext(request, env));
    }

    if (pathname === "/api/admin/session" && request.method === "GET") {
      return session(buildContext(request, env));
    }

    if (pathname === "/api/admin/texts") {
      if (request.method === "GET") {
        return listAdminTexts(buildContext(request, env));
      }

      if (request.method === "POST") {
        return createAdminText(buildContext(request, env));
      }
    }

    const textMatch = pathname.match(/^\/api\/admin\/texts\/(\d+)$/);

    if (textMatch) {
      const context = buildContext(request, env, { id: textMatch[1] });

      if (request.method === "GET") {
        return getAdminText(context);
      }

      if (request.method === "PUT") {
        return updateAdminText(context);
      }
    }

    if (pathname.startsWith("/api/")) {
      return notFound();
    }

    return env.ASSETS.fetch(request);
  },
};
