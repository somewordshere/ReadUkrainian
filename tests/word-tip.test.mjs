import assert from "node:assert/strict";
import test from "node:test";

import { TIP_WORDS, pickTipWordIndex } from "../public/js/app/word-tip.mjs";

const words = (paragraphs) =>
  paragraphs.flatMap((text, paragraph) => text.split(" ").map((word) => ({ word, paragraph })));

test("points at a common word in the first paragraph, each distinct word equally likely", () => {
  // Candidates: «Мама» (first occurrence only), «тато», «вдома»; «Сьогодні» is in paragraph 2.
  const story = words(["Мама і тато вдома Мама каже", "Сьогодні день"]);
  assert.equal(pickTipWordIndex(story, () => 0), 0);
  assert.equal(pickTipWordIndex(story, () => 0.5), 2);
  assert.equal(pickTipWordIndex(story, () => 0.99), 3);
});

test("falls back to the second paragraph, then to any longer first-paragraph word", () => {
  assert.equal(pickTipWordIndex(words(["Я і ти", "Сьогодні тихо"]), () => 0), 3);
  assert.equal(pickTipWordIndex(words(["Я і сонце", "Ми"]), () => 0), 2);
  assert.equal(pickTipWordIndex(words(["Я і", "Ми"]), () => 0), -1);
  assert.equal(pickTipWordIndex([], () => 0), -1);
});

test("matches words regardless of case and apostrophe style", () => {
  assert.equal(pickTipWordIndex(words(["ЙОГО книга"]), () => 0), 0);
});

test("tip words are unique, lower-case and at least three letters", () => {
  assert.equal(new Set(TIP_WORDS).size, TIP_WORDS.length);
  for (const word of TIP_WORDS) {
    assert.equal(word, word.toLocaleLowerCase("uk-UA"));
    assert.ok([...word].length >= 3, word);
  }
});
