# Release 0.84

Published 2026-09-15; pronunciation and browser acceptance completed 2026-09-16.

## Changes

- Five A1 stories, topics 20–24, with 25 complete questions. Lengths are
  **80, 100, 92, 80 and 82 words**, all sentences at most 11 words.
- 25 reviewed English entries covering 27 missing forms; expanded English
  coverage is **4,158/4,158**.
- 311 reviewed German translations selected from the Linguisto supplement;
  German coverage rises from **1,224 to 1,573 of 4,158 forms** (29.4% → 37.8%).
  Other candidate translations remain unpublished.
- Supported raw dictionary extraction, deterministic IDs for raw senses,
  non-overwriting generators, and scratch-database rebuild validation.
- Version-selected release helpers and English/German live probes.
- Private A2 progression map covering all 103 stories, A1 15–19 learner review
  pack, separate teacher key and feedback form, and new-batch editorial evidence.

## Validation before publication

- Full check: **156 passed, zero failed, one skipped** (the opt-in provider test).
- The provider test passed separately for the production-selected Lada voice.
  The provider returns valid WAV even when MP3 is requested; the endpoint labels
  the validated format correctly. MAI Ukrainian is absent from the current public
  provider catalog; the existing Lada selection is retained.
- Full raw extracts filtered: **10,913,996 English-source rows → 59,877 Ukrainian
  entries**, and **1,329,116 German-source rows → 15,120 Ukrainian entries**.
  Repeated full builds are byte-identical. Source checksums and scratch-database
  results are in `data/releases/dictionary-rebuild-084.json`.
- Rebuild validation preserves every existing dictionary record and editorial
  preference; full upstream rebuilds remain unpublished candidates.
- Targeted migration tests preserve original content and questions, IDs,
  disabled flags, drafts, revision history and a stored dictionary preference.
  Occupied new-story slots stop the release instead of overwriting editorial work.

## Recovery

The release workflow saves affected content, deployed versions, a D1 recovery
bookmark and the previous pronunciation setting before applying migrations.
Use the version-aware rollback generator to hide this batch while preserving
its IDs and editorial history. Dictionary additions remain intact.

If pronunciation must be disabled, update only its enabled flag through the
existing administrator settings and retain the selected voice. The captured
pre-release setting supplies its original value.

## Review limitations

External teacher/learner review is pending; no participants were contacted.
Mechanical checks and agent editorial review do not establish learner suitability.
The acceptance document lists every newly encountered surface form; instructional
focus words are not a claim that learners know every other word. Dictionary
coverage does not measure exhaustive translation accuracy. B1 remains deferred.

## Publication evidence

### Automated release and live API checks

- [Production workflow 35013603070](https://github.com/somewordshere/ReadUkrainian/actions/runs/35013603070)
  passed on 2026-09-15. Deployed commit:
  `f04f83512b4dc0756d6f9c512d51c805433d2dcf`; Worker version:
  `3a4860ee-a40c-4559-aee5-c2599ddd3aa6`.
- All **127 live stories and 635 complete questions** matched the release;
  **56 English/German dictionary probes** passed, including the three previously
  repaired associations. Migrations 0025–0027 are applied; none remain pending.
- [PR 7](https://github.com/somewordshere/ReadUkrainian/pull/7) contains the release.
  The first workflow deployed successfully but its German verification used a
  lemma absent from the compact form index. [PR 8](https://github.com/somewordshere/ReadUkrainian/pull/8)
  selects the actual corpus form and adds a regression test; the complete rerun passed.
- The first run's pre-migration recovery record was downloaded to
  `.local-release/github-recovery-084/0.84-1789500075076.json`. The successful run
  also retained recovery artifact `recovery-f04f83512b4dc0756d6f9c512d51c805433d2dcf-1`.

### Pronunciation acceptance

- Lada was enabled at **2026-09-16 08:40:05 UTC**, setting version **8 → 9**.
  Previous state: Lada, disabled. Voice selection, AI-voice disclosure and the
  **4,500-character daily limit** are unchanged.
- The live endpoint returned **200, audio/wav, 26,156 bytes** for `сонце`;
  RIFF/WAVE bytes were validated and repeated requests reported cache `HIT`.
  A phrase was rejected with **422**, as the existing API specifies. Evidence:
  `.local-release/live-speech-084.json` and `.local-release/lada-084.wav`.
- Actual provider synthesis passed separately. Automated regressions cover
  missing words, disabled settings, quota exhaustion, provider failures and UI
  messages; these failure scenarios were not forced on production visitors.
- Existing story responses can briefly retain the old enabled state under their
  60-second cache / 300-second stale-revalidation policy. A subsequent browser
  reload displayed the enabled controls and completed playback successfully.

### Browser acceptance

- Desktop **1365×900**: library counts, new weather story, English `sun` and
  German `Sonne` (with Linguisto attribution), 5/5 quiz, bookmark and saved progress
  after reload passed on September 15.
- Mobile viewport **390×844**: telling-time story, 5/5 quiz, bookmark and all
  selected answers persisted after reload on September 16; no horizontal overflow.
  German `ключі` lookup displayed `Schlüssel` with source attribution.
- Mobile pronunciation for `ключі` progressed from loading to
  **«Відтворення завершено.»**; no browser errors or warnings were recorded.
  These are browser viewport checks, not physical-device or human listening review.

### Editorial and external review

Agent editorial checks, passage evidence for all 25 answers, vocabulary reuse and
complete topic specifications are recorded in the private A1 20–24 audit. The A2
map proposes a sequence for all 103 stories without changing public order. The
A1 15–19 learner pack and teacher key remain separate. External teacher/learner
responses are **pending**, with no outreach performed.

### Private backup

The final curriculum checkpoint was pushed to the private repository as
`84cc67f`. Repository privacy was reconfirmed on September 16; a fresh checkout
in `.local-release/curriculum-verify-084-published` matched all **27 curriculum
files byte for byte**. Public curriculum files remain gitignored.
