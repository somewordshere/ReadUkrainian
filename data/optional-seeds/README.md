# Optional seeds

SQL in this directory is **not** a migration and is never applied automatically.

`wrangler d1 migrations apply` applies every unapplied file in `migrations/` and
offers no way to select a subset, so a file kept there but deliberately withheld
from production is one routine deploy away from shipping by accident.

## dictionary_linguisto_uk_de.sql

Ukrainian→German translations from the Linguisto dictionary (release 2018-04-12,
Creative Commons Attribution). Committed in `07b8c0d` as in-flight work and never
applied to production, so these translations are absent from the live site.

`tests/dictionary-workflow.test.mjs` loads it explicitly, which is why the German
lookups and coverage figures in that suite include Linguisto data that production
does not have.

Do not move this complete seed into production migrations. Editorial review for
0.84 found unsuitable senses among the automatic matches. Only the 311 explicit
approvals in `data/dictionary-german-review-084.json` ship through migration 0026;
all remaining candidates stay here for further review.
