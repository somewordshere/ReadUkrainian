import { fetchContentIndex } from "./content-api.js";

const levelsContainer = document.getElementById("levels");

function createLevelCard(level) {
  const visibleStories = level.texts
    .filter((story) => story.active !== false)
    .map((story, index) => ({ story, displayNumber: index + 1 }));
  const completedCount = visibleStories.filter(({ story }) =>
    isStoryCompleted(level.id, story.storyId, story.title)
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
    <p class="level-count">Завершено: ${completedCount}/${visibleStories.length}</p>
  `;

  const grid = document.createElement("div");
  grid.className = "texts-grid";

  visibleStories.forEach(({ story, displayNumber }) => {
    const card = document.createElement("div");
    card.className = "text-card";

    const link = document.createElement("a");
    link.className = "text-button";
    const query = new URLSearchParams({
      story: String(story.storyId),
      level: level.id,
      order: String(story.sortOrder),
    });
    link.href = `./story.html?${query}`;
    link.innerHTML = `
      <span class="text-label">${level.id}</span>
      <span class="text-title">${displayNumber}. ${story.title}</span>
    `;

    if (isStoryCompleted(level.id, story.storyId, story.title)) {
      link.classList.add("is-completed");
      link.setAttribute("aria-label", `${story.title} - тест завершено`);
    }

    const bookmarkButton = document.createElement("button");
    bookmarkButton.className = "text-bookmark-button";
    bookmarkButton.type = "button";

    function renderBookmark() {
      const bookmarked = isStoryBookmarked(level.id, story.storyId, story.title);
      bookmarkButton.classList.toggle("is-active", bookmarked);
      bookmarkButton.textContent = bookmarked ? "★" : "☆";
      bookmarkButton.setAttribute(
        "aria-label",
        bookmarked ? "Прибрати із закладок" : "Додати в закладки"
      );
    }

    bookmarkButton.addEventListener("click", () => {
      setStoryBookmarked(
        level.id,
        story.storyId,
        story.title,
        !isStoryBookmarked(level.id, story.storyId, story.title)
      );
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

    const hasVisibleStories = level.texts.some((story) => story.active !== false);

    if (!hasVisibleStories) {
      return;
    }

    levelsContainer.appendChild(createLevelCard(level));
  });
}

initLevels();
