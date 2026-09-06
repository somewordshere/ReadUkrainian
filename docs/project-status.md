# Read Ukrainian — project status

Last reconciled: **2026-09-06**. This is a dated checkpoint, not a live dashboard.

## Dictionary repair

**Implemented locally and applied to production on 2026-09-06.** Source and
documentation changes are currently local and uncommitted; future builds must
use the corrected generator. Migration 0022 is recorded in production D1.

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

No Worker code or frontend deployment was needed; the public version remains
0.82. The optional German supplement and pronunciation setting were unchanged.

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

- Public version: **0.82** at https://readukrainianapp.com.
- **14 A1 + 103 A2 stories**, each with five questions. On 2026-09-06 all 117
  live stories matched the repository paragraphs.
- B1 is hidden and has no real content. The 15 repository rows are placeholders.
- Reading, quizzes, search/filtering, bookmarks, browser-saved progress, and
  private draft/publish/revision workflows are implemented.
- English and German dictionaries are available. Pronunciation is implemented
  but its production setting was **off** when checked on 2026-09-06.
- English coverage of real A1/A2 story vocabulary is **4,085/4,085 (100%)**
  in the locally reconstructed standard database. Coverage is not accuracy.
- German coverage in that database is **1,221/4,085 (29.9%)**. The optional,
  unpublished Linguisto supplement raises it to **2,888/4,085 (70.7%)** locally.
  These are local database measurements, not an exhaustive live dictionary audit.
- Both levels pass the mechanical text checker. Warnings remain and the checker
  does not enforce the entire grammar inventory or every sentence/paragraph rule.

## Open work

1. Three A1 passages still breach the project's grammar exclusions: #5 uses
   `якщо`; #8 uses relative `якого`; #9 uses relative `який`. Repair locally,
   then check affected questions, length and dictionary coverage.
2. A1 topics 15–40 have specifications but no stories/questions. The proposed
   first batch is 15–19.
3. Define introduction and consolidation of A2 grammar, vocabulary and reading
   skills across groups of stories. No per-story quota has been adopted.
4. Develop B1 after the progression of the existing levels is clearer.
5. Arrange a private versioned backup for `prompts/`. It remains gitignored;
   external backup has not been verified. The private README was reconciled
   without publishing the prompts, and its previous text is archived locally.
6. Validate a supported dictionary-source workflow. The Kaikki postprocessed
   downloads still responded on 2026-09-06 but are deprecated; the maintainer
   recommends raw extracts. A full replacement-source rebuild remains untested.
7. Connect the existing automated tests and live-content checks to releases.
   No GitHub workflows were configured when inspected on 2026-09-06.

## Resolved and historical findings

- “44 A2 stories below target” is superseded by the rewrites; all 103 now pass.
- The parade/fireworks exception was settled by the owner on **2026-08-24**:
  topics 16, 46 and 67 retain **180–220 words**, overriding topic targets and
  preserving before/after-2022 material. It is not awaiting another decision.
- A2 #3 «Мій будинок» was restored by migration 0021 and verified live.
- The old “A1 has never been checked / six failures” claim is stale. Passing
  today's mechanical checker does not resolve the three grammar items above.
- The old 71.8% English coverage gap was repaired by refreshes and the reviewed
  supplement. The incorrect dictionary associations were a separate defect.
- The 71% A2 grammar-overlap figure dates to **2026-08-23**, before the rewrites.
  A later conversational 46% marker result has no verified script/definitions
  in this checkout. Neither is a current CEFR score or a basis for a full rewrite.

Private curriculum instructions and detailed historical audits remain under
`prompts/`. Use their current prompts and later recorded decisions; do not treat
an old audit's unresolved list as today's backlog.
