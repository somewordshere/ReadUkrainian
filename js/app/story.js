import { fetchContentIndex, fetchStory } from "./content-api.js";
import { findNextIncompleteStory, getStoryHref } from "./library-utils.mjs";

const params = new URLSearchParams(window.location.search);
const level = params.get("level") || "A1";
const requestedStoryId = params.get("story") || "";
const legacyOrder = Number(params.get("order") || params.get("text")) || 1;

const storyLevel = document.getElementById("storyLevel");
const storyTitle = document.getElementById("storyTitle");
const storyContent = document.getElementById("storyContent");
const questionsList = document.getElementById("questionsList");
const questionsStatus = document.getElementById("questionsStatus");
const restartButton = document.getElementById("restartButton");
const bookmarkButton = document.getElementById("bookmarkButton");
const completionActions = document.getElementById("completionActions");
const reviewMistakesButton = document.getElementById("reviewMistakesButton");
const nextStoryLink = document.getElementById("nextStoryLink");

const questionInputs = [];
let storyAvailable = false;
let currentStory = null;
let currentQuestionCount = 0;
let contentLevels = [];
let nextStory = null;

function getQuestionInputs(questionIndex) {
  return questionInputs.filter(
    (input) => Number(input.dataset.questionIndex) === questionIndex
  );
}

function getQuestionItem(questionIndex) {
  return questionsList.querySelector(`[data-question-index="${questionIndex}"]`);
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

function clearQuestionResult(questionIndex) {
  const item = getQuestionItem(questionIndex);
  item?.querySelectorAll(".answer-option").forEach((label) => {
    label.classList.remove("is-correct", "is-wrong", "is-correct-answer");
  });

  const feedback = item?.querySelector(".answer-feedback");
  if (feedback) {
    feedback.textContent = "";
    feedback.className = "answer-feedback";
  }
}

function renderQuestionResult(input) {
  const questionIndex = Number(input.dataset.questionIndex);
  const inputs = getQuestionInputs(questionIndex);
  const selectedLabel = input.closest(".answer-option");
  const correctInput = inputs.find((candidate) => candidate.dataset.correct === "true");
  const feedback = getQuestionItem(questionIndex)?.querySelector(".answer-feedback");
  const isCorrect = input.dataset.correct === "true";

  clearQuestionResult(questionIndex);
  selectedLabel.classList.add(isCorrect ? "is-correct" : "is-wrong");

  if (!isCorrect) {
    correctInput?.closest(".answer-option")?.classList.add("is-correct-answer");
  }

  const resultMessage = isCorrect
    ? "Правильно."
    : `Неправильно. Правильна відповідь: ${correctInput?.dataset.optionText || "—"}.`;

  if (feedback) {
    feedback.textContent = resultMessage;
    feedback.classList.add(isCorrect ? "is-correct" : "is-wrong");
  }

  return resultMessage;
}

function updateQuestionStatus(completedCount, correctCount, latestResult = "") {
  if (questionInputs.length === 0) {
    questionsStatus.textContent = "Питання буде додано пізніше.";
    return;
  }

  if (completedCount === 0) {
    questionsStatus.textContent = `Дайте відповіді на всі ${currentQuestionCount} питань.`;
    return;
  }

  const resultPrefix = latestResult ? `${latestResult} ` : "";
  if (completedCount < currentQuestionCount) {
    questionsStatus.textContent = `${resultPrefix}Відповіді: ${completedCount}/${currentQuestionCount}. Правильно: ${correctCount}.`;
    return;
  }

  questionsStatus.textContent = `${resultPrefix}Тест завершено. Правильно: ${correctCount}/${currentQuestionCount}.`;
}

function updateCompletionActions(completedCount, correctCount) {
  const completed = currentQuestionCount > 0 && completedCount === currentQuestionCount;
  completionActions.hidden = !completed;
  reviewMistakesButton.hidden = !completed || correctCount === currentQuestionCount;
  nextStoryLink.hidden = !completed || !nextStory;
}

function getSelectedAnswers() {
  const answers = Array.from({ length: currentQuestionCount }, () => null);

  questionInputs.forEach((input) => {
    if (input.checked) {
      answers[Number(input.dataset.questionIndex)] = Number(input.dataset.optionIndex);
    }
  });

  return answers;
}

function syncProgress(latestResult = "") {
  const answers = getSelectedAnswers();
  const completedCount = answers.filter((answer) => answer !== null).length;
  const correctCount = questionInputs.filter(
    (input) => input.checked && input.dataset.correct === "true"
  ).length;
  const bookmarked = isStoryBookmarked(level, currentStory.storyId, currentStory.title);

  setStoryProgress(level, currentStory.storyId, currentStory.title, {
    answers,
    completed: completedCount === currentQuestionCount,
    correctCount,
    bookmarked,
  });

  updateQuestionStatus(completedCount, correctCount, latestResult);
  updateCompletionActions(completedCount, correctCount);
}

function applySavedProgress() {
  if (questionInputs.length === 0) {
    updateQuestionStatus(0, 0);
    updateCompletionActions(0, 0);
    return;
  }

  const savedProgress = getStoryProgress(level, currentStory.storyId, currentStory.title);

  if (!savedProgress?.answers?.length) {
    updateQuestionStatus(0, 0);
    updateCompletionActions(0, 0);
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
    renderQuestionResult(matchingInput);
    lockQuestion(questionIndex);
  });

  const completedCount = savedProgress.answers.filter(
    (answer) => answer !== null && answer !== undefined
  ).length;
  const correctCount = savedProgress.correctCount || 0;
  updateQuestionStatus(completedCount, correctCount);
  updateCompletionActions(completedCount, correctCount);
}

