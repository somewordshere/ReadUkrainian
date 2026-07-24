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

Install dependencies and start Wrangler:

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

## Admin access

`public/admin.html` supports creating, editing, enabling, and disabling stories and questions through authenticated API routes.

Generate a PBKDF2 password hash for an admin user:

```powershell
node .\scripts\generate-password-hash.mjs "your-strong-password"
```

Insert the result into D1:

```sql
INSERT INTO users (email, password_hash, role, is_active)
VALUES ('your-email@example.com', 'PASTE_HASH_HERE', 'admin', 1);
```

The Worker also requires a `SESSION_SECRET`:

```powershell
npx.cmd wrangler secret put SESSION_SECRET
```

## Deployment

The D1 database binding and static asset directory are defined in `wrangler.jsonc`. After the migrations and secret are configured, deploy with:

```powershell
npm.cmd run deploy
```
