import test from "node:test";
import assert from "node:assert/strict";

import {
  applyStress,
  STRESS_MARK,
  stressKey,
  stripStressMarks,
  tokenizeParagraph,
} from "../public/js/app/story-words.mjs";

test("tokenizes a paragraph into words and the text between them, losslessly", () => {
  const paragraph = "Наша сім’я живе в будинку, 2 роки — по-українськи! OK?";
  const pieces = tokenizeParagraph(paragraph);

  assert.equal(pieces.map((piece) => piece.text).join(""), paragraph);
  assert.deepEqual(
    pieces.filter((piece) => piece.word).map((piece) => piece.text),
    ["Наша", "сім’я", "живе", "в", "будинку", "роки", "по-українськи"]
  );
});

test("keys words by unstressed lower-case spelling with one apostrophe form", () => {
  assert.equal(stressKey("Сім’я"), "сім'я");
  assert.equal(stressKey("сімʼя́"), "сім'я");
  assert.equal(stripStressMarks("ма́ма"), "мама");
});

test("applies the stressed letter while keeping the word's own case and apostrophe", () => {
  const stressMap = { мама: 1, "сім'я": 4, київ: 1, "по-українськи": 7 };

  assert.equal(applyStress("мама", stressMap), `ма${STRESS_MARK}ма`);
  assert.equal(applyStress("Мама", stressMap), `Ма${STRESS_MARK}ма`);
  assert.equal(applyStress("сім’я", stressMap), `сім’я${STRESS_MARK}`);
  assert.equal(applyStress("Київ", stressMap), `Ки${STRESS_MARK}їв`);
  assert.equal(applyStress("по-українськи", stressMap), `по-украї${STRESS_MARK}нськи`);
});

test("marks every stress of a compound and leaves unknown words alone", () => {
  assert.equal(applyStress("завжди", { завжди: [1, 5] }), `за${STRESS_MARK}вжди${STRESS_MARK}`);
  assert.equal(applyStress("руки", { мама: 1 }), "руки");
  assert.equal(applyStress("руки", null), "руки");
});
