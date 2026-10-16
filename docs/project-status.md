# Read Ukrainian — project status

## 1.15 — saved words, beta badge (2026-10-16)

Code-only release; no migration, content or dictionary change.
- **Saved words.** The word popup has a «☆ Зберегти слово» toggle under the translation. A saved
  word keeps its form, lemma, part of speech, up to three translations (this story's first), the
  sentence it was tapped in and the story it came from. The list lives in `localStorage`
  (`readukrainian.saved-words`, `public/js/app/saved-words.mjs`), one entry per word form, capped at
  500. Nothing is sent to the server. Saved words get a dotted underline in every story.
- **«Мої слова»** (`public/words.html`, `noindex`, not in the sitemap) lists them newest first, with
  the sentence highlighted, a link back to the story, pronunciation through `/api/speech`, remove
  with undo, and a JSON file to export and import, so the list can move to another browser. It is
  linked from the library (with the count) and from the reader.
- **Beta badge** in the top-left corner of every learner page.
- Tests: `tests/saved-words.test.mjs`, plus popup tests in `tests/selection-speech.test.mjs`.

Next on this line: flashcards or spaced review on top of the saved list.

## 1.12 — 14 A1 stories corrected (2026-10-14)

Content release. The owner-reviewed corrections of 14 published A1 stories (1–4, 7, 9, 10, 12–14,
18, 20, 22, 23) are applied by `0041_a1_ladder_corrections.sql`: paragraphs only, after a guard
that stops if any affected story or question differs from the 1.11 baseline. They were made against
the level ladder (prompts are private): long sentences split, speech marked, one comparative and one
past form outside A1 replaced. Titles, quizzes, IDs, drafts and history are unchanged, and the
corrections use no word form the collection did not already have, so the dictionary and the static
audio need no change (`tests/release-112.test.mjs`).

Still not done: no native speaker has read the corrections; a review pack for one is prepared.
Five A1 stories (5, 6, 9, 11, 12) still break a ladder rule by the owner's choice.

## 1.11 — static audio in the site voice, hidden B1 kept hidden (published 2026-10-14)

**What 1.10 got wrong.** 1.10 (published 2026-10-13) shipped 4,165 MP3s for
`uk-UA-Chirp3-HD-Achernar`, the code default, but the site voice chosen in the admin is
`uk-UA-Chirp3-HD-Sadachbia`, and Achernar is not on the learner shortlist (Sadachbia,
Algenib, Callirrhoe, Kore). No static file was ever served: every word was synthesized
live by Google. Pronunciation worked, which also showed that the production
`GOOGLE_TTS_API_KEY` belongs to a billing-enabled project.

**1.11 changes:**
- The static set is rebuilt for **Sadachbia** in `public/speech/uk-UA-Chirp3-HD-Sadachbia/`,
  and the unused Achernar set is removed. It covers the 4,159 words in the text of the 127
  published stories. Words that occur only in a title, and learners who pick another
  shortlist voice, are still served live by Google.
- **Hidden B1 stays hidden.** The B1 level is inactive, but `/api/content` used to list its
  16 rows: 15 placeholders and a test story (id 265, «67»). A story is now public only
  while it is enabled *and* its level is open (`isPubliclyVisible` in
  `functions/_shared/texts.js`), for the library, the reader, pronunciation and word
  reports. The audio generator skips inactive levels too.
- **Pronunciation is checked daily.** `scripts/check-live-speech.mjs` runs in the release
  and the daily **Verify production** runs. It fails unless a story word plays from the
  static files of the site voice, so a voice mismatch like 1.10's, a disabled feature or
  a provider outage reaches GitHub's failure email within a day. Against the live 1.10
  site it fails as intended.

- **Readers can reach us, and search engines can find the site.** A new About and privacy
  page (`public/about.html`, linked under every learner page) holds a feedback form.
  Messages, with an email only if the reader leaves one, are stored by migration
  `0040_feedback.sql` and listed in the admin's Feedback card. `public/sitemap.xml` lists
  the 127 stories at the addresses Cloudflare serves them at (`/story?level=…&order=…`,
  `/about`) and is checked against the seed by `tests/sitemap.test.mjs`; rebuild it with
  `node scripts/build-sitemap.mjs` after a batch. The pages carry descriptions, share
  tags and canonical links.
- **Analytics is prepared, not on.** The CSP allows the Cloudflare Web Analytics beacon;
  the owner still has to switch Web Analytics on in the Cloudflare dashboard. The About
  page already says visits are counted that way.
- **Licence:** `LICENSE` states «all rights reserved», with the dictionary data
  (Wiktionary CC BY-SA, Linguisto CC BY) and the Literata font (SIL OFL) under their own
  licences.

Test story 265 («67», «67 31 dsad») is still enabled in the database. From 1.11 on it is
hidden with the rest of B1, but it would appear the day B1 opens: delete it in the admin.

The 1.09 checkpoint below describes the state before any audio was generated.

## 1.09 — checkpoint (2026-10-07)

Public version **1.09** (see [change.log](change.log)). Content is unchanged since 0.85:
**127 stories (24 A1 + 103 A2), 635 questions**; B1 remains hidden placeholders.
`npm test` on 2026-10-07: 270 tests, 269 passed, 0 failed, 1 skipped (the opt-in live
audio-provider test). The sections below are historical checkpoints from 0.83–0.85;
their coverage and test counts are not current.

**Pronunciation is blocked.** Google answers every Text-to-Speech request with
`403 BILLING_DISABLED`: the Cloud project behind `GOOGLE_TTS_API_KEY` has no billing
account. `/api/speech` therefore returns 502 for any word without a pre-generated MP3,
and `public/speech/` currently contains no audio for the default voice
(`uk-UA-Chirp3-HD-Achernar`). Fix: enable billing on the project (Chirp 3 HD stays within
the free allowance), confirm the production Worker secret, then run
`npm run speech:build` and release. See [scripts/speech/README.md](../scripts/speech/README.md).

Next steps, in order: restore pronunciation; saved-vocabulary list; page metadata,
sitemap and privacy-friendly analytics; A1 topics 20–40 with teacher review; B1.

## 0.85 — published and verified (2026-09-16)

A1 stories 20–24 are revised to **90, 105, 100, 90 and 90 words** using the
unchanged A1 prompt and topic limits. All 25 questions retain their wording and
answers. IDs, bookmarks, progress, drafts, revisions and preferences are preserved.

The [manual release](https://github.com/somewordshere/ReadUkrainian/actions/runs/35104828324)
passed: **127 stories, 635 questions and 74 dictionary probes** match production.
Full checks passed 160 tests, zero failures, with one optional provider test skipped.
Desktop/mobile reading, retained bookmark and 5/5 quiz after reload, both dictionary
languages and Lada playback passed. The voice and 4,500-character limit remain unchanged.

English coverage is **4,159/4,159 (100%)**; German is **1,579/4,159 (38.0%)**,
with 2,580 uncovered forms. Coverage does not establish translation accuracy.
See [the release evidence](release-0.85.md) for separate automated, editorial,
browser and audio results and recovery information.

Private backup `d209a51` is pushed; privacy and all **28 curriculum files** were
verified against a fresh checkout. External teacher/learner feedback remains
pending. B1 is deferred. The following checkpoints are historical.

## 0.84 — published and verified (2026-09-16)

Production now serves **24 A1 + 103 A2 stories: 127 stories and 635 questions**.
The [manual release](https://github.com/somewordshere/ReadUkrainian/actions/runs/35013603070)
passed, matching all live content and 56 dictionary probes. Full checks passed
156 tests, with zero failures and one optional provider test skipped; that test
passed separately against Lada.

English coverage is **4,158/4,158 (100%)**. The 311 reviewed German additions raise
coverage from **29.4% to 37.8% (1,573/4,158)**, leaving 2,585 forms uncovered.
Coverage is not translation accuracy. Raw English/German rebuilds were repeated
byte for byte; full upstream outputs remain unpublished review candidates.

**Lada pronunciation is enabled**, with actual production audio, cache reuse and
browser playback verified. The existing 4,500-character daily limit and AI-voice
disclosure remain. Desktop and mobile viewport reading, dictionaries, quizzes,
bookmarks and saved progress passed. See [release evidence](release-0.84.md).

Private curriculum materials include the 103-story A2 progression map, A1 15–19
learner pack, separate teacher key and feedback template, and the A1 20–24 audit.
External teacher/learner review remains pending; no outreach occurred. B1 is deferred.

Private backup commit `84cc67f` is pushed. Repository privacy and all 27 files were
verified against a fresh checkout on September 16.

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
are preserved in pushed commit `f944867`, merged into main with the A1 release.
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
