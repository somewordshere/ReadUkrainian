const storiesByLevel = {};

const levelSettingsById = {
  A1: { active: true },
  A2: { active: true },
  // Hidden until B1 has real content. Must match functions/_shared/levels.js.
  B1: { active: false }
};

function isLevelActive(levelId) {
  return levelSettingsById[levelId]?.active !== false;
}

function isStoryActive(story) {
  return story?.active !== false;
}

window.storiesByLevel = storiesByLevel;
window.isLevelActive = isLevelActive;
window.isStoryActive = isStoryActive;
