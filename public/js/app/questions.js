const questionDataByLevel = {};

function q(prompt, correct, wrong) {
  return { prompt, correct, wrong };
}

function getQuestionsForStory(level, questionIndex) {
  const questions = questionDataByLevel[level]?.[questionIndex - 1];

  if (!questions) {
    return [];
  }

  return questions.map((question, index) =>
    withShuffledOptions(question, level, questionIndex, index)
  );
}

function withShuffledOptions(question, level, storyQuestionIndex, questionIndex) {
  const options = [question.correct, ...question.wrong];
  const shuffled = seededShuffle(options, `${level}-${storyQuestionIndex}-${questionIndex}`);

  return {
    prompt: question.prompt,
    options: shuffled,
    correctIndex: shuffled.indexOf(question.correct)
  };
}

function seededShuffle(items, seedText) {
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
