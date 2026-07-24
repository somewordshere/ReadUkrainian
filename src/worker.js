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
import { error } from "../functions/_shared/http.js";

const EXACT_API_ROUTES = new Map([
  ["/api/content", { GET: getContent }],
  ["/api/content/story", { GET: getStory }],
  ["/api/admin/login", { POST: login }],
  ["/api/admin/logout", { POST: logout }],
  ["/api/admin/session", { GET: session }],
  ["/api/admin/texts", { GET: listAdminTexts, POST: createAdminText }],
]);

const PARAMETERIZED_API_ROUTES = [
  {
    pattern: /^\/api\/admin\/texts\/(\d+)$/,
    handlers: { GET: getAdminText, PUT: updateAdminText },
    getParams: (match) => ({ id: match[1] }),
  },
];

function matchApiRoute(pathname) {
  const exactHandlers = EXACT_API_ROUTES.get(pathname);

  if (exactHandlers) {
    return { handlers: exactHandlers, params: {} };
  }

  for (const route of PARAMETERIZED_API_ROUTES) {
    const match = pathname.match(route.pattern);

    if (match) {
      return {
        handlers: route.handlers,
        params: route.getParams(match),
      };
    }
  }

  return null;
}

async function handleApiRequest(request, env, pathname) {
  const route = matchApiRoute(pathname);

  if (!route) {
    return error(404, "Not found.");
  }

  const handler = route.handlers[request.method];

  if (!handler) {
    return error(405, "Method not allowed.", {
      headers: { allow: Object.keys(route.handlers).join(", ") },
    });
  }

  return handler({
    request,
    env,
    params: route.params,
  });
}

export async function handleRequest(request, env) {
  const { pathname } = new URL(request.url);

  if (pathname.startsWith("/api/")) {
    return handleApiRequest(request, env, pathname);
  }

  return env.ASSETS.fetch(request);
}

export default {
  fetch: handleRequest,
};
