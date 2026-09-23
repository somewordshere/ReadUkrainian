import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// questions.js is a classic script that publishes globals, so it is evaluated
// in a VM rather than imported.
const context = vm.createContext({});
vm.runInContext(
  `${fs.readFileSync("public/js/app/questions.js", "utf8")}
  ;globalThis.__api = { prepareQuestions, carryOverLegacyAnswers };`,
  context
);
const { prepareQuestions, carryOverLegacyAnswers } = context.__api;
const plain = (value) => JSON.parse(JSON.stringify(value));

function question(prompt = "Хто?") {
  return { prompt, correct: "C", wrong: ["w1", "w2", "w3"] };
}

test("the correct answer is equally likely in every position", () => {
  const counts = [0, 0, 0, 0];
  let total = 0;
  for (const level of ["A1", "A2"]) {
    for (let story = 1; story <= 150; story += 1) {
      const questions = Array.from({ length: 5 }, () => question());
      for (const prepared of prepareQuestions(questions, `${level}-${story}`)) {
        counts[prepared.correctIndex] += 1;
        total += 1;
      }
    }
  }

  // 1,500 questions: a fair shuffle stays well within 20-30% per position.
  // The old one put the answer first 33% of the time and second 17%.
  for (const count of counts) {
    const share = count / total;
    assert.ok(share > 0.2 && share < 0.3, `position share ${(share * 100).toFixed(1)}%`);
  }
});

test("orders are stable per question and differ between look-alike seeds", () => {
  const first = plain(prepareQuestions([question(), question()], "A2-12"));
  assert.deepEqual(plain(prepareQuestions([question(), question()], "A2-12")), first);

  // The old shuffle summed character codes, so these two always matched.
  const swapped = plain(prepareQuestions([question(), question()], "A2-21"));
  assert.notDeepEqual(swapped.map((item) => item.options), first.map((item) => item.options));
});

test("legacyOptions reproduce the order shown before 1.02", () => {
  // Recorded from the previous shuffle before it was replaced.
  const prepared = plain(prepareQuestions([question(), question()], "A2-12"));
  assert.deepEqual(prepared.map((item) => item.legacyOptions), [
    ["w2", "w3", "C", "w1"],
    ["w3", "C", "w1", "w2"],
  ]);
});

test("answers saved with the old order carry over to the same answer text", () => {
  const prepared = prepareQuestions([question(), question(), question()], "A1-3");
  // Old positions: C was at index 3 in question 1, w3 at index 1 in question 2.
  const carried = plain(carryOverLegacyAnswers(prepared, [3, 1, null]));

  assert.equal(prepared[0].options[carried[0]], "C");
  assert.equal(prepared[1].options[carried[1]], "w3");
  assert.equal(carried[2], null);
  // An answer position beyond the options, or a question that no longer exists,
  // is dropped rather than guessed.
  assert.deepEqual(plain(carryOverLegacyAnswers(prepared, [9, null, null, 2])), [null, null, null, null]);
});
