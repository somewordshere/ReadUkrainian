# Rebuilding dictionaries from raw extracts

Validated on 2026-09-15 for release 0.84. Kaikki's postprocessed downloads are
deprecated; obtain English, German and Polish **raw** gzip extracts from
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

## Shared word forms and the Polish dictionary

Since 1.04 Ukrainian word forms are shared by every translation language. A
lookup finds an entry through its own forms or through the forms the English
dictionary records for the same lemma and part of speech (`formEntriesCtes` and
`FORMS_REFERENCE_LANGUAGE` in `functions/_shared/dictionary.js`). English is the
reference because it covers every story word and its forms are what the guards
check; a repair to an English form therefore reaches every language. Other
languages' own forms still lead only to their own entries. Parts of speech are
compared and reported spelled out (`adj` and `adjective` are one), and entries
that otherwise tie keep their source order. Coverage (`analyzeDictionaryCoverage`)
follows the same forms, so a word counts as covered exactly when a lookup shows it.

Polish Wiktionary lists no Ukrainian inflections, so the Polish seed carries no
forms at all. Build it from the official Polish extract after English is installed:

```sh
node scripts/dictionary/extract-raw-ukrainian.mjs --source pl-extract.jsonl.gz --edition pl --revision YYYY-MM-DD --source-url https://kaikki.org/dictionary/downloads/pl/pl-extract.jsonl.gz --output NEW_UK_PL.jsonl
node scripts/dictionary/build-dictionary-seed.mjs --source NEW_UK_PL.jsonl --revision YYYY-MM-DD --target pl --output NEW_PL.sql
```

The builder keeps a Polish entry only when the installed English forms of a story
word lead to its lemma and part of speech. Where Polish Wiktionary names a word's
part of speech differently (a pronoun «цей», an adjective «два», a particle «не»),
the entry is filed under English's when both belong to one interchangeable group
and English has exactly one of them; nouns and names are never interchanged. The
SQL header lists every such filing. Letter entries are left out, and glosses are
cleaned: "…wyrażający cel: na" becomes "na (wyrażający cel)", and "zob."
cross-references are dropped. Release 1.04 installs the 2026-09-20 extract as
migration 0035: 1,691 entries covering 3,308 of 4,159 A1–A2 story words (79.5%).

## German review

`data/dictionary-german-review-084.json` records every accepted lemma/translation
with passage evidence. The original optional seed contains 4,587 translation
candidates; 311 are accepted and 4,276 remain deferred. Known unsuitable examples
are recorded separately. Deferred does not mean proven wrong.

For the expanded 127-story corpus, German coverage increases from 1,224/4,158
(29.4%) to 1,573/4,158 (37.8%). The entire optional seed is still unpublished.
Coverage measures whether a form has a translation, not whether all senses are
accurate. See the versioned rebuild evidence for raw source hashes and results.
