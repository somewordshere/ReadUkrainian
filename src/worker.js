import { onRequestGet as getContent } from "../functions/api/content.js";
import { onRequestGet as getStory } from "../functions/api/content/story.js";
import { onRequestPost as createSpeech } from "../functions/api/speech.js";
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
import { onRequestPost as publishAdminText } from "../functions/api/admin/texts/publish.js";
import { onRequestPost as unpublishAdminText } from "../functions/api/admin/texts/unpublish.js";
import { onRequestGet as listAdminTextRevisions } from "../functions/api/admin/texts/revisions.js";
import { onRequestPost as restoreAdminTextRevision } from "../functions/api/admin/texts/restore.js";
import {
  onRequestGet as getSpeechSettings,
  onRequestPut as updateSpeechSettings,
} from "../functions/api/admin/settings/speech.js";
import { error } from "../functions/_shared/http.js";

const CANONICAL_HOSTNAME = "readukrainianapp.com";

const EXACT_API_ROUTES = new Map([
  ["/api/content", { GET: getContent }],
  ["/api/content/story", { GET: getStory }],
  ["/api/speech", { POST: createSpeech }],
  ["/api/admin/login", { POST: login }],
  ["/api/admin/logout", { POST: logout }],
  ["/api/admin/session", { GET: session }],
  ["/api/admin/settings/speech", { GET: getSpeechSettings, PUT: updateSpeechSettings }],
  ["/api/admin/texts", { GET: listAdminTexts, POST: createAdminText }],
]);

const PARAMETERIZED_API_ROUTES = [
  {
    pattern: /^\/api\/admin\/texts\/(\d+)\/revisions\/(\d+)\/restore$/,
    handlers: { POST: restoreAdminTextRevision },
    getParams: (match) => ({ id: match[1], revisionId: match[2] }),
  },
  {
    pattern: /^\/api\/admin\/texts\/(\d+)\/revisions$/,
    handlers: { GET: listAdminTextRevisions },
    getParams: (match) => ({ id: match[1] }),
  },
  {
    pattern: /^\/api\/admin\/texts\/(\d+)\/publish$/,
    handlers: { POST: publishAdminText },
    getParams: (match) => ({ id: match[1] }),
  },
  {
    pattern: /^\/api\/admin\/texts\/(\d+)\/unpublish$/,
    handlers: { POST: unpublishAdminText },
    getParams: (match) => ({ id: match[1] }),
  },
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

function isAdminPath(pathname) {
  return (
    pathname === "/admin" ||
    pathname === "/admin.html" ||
    pathname.startsWith("/admin/") ||
    pathname === "/api/admin" ||
    pathname.startsWith("/api/admin/")
  );
}

function disabledAdminResponse(pathname) {
  const headers = { "cache-control": "no-store" };

  if (pathname.startsWith("/api/")) {
    return error(404, "Not found.", { headers });
  }

  return new Response("Not found.", {
    status: 404,
    headers: {
      ...headers,
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

async function handleApiRequest(request, env, pathname, ctx) {
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
    waitUntil: typeof ctx?.waitUntil === "function" ? ctx.waitUntil.bind(ctx) : undefined,
  });
}

function noStoreResponse(response) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);

  if (url.hostname === `www.${CANONICAL_HOSTNAME}`) {
    url.hostname = CANONICAL_HOSTNAME;
    url.protocol = "https:";
    url.port = "";
    return Response.redirect(url, 308);
  }

  const { pathname } = url;

  if (env.ADMIN_ENABLED !== "true" && isAdminPath(pathname)) {
    return disabledAdminResponse(pathname);
  }

  if (pathname.startsWith("/api/")) {
    const response = await handleApiRequest(request, env, pathname, ctx);
    return pathname.startsWith("/api/admin/")
      ? noStoreResponse(response)
      : response;
  }

  return env.ASSETS.fetch(request);
}

export default {
  fetch: handleRequest,
};
