import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_SAVED_WORDS,
  SAVED_WORDS_STORAGE_KEY,
  createSavedWords,
  normalizeSavedWord,
  parseSavedWords,
  savedWordFromLookup,
  sentenceAround,
  wordsLabel,
} from "../public/js/app/saved-words.mjs";

function createStorage(seed = {}) {
  const entries = new Map(Object.entries(seed));
  return {
    entries,
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => entries.set(key, String(value)),
  };
}

function clock(start = Date.parse("2026-10-16T10:00:00Z")) {
  let time = start;
  return () => new Date((time += 1000));
}

const BOOK = {
  word: "книгу",
  lemma: "книга",
  partOfSpeech: "іменник",
  translations: ["book"],
  language: "en",
  sentence: "Я читаю книгу.",
  storyId: 7,
  level: "A1",
  order: 3,
  storyTitle: "Мій день",
};

test("saves a word in this browser and finds it again by any spelling of the form", () => {
  const storage = createStorage();
  const savedWords = createSavedWords(storage, { now: clock() });

  assert.equal(savedWords.save(BOOK), "saved");
  assert.equal(savedWords.has("книгу"), true);
  assert.equal(savedWords.has("Кни́гу"), true, "stress marks and capitals do not make another word");
  assert.equal(savedWords.has("книга"), false, "the lemma is another form");

  const stored = JSON.parse(storage.entries.get(SAVED_WORDS_STORAGE_KEY));
  assert.equal(stored.version, 1);
  assert.equal(stored.words[0].word, "книгу");
  assert.equal(stored.words[0].key, "книгу");

  // A fresh page reads what the last one wrote.
  assert.deepEqual(createSavedWords(storage).list(), savedWords.list());
});

test("apostrophe variants are one word", () => {
  const savedWords = createSavedWords(createStorage(), { now: clock() });
  savedWords.save({ ...BOOK, word: "сім’я" });
  assert.equal(savedWords.has("сім'я"), true);
  assert.equal(savedWords.has("сімʼя"), true);
});

test("the newest word comes first and saving again moves a word to the top", () => {
  const savedWords = createSavedWords(createStorage(), { now: clock() });
  savedWords.save({ ...BOOK, word: "мама" });
  savedWords.save({ ...BOOK, word: "тато" });
  savedWords.save({ ...BOOK, word: "мама", translations: ["mum"] });

  assert.deepEqual(savedWords.list().map((entry) => entry.word), ["мама", "тато"]);
  assert.deepEqual(savedWords.list()[0].translations, ["mum"]);
});

test("removing and restoring a word keeps its place", () => {
  const savedWords = createSavedWords(createStorage(), { now: clock() });
  ["мама", "тато", "брат"].forEach((word) => savedWords.save({ ...BOOK, word }));
  const tato = savedWords.list()[1];

  assert.equal(savedWords.remove("тато"), true);
  assert.deepEqual(savedWords.list().map((entry) => entry.word), ["брат", "мама"]);
  assert.equal(savedWords.restore(tato), true);
  assert.deepEqual(savedWords.list().map((entry) => entry.word), ["брат", "тато", "мама"]);
});

test("the list stops at the cap instead of dropping old words", () => {
  const storage = createStorage();
  const savedWords = createSavedWords(storage, { now: clock() });
  for (let index = 0; index < MAX_SAVED_WORDS; index += 1) {
    assert.equal(savedWords.save({ ...BOOK, word: `слово${index}` }), "saved");
  }

  assert.equal(savedWords.save({ ...BOOK, word: "нове" }), "full");
  assert.equal(savedWords.count(), MAX_SAVED_WORDS);
  assert.equal(savedWords.save({ ...BOOK, word: "слово0", translations: ["again"] }), "saved", "a saved word can still be updated");
});

test("blocked or full storage fails without throwing or losing the list", () => {
  const savedWords = createSavedWords(null);
  assert.equal(savedWords.available, false);
  assert.equal(savedWords.save(BOOK), "failed");
  assert.deepEqual(savedWords.list(), []);

  const storage = createStorage();
  const full = createSavedWords(storage, { now: clock() });
  full.save(BOOK);
  storage.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  assert.equal(full.save({ ...BOOK, word: "мама" }), "failed");
  assert.deepEqual(full.list().map((entry) => entry.word), ["книгу"]);

  const unreadable = createSavedWords({
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {},
  });
  assert.deepEqual(unreadable.list(), []);
});

