# Release 0.85 — A1 passage revision

Prepared 2026-09-16 in response to feedback that A1 20–24 felt too short.

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

Production workflow and browser evidence will be recorded after publication.
The existing manual workflow captures the previous passages, question records,
pronunciation setting and recovery information before applying these migrations.
