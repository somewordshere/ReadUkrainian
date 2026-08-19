import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("the Linguisto builder imports only ranked, exact, unambiguous POS matches", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "readukrainian-linguisto-"));
  const sourcePath = join(temporaryDirectory, "linguisto.xdxf");
  const seedPath = join(temporaryDirectory, "lexemes.sql");
  const outputPath = join(temporaryDirectory, "linguisto.sql");

  try {
    writeFileSync(sourcePath, `<?xml version="1.0" encoding="UTF-8"?>
<xdxf><lexicon>
  <ar><k>gelassen</k><def freq="5000"><gr>прикметник</gr><dtrn>спокійний</dtrn></def></ar>
  <ar><k>ruhig</k><def freq="100"><gr>прикметник</gr><dtrn>спокійний</dtrn></def></ar>
  <ar><k>zur Ruhe kommen</k><def freq="50"><gr>дієслово</gr><dtrn>стати спокійним</dtrn></def></ar>
  <ar><k>Mutter</k><def freq="20"><gr>іменник жіночого роду</gr><dtrn>мати</dtrn></def></ar>
</lexicon></xdxf>`, "utf8");
    writeFileSync(seedPath, `
INSERT OR IGNORE INTO dictionary_lexemes (id, source_language, lemma, normalized_lemma, part_of_speech, source_entry_id) VALUES ('lex-calm', 'uk', 'спокійний', 'спокійний', 'adj', 'calm');
INSERT OR IGNORE INTO dictionary_senses (id, lexeme_id, sense_order, usage_tags_json) VALUES ('sense-calm-1', 'lex-calm', 1, '[]');
INSERT OR IGNORE INTO dictionary_senses (id, lexeme_id, sense_order, usage_tags_json) VALUES ('sense-calm-2', 'lex-calm', 2, '[]');
INSERT OR IGNORE INTO dictionary_lexemes (id, source_language, lemma, normalized_lemma, part_of_speech, source_entry_id) VALUES ('lex-mother-1', 'uk', 'мати', 'мати', 'noun', 'mother-1');
INSERT OR IGNORE INTO dictionary_lexemes (id, source_language, lemma, normalized_lemma, part_of_speech, source_entry_id) VALUES ('lex-mother-2', 'uk', 'мати', 'мати', 'noun', 'mother-2');
`, "utf8");

    const stdout = execFileSync(process.execPath, [
      fileURLToPath(new URL("../scripts/dictionary/build-linguisto-seed.mjs", import.meta.url)),
      "--source", sourcePath,
      "--revision", "2018-04-12",
      "--lexeme-seed", seedPath,
      "--output", outputPath,
    ], { encoding: "utf8" });
    const result = JSON.parse(stdout);
    const sql = readFileSync(outputPath, "utf8");

    assert.equal(result.sourceArticles, 4);
    assert.equal(result.matchedLexemes, 1);
    assert.equal(result.translations, 2);
    assert.ok(sql.indexOf("'ruhig'") < sql.indexOf("'gelassen'"));
    assert.match(sql, /'lex-calm', 3, '\[\]'/u);
    assert.doesNotMatch(sql, /zur Ruhe kommen|Mutter/u);
    assert.match(sql, /Linguisto German–Ukrainian dictionary \(2018-04-12\)/u);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