test("stored data is untrusted: bad entries are dropped and fields are rebuilt", () => {
  const raw = JSON.stringify({
    version: 1,
    words: [
      { word: "мама", translations: ["mum", 5, "", "x".repeat(500)], storyId: "12", level: "Z9", savedAt: "2026-10-01T00:00:00Z", extra: "<b>" },
      { word: "two words" },
      { word: "hello" },
      { word: "" },
      null,
      ["мама"],
      { word: "мама", savedAt: "2026-09-01T00:00:00Z" },
    ],
  });
  const words = parseSavedWords(raw);

  assert.equal(words.length, 1, "non-Cyrillic, multi-word, empty and duplicate entries are dropped");
  assert.equal(words[0].savedAt, "2026-10-01T00:00:00.000Z", "the newer copy of a duplicate wins");
  assert.deepEqual(words[0].translations, ["mum", "5", "x".repeat(200)]);
  assert.equal(words[0].storyId, 12);
  assert.equal(words[0].level, "");
  assert.equal(Object.hasOwn(words[0], "extra"), false);

  assert.deepEqual(parseSavedWords("{not json"), []);
  assert.deepEqual(parseSavedWords('{"__proto__": {"polluted": true}}'), []);
  assert.equal({}.polluted, undefined);
  assert.equal(normalizeSavedWord("мама"), null);
});

test("export and import carry the list to another browser", () => {
  const first = createSavedWords(createStorage(), { now: clock() });
  first.save({ ...BOOK, word: "мама" });
  first.save({ ...BOOK, word: "тато" });
  const file = first.exportJson();

  const second = createSavedWords(createStorage(), { now: clock(Date.parse("2026-10-17T00:00:00Z")) });
  second.save({ ...BOOK, word: "брат" });
  assert.equal(second.importJson(file), 2);
  assert.deepEqual(second.list().map((entry) => entry.word), ["брат", "тато", "мама"]);
  assert.equal(second.importJson(file), 0, "importing the same file again adds nothing");

  assert.equal(second.importJson("not json"), -1);
  assert.equal(second.importJson('{"something": "else"}'), -1);
  assert.equal(second.count(), 3, "a rejected file changes nothing");
});

test("finds the sentence a word stands in", () => {
  const paragraph = "Мене звати Олег. Я читаю книгу! А ти? Ми йдемо…";
  assert.equal(sentenceAround(paragraph, paragraph.indexOf("книгу")), "Я читаю книгу!");
  assert.equal(sentenceAround(paragraph, 0), "Мене звати Олег.");
  assert.equal(sentenceAround(paragraph, paragraph.indexOf("А ти")), "А ти?");
  assert.equal(sentenceAround(paragraph, paragraph.indexOf("йдемо")), "Ми йдемо…");
  assert.equal(sentenceAround("«Привіт», — каже мама. Добре.", 3), "«Привіт», — каже мама.");
  assert.equal(sentenceAround("Без крапки", 4), "Без крапки");
});

test("takes the dictionary answer's lemma and puts this story's translation first", () => {
  const entry = savedWordFromLookup("книгу", {
    query: { text: "книгу", targetLanguage: "de" },
    entries: [
      { lemma: "книга", partOfSpeech: "noun", translations: [{ text: "Band" }, { text: "Buch", preferred: true }] },
      { lemma: "книжка", partOfSpeech: "noun", translations: [{ text: "Heft" }] },
    ],
  });
  assert.deepEqual(entry, { word: "книгу", lemma: "книга", partOfSpeech: "noun", translations: ["Buch", "Band"], language: "de" });

  const missing = savedWordFromLookup("Олег", { query: { text: "Олег", targetLanguage: "en" }, entries: [] });
  assert.deepEqual(missing.translations, []);
  assert.equal(normalizeSavedWord(missing).word, "Олег", "a word without a translation can still be saved");
});

test("counts words in Ukrainian", () => {
  assert.deepEqual(
    [1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111, 500].map(wordsLabel),
    ["1 слово", "2 слова", "4 слова", "5 слів", "11 слів", "12 слів", "14 слів", "21 слово", "22 слова", "25 слів", "101 слово", "111 слів", "500 слів"]
  );
});
