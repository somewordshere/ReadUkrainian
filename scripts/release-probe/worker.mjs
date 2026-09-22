// Only run through Wrangler's authenticated remote preview, never deploy publicly.
export const productionOrigin = "https://readukrainianapp.com";

export function productionRequest(request) {
  const url = new URL(request.url);
  const read = request.method === "GET" && ["/api/content", "/api/content/story", "/js/app/version.js"].includes(url.pathname);
  const lookup = request.method === "POST" && url.pathname === "/api/dictionary/lookup";
  if (!read && !lookup) return null;
  return new Request(`${productionOrigin}${url.pathname}${url.search}`, {
    method: request.method,
    headers: { "cache-control": "no-cache", "content-type": "application/json", origin: productionOrigin },
    body: lookup ? request.body : undefined,
    redirect: "manual",
    ...(lookup ? { duplex: "half" } : {}),
  });
}

export default {
  async fetch(request, env) {
    const upstream = productionRequest(request);
    if (!upstream) return new Response("Only public release verification endpoints are available.", { status: 404 });
    // Exercise the deployed production Worker, its public API, D1 and assets,
    // through the service binding rather than the bot-protected public edge.
    return env.PRODUCTION.fetch(upstream);
  },
};
