# Read Ukrainian — project status

## 0.84 — prepared for publication (2026-09-15)

Five A1 stories (20–24), 25 questions, 27 English vocabulary forms and 311 reviewed German translations are prepared. The 127-story corpus has complete English coverage (4,158 forms); German coverage is 1,573/4,158 (37.8%). Raw English/German extraction and repeated builds passed; full raw outputs remain unpublished review artifacts. Private A2 progression and A1 teacher/learner review materials are prepared. External human review is pending. Lada provider synthesis passed; production activation awaits the release. B1 is deferred.

The following 0.83 checkpoint remains historical.

Last reconciled: **2026-09-08**. This is a dated checkpoint, not a live dashboard.

## Version 0.83 — published and verified

Production serves **19 A1 + 103 A2 stories: 122 stories and 610 questions** at
[Read Ukrainian](https://readukrainianapp.com). The
[manual release](https://github.com/somewordshere/ReadUkrainian/actions/runs/34207575116)
completed successfully on 2026-09-08 at 09:01 UTC.

- A1 #5, #8 and #9 are repaired in production; their questions and answers are unchanged.
- Topics 15–19 have five finished stories and 25 questions. Their word counts are
  92, 101, 95, 82 and 91, with no sentence over 11 words. An explicit dialogue
  exception resolves topic 19's conflicting word/turn/paragraph instructions.
- New English supplement: 40 entries covering 42 previously missing forms.
  The reconstructed standard database covers **4,129/4,129** distinct forms in
  real A1/A2 stories. This is coverage, not an exhaustive accuracy assessment.
- Migrations 0023 and 0024 were applied on 2026-09-08. The latter targeted exactly
  A1 #5, #8, #9 and #15–19. The live baseline matched before publication; the final
  release confirmed zero pending migrations. Recovery information was saved before
  writes and downloaded locally from the first release run.
- **151 tests passed, zero failed, one skipped** (the opt-in live audio-provider
  test). Seed consistency, A1/A2 mechanical checks, migration integrity and complete
  English coverage passed locally and in GitHub. Historical regression fixtures
  remain independent of the expanded corpus. Migration tests preserve unrelated
  content, existing IDs, flags, drafts, revision history and dictionary preferences.
- Deep live checks matched all 122 story texts and all 610 complete questions,
  including correct answers and distractors. All 45 dictionary probes passed:
  42 added vocabulary forms and the three previously repaired associations.
- Live desktop (1365×900) and mobile viewport (390×844) checks covered reading,
  quizzes, bookmarks and saved progress after reload. The desktop dictionary
  selection opened an English definition; mobile dialogue retained its line breaks
  without horizontal overflow. These were browser checks, not physical-phone tests.
- Automatic checks run on pushes and pull requests. Production releases require
  a manual run on main, use the scoped deployment credential in GitHub's production
  environment, and run one at a time. The workflow has passed end to end.
  Cloudflare's Git integration was inspected and disconnected on 2026-09-07;
  the dashboard now offers Connect, so pushes no longer deploy automatically.
- The private curriculum repository contains initial commit `4735455`, batch
  commit `5ec19e4` and published checkpoint `b04149f`. Privacy was reconfirmed on
  2026-09-08, and a fresh checkout matched all 22 curriculum files byte for byte.
  Public prompts remain ignored. See [the release report](release-0.83.md).
- No teacher or learner review has been performed.

The first deployment succeeded, but Cloudflare Bot Fight Mode challenged direct
GitHub verification requests. The corrected workflow verifies public endpoints
through an authenticated temporary Cloudflare preview; the second run passed.
No bot or firewall protection was disabled. See [release and recovery procedure](releases.md)
and [commits and release evidence](release-0.83.md).

## Dictionary repair

**Implemented and applied to production on 2026-09-06.** Source and documentation
are preserved in pushed commit `7499e35`, merged into main with the A1 release.
Future builds must use the corrected generator. Migration 0022 is recorded in production D1.

Three confirmed imported inflection-table errors attached forms of common words
to unrelated English dictionary entries:

| Incorrect entry | Forms incorrectly attached to it | Intended entry |
|---|---|---|
| озимина | мама, мами, мамі, маму, мамою, мамо | мама |
| рясний | червоний, червона, червоні, червоним, червону, червоними | червоний |
| лісопарк | парк, парку, парках | парк |

The repair has two parts:

- `scripts/dictionary/form-exclusions.mjs`, called by the Kaikki builder after
  direct forms, aliases and supplemental forms are merged. Exact lemma/POS/form
  exclusions cover the complete reviewed foreign tables, including forms not
  used in current stories. It preserves valid forms and ordinary Ukrainian
  alternations, and applies to both English and German builds.
- `migrations/0022_remove_incorrect_dictionary_forms.sql` removes only those
  associations from existing Kaikki-derived database entries. It preserves
  lexemes, senses, translations, valid forms and story sense preferences.

Regression tests exercise direct forms, `form_of`, `alt_of`, both supplementary
alias routes and supplemental direct forms in both languages. A migration test
reproduces the bad lookups, verifies the repair, checks every unaffected form
and definition table, preserves a story sense preference, verifies foreign keys,
and confirms that reapplying the migration is harmless.

Validation completed on 2026-09-06:

- **137 tests passed, zero failed, one skipped** (the opt-in live audio-provider
  test). This includes 13 new dictionary repair regressions.
- The locally reconstructed database retains **100% English coverage** of all
  **4,085 unique forms** in real A1/A2 stories after the cleanup.
- Only migration 0022 was pending, and only that migration was applied remotely.
  A D1 recovery bookmark was captured before the repair.
- **All 15 affected word forms were checked through the live dictionary API**:
  each still has a translation and none returns its incorrect associated lemma.
  In particular, мама no longer returns озимина; червоний no longer returns
  рясний; парк no longer returns лісопарк.
- The live database retained all **3,525 lexemes**, **5,845 senses** and
  **5,845 translations**. Form records decreased from **13,315 to 13,287**:
  exactly **28** incorrect records removed (15 distinct form/entry pairs).
  The three original lexemes and their seven senses remain. Foreign-key checks
  report no violations.
- The deep live-content check still opens **117 A1/A2 stories** with matching
  paragraphs and five questions each. Hidden B1 placeholders are excluded.

No Worker code or frontend deployment was needed for that September 6 repair;
the public version at that checkpoint was 0.82. The optional German supplement
and pronunciation setting were unchanged.

### Audit limitations

`scripts/check-dictionary-paradigms.mjs` scans **historical English seeds 0012
and 0017**, containing 2,771 lexemes. It does not replay later migrations or
read production. Its six candidates include the three confirmed defects and
three legitimate alternation candidates. It cannot detect all corruption and
does not assess German or curated entries. **Three found is not a total error
count or a measured overall error rate.** The repaired entries will still appear
in that historical scan; use the regression tests and live lookups for repair
verification.

The source word pages were inspected on 2026-09-06:
[озимина](https://kaikki.org/dictionary/Ukrainian/meaning/о/оз/озимина.html),
[рясний](https://kaikki.org/dictionary/Ukrainian/meaning/р/ря/рясний.html),
[лісопарк](https://kaikki.org/dictionary/Ukrainian/meaning/л/лі/лісопарк.html).

## Current product and content

- Public version: **0.83** at https://readukrainianapp.com.
- **19 A1 + 103 A2 stories**, each with five questions. On 2026-09-08 all 122
  live stories and their complete question sets matched the repository.
- B1 is hidden and has no real content. The 15 repository rows are placeholders.
- Reading, quizzes, search/filtering, bookmarks, browser-saved progress, and
  private draft/publish/revision workflows are implemented.
- English and German dictionaries are available. Pronunciation is implemented
  but its production setting was **off** when checked on 2026-09-06.
- English coverage of real A1/A2 story vocabulary is **4,129/4,129 (100%)**
  in the locally reconstructed standard database. Coverage is not accuracy.
- Historical German coverage on 2026-09-06 was **1,221/4,085 (29.9%)**. The optional,
  unpublished Linguisto supplement raised it to **2,888/4,085 (70.7%)** locally.
  These pre-batch measurements are not current coverage of the expanded collection
  or an exhaustive live dictionary audit.
- Both levels pass the mechanical text checker. Warnings remain and the checker
  does not enforce the entire grammar inventory or every sentence/paragraph rule.

## Open work

1. Review the first A1 batch with a Ukrainian teacher and learners when available;
   complete the next batches, topics 20–40.
2. Define introduction and consolidation of A2 grammar, vocabulary and reading
   skills across groups of stories. No per-story quota has been adopted.
3. Develop B1 after the progression of the existing levels is clearer.
4. Validate a supported dictionary-source workflow. The Kaikki postprocessed
   downloads still responded on 2026-09-06 but are deprecated; the maintainer
   recommends raw extracts. A full replacement-source rebuild remains untested.
5. Expand and review German coverage, and decide when to activate pronunciation.

## Resolved and historical findings

- “44 A2 stories below target” is superseded by the rewrites; all 103 now pass.
- The parade/fireworks exception was settled by the owner on **2026-08-24**:
  topics 16, 46 and 67 retain **180–220 words**, overriding topic targets and
  preserving before/after-2022 material. It is not awaiting another decision.
- A2 #3 «Мій будинок» was restored by migration 0021 and verified live.
- The old “A1 has never been checked / six failures” claim is stale. The three
  identified grammar breaches were separately repaired and published in 0.83.
- The old 71.8% English coverage gap was repaired by refreshes and the reviewed
  supplement. The incorrect dictionary associations were a separate defect.
- The 71% A2 grammar-overlap figure dates to **2026-08-23**, before the rewrites.
  A later conversational 46% marker result has no verified script/definitions
  in this checkout. Neither is a current CEFR score or a basis for a full rewrite.

Private curriculum instructions and detailed historical audits remain under
`prompts/`. Use their current prompts and later recorded decisions; do not treat
an old audit's unresolved list as today's backlog.
