const questionDataByLevel = {};

function q(prompt, correct, wrong) {
  return { prompt, correct, wrong };
}

function getQuestionsForStory(level, storyIndex) {
  const questions = questionDataByLevel[level]?.[storyIndex - 1];

  if (!questions) {
    return Array.from({ length: 5 }, (_, index) => {
      const correct = "\u0422\u0435\u043A\u0441\u0442 \u0431\u0443\u0434\u0435 \u0434\u043E\u0434\u0430\u043D\u043E \u043F\u0456\u0437\u043D\u0456\u0448\u0435";
      return withShuffledOptions(
        {
          prompt: `\u041F\u0438\u0442\u0430\u043D\u043D\u044F ${index + 1} \u0434\u043B\u044F \u0446\u044C\u043E\u0433\u043E \u0442\u0435\u043A\u0441\u0442\u0443`,
          correct,
          wrong: ["\u0412\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u044C A", "\u0412\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u044C B", "\u0412\u0456\u0434\u043F\u043E\u0432\u0456\u0434\u044C C"]
        },
        level,
        storyIndex,
        index
      );
    });
  }

  return questions.map((question, index) =>
    withShuffledOptions(question, level, storyIndex, index)
  );
}

function withShuffledOptions(question, level, storyIndex, questionIndex) {
  const options = [question.correct, ...question.wrong];
  const shuffled = seededShuffle(options, `${level}-${storyIndex}-${questionIndex}`);

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
