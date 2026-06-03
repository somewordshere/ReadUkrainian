const params = new URLSearchParams(window.location.search);
const level = params.get("level") || "A1";
const textNumber = Number(params.get("text")) || 1;

const storyLevel = document.getElementById("storyLevel");
const storyTitle = document.getElementById("storyTitle");
const storyContent = document.getElementById("storyContent");
const questionsList = document.getElementById("questionsList");
const questionsStatus = document.getElementById("questionsStatus");
const restartButton = document.getElementById("restartButton");
const bookmarkButton = document.getElementById("bookmarkButton");

const story = storiesByLevel[level]?.[textNumber - 1];
const questionInputs = [];

storyLevel.textContent = `Рівень ${level}`;
storyTitle.textContent = story?.title || `Текст ${textNumber}`;

if (story?.paragraphs?.length) {
  story.paragraphs.forEach((paragraph) => {
    const element = document.createElement("p");
    element.className = "story-note";
    element.textContent = paragraph;
    storyContent.appendChild(element);
  });
}

if (story?.showWordCount) {
  const wordCount = story.paragraphs
    .join(" ")
    .match(/[\p{L}\p{N}]+(?:['’ʼ-][\p{L}\p{N}]+)*/gu)?.length || 0;
  const countElement = document.createElement("p");
  countElement.className = "word-count-note";
  countElement.textContent = `Кількість слів: ${wordCount}`;
  storyContent.appendChild(countElement);
}

const questions = getQuestionsForStory(level, textNumber);

if (questions.length === 0) {
  questionsStatus.textContent = "Питання буде додано пізніше.";
  restartButton.hidden = true;
} else {
  questions.forEach((question, questionIndex) => {
    const item = document.createElement("article");
    item.className = "question-item";

    const number = document.createElement("div");
    number.className = "question-number";
    number.textContent = questionIndex + 1;

    const prompt = document.createElement("p");
    prompt.className = "question-prompt";
    prompt.textContent = question.prompt;

    const options = document.createElement("div");
    options.className = "question-options";

    question.options.forEach((option, optionIndex) => {
      const label = document.createElement("label");
      label.className = "answer-option";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = `question-${questionIndex + 1}`;
      input.dataset.correct = String(optionIndex === question.correctIndex);
      input.dataset.questionIndex = String(questionIndex);
      input.dataset.optionIndex = String(optionIndex);

      input.addEventListener("change", () => {
        if (!input.checked) {
          label.classList.remove("is-correct", "is-wrong");
          syncProgress();
          return;
        }

        options.querySelectorAll("input").forEach((otherInput) => {
          if (otherInput !== input) {
            otherInput.checked = false;
            otherInput.closest(".answer-option").classList.remove("is-correct", "is-wrong");
          }
        });

        label.classList.toggle("is-correct", input.dataset.correct === "true");
        label.classList.toggle("is-wrong", input.dataset.correct !== "true");
        lockQuestion(questionIndex);
        syncProgress();
      });

      const marker = document.createElement("span");
      marker.className = "answer-marker";
      marker.textContent = String.fromCharCode(97 + optionIndex);

      const text = document.createElement("span");
      text.textContent = option;

      label.append(input, marker, text);
      options.appendChild(label);
      questionInputs.push(input);
    });

    item.append(number, prompt, options);
    questionsList.appendChild(item);
  });
}

function getQuestionInputs(questionIndex) {
  return questionInputs.filter(
    (input) => Number(input.dataset.questionIndex) === questionIndex
  );
}

function lockQuestion(questionIndex) {
  getQuestionInputs(questionIndex).forEach((input) => {
    input.disabled = true;
    input.closest(".answer-option").classList.add("is-locked");
  });
}

function unlockAllQuestions() {
  questionInputs.forEach((input) => {
    input.disabled = false;
    input.closest(".answer-option").classList.remove("is-locked");
  });
}

function updateQuestionStatus(completedCount, correctCount) {
  if (questionInputs.length === 0) {
    questionsStatus.textContent = "Питання буде додано пізніше.";
    return;
  }

  if (completedCount === 0) {
    questionsStatus.textContent = "Дайте відповіді на всі 5 питань.";
    return;
  }

  if (completedCount < 5) {
    questionsStatus.textContent = `Відповіді: ${completedCount}/5. Правильно: ${correctCount}.`;
    return;
  }

  questionsStatus.textContent = `Тест завершено. Правильно: ${correctCount}/5.`;
}

function getSelectedAnswers() {
  const answers = Array.from({ length: 5 }, () => null);

  questionInputs.forEach((input) => {
    if (input.checked) {
      answers[Number(input.dataset.questionIndex)] = Number(input.dataset.optionIndex);
    }
  });

  return answers;
}

function syncProgress() {
  const answers = getSelectedAnswers();
  const completedCount = answers.filter((answer) => answer !== null).length;
  const correctCount = questionInputs.filter(
    (input) => input.checked && input.dataset.correct === "true"
  ).length;
  const bookmarked = isStoryBookmarked(level, textNumber);

  updateQuestionStatus(completedCount, correctCount);

  setStoryProgress(level, textNumber, {
    answers,
    completed: completedCount === 5,
    correctCount,
    bookmarked
  });
}

function applySavedProgress() {
  if (questionInputs.length === 0) {
    updateQuestionStatus(0, 0);
    return;
  }

  const savedProgress = getStoryProgress(level, textNumber);

  if (!savedProgress?.answers?.length) {
    updateQuestionStatus(0, 0);
    return;
  }

  savedProgress.answers.forEach((savedOptionIndex, questionIndex) => {
    if (savedOptionIndex === null || savedOptionIndex === undefined) {
      return;
    }

    const matchingInput = questionInputs.find(
      (input) =>
        Number(input.dataset.questionIndex) === questionIndex &&
        Number(input.dataset.optionIndex) === savedOptionIndex
    );

    if (!matchingInput) {
      return;
    }

    matchingInput.checked = true;
    const label = matchingInput.closest(".answer-option");
    label.classList.toggle("is-correct", matchingInput.dataset.correct === "true");
    label.classList.toggle("is-wrong", matchingInput.dataset.correct !== "true");
    lockQuestion(questionIndex);
  });

  const completedCount = savedProgress.answers.filter((answer) => answer !== null).length;
  updateQuestionStatus(completedCount, savedProgress.correctCount || 0);
}

restartButton.addEventListener("click", () => {
  const bookmarked = isStoryBookmarked(level, textNumber);

  questionInputs.forEach((input) => {
    input.checked = false;
    input.closest(".answer-option").classList.remove("is-correct", "is-wrong");
  });
  unlockAllQuestions();

  if (bookmarked) {
    setStoryProgress(level, textNumber, {
      answers: [null, null, null, null, null],
      completed: false,
      correctCount: 0,
      bookmarked: true
    });
  } else {
    clearStoryProgress(level, textNumber);
  }

  updateQuestionStatus(0, 0);
});

function renderBookmarkState() {
  const bookmarked = isStoryBookmarked(level, textNumber);
  const icon = bookmarkButton.querySelector(".bookmark-icon");

  bookmarkButton.classList.toggle("is-active", bookmarked);
  bookmarkButton.setAttribute(
    "aria-label",
    bookmarked ? "Прибрати із закладок" : "Додати в закладки"
  );
  icon.textContent = bookmarked ? "★" : "☆";
}

bookmarkButton.addEventListener("click", () => {
  setStoryBookmarked(level, textNumber, !isStoryBookmarked(level, textNumber));
  renderBookmarkState();
});

applySavedProgress();
renderBookmarkState();

document.title = `Історії українською - ${level} - ${storyTitle.textContent}`;
