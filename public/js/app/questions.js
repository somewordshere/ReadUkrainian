const questionDataByLevel = {};

function q(prompt, correct, wrong) {
  return { prompt, correct, wrong };
}

function getQuestionsForStory(level, questionIndex) {
  const questions = questionDataByLevel[level]?.[questionIndex - 1];

  if (!questions) {
    return [];
  }

  return prepareQuestions(questions, `${level}-${questionIndex}`);
}

function prepareQuestions(questions, seedPrefix) {
  return questions.map((question, index) =>
    withShuffledOptions(question, `${seedPrefix}-${index}`)
  );
}

function withShuffledOptions(question, seedText) {
  const options = [question.correct, ...question.wrong];
  const shuffled = seededShuffle(options, seedText);

  return {
    prompt: question.prompt,
    options: shuffled,
    correctIndex: shuffled.indexOf(question.correct),
    // The order versions before 1.02 showed. Saved answers are positions, so
    // story.js uses this to carry old answers over to the same answer text.
    legacyOptions: legacySeededShuffle(options, seedText)
  };
}

// Answers saved before 1.02 are positions in the legacy order; this maps each to
// the position the same answer text has now, or null if that answer is gone.
function carryOverLegacyAnswers(questions, answers) {
  return answers.map((answer, questionIndex) => {
    if (answer === null || answer === undefined) return answer;

    const question = questions[questionIndex];
    const answerText = question?.legacyOptions?.[answer];
    const index = answerText === undefined ? -1 : question.options.indexOf(answerText);
    return index >= 0 ? index : null;
  });
}

// FNV-1a hash of the seed text feeding a mulberry32 generator, so every answer
// position is equally likely and each question gets its own order.
function seededShuffle(items, seedText) {
  const result = [...items];
  let seed = 2166136261;

  for (const character of seedText) {
    seed = Math.imul(seed ^ character.codePointAt(0), 16777619);
  }

  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

// The shuffle used before 1.02, kept only to read answers saved with it. It
// summed character codes (so "A2-12" and "A2-21" shuffled alike) and took the
// generator's weak low bits, which put the correct answer first a third of the
// time and second only a sixth.
function legacySeededShuffle(items, seedText) {
  const result = [...items];
  let seed = 0;

  for (const character of seedText) {
    seed += character.charCodeAt(0);
  }

  for (let index = result.length - 1; index > 0; index -= 1) {
    seed = (seed * 9301 + 49297) % 233280;
    const swapIndex = seed % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}
