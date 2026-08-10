import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeSpeechWord,
  extractCanonicalSpeechWords,
  speechAssetFilename,
} from "./normalization.mjs";

test("canonicalizes Ukrainian case and joiner variants", () => {
  assert.equal(canonicalizeSpeechWord("  П’ЄСА  "), "п'єса");
  assert.equal(canonicalizeSpeechWord("ПІВ–ЄВРОПИ"), "пів-європи");
});

test("rejects phrases, punctuation, digits, and non-Ukrainian letters", () => {
  assert.equal(canonicalizeSpeechWord("два слова"), null);
  assert.equal(canonicalizeSpeechWord("слово!"), null);
  assert.equal(canonicalizeSpeechWord("тест2"), null);
  assert.equal(canonicalizeSpeechWord("hello"), null);
});

test("extracts only canonical Ukrainian tokens", () => {
  assert.deepEqual(
    extractCanonicalSpeechWords(
      "Наша сім’я — вдома. English 123 пів–Європи сло́во слово2 abcслово."
    ),
    ["наша", "сім'я", "вдома", "пів-європи"]
  );
});

test("uses lowercase SHA-256 UTF-8 filenames", () => {
  assert.equal(
    speechAssetFilename("наша"),
    "8fd452e848de0209b11319061ae97cd9b26efac3b2ec267d40f60940d1866b2a.mp3"
  );
});
