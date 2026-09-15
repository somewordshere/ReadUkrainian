# Release 0.84

Prepared 2026-09-15. Publication and live acceptance are recorded below when complete.

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

- Full check: **155 passed, zero failed, one skipped** (the opt-in provider test).
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

Pending the checked production release and live browser acceptance.
