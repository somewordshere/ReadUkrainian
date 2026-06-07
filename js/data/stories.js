const storiesByLevel = {};

const levelSettingsById = {
  A1: { active: true },
  A2: { active: true },
  B1: { active: true }
};

function isLevelActive(levelId) {
  return levelSettingsById[levelId]?.active !== false;
}

function isStoryActive(story) {
  return story?.active !== false;
}
