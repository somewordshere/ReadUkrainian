import { fetchContentIndex } from "./content-api.js";

const levelsContainer = document.getElementById("levels");

function createLevelCard(level) {
  const visibleTexts = level.texts
    .filter((text) => text.active !== false)
    .map((text) => ({ text, storyNumber: text.storyNumber }));
  const completedCount = visibleTexts.filter(({ storyNumber }) =>
    isStoryCompleted(level.id, storyNumber)
  ).length;
  const article = document.createElement("article");
  article.className = "level-card";

  const header = document.createElement("div");
  header.className = "level-header";
  header.innerHTML = `
    <div>
      <h2>${level.id}</h2>
      <p>${level.description}</p>
    </div>
    <p class="level-count">Завершено: ${completedCount}/${visibleTexts.length}</p>
  `;

  const grid = document.createElement("div");
  grid.className = "texts-grid";

  visibleTexts.forEach(({ text, storyNumber }) => {
    const card = document.createElement("div");
    card.className = "text-card";

    const link = document.createElement("a");
    link.className = "text-button";
    link.href = `./story.html?level=${encodeURIComponent(level.id)}&text=${storyNumber}`;
    link.innerHTML = `
      <span class="text-label">${level.id}</span>
      <span class="text-title">${storyNumber}. ${text.title}</span>
    `;

    if (isStoryCompleted(level.id, storyNumber)) {
      link.classList.add("is-completed");
      link.setAttribute("aria-label", `${text.title} - тест завершено`);
    }

    const bookmarkButton = document.createElement("button");
    bookmarkButton.className = "text-bookmark-button";
    bookmarkButton.type = "button";

    function renderBookmark() {
      const bookmarked = isStoryBookmarked(level.id, storyNumber);
      bookmarkButton.classList.toggle("is-active", bookmarked);
      bookmarkButton.textContent = bookmarked ? "★" : "☆";
      bookmarkButton.setAttribute(
        "aria-label",
        bookmarked ? "Прибрати із закладок" : "Додати в закладки"
      );
    }

    bookmarkButton.addEventListener("click", () => {
      setStoryBookmarked(level.id, storyNumber, !isStoryBookmarked(level.id, storyNumber));
      renderBookmark();
    });

    renderBookmark();
    card.append(link, bookmarkButton);
    grid.appendChild(card);
  });

  article.append(header, grid);
  return article;
}

async function initLevels() {
  const levels = await fetchContentIndex();

  levels.forEach((level) => {
    if (!level.active) {
      return;
    }

    const hasVisibleTexts = level.texts.some((text) => text.active !== false);

    if (!hasVisibleTexts) {
      return;
    }

    levelsContainer.appendChild(createLevelCard(level));
  });
}

initLevels();
