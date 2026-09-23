// Security headers for every response the Worker serves. They live outside
// worker.js because workerd treats each named export of the entry module as
// an entrypoint and refuses to start when one is not a handler.

// The only inline script is story.html's first-paint stress-switch preference.
// tests/security-headers.test.mjs recomputes these hashes from public/*.html, so
// editing an inline script without updating this list fails the tests instead
// of silently breaking the page.
export const INLINE_SCRIPT_HASHES = Object.freeze([
  "sha256-5lOkryhgP3vNizqejEckeiKIVzzDHMcE0dAxXS0AIoY=",
]);

// Cloudflare's bot management injects an inline "JavaScript detections" script
// into every HTML page, with different contents each time, so no hash can
// allow it. Cloudflare reads a nonce from this header and puts it on the
// script it injects, so each page gets a fresh nonce.
export function contentSecurityPolicy(nonce = null) {
  const scriptSources = [
    "'self'",
    ...INLINE_SCRIPT_HASHES.map((hash) => `'${hash}'`),
    ...(nonce ? [`'nonce-${nonce}'`] : []),
  ];

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self'",
    // admin.css draws its select arrow as a data: SVG.
    "img-src 'self' data:",
    // Pronunciation audio is played from a blob: URL of the fetched MP3.
    "media-src 'self' blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export const CONTENT_SECURITY_POLICY = contentSecurityPolicy();

export function createNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export const SECURITY_HEADERS = Object.freeze({
  "content-security-policy": CONTENT_SECURITY_POLICY,
  "strict-transport-security": "max-age=31536000",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

export const ADMIN_API_HEADERS = Object.freeze({
  ...SECURITY_HEADERS,
  "cache-control": "no-store",
});
