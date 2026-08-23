// The bundled copy of the learning content is a fallback for when the content
// service is unavailable. It is far larger than the rest of the front end, so it
// is fetched on demand instead of on every page load.
//
// The data files are classic scripts that append to the `storiesByLevel` and
// `questionDataByLevel` globals declared by data/stories.js and app/questions.js,
// so they are injected as script tags rather than imported as modules.

const STORY_DATA_FILES = [
  "./js/data/a1-stories.js",
  "./js/data/a2-stories.js",
  "./js/data/b1-stories.js",
];

const QUESTION_DATA_FILES = [
  "./js/data/a1-questions.js",
  "./js/data/a2-questions.js",
  "./js/data/b1-questions.js",
];

const pendingScripts = new Map();

function loadScript(src) {
  const existing = pendingScripts.get(src);
  if (existing) {
    return existing;
  }

  const pending = new Promise((resolve, reject) => {
    const element = document.createElement("script");
    element.src = src;
    // Injected scripts default to async; keeping order makes the data files
    // append to the shared globals in the same sequence as the markup did.
    element.async = false;
    element.addEventListener("load", () => resolve());
    element.addEventListener("error", () => {
      pendingScripts.delete(src);
      reject(new Error(`Failed to load ${src}`));
    });
    document.head.appendChild(element);
  });

  pendingScripts.set(src, pending);
  return pending;
}

function loadAll(sources) {
  return Promise.all(sources.map(loadScript));
}

let storiesPromise = null;
let questionsPromise = null;

export function loadLegacyStories() {
  if (!storiesPromise) {
    storiesPromise = loadAll(STORY_DATA_FILES).catch((error) => {
      storiesPromise = null;
      throw error;
    });
  }

  return storiesPromise;
}

export function loadLegacyQuestions() {
  if (!questionsPromise) {
    questionsPromise = loadAll(QUESTION_DATA_FILES).catch((error) => {
      questionsPromise = null;
      throw error;
    });
  }

  return questionsPromise;
}
