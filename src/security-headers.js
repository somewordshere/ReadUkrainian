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

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' ${INLINE_SCRIPT_HASHES.map((hash) => `'${hash}'`).join(" ")}`,
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
