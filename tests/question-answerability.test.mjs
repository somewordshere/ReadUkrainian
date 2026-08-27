import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Every comprehension question must be answerable from the story it belongs to.
//
// Nothing checked this before 2026-08-25, which is how a content rewrite of all
// 103 A2 texts left 41 questions asking about details the new texts no longer
// contained — including one whose stored answer had become factually wrong.
//
// The check is deliberately generous: a question passes if ANY content word of
// its correct answer appears in the story. It cannot judge whether a question is
// still a *good* question, only whether the answer has vanished.

function loadBundle() {
  const context = { window: undefined };
  context.window = context;
  vm.createContext(context);

  const files = [
    "public/js/app/questions.js",
    "public/js/data/a1-questions.js",
    "public/js/data/a2-questions.js",
    "public/js/data/stories.js",
    "public/js/data/a1-stories.js",
    "public/js/data/a2-stories.js",
  ];

  let source = "";
  for (const file of files) {
    source += `\n${readFileSync(new URL(`../${file}`, import.meta.url), "utf8")}`;
  }
  source += "\nglobalThis.__questions = questionDataByLevel;\nglobalThis.__stories = storiesByLevel;";
  vm.runInContext(source, context, { filename: "questions-bundle.js" });

  return { questions: context.__questions, stories: context.__stories };
}

const FUNCTION_WORDS = new Set([
  "і", "та", "в", "у", "з", "із", "до", "по", "за", "про", "що", "як", "а", "але",
  "це", "їх", "він", "вона", "вони", "я", "ми", "ви", "не", "є", "для", "від",
  "ще", "вже", "так", "там", "тут", "дуже", "його", "її", "свій", "своя", "мій",
  "моя", "наш", "наша", "тільки", "або", "чи", "щоб", "коли", "бо", "через",
  "після", "перед", "без", "між", "над", "під", "себе", "них", "нього", "цей",
  "ця", "які", "яка", "який", "на",
]);

// Ukrainian inflects heavily, so compare on a short prefix rather than the whole
// word: «кашу» must match «каша», «сина» must match «син».
function contentStems(text) {
  return text
    .toLowerCase()
    .replace(/[«»""''.,!?;:()[\]—–…]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !FUNCTION_WORDS.has(word))
    .map((word) => word.slice(0, Math.min(4, word.length - 1)));
}

function unsupportedAnswers({ questions, stories }, level) {
  const levelQuestions = questions[level] || [];
  const levelStories = stories[level] || [];
  const unsupported = [];

  levelStories.forEach((story, storyIndex) => {
    const storyText = story.paragraphs.join(" ").toLowerCase();

    (levelQuestions[storyIndex] || []).forEach((question, questionIndex) => {
      const stems = contentStems(question.correct);
      if (stems.length === 0) {
        return;
      }
      if (!stems.some((stem) => storyText.includes(stem))) {
        unsupported.push(`${level} ${storyIndex + 1}.${questionIndex + 1} — ${question.correct}`);
      }
    });
  });

  return unsupported;
}

// Baselines are tripwires, not targets. A rise means a story and its questions
// have drifted apart — read the reported questions against their texts and
// repair them (see prompts/tests/a2-question-repairs.md for the 2026-08-25
// pass). Lower these numbers when you fix one; never raise them to make the
// suite pass.
const BASELINE = { A1: 0, A2: 0 };

for (const level of ["A1", "A2"]) {
  test(`every ${level} question's correct answer still appears in its story`, () => {
    const bundle = loadBundle();
    const unsupported = unsupportedAnswers(bundle, level);

    assert.equal(
      unsupported.length,
      BASELINE[level],
      `${level}: expected ${BASELINE[level]} unsupported answer(s), found ${unsupported.length}:\n  ${unsupported.join("\n  ")}`
    );
  });
}

test("every question has exactly three wrong answers and none repeats the correct one", () => {
  const { questions, stories } = loadBundle();

  for (const level of ["A1", "A2"]) {
    (questions[level] || []).forEach((set, storyIndex) => {
      set.forEach((question, questionIndex) => {
        const where = `${level} ${storyIndex + 1}.${questionIndex + 1}`;
        assert.equal(question.wrong.length, 3, `${where} has ${question.wrong.length} wrong answers`);
        assert.ok(
          !question.wrong.includes(question.correct),
          `${where} repeats the correct answer among the distractors`
        );
        assert.equal(
          new Set(question.wrong).size,
          question.wrong.length,
          `${where} has duplicate distractors`
        );
      });
    });

    assert.equal(
      (questions[level] || []).length,
      (stories[level] || []).length,
      `${level} has ${(questions[level] || []).length} question sets for ${(stories[level] || []).length} stories`
    );
  }
});
