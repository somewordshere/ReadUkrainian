const PROGRESS_STORAGE_KEY = "isuk-progress";
const PROGRESS_WINDOW_KEY = "__isukProgress__";

function getBrowserStorage(storageName) {
  try {
    return window[storageName] || null;
  } catch (error) {
    return null;
  }
}

function readFromStorage(storage) {
  try {
    if (!storage) {
      return null;
    }

    return storage.getItem(PROGRESS_STORAGE_KEY);
  } catch (error) {
    return null;
  }
}

function writeToStorage(storage, value) {
  try {
    if (!storage) {
      return false;
    }

    storage.setItem(PROGRESS_STORAGE_KEY, value);
    return true;
  } catch (error) {
    return false;
  }
}

function readFromWindowName() {
  try {
    if (!window.name) {
      return null;
    }

    const parsed = JSON.parse(window.name);
    return parsed?.[PROGRESS_WINDOW_KEY] || null;
  } catch (error) {
    return null;
  }
}

function parseProgress(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    return {};
  }
}

function mergeProgress(...progressSources) {
  return progressSources.reduce((merged, source) => {
    Object.entries(source || {}).forEach(([level, levelProgress]) => {
      if (!merged[level]) {
        merged[level] = {};
      }

      Object.assign(merged[level], levelProgress);
    });

    return merged;
  }, {});
}

function writeToWindowName(value) {
  try {
    let parsed = {};

    try {
      parsed = window.name ? JSON.parse(window.name) : {};
    } catch (error) {
      parsed = {};
    }

    parsed[PROGRESS_WINDOW_KEY] = value;
    window.name = JSON.stringify(parsed);
    return true;
  } catch (error) {
    return false;
  }
}

function loadProgress() {
  const local = getBrowserStorage("localStorage");
  const session = getBrowserStorage("sessionStorage");
  const progress = mergeProgress(
    parseProgress(readFromStorage(local)),
    parseProgress(readFromStorage(session)),
    parseProgress(readFromWindowName())
  );

  if (Object.keys(progress).length > 0) {
    saveProgress(progress);
  }

  return progress;
}

function saveProgress(progress) {
  const serialized = JSON.stringify(progress);
  writeToStorage(getBrowserStorage("localStorage"), serialized);
  writeToStorage(getBrowserStorage("sessionStorage"), serialized);
  writeToWindowName(serialized);
}

function getStoryProgress(level, storyNumber) {
  const progress = loadProgress();
  return progress?.[level]?.[storyNumber] || null;
}

function setStoryProgress(level, storyNumber, storyProgress) {
  const progress = loadProgress();

  if (!progress[level]) {
    progress[level] = {};
  }

  progress[level][storyNumber] = storyProgress;
  saveProgress(progress);
}

function clearStoryProgress(level, storyNumber) {
  const progress = loadProgress();

  if (!progress[level]?.[storyNumber]) {
    return;
  }

  delete progress[level][storyNumber];

  if (Object.keys(progress[level]).length === 0) {
    delete progress[level];
  }

  saveProgress(progress);
}

function isStoryCompleted(level, storyNumber) {
  return Boolean(getStoryProgress(level, storyNumber)?.completed);
}

function isStoryBookmarked(level, storyNumber) {
  return Boolean(getStoryProgress(level, storyNumber)?.bookmarked);
}

function setStoryBookmarked(level, storyNumber, bookmarked) {
  const progress = loadProgress();

  if (!progress[level]) {
    progress[level] = {};
  }

  const existingStoryProgress = progress[level][storyNumber] || {
    answers: [null, null, null, null, null],
    completed: false,
    correctCount: 0
  };

  progress[level][storyNumber] = {
    ...existingStoryProgress,
    bookmarked
  };

  saveProgress(progress);
}
