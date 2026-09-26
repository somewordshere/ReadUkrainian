# Release 0.83 completion record

Verified on **2026-09-08**. [Production](https://readukrainianapp.com) serves
**19 A1 + 103 A2 stories: 122 stories and 610 questions**.

## Published changes

- Repaired the conditional in A1 #5 and relative clauses in #8 and #9 while
  preserving facts and all 15 existing questions and answers.
- Added #15 «Моя кімната», #16 «У школі», #17 «Мій друг», #18 «Сніданок удома»
  and #19 «У магазині», with 25 reviewed questions. Each has four literal questions
  and one supported connection/sequence question. Word counts: 92, 101, 95, 82, 91.
- Resolved topic 19's contradictory instructions explicitly: 90–100 words,
  at most six turns, formal ви, one stored paragraph, multiple short sentences
  per turn allowed, and an 11-word sentence ceiling. The narrative paragraph
  limit does not apply to stored dialogue.
- Added 40 reviewed English entries for 42 previously uncovered forms. Standard
  reconstructed coverage is **4,129/4,129 distinct published forms (100%)**.
- Applied dictionary migration 0023 and guarded content migration 0024. Exactly
  eight A1 stories were affected. Original story identities, ordering and settings
  were preserved; the five new live IDs are 403–407.

## Commits and publication

| Commit | Result |
|---|---|
| `f944867` | Dictionary exclusions, migration 0022, regression tests, audit caveats and reconciled status |
| `859be68` | A1 batch, safe seed/refresh generation, guarded migrations, recovery helpers, automatic checks and manual release |
| `c4b1624` | [PR #5](https://github.com/somewordshere/ReadUkrainian/pull/5) merged to main |
| `08e1de8` | Verification through an authenticated temporary Cloudflare preview |
| `1cb197d` | [PR #6](https://github.com/somewordshere/ReadUkrainian/pull/6) merged; successfully released commit |

The [first run](https://github.com/somewordshere/ReadUkrainian/actions/runs/34172898527)
applied both migrations and deployed 0.83. Its final direct GitHub HTTP checks
received Cloudflare Bot Fight Mode challenges. Independent local live checks
passed. The verification fix kept bot protection intact and introduced no
permanent verification service.

The [second manual run](https://github.com/somewordshere/ReadUkrainian/actions/runs/34207575116)
passed every step, finishing at **09:01 UTC**. It recognized the applied content,
confirmed **zero pending migrations**, redeployed the checked commit and verified
all live content, complete questions, version and dictionary probes.
Deployed Worker version: `e7f27a3c-c98e-412f-a1a0-d95047f08c21`.

GitHub checks run on pushes and pull requests. Releases require a manual run on
`main`, are serialized, and use a scoped Cloudflare credential in GitHub's
branch-restricted `production` environment. The previous Cloudflare automatic
Git deployment integration was disconnected. Public CI contains mechanical
acceptance fixtures; private curriculum instructions remain excluded.

## Validation

- **152 tests: 151 passed, zero failed, one skipped.** The skip is the opt-in live
  audio-provider test. Seed consistency, A1/A2 text checks, migration integrity
  and English coverage passed locally and in GitHub.
- Historical regression fixtures remain independent of the expanding corpus.
  Migration tests prove preservation of unrelated content, IDs, enabled flags,
  drafts, editorial revisions and dictionary preferences. Baseline conflict tests
  reject changed story text or questions; refresh generation rejects existing
  filenames, unknown story selections and incomplete question sets.
- Deep live verification compared all **122 story texts and 610 questions**,
  including every correct answer and distractor. **45 live dictionary lookups**
  passed: 42 added forms plus мама, червоний and парк without the known wrong lemmas.
- Live desktop at 1365×900: reading, dictionary selection, a five-question quiz,
  bookmark filtering and saved completion after reload passed.
- Live mobile viewport at 390×844: dialogue line breaks, a five-question quiz,
  bookmarks and saved completion after reload passed. The page had no horizontal
  overflow; the library correctly reflected both completed test stories.
- Story facts, grammar, vocabulary reuse and question evidence were reviewed
  locally against the full private specifications. No teacher or learner review
  occurred. Browser viewport checks do not establish physical-device compatibility;
  dictionary coverage does not establish exhaustive translation accuracy.

## Private backup

[somewordshere/ReadUkrainian-curriculum](https://github.com/somewordshere/ReadUkrainian-curriculum)
was created as a private repository. Initial backup `4735455`, batch backup
`5ec19e4` and final published checkpoint **`b04149f`** are pushed.

Privacy was reconfirmed as `true` on 2026-09-08. A new checkout after the final push
matched **all 22 curriculum files, including historical archives, byte for byte**
using complete filename comparison and SHA-256 hashes. Source prompts, private
backup checkouts and recovery files remain ignored by the public repository.
The repeatable procedure is documented in [releases.md](releases.md#private-curriculum-backup).

## Recovery and remaining work

The first run captured original affected records, questions, a D1 recovery bookmark
and deployed versions at **00:18:59 UTC**, before any release writes. Its recovery
artifact was downloaded to the ignored local release directory. GitHub keeps
workflow artifacts for seven days. The recorded pre-release Worker version is
`22099cca-c4b3-43a2-a79e-8e18f4cb9d34` (the latest deployment by timestamp).

The [recovery procedure](releases.md#recovery) generates guarded SQL to restore the
three earlier passages and hide the five new stories while preserving their IDs,
dictionary additions, drafts and editorial history. It rejects subsequent editorial
changes. No recovery SQL or production rollback was executed.

Remaining work: A1 topics 20–40, A2 sequencing, B1 content, a validated replacement
dictionary-source build, German expansion and pronunciation activation. Current
mechanical checks still have historical warnings; they are not a CEFR assessment.
