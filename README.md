# Read Ukrainian Admin Migration

This repo now includes the first Cloudflare-ready admin/content stack:

- public content API backed by D1
- admin login API with signed cookie sessions
- admin page for creating, editing, enabling, and disabling texts and questions
- D1 schema and generated seed SQL from the current static stories and questions
- Worker-based deployment with static assets served from `public/`

## What was added

- `functions/`
  - route handlers reused by the Worker for public content and admin CRUD/auth
- `src/worker.js`
  - Worker entrypoint and API router
- `admin.html`
  - browser admin UI
- `migrations/0001_schema.sql`
  - D1 tables for `users` and `texts`
- `migrations/0002_seed_texts.sql`
  - generated inserts for the existing story content
- `migrations/0004_questions_schema.sql`
  - D1 table for story questions
- `migrations/0005_seed_questions.sql`
  - generated inserts for the existing question content
- `data/content-seed.json`
  - JSON export of the same content
- `data/questions-seed.json`
  - JSON export of the seeded questions
- `scripts/build-content-seed.mjs`
  - regenerates the seed from the legacy JS files
- `scripts/generate-password-hash.mjs`
  - generates a PBKDF2 password hash for the first admin user
- `wrangler.jsonc`
  - Worker config, D1 binding, and static asset settings
- `public/`
  - static files uploaded as Worker assets

## Current behavior

- `public/index.html` and `public/story.html` try to load content from `/api/content`.
- If the API is not available yet, they fall back to the legacy static JS data.
- `public/admin.html` expects the Worker API routes and D1 database to be available.

## What you need to do in Cloudflare

1. Create a D1 database.
2. Put the real D1 database ID into `wrangler.jsonc`.
3. Run `migrations/0001_schema.sql`.
4. Run `migrations/0002_seed_texts.sql`.
5. Run `migrations/0003_add_question_index.sql`.
6. Run `migrations/0004_questions_schema.sql`.
7. Run `migrations/0005_seed_questions.sql`.
8. Create a long random `SESSION_SECRET` as a Worker secret.
9. Generate a password hash for your admin password.
10. Insert your admin user into the `users` table.
11. Deploy the Worker.

## Generate the first admin password hash

Use the bundled Node runtime path already available in Codex:

```powershell
& 'C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\scripts\generate-password-hash.mjs "your-strong-password"
```

That prints a value like:

```text
pbkdf2_sha256$100000$...$...
```

Insert it into D1:

```sql
INSERT INTO users (email, password_hash, role, is_active)
VALUES ('your-email@example.com', 'PASTE_HASH_HERE', 'admin', 1);
```

## Regenerate the content seed

If you change the legacy story files before fully cutting over to D1, regenerate the seed:

```powershell
& 'C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\scripts\build-content-seed.mjs
```

## Worker deployment commands

Set the session secret:

```powershell
npx.cmd wrangler secret put SESSION_SECRET
```

Deploy the Worker:

```powershell
npx.cmd wrangler deploy
```

## Questions

Questions are now stored in D1 and loaded by the Worker API.

That means:

- existing static questions can be migrated with `migrations/0005_seed_questions.sql`
- newly created texts can have questions created and edited directly in the admin UI
- the legacy question files remain as a fallback only when the API is unavailable
