function getLegacyLevels() {
  const descriptions = {
    A1: "Початковий рівень для коротких і простих текстів.",
    A2: "Базовий рівень для ширшого словникового запасу.",
    B1: "Середній рівень для довших і змістовніших текстів.",
  };

  return Object.keys(window.storiesByLevel || {}).map((levelId) => ({
    id: levelId,
    description: descriptions[levelId] || "",
    active: window.isLevelActive ? window.isLevelActive(levelId) : true,
    texts: (window.storiesByLevel[levelId] || []).map((story, index) => ({
      id: `${levelId}-${index + 1}`,
      storyNumber: index + 1,
      title: story.title,
      active: window.isStoryActive ? window.isStoryActive(story) : story.active !== false,
      showWordCount: story.showWordCount !== false,
    })),
  }));
}

function getLegacyStory(level, storyNumber) {
  const story = window.storiesByLevel?.[level]?.[storyNumber - 1];

  if (!story) {
    return null;
  }

  return {
    id: `${level}-${storyNumber}`,
    level,
    storyNumber,
    title: story.title,
    paragraphs: story.paragraphs || [],
    showWordCount: story.showWordCount !== false,
    active: window.isStoryActive ? window.isStoryActive(story) : story.active !== false,
  };
}

export async function fetchContentIndex() {
  try {
    const response = await fetch("./api/content", {
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`API request failed with ${response.status}`);
    }

    const payload = await response.json();
    return payload.levels;
  } catch {
    return getLegacyLevels();
  }
}

export async function fetchStory(level, storyNumber) {
  try {
    const url = new URL("./api/content/story", window.location.href);
    url.searchParams.set("level", level);
    url.searchParams.set("text", String(storyNumber));

    const response = await fetch(url, {
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`API request failed with ${response.status}`);
    }

    const payload = await response.json();
    return payload.story;
  } catch {
    return getLegacyStory(level, storyNumber);
  }
}