function renderBookmarkState() {
  const bookmarked = isStoryBookmarked(level, currentStory.storyId, currentStory.title);
  const icon = bookmarkButton.querySelector(".bookmark-icon");

  bookmarkButton.classList.toggle("is-active", bookmarked);
  bookmarkButton.setAttribute("aria-pressed", String(bookmarked));
  bookmarkButton.setAttribute(
    "aria-label",
    bookmarked ? "Прибрати із закладок" : "Додати в закладки"
  );
  icon.textContent = bookmarked ? "★" : "☆";
}

function renderQuestions(questions) {
  currentQuestionCount = questions.length;

  if (questions.length === 0) {
    questionsStatus.textContent = "Питання буде додано пізніше.";
    restartButton.hidden = true;
    return;
  }

  restartButton.hidden = false;

  questions.forEach((question, questionIndex) => {
    const item = document.createElement("fieldset");
    const legend = document.createElement("legend");
    const number = document.createElement("span");
    const prompt = document.createElement("span");
    const options = document.createElement("div");
    const feedback = document.createElement("p");
    const feedbackId = `answer-feedback-${questionIndex + 1}`;

    item.className = "question-item";
    item.dataset.questionIndex = String(questionIndex);
    item.tabIndex = -1;
    legend.className = "question-legend";
    number.className = "question-number";
    number.setAttribute("aria-hidden", "true");
    number.textContent = questionIndex + 1;
    prompt.className = "question-prompt";
    prompt.textContent = question.prompt;
    legend.append(number, prompt);

    options.className = "question-options";
    feedback.className = "answer-feedback";
    feedback.id = feedbackId;

    question.options.forEach((option, optionIndex) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      const marker = document.createElement("span");
      const text = document.createElement("span");

      label.className = "answer-option";
      input.type = "radio";
      input.name = `question-${questionIndex + 1}`;
      input.value = String(optionIndex);
      input.dataset.correct = String(optionIndex === question.correctIndex);
      input.dataset.questionIndex = String(questionIndex);
      input.dataset.optionIndex = String(optionIndex);
      input.dataset.optionText = option;
      input.setAttribute("aria-describedby", feedbackId);

      input.addEventListener("change", () => {
        if (!input.checked) {
          return;
        }

        const resultMessage = renderQuestionResult(input);
        lockQuestion(questionIndex);
        syncProgress(resultMessage);
      });

      marker.className = "answer-marker";
      marker.setAttribute("aria-hidden", "true");
      marker.textContent = String.fromCharCode(97 + optionIndex);
      text.textContent = option;

      label.append(input, marker, text);
      options.appendChild(label);
      questionInputs.push(input);
    });

    item.append(legend, options, feedback);
    questionsList.appendChild(item);
  });
}

function configureNextStory() {
  nextStory = findNextIncompleteStory(
    contentLevels,
    currentStory,
    (story) => getStoryProgress(story.levelId, story.storyId, story.title)
  );

  if (!nextStory) {
    nextStoryLink.hidden = true;
    return;
  }

  nextStoryLink.href = getStoryHref(nextStory);
  nextStoryLink.textContent = `Наступний текст: ${nextStory.title}`;
}

function resetStoryUi() {
  storyAvailable = false;
  currentStory = null;
  currentQuestionCount = 0;
  nextStory = null;
  questionInputs.length = 0;
  storyLevel.textContent = `Рівень ${level}`;
  storyTitle.textContent = "Завантаження…";
  storyContent.replaceChildren();
  questionsList.replaceChildren();
  questionsStatus.textContent = "Завантажуємо питання…";
  storyContent.setAttribute("aria-busy", "true");
  bookmarkButton.hidden = false;
  restartButton.hidden = true;
  completionActions.hidden = true;
}

