export const STORY_TOPICS = [
  {
    id: "history",
    label: "Історія та суспільство",
    keywords: [
      "голодомор", "чорнобиль", "конституц", "незалежност", "соборност",
      "гідност", "героїв", "захисник", "ветеран", "козацьк", "україна і світ",
      "бути українцем", "волонтерств", "пам'ят", "пам’ят"
    ],
  },
  {
    id: "culture",
    label: "Культура й традиції",
    keywords: [
      "традиц", "різдв", "великден", "великдень", "вишив", "писанк", "купал",
      "трійц", "водохрещ", "весіль", "калина", "письменник", "фестиваль",
      "святий вечір", "народна медицин"
    ],
  },
  {
    id: "food",
    label: "Їжа",
    keywords: [
      "борщ", "вареник", "пампуш", "хліб", "їжа", "снідан", "кафе", "кава",
      "холодець", "страв", "готув", "рецепт", "обід"
    ],
  },
  {
    id: "travel",
    label: "Місця й подорожі",
    keywords: [
      "подорож", "поїздк", "дорога", "маршрут", "автобус", "льв", "одес",
      "київ", "карпат", "дніпро", "річк", "місто", "село", "вулиц", "ринок",
      "за кордон"
    ],
  },
  {
    id: "learning",
    label: "Навчання й мова",
    keywords: [
      "школ", "урок", "іспит", "курс", "бібліот", "мов", "занят", "книж",
      "книг", "дзвоник", "знан"
    ],
  },
  {
    id: "nature",
    label: "Природа",
    keywords: [
      "погод", "зима", "тварин", "ферм", "еколог", "соняшник", "море", "ліс"
    ],
  },
  {
    id: "everyday",
    label: "Щоденне життя",
    keywords: [],
  },
];

function normalizeSearchText(value = "") {
  return String(value)
    .toLocaleLowerCase("uk-UA")
    .replace(/[’ʼ]/g, "'")
    .replace(/[—–-]/g, " ")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim();
}

export function getStoryTopic(title) {
  const normalizedTitle = normalizeSearchText(title);
  return (
    STORY_TOPICS.find(
      (topic) => topic.keywords.length > 0 && topic.keywords.some((keyword) => normalizedTitle.includes(keyword))
    ) || STORY_TOPICS[STORY_TOPICS.length - 1]
  );
}

export function flattenActiveStories(levels = []) {
  return levels.flatMap((level) =>
    level.active === false
      ? []
      : (level.texts || [])
        .filter((story) => story.active !== false)
        .map((story, index) => ({
          ...story,
          levelId: level.id,
          levelDescription: level.description || "",
          displayNumber: index + 1,
        }))
  );
}

export function getStoryHref(story) {
  const query = new URLSearchParams({
    level: story.levelId,
    order: String(story.sortOrder),
  });

  if (story.storyId !== undefined && story.storyId !== null && String(story.storyId)) {
    query.set("story", String(story.storyId));
  }

  return `./story.html?${query}`;
}

export function storyMatchesFilters(story, filters, getProgress) {
  const progress = getProgress(story) || {};
  const query = normalizeSearchText(filters.query);
  const topic = getStoryTopic(story.title);
  const searchableText = normalizeSearchText(`${story.levelId} ${story.title} ${topic.label}`);

  if (query && !searchableText.includes(query)) {
    return false;
  }

  if (filters.topic !== "all" && topic.id !== filters.topic) {
    return false;
  }

  if (filters.status === "completed" && !progress.completed) {
    return false;
  }

  if (filters.status === "incomplete" && progress.completed) {
    return false;
  }

  if (filters.status === "bookmarked" && !progress.bookmarked) {
    return false;
  }

  return true;
}

function storyMatchesReference(story, reference) {
  if (!reference) {
    return false;
  }

  if (String(story.levelId) !== String(reference.level)) {
    return false;
  }

  if (reference.storyId && String(story.storyId) === String(reference.storyId)) {
    return true;
  }

  return Number(story.sortOrder) === Number(reference.sortOrder);
}

export function findContinueStory(levels, lastVisited, getProgress) {
  const stories = flattenActiveStories(levels);

  if (stories.length === 0) {
    return null;
  }

  const lastIndex = stories.findIndex((story) => storyMatchesReference(story, lastVisited));

  if (lastIndex >= 0) {
    const lastStory = stories[lastIndex];
    if (!getProgress(lastStory)?.completed) {
      return { story: lastStory, mode: "continue" };
    }

    const nextStory = [
      ...stories.slice(lastIndex + 1),
      ...stories.slice(0, lastIndex),
    ].find((story) => !getProgress(story)?.completed);

    return nextStory ? { story: nextStory, mode: "next" } : null;
  }

  const inProgressStory = stories.find((story) => {
    const progress = getProgress(story);
    return !progress?.completed && progress?.answers?.some((answer) => answer !== null && answer !== undefined);
  });

  if (inProgressStory) {
    return { story: inProgressStory, mode: "continue" };
  }

  const firstIncomplete = stories.find((story) => !getProgress(story)?.completed);
  return firstIncomplete ? { story: firstIncomplete, mode: "start" } : null;
}

export function findNextIncompleteStory(levels, currentStory, getProgress) {
  const stories = flattenActiveStories(levels);
  const currentIndex = stories.findIndex((story) => storyMatchesReference(story, {
    level: currentStory.level || currentStory.levelId,
    storyId: currentStory.storyId,
    sortOrder: currentStory.sortOrder,
  }));

  if (currentIndex < 0) {
    return stories.find((story) => !getProgress(story)?.completed) || null;
  }

  return [
    ...stories.slice(currentIndex + 1),
    ...stories.slice(0, currentIndex),
  ].find((story) => !getProgress(story)?.completed) || null;
}
