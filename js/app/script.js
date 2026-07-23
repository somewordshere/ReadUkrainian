import { fetchContentIndex } from "./content-api.js";
import {
  STORY_TOPICS,
  findContinueStory,
  getStoryHref,
  getStoryTopic,
  storyMatchesFilters,
} from "./library-utils.mjs";

const levelsContainer = document.getElementById("levels");
const libraryTools = document.getElementById("libraryTools");
const libraryState = document.getElementById("libraryState");
const libraryStateMessage = document.getElementById("libraryStateMessage");
const retryLibraryButton = document.getElementById("retryLibraryButton");
const storySearch = document.getElementById("storySearch");
const topicFilter = document.getElementById("topicFilter");
const statusFilter = document.getElementById("statusFilter");
const clearFiltersButton = document.getElementById("clearFiltersButton");
const librarySummary = document.getElementById("librarySummary");
const continueCard = document.getElementById("continueCard");
const continueKicker = document.getElementById("continueKicker");
const continueTitle = document.getElementById("continueTitle");
const continueMeta = document.getElementById("continueMeta");
const continueLink = document.getElementById("continueLink");

const filters = {
  query: "",
  topic: "all",
  status: "all",
};
const expandedLevels = new Set();
let levels = [];
let libraryStateAction = null;
let searchTimer = null;

function getProgressForStory(story) {
  return getStoryProgress(story.levelId, story.storyId, story.title);
}

function getActiveStoriesForLevel(level) {
  return (level.texts || [])
    .filter((story) => story.active !== false)
    .map((story, index) => ({
      ...story,
      levelId: level.id,
      levelDescription: level.description || "",
      displayNumber: index + 1,
    }));
}

function setLibraryState(message = "", action = null, actionLabel = "") {
  libraryState.hidden = !message;
  libraryStateMessage.textContent = message;
  libraryStateAction = action;
  retryLibraryButton.hidden = !action;
  retryLibraryButton.textContent = actionLabel || "Спробувати ще раз";
}

function populateTopicFilter() {
  STORY_TOPICS.forEach((topic) => {
    const option = document.createElement("option");
    option.value = topic.id;
    option.textContent = topic.label;
    topicFilter.appendChild(option);
  });
}

function renderContinueCard() {
  const recommendation = findContinueStory(levels, getLastVisitedStory(), getProgressForStory);

  if (!recommendation) {
    continueCard.hidden = true;
    return;
  }

  const { story, mode } = recommendation;
  const topic = getStoryTopic(story.title);
  const progress = getProgressForStory(story);
  const answeredCount = progress?.answers?.filter(
    (answer) => answer !== null && answer !== undefined
  ).length || 0;

  continueKicker.textContent = mode === "continue"
    ? "Продовжити навчання"
    : mode === "next"
      ? "Наступний крок"
      : "Рекомендований початок";
  continueTitle.textContent = story.title;
  continueMeta.textContent = answeredCount > 0
    ? `${story.levelId} · ${topic.label} · Відповіді: ${answeredCount}/${progress.answers.length}`
    : `${story.levelId} · ${topic.label}`;
  continueLink.href = getStoryHref(story);
  continueLink.textContent = mode === "continue" ? "Продовжити текст" : "Відкрити текст";
  continueCard.hidden = false;
}

function createStoryCard(story) {
  const card = document.createElement("article");
  const link = document.createElement("a");
  const label = document.createElement("span");
  const title = document.createElement("span");
  const topic = document.createElement("span");
  const bookmarkButton = document.createElement("button");
  const storyTopic = getStoryTopic(story.title);

  card.className = "text-card";
  link.className = "text-button";
  link.href = getStoryHref(story);
  label.className = "text-label";
  label.textContent = story.levelId;
  title.className = "text-title";
  title.textContent = `${story.displayNumber}. ${story.title}`;
  topic.className = "text-topic";
  topic.textContent = storyTopic.label;
  link.append(label, title, topic);

  const progress = getProgressForStory(story);
  if (progress?.completed) {
    const completedBadge = document.createElement("span");
    completedBadge.className = "completed-badge";
    completedBadge.textContent = "Завершено";
    link.classList.add("is-completed");
    link.setAttribute("aria-label", `${story.title}. Тест завершено`);
    link.appendChild(completedBadge);
  }

  bookmarkButton.className = "text-bookmark-button";
  bookmarkButton.type = "button";

  function renderBookmark() {
    const bookmarked = isStoryBookmarked(story.levelId, story.storyId, story.title);
    bookmarkButton.classList.toggle("is-active", bookmarked);
    bookmarkButton.textContent = bookmarked ? "★" : "☆";
    bookmarkButton.setAttribute("aria-pressed", String(bookmarked));
    bookmarkButton.setAttribute(
      "aria-label",
      bookmarked ? `Прибрати «${story.title}» із закладок` : `Додати «${story.title}» у закладки`
    );
  }

  bookmarkButton.addEventListener("click", () => {
    setStoryBookmarked(
      story.levelId,
      story.storyId,
      story.title,
      !isStoryBookmarked(story.levelId, story.storyId, story.title)
    );
    renderBookmark();

    if (filters.status === "bookmarked") {
      renderLibrary();
    }
  });

  renderBookmark();
  card.append(link, bookmarkButton);
  return card;
}