function renderStoryError() {
  const message = document.createElement("p");
  const retry = document.createElement("button");

  storyTitle.textContent = "Не вдалося завантажити текст";
  message.className = "story-note";
  message.textContent = "Перевірте з’єднання та спробуйте ще раз.";
  retry.className = "retry-button";
  retry.type = "button";
  retry.textContent = "Спробувати ще раз";
  retry.addEventListener("click", initStory);
  storyContent.replaceChildren(message, retry);
  storyContent.setAttribute("aria-busy", "false");
  questionsStatus.textContent = "Питання недоступні, доки текст не завантажено.";
  bookmarkButton.hidden = true;
  restartButton.hidden = true;
  completionActions.hidden = true;
}

restartButton.addEventListener("click", () => {
  if (!storyAvailable) {
    return;
  }

  const bookmarked = isStoryBookmarked(level, currentStory.storyId, currentStory.title);

  questionInputs.forEach((input) => {
    input.checked = false;
    input.closest(".answer-option").classList.remove(
      "is-correct",
      "is-wrong",
      "is-correct-answer"
    );
  });
  questionsList.querySelectorAll(".answer-feedback").forEach((feedback) => {
    feedback.textContent = "";
    feedback.className = "answer-feedback";
  });
  unlockAllQuestions();

  if (bookmarked) {
    setStoryProgress(level, currentStory.storyId, currentStory.title, {
      answers: Array.from({ length: currentQuestionCount }, () => null),
      completed: false,
      correctCount: 0,
      bookmarked: true,
    });
  } else {
    clearStoryProgress(level, currentStory.storyId, currentStory.title);
  }

  updateQuestionStatus(0, 0);
  updateCompletionActions(0, 0);
  questionInputs[0]?.focus();
});

reviewMistakesButton.addEventListener("click", () => {
  const firstWrongQuestion = questionsList.querySelector(".answer-option.is-wrong")
    ?.closest(".question-item");

  if (!firstWrongQuestion) {
    return;
  }

  firstWrongQuestion.scrollIntoView({ behavior: "smooth", block: "start" });
  firstWrongQuestion.focus({ preventScroll: true });
});

bookmarkButton.addEventListener("click", () => {
  if (!storyAvailable) {
    return;
  }

  setStoryBookmarked(
    level,
    currentStory.storyId,
    currentStory.title,
    !isStoryBookmarked(level, currentStory.storyId, currentStory.title)
  );
  renderBookmarkState();
});

async function initStory() {
  resetStoryUi();

  try {
    const [story, fetchedLevels] = await Promise.all([
      fetchStory(requestedStoryId, level, legacyOrder),
      fetchContentIndex().catch(() => []),
    ]);
    currentStory = story;
    contentLevels = fetchedLevels;

    const storyLevelId = story?.level || level;
    storyAvailable = Boolean(story) && isLevelActive(storyLevelId) && isStoryActive(story);
    storyLevel.textContent = `Рівень ${storyLevelId}`;
    storyTitle.textContent = storyAvailable ? story.title : "Текст недоступний";
    storyContent.replaceChildren();
    storyContent.setAttribute("aria-busy", "false");

    if (!storyAvailable) {
      const unavailableElement = document.createElement("p");
      unavailableElement.className = "story-note";
      unavailableElement.textContent = "Цей текст зараз недоступний для читача.";
      storyContent.appendChild(unavailableElement);
      questionsStatus.textContent = "Питання недоступні, бо текст вимкнений.";
      restartButton.hidden = true;
      bookmarkButton.hidden = true;
      document.title = `Історії українською - ${storyLevelId} - Текст недоступний`;
      return;
    }

    setLastVisitedStory({
      level: storyLevelId,
      storyId: story.storyId,
      sortOrder: story.sortOrder || legacyOrder,
      title: story.title,
    });

    (story.paragraphs || []).forEach((paragraph) => {
      const element = document.createElement("p");
      element.className = "story-note";
      element.textContent = paragraph;
      storyContent.appendChild(element);
    });

    if (story.showWordCount) {
      const wordCount = (story.paragraphs || [])
        .join(" ")
        .match(/[\p{L}\p{N}]+(?:['’ʼ-][\p{L}\p{N}]+)*/gu)?.length || 0;
      const countElement = document.createElement("p");
      countElement.className = "word-count-note";
      countElement.textContent = `Кількість слів: ${wordCount}`;
      storyContent.appendChild(countElement);
    }

    const questions = story.questions?.length
      ? prepareQuestions(
        story.questions,
        `${storyLevelId}-${story.questionIndex || story.storyId || "story"}`
      )
      : Number.isInteger(story.questionIndex)
        ? getQuestionsForStory(storyLevelId, story.questionIndex)
        : [];

    configureNextStory();
    renderQuestions(questions);
    applySavedProgress();
    renderBookmarkState();
    document.title = `Історії українською - ${storyLevelId} - ${story.title}`;
  } catch (error) {
    renderStoryError();
    document.title = "Історії українською - Помилка завантаження";
  }
}

initStory();
