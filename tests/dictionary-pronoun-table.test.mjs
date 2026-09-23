import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const migration = (name) => readFileSync(join(ROOT, "migrations", name), "utf8");

// The shared table English Wiktionary now shows on every personal pronoun's page,
// in the shape Kaikki exports it (abridged; stress marks as in the source).
const row = (form, ...tags) => ({ form, tags: ["personal", "pronoun", ...tags] });
const SHARED_TABLE = [
  { form: "no-table-tags", tags: ["table-tags"] },
  row("я", "first-person", "nominative", "singular"),
  row("мене́", "first-person", "genitive", "singular"),
  row("мені́", "dative", "first-person", "singular"),
  row("ти", "informal", "nominative", "second-person", "singular"),
  row("тебе́", "genitive", "informal", "second-person", "singular"),
  row("тобі́", "dative", "informal", "second-person", "singular"),
  row("він", "masculine", "nominative", "singular", "third-person"),
  row("його́", "genitive", "masculine", "singular", "third-person"),
  row("вона́", "feminine", "nominative", "singular", "third-person"),
  row("ми", "first-person", "nominative", "plural"),
  row("нас", "first-person", "genitive", "plural"),
];

const ROMANIZATIONS = { я: "ja", ти: "ty", він: "vin", ми: "my", його: "joho" };

function pronoun(word, gloss) {
  return {
    word, pos: "pron", lang_code: "uk",
    forms: [{ form: ROMANIZATIONS[word], tags: ["romanization"] }, ...SHARED_TABLE],
    senses: [{ id: `fixture-${word}`, glosses: [gloss] }],
  };
}

function build(target, source, supplement = null) {
  const directory = mkdtempSync(join(tmpdir(), "readukrainian-pronouns-"));
  const sqlite = new DatabaseSync(":memory:");
  try {
    const sourcePath = join(directory, "source.jsonl");
    const outputPath = join(directory, "output.sql");
    writeFileSync(sourcePath, source.map((entry) => JSON.stringify(entry)).join("\n"));
    const args = [
      join(ROOT, "scripts/dictionary/build-dictionary-seed.mjs"),
      "--source", sourcePath, "--revision", "2026-09-23", "--target", target,
      "--scope", "all", "--output", outputPath,
    ];
    if (supplement) {
      const supplementPath = join(directory, "supplement.jsonl");
      writeFileSync(supplementPath, supplement.map((entry) => JSON.stringify(entry)).join("\n"));
      args.push("--forms-source", supplementPath);
    }
    execFileSync(process.execPath, args, { encoding: "utf8" });
    sqlite.exec(migration("0011_dictionary_schema.sql"));
    sqlite.exec(migration("0013_dictionary_workflow.sql"));
    sqlite.exec(readFileSync(outputPath, "utf8"));
    return (lemma) => sqlite.prepare(`
      SELECT DISTINCT f.normalized_form FROM dictionary_forms f
      JOIN dictionary_lexemes l ON l.id = f.lexeme_id WHERE l.normalized_lemma = ?
    `).all(lemma).map(({ normalized_form: form }) => form).sort();
  } finally {
    // The query closure above has already read everything it needs.
    queueMicrotask(() => sqlite.close());
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
}

const EXPECTED = {
  "я": ["мене", "мені", "я"],
  "ти": ["тебе", "ти", "тобі"],
  "він": ["він", "його"],
  "ми": ["нас", "ми"],
  // A possessive pronoun page carries the table but has no nominative row of its own.
  "його": ["його"],
};

test("a shared personal-pronoun table only gives each pronoun its own forms", () => {
  const formsFor = build("en", [
    pronoun("я", "I"),
    pronoun("ти", "you"),
    pronoun("він", "he"),
    pronoun("ми", "we"),
    pronoun("його", "his"),
  ]);
  for (const [lemma, forms] of Object.entries(EXPECTED)) {
    assert.deepEqual(formsFor(lemma), [...forms].sort(), lemma);
  }
});

test("German entries borrowing forms from the English table get the same filtering", () => {
  const german = (word, gloss) => ({
    word, pos: "pron", lang_code: "uk",
    forms: [{ form: word, tags: ["transcription"] }],
    senses: [{ id: `fixture-de-${word}`, glosses: [gloss] }],
  });
  const formsFor = build(
    "de",
    [german("я", "ich"), german("ти", "du"), german("він", "er"), german("ми", "wir"), german("його", "sein")],
    [pronoun("я", "I"), pronoun("ти", "you"), pronoun("він", "he"), pronoun("ми", "we"), pronoun("його", "his")]
  );
  for (const [lemma, forms] of Object.entries(EXPECTED)) {
    assert.deepEqual(formsFor(lemma), [...forms].sort(), lemma);
  }
});

test("pronouns without the shared table keep all their forms", () => {
  const formsFor = build("en", [{
    word: "себе", pos: "pron", lang_code: "uk",
    forms: [
      { form: "себе́", tags: ["accusative"] },
      { form: "собі́", tags: ["dative"] },
      { form: "собо́ю", tags: ["instrumental"] },
    ],
    senses: [{ id: "fixture-себе", glosses: ["oneself"] }],
  }]);
  assert.deepEqual(formsFor("себе"), ["себе", "собі", "собою"].sort());
});