function createLevelCard(level, stories, totalStories) {
  const article = document.createElement("article");
  const header = document.createElement("div");
  const headingGroup = document.createElement("div");
  const heading = document.createElement("h2");
  const description = document.createElement("p");
  const headerActions = document.createElement("div");
  const count = document.createElement("p");
  const visibleCount = document.createElement("p");
  const toggle = document.createElement("button");
  const grid = document.createElement("div");
  const gridId = `level-${level.id.toLocaleLowerCase("uk-UA")}-stories`;
  const completedCount = totalStories.filter((story) => getProgressForStory(story)?.completed).length;
  const expanded = expandedLevels.has(level.id);

  article.className = "level-card";
  header.className = "level-header";
  heading.textContent = level.id;
  description.textContent = level.description || "";
  headingGroup.append(heading, description);

  headerActions.className = "level-header-actions";
  count.className = "level-count";
  count.textContent = `Завершено: ${completedCount}/${totalStories.length}`;
  visibleCount.className = "level-visible-count";
  visibleCount.textContent = stories.length === totalStories.length ? "" : `Показано: ${stories.length}`;
  visibleCount.hidden = stories.length === totalStories.length;
  toggle.className = "level-toggle-button";
  toggle.type = "button";
  toggle.setAttribute("aria-controls", gridId);
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.setAttribute("aria-label", `${expanded ? "Згорнути" : "Розгорнути"} рівень ${level.id}`);
  toggle.textContent = expanded ? "Згорнути" : "Розгорнути";
  headerActions.append(count, visibleCount, toggle);
  header.append(headingGroup, headerActions);

  grid.className = "texts-grid";
  grid.id = gridId;
  grid.hidden = !expanded;
  stories.forEach((story) => grid.appendChild(createStoryCard(story)));

  toggle.addEventListener("click", () => {
    const shouldExpand = !expandedLevels.has(level.id);
    if (shouldExpand) {
      expandedLevels.add(level.id);
    } else {
      expandedLevels.delete(level.id);
    }
    grid.hidden = !shouldExpand;
    toggle.textContent = shouldExpand ? "Згорнути" : "Розгорнути";
    toggle.setAttribute("aria-expanded", String(shouldExpand));
    toggle.setAttribute("aria-label", `${shouldExpand ? "Згорнути" : "Розгорнути"} рівень ${level.id}`);
  });

  article.append(header, grid);
  return article;
}

function filtersAreActive() {
  return Boolean(filters.query) || filters.topic !== "all" || filters.status !== "all";
}

function clearFilters() {
  filters.query = "";
  filters.topic = "all";
  filters.status = "all";
  storySearch.value = "";
  topicFilter.value = "all";
  statusFilter.value = "all";
  expandedLevels.clear();
  expandedLevels.add(getLastVisitedStory()?.level || "A1");
  renderLibrary();
  storySearch.focus();
}

function renderLibrary() {
  levelsContainer.replaceChildren();
  setLibraryState();

  const activeLevels = levels.filter((level) => level.active !== false);
  let visibleStoryCount = 0;
  let totalStoryCount = 0;
  const renderedLevels = [];

  activeLevels.forEach((level) => {
    const totalStories = getActiveStoriesForLevel(level);
    const matchingStories = totalStories.filter((story) =>
      storyMatchesFilters(story, filters, getProgressForStory)
    );

    totalStoryCount += totalStories.length;
    visibleStoryCount += matchingStories.length;

    if (matchingStories.length > 0) {
      if (filtersAreActive()) {
        expandedLevels.add(level.id);
      }
      renderedLevels.push(createLevelCard(level, matchingStories, totalStories));
    }
  });

  renderedLevels.forEach((levelCard) => levelsContainer.appendChild(levelCard));
  levelsContainer.setAttribute("aria-busy", "false");
  librarySummary.textContent = `Показано: ${visibleStoryCount} із ${totalStoryCount} текстів.`;
  clearFiltersButton.disabled = !filtersAreActive();

  if (totalStoryCount === 0) {
    setLibraryState("Поки що немає доступних текстів.");
    return;
  }

  if (visibleStoryCount === 0) {
    setLibraryState(
      "За цими фільтрами нічого не знайдено.",
      clearFilters,
      "Очистити фільтри"
    );
  }
}

async function initLevels() {
  levelsContainer.setAttribute("aria-busy", "true");
  setLibraryState("Завантажуємо тексти…");
  libraryTools.hidden = true;
  continueCard.hidden = true;

  try {
    levels = await fetchContentIndex();
    expandedLevels.clear();
    expandedLevels.add(getLastVisitedStory()?.level || "A1");
    libraryTools.hidden = false;
    renderContinueCard();
    renderLibrary();
  } catch (error) {
    levels = [];
    levelsContainer.replaceChildren();
    levelsContainer.setAttribute("aria-busy", "false");
    setLibraryState(
      "Не вдалося завантажити тексти. Перевірте з’єднання та спробуйте ще раз.",
      initLevels,
      "Спробувати ще раз"
    );
  }
}

retryLibraryButton.addEventListener("click", () => libraryStateAction?.());
clearFiltersButton.addEventListener("click", clearFilters);
topicFilter.addEventListener("change", () => {
  filters.topic = topicFilter.value;
  renderLibrary();
});
statusFilter.addEventListener("change", () => {
  filters.status = statusFilter.value;
  renderLibrary();
});
storySearch.addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    filters.query = storySearch.value.trim();
    renderLibrary();
  }, 120);
});

populateTopicFilter();
initLevels();
