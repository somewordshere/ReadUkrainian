# Release 0.85 — A1 passage revision

Published 2026-09-16 in response to feedback that A1 20–24 felt too short.

The five passages now use the upper end of their **unchanged** topic limits:

| A1 story | Previous words | Revised words | Paragraphs |
|---|---:|---:|---:|
| 20 — Погода сьогодні | 80 | 90 | 2 |
| 21 — Пори року | 100 | 105 | 3 |
| 22 — Мій одяг | 92 | 100 | 3 |
| 23 — Кольори навколо мене | 80 | 90 | 2 |
| 24 — Котра година? | 82 | 90 | 2 |

The batch average rises from 86.8 to 95 words; stories 1–10 average 97.8.
Scenes and action sequences are clearer, the seasons passage loses the empty
«Дерево поруч» line, and the clock story uses three distinct full hours with a
concrete search for keys. The longest sentence is 11 words.

## Preservation and dictionaries

Migration 0029 changes only the five paragraph arrays and their update times.
It refuses changed published passages or questions. All story/question IDs,
titles, 25 quiz records, enabled flags, drafts, revisions, dictionary preferences
and pronunciation settings remain intact. The corpus remains 127 stories and
635 questions; B1 stays excluded. Migrations through 0027 remain immutable.

Migration 0028 adds reviewed inflections to existing dictionary lexemes, retaining
their translations and attribution. English coverage is **4,159/4,159 (100%)**;
German is **1,579/4,159 (38.0%)**, leaving 2,580 forms uncovered. This is coverage,
not an exhaustive translation-accuracy assessment.

## Validation

- Full local check: 160 passed, zero failed, one optional live-provider test skipped.
- Focused regressions cover topic bands, sentence/paragraph limits, vocabulary
  recycling, stable quiz records, preserved editorial data and pronunciation
  settings, editorial-drift rejection, migration order and dictionary mappings.
- All 25 question answers were checked against the revised passages; the private
  audit records exact supporting sentences. The A1 prompt and topic specifications
  were not rewritten to accommodate the revisions.
- External teacher/learner feedback remains pending. Vocabulary recycling and
  surface-form counts do not prove how many words a particular beginner knows;
  the audit makes no claim that a three-word instructional list proves that limit.

## Publication and recovery

The [manual production workflow](https://github.com/somewordshere/ReadUkrainian/actions/runs/35104828324)
passed after explicit approval to publish 0.85. It deployed merge commit
`ad3ec88bb819fdae96ae6d009a0bf052798fd968`, Worker version
`e73dd8fb-43ab-4bbf-82d1-f1fb9f444033`, and applied migrations 0028 and 0029.
All **127 live stories and 635 complete questions** matched the repository;
**74 dictionary probes** passed, including the three repaired associations.
The workflow repeated the full checks successfully before deployment.

The workflow captured previous passages, questions, speech settings and recovery
information before changing production. The recovery artifact was downloaded to
the ignored local folder `.local-release/github-recovery-085`; the production log
is `.local-release/release-085-production.log`.

## Browser and audio evidence

- Desktop (1365×900) and mobile viewport (390×844): the revised clock passage
  displays 90 words, with no horizontal overflow. The page shows version 0.85.
- The pre-existing bookmark and completed 5/5 quiz survived publication and
  reload on both viewports. The test did not clear or restart saved progress.
- Both English and German lookups for the newly mapped form «своїй» resolved to
  «свій» with the existing translations and source attribution.
- Browser pronunciation for «своїй» reached “Відтворення завершено.”.
  Separate live API checks returned valid 26,156-byte Lada WAV audio twice
  (both cache hits); a multiword request was rejected with HTTP 422.
  Results are in `.local-release/live-speech-085.json`. The live uncached provider
  validation from 0.84 remains recorded separately; this API repeat proves cached
  audio delivery. The configured voice, 4,500-character limit and disclosure are unchanged.
- The dictionary selection was restored to English and the temporary viewport
  override was removed after checks.

## Private backup and outstanding review

Private curriculum commit `d209a516fb596fce2347d9661d180bf91d3c65db` is pushed.
Repository privacy and all **28 files** were verified byte for byte against a fresh
checkout after the publication notes were updated. External teacher/learner
responses remain pending; automated, editorial and browser checks are not human
review or proof of every learner's vocabulary knowledge.
