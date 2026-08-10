# Read Ukrainian

A Ukrainian reading practice app deployed as a Cloudflare Worker. Stories and quiz questions are served from D1, while the browser can fall back to bundled static content if the API is unavailable.

## Project structure

- `public/` — the canonical frontend source and Worker static assets
- `src/worker.js` — Worker entry point and API router
- `functions/` — public and authenticated admin API handlers
- `migrations/` — D1 schema and seed migrations
- `scripts/` — content-seed and password-hash utilities
- `tests/` — Node tests for library helpers, authentication, HTTP helpers, and routing

The frontend exists only under `public/`; Wrangler uploads that directory through the `ASSETS` binding configured in `wrangler.jsonc`.

## Local development

Node.js 22 or newer is required. Install dependencies and start Wrangler:

```powershell
npm.cmd install
npm.cmd run dev
```

Run the test suite:

```powershell
npm.cmd test
```

## Content and questions

The public content API reads stories and questions from D1. `public/index.html` and `public/story.html` use the static files in `public/js/data/` only as a resilience fallback.

To regenerate the JSON exports and seed migrations from those canonical fallback files:

```powershell
npm.cmd run seed
```

The command updates:

- `data/content-seed.json`
- `data/questions-seed.json`
- `migrations/0002_seed_texts.sql`
- `migrations/0005_seed_questions.sql`

## Selected-text pronunciation

On a story page, a reader can select one word and use the nearby **Прослухати** button to hear server-delivered Ukrainian audio. The browser posts the selected word and story ID to `POST /api/speech`; the Worker canonicalizes punctuation and apostrophe variants, then verifies an exact token in the active published story. No Windows, browser, or device speech voice is used.

The Worker serves a pre-generated immutable MP3 when one exists. Otherwise it uses TTS.ai's anonymous Ukrainian Piper voice on the server and caches the result at Cloudflare. This fallback currently has no API charge and needs no secret; the app stays within its free allowance with an 8-request-per-minute limiter and an atomic 4,500-character daily circuit breaker. On an uncached miss, the selected word is sent to TTS.ai. The interface identifies the voice as AI-generated.

An administrator can choose Lada (Piper) or MAI (VITS) in the **Pronunciation voice** card at `/admin`. These are the Ukrainian voices actually published in the provider catalog. The choice is stored in D1 and applies globally; provider identifiers remain server-controlled. Static files and generated-cache entries are namespaced by voice, so switching the setting cannot return audio produced with a previously selected voice.

The build-only pipeline in `scripts/speech/` can pre-generate the entire published vocabulary with the open-source Ukrainian Piper model, removing the runtime provider dependency for covered words. It reads the production content API by default so admin-published changes are included:

```powershell
npm.cmd run speech:plan
npm.cmd run speech:build -- --python C:\path\to\python.exe
```

Run the speech build and redeploy after publishing paragraph changes. See `scripts/speech/README.md` and `public/speech/NOTICE.txt` for the exact normalization contract, safe fallback workflow, and model provenance.

## Admin access

`public/admin.html` is a role-aware publishing workspace. It loads story summaries first, supports search and status filters, saves edits as private drafts, previews unpublished work, publishes or unpublishes explicitly, and can restore transactional revision checkpoints. Quiz questions can be collapsed, reordered, duplicated, removed, and restored with undo.

Available roles are:

- `editor` — view stories and save drafts
- `publisher` — editor access plus publish, unpublish, and restore
- `admin` — full publishing access plus the global pronunciation voice setting

Permissions are enforced by the Worker; hiding a button in the browser is not the security boundary. The deployed admin panel is guarded by the signed session cookie and a separate 10-attempt-per-minute login throttle.

Generate a PBKDF2 password hash for an admin user:

```powershell
node .\scripts\generate-password-hash.mjs
```

The script reads the password from a hidden prompt so it is not exposed in shell history or the process list. New hashes use PBKDF2-HMAC-SHA256 with 600,000 iterations; existing 100,000-iteration hashes remain valid and can be replaced at the next password change.

Insert the result into D1:

```sql
INSERT INTO users (email, password_hash, role, is_active)
VALUES ('your-email@example.com', 'PASTE_HASH_HERE', 'admin', 1);
```

The Worker also requires a `SESSION_SECRET`:

```powershell
npx.cmd wrangler secret put SESSION_SECRET
```

Apply D1 migrations before deploying a Worker that uses the editor workflow:

```powershell
npx.cmd wrangler d1 migrations apply readukrainian_db --remote
```

## Deployment

The D1 database binding and static asset directory are defined in `wrangler.jsonc`. After the migrations and secret are configured, deploy with:

```powershell
npm.cmd run deploy
```

## Security and local data

Keep local secrets in `.dev.vars`; it and common `.env` variants are ignored by Git. Production secrets must be configured with `wrangler secret put`, never committed. Local Wrangler/Miniflare databases, audit captures, generated speech audio, logs, and handover files are also excluded from releases.

Report vulnerabilities through the repository's private **Report a vulnerability** form described in `SECURITY.md`, not through a public issue.

## License

No open-source license has been selected. Public visibility permits viewing the source but does not grant permission to copy, modify, or redistribute it.
