# Content releases

Changes are checked automatically. Production publication is a manual **Release
production** action on `main`. A failed check stops the release. No push should
deploy production through another integration.

## One-time account setup

1. In Cloudflare, check the `readukrainian` Worker's **Builds** settings. Disconnect
   automatic Git deployment if configured; retain this manual GitHub workflow.
2. Create a deployment API token scoped to this Cloudflare account and the site's
   zone. Start with the **Edit Cloudflare Workers** template and add **D1 Edit**.
   Store the value as `CLOUDFLARE_API_TOKEN` in this repository's `production`
   environment secrets. Do not put it in chat, source files, or command arguments.
3. Set repository variable `CLOUDFLARE_ACCOUNT_ID` to
   `3ff0f3d4cc189f35fc5d9ca14a9c6309`. Restrict the production environment to `main`.

See [Cloudflare's GitHub Actions setup](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).
An existing local Wrangler OAuth login is not a persistent GitHub deployment credential.

## Prepare and publish

1. Update the frontend stories and quizzes. `npm run seed` updates **JSON only**;
   `npm run check:seeds` checks consistency without writing anything. Never rewrite
   historical migrations or execute the original destructive seeds on production.
2. For a new batch, use explicit story keys and a new migration filename:
   `node scripts/build-content-refresh.mjs --output migrations/NEW_NAME.sql --stories "A1#15,A1#16"`.
   The generator refuses existing files, unknown selections and incomplete quizzes.
3. Review grammar, required details, vocabulary reuse and question evidence against
   the private curriculum. Public CI checks only public mechanical criteria; it
   does not establish CEFR suitability or replace a Ukrainian teacher's review.
4. Maintain a reviewed release manifest with migration checksums, exact before/after
   content and questions, and the allowed pending migration sequence. Version 0.83
   uses `data/releases/0.83.json`; later releases must update the release helpers,
   manifest selection and expected version in the workflow together. Do not update
   checksums for already-applied SQL to conceal an edit.
5. Run `npm run check`, review the diff, and merge the checked commits to `main`.
   Run **Release production** on `main` to publish the selected commit.

The workflow repeats checks, compares the live database with the reviewed baseline,
and saves recovery information **before** applying migrations. Recovery artifacts
contain public story data and recovery identifiers, not drafts, editor emails,
tokens or private curriculum. They are retained for seven days.

Only the reviewed pending migrations may run. The 0.83 content migration also
checks original text and questions inside the database to reject a concurrent
editorial content change. Existing IDs, flags, drafts and revision history survive.
After deployment the workflow checks every public story and all its questions,
the version, and the added dictionary forms. Cache propagation retries are bounded.

## Recovery

If a release fails, stop and inspect which steps completed. Do not rerun old seed
migrations or restore the entire database over later editorial work. A retry of
the same release recognizes an already-applied dictionary/content migration and
checks the appropriate content baseline before continuing.

If 0.83 must be withdrawn after its content migration:

1. Download its recovery artifact and retain the previous Worker version ID.
2. Generate `node scripts/build-release-rollback.mjs --output rollback-083.sql` in
   an ignored recovery directory. Review and apply the SQL in one D1 transaction
   using `wrangler d1 execute DB --remote --file rollback-083.sql`.
3. This restores the three earlier passages and questions and hides the five new
   stories. It retains the new rows, dictionary additions, drafts and history.
   It refuses to run if an editor has since changed any affected text or question;
   reconcile that conflict explicitly rather than removing the guards.
4. Roll back the Worker to the recorded previous version with `wrangler rollback
   VERSION_ID`. Verify the public 0.82 collection and affected lookups against the
   prior checkout. Retain the migration records; prepare a new reviewed release
   before republishing withdrawn content.

## Private curriculum backup

The private repository is `somewordshere/ReadUkrainian-curriculum`. Working copies
under `.local-release/` and source `prompts/` remain ignored by the public project.

From the project root, after each curriculum edit:

```powershell
node scripts/backup-curriculum.mjs --sync .local-release/curriculum
git -C .local-release/curriculum add prompts
git -C .local-release/curriculum commit -m "Update curriculum after content batch"
git -C .local-release/curriculum push
gh api repos/somewordshere/ReadUkrainian-curriculum --jq '.private'
gh repo clone somewordshere/ReadUkrainian-curriculum .local-release/NEW-verification-checkout
node scripts/backup-curriculum.mjs --verify .local-release/NEW-verification-checkout
```

The privacy result must be `true`; verification compares the complete filename
list and SHA-256 hashes. Use a fresh verification directory each time. The sync
copies only curriculum files, rejects symlinks, and preserves Git history.
