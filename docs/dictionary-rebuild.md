# Rebuilding dictionaries from raw extracts

Validated on 2026-09-15 for release 0.84. Kaikki's postprocessed downloads are
deprecated; obtain English and German **raw** gzip extracts from
[the official download page](https://kaikki.org/dictionary/rawdata.html).

Keep downloads and generated full seeds outside `migrations/`, for example under
the ignored `.local-release/raw/` directory. Record the upstream dump date when
available; otherwise record the capture date explicitly. The German 2026-09-15
revision in this validation is a capture date, not a verified dump date.

## Repeatable workflow

1. Save each complete compressed download. Retain its checksum and the resulting
   metadata file; the source URLs are mutable.
2. Filter Ukrainian entries in a streaming pass:

   ```sh
   node scripts/dictionary/extract-raw-ukrainian.mjs --source DOWNLOAD.jsonl.gz --edition en --revision YYYY-MM-DD --source-url OFFICIAL_URL --output NEW_UK_EN.jsonl
   ```

   Repeat with `--edition de`. A successful extraction writes a metadata sidecar
   containing both input and filtered SHA-256 checksums and entry counts. Partial
   outputs without successful metadata must not be used. Use a fresh filename
   after a failure; existing files are never overwritten.
3. Build candidate dictionaries:

   ```sh
   node scripts/dictionary/build-dictionary-seed.mjs --source NEW_UK_EN.jsonl --revision YYYY-MM-DD --output NEW_EN.sql
   node scripts/dictionary/build-dictionary-seed.mjs --source NEW_UK_DE.jsonl --forms-source NEW_UK_EN.jsonl --target de --revision YYYY-MM-DD --output NEW_DE.sql
   ```

   Raw senses lack the old postprocessor IDs. The builder assigns deterministic
   identities from source edition, lemma, part of speech, etymology, gloss and
   tags. Existing postprocessed IDs remain unchanged. Known bad form associations
   are excluded after every form/alias source has been merged.
4. Run both builds again to different filenames and compare file hashes. Validate
   candidates in a scratch database:

   ```sh
   node scripts/dictionary/validate-rebuild.mjs --en NEW_EN.sql --de NEW_DE.sql --output NEW_REPORT.json
   npm run check:dictionary -- --missing
   ```

   This checks additive compatibility: existing rows and sense preferences must
   remain intact, foreign keys must hold, English coverage must remain complete,
   and the three repaired associations must remain absent in both languages.

## Publication boundary

Full raw builds are validation artifacts. They contain new upstream definitions
and different identities; importing everything would add duplicate senses and
unreviewed meanings. Release 0.84 publishes only the reviewed English supplement
and 311 explicitly approved Linguisto translations. It does not replace the live
dictionary with an unreviewed raw rebuild.

Keep historical migrations immutable. All three dictionary generators require an
explicit unused output filename. For a later dictionary refresh, review the
meaning/form changes, create a new bounded migration, preserve old referenced
senses, and use the existing guarded release procedure.

## German review

`data/dictionary-german-review-084.json` records every accepted lemma/translation
with passage evidence. The original optional seed contains 4,587 translation
candidates; 311 are accepted and 4,276 remain deferred. Known unsuitable examples
are recorded separately. Deferred does not mean proven wrong.

For the expanded 127-story corpus, German coverage increases from 1,224/4,158
(29.4%) to 1,573/4,158 (37.8%). The entire optional seed is still unpublished.
Coverage measures whether a form has a translation, not whether all senses are
accurate. See the versioned rebuild evidence for raw source hashes and results.
