const PROGRESS_STORAGE_KEY = "isuk-progress";
const LAST_STORY_STORAGE_KEY = "isuk-last-story";
// Older versions also mirrored progress into window.name. Any site can set a
// tab's window.name (window.open's second argument) and read it after the tab
// navigates away, so it is neither private nor trustworthy; these keys are only
// ever removed now.
const RETIRED_WINDOW_NAME_KEYS = ["__isukProgress__", "__isukLastStory__"];
// Keys that would reach Object.prototype if merged into a plain object.
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
// A frozen migration table, not content: progress saved before stories had ids
// was keyed by position, and these are the titles those positions held. It
// stays in this file because a separate data file would cost every page an
// extra request before progress can load.
const LEGACY_STORY_TITLES_BY_LEVEL = {
  "A1": [
    "Розклад занять студента",
    "Мої домашні тварини",
    "Нова машина для сім'ї",
    "Мій будинок",
    "Моя м'яка іграшка",
    "Новий однокласник",
    "Поїздка з мамою",
    "Книги та іграшки",
    "Мій звичайний день",
    "Будинок моєї сім'ї",
    "Мій день",
    "Моя чудова родина",
    "На пошті",
    "Мої канікули"
  ],
  "A2": [
    "Мій день",
    "Моя сім'я",
    "Мій будинок",
    "У школі",
    "Мій друг",
    "У магазині",
    "Мій улюблений спорт",
    "Погода сьогодні",
    "Що я їм на сніданок",
    "Мої домашні тварини",
    "Маршрутка або автобус",
    "У лікаря",
    "Мій вільний час",
    "Дні тижня",
    "День пам'яті жертв Чорнобиля",
    "Новий рік",
    "День Соборності України",
    "Різдво Христове",
    "День Героїв Небесної Сотні",
    "Міжнародний жіночий день",
    "Вишиванка - мій одяг",
    "Борщ - улюблена страва",
    "Великдень",
    "Вареники на обід",
    "Хліб та сіль",
    "Моя вулиця",
    "Перший дзвоник - День знань",
    "Покупки на ринку",
    "Я допомагаю вдома",
    "День матері",
    "День вишиванки",
    "У кафе",
    "Моя улюблена їжа",
    "Зима в Україні",
    "Писанка - мистецтво розпису яєць",
    "Числа і гроші",
    "Моя мама",
    "Пісня на уроці",
    "Тварини на фермі",
    "Хто де живе",
    "День Конституції України",
    "Дорога до школи",
    "Мій день народження",
    "Ранок у сім'ї",
    "Річка Дніпро",
    "День Незалежності України",
    "Відпочинок в Одесі та на Чорному морі",
    "День захисників і захисниць",
    "День Гідності та Свободи",
    "День пам'яті жертв Голодомору",
    "Традиція Івана Купала",
    "Переїзд у нове місто",
    "Як готують пампушки",
    "Прогулянка Львовом",
    "Перший заробіток",
    "Великдень: традиції і значення",
    "Українська вишивка",
    "Мандрівка Карпатами",
    "Як я навчився готувати",
    "Моя бабуся і її рецепти",
    "Традиційний одяг різних регіонів",
    "Козацька історія",
    "Калина - символ України",
    "Нові друзі на мовних курсах",
    "Київ - місто на горах",
    "Останній дзвоник",
    "Новий рік: традиції та родина",
    "Малий бізнес у селі",
    "День захисників: листи із фронту",
    "Поїздка до бабусі в село",
    "Соняшники - символ степу",
    "Українська мова у світі",
    "Перша подорож за кордон",
    "День вишиванки: традиція і сучасність",
    "Гуцульські традиції",
    "Чорнобиль: пам'ять і уроки",
    "Ринок Привоз в Одесі",
    "Як я готуюся до іспиту",
    "День пам'яті Голодомору: свічка у вікні",
    "Традиційний весільний обряд",
    "День Героїв Небесної Сотні: пам'ять і вибір",
    "Сільська гостинність",
    "Екологія і Карпати",
    "Мій улюблений український письменник",
    "День Соборності: одна країна, різні голоси",
    "Холодець на Різдво",
    "Дванадцять страв на Святий вечір",
    "Чому я вивчаю іноземні мови",
    "Допомога ветеранам",
    "Кава по-львівськи",
    "Трійця і клечання",
    "Переваги роботи онлайн",
    "Водохреща",
    "День Гідності та Свободи: що він означає сьогодні",
    "Народна медицина в Україні",
    "День Конституції: права і обов'язки",
    "Фестиваль Країна Мрій",
    "Листи до рідних",
    "Українці у світі",
    "Одеса: місто між морем і степом",
    "Волонтерство як стиль життя",
    "Що означає бути українцем",
    "Україна і світ: новий погляд"
  ],
  "B1": [
    "Текст 1",
    "Текст 2",
    "Текст 3",
    "Текст 4",
    "Текст 5",
    "Текст 6",
    "Текст 7",
    "Текст 8",
    "Текст 9",
    "Текст 10",
    "Текст 11",
    "Текст 12",
    "Текст 13",
    "Текст 14",
    "Текст 15"
  ]
};
Object.values(LEGACY_STORY_TITLES_BY_LEVEL).forEach(Object.freeze);
Object.freeze(LEGACY_STORY_TITLES_BY_LEVEL);

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

function forgetWindowNameProgress() {
  try {
    const parsed = window.name ? JSON.parse(window.name) : null;
    if (!isPlainRecord(parsed)) return;
    if (!RETIRED_WINDOW_NAME_KEYS.some((key) => Object.prototype.hasOwnProperty.call(parsed, key))) return;

    RETIRED_WINDOW_NAME_KEYS.forEach((key) => delete parsed[key]);
    window.name = Object.keys(parsed).length ? JSON.stringify(parsed) : "";
  } catch (error) {
    // window.name held something else; it is not ours to change.
  }
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

forgetWindowNameProgress();

function parseProgress(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    return isPlainRecord(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

// Stored progress is untrusted input, so the merge builds prototype-less
// objects and drops keys that would otherwise write to Object.prototype.
function mergeProgress(...progressSources) {
  const merged = Object.create(null);

  progressSources.forEach((source) => {
    Object.entries(source || {}).forEach(([level, levelProgress]) => {
      if (UNSAFE_KEYS.has(level) || !isPlainRecord(levelProgress)) {
        return;
      }

      const mergedLevel = ensureLevel(merged, level);
      Object.entries(levelProgress).forEach(([storyKey, storyProgress]) => {
        if (!UNSAFE_KEYS.has(storyKey) && isPlainRecord(storyProgress)) {
          mergedLevel[storyKey] = storyProgress;
        }
      });
    });
  });

  return merged;
}

function emptyStoryProgress() {
  return {
    answers: [],
    completed: false,
    correctCount: 0
  };
}

function getStoryStorageKeyByTitle(title) {
  return `title:${title}`;
}

function getStoryStorageKey(storyId) {
  return `id:${storyId}`;
}

function ensureLevel(progress, level) {
  if (!progress[level]) {
    progress[level] = Object.create(null);
  }

  return progress[level];
}

// Moves title-keyed progress onto the story id in memory only; the next write
// persists it, so reading progress never writes to storage.
function migrateStoryProgressToId(progress, level, storyId, title) {
  const storyKey = getStoryStorageKey(storyId);
  const titleKey = title ? getStoryStorageKeyByTitle(title) : null;
  const levelProgress = progress[level];

  if (!levelProgress || levelProgress[storyKey] || !titleKey || !levelProgress[titleKey]) {
    return storyKey;
  }

  levelProgress[storyKey] = levelProgress[titleKey];
  delete levelProgress[titleKey];
  return storyKey;
}

function migrateLegacyProgressKeys(progress) {
  Object.entries(LEGACY_STORY_TITLES_BY_LEVEL).forEach(([level, legacyTitles]) => {
    const levelProgress = progress[level];

    if (!levelProgress) {
      return;
    }

    Object.entries({ ...levelProgress }).forEach(([legacyStoryNumber, storyProgress]) => {
      if (!/^\d+$/.test(legacyStoryNumber)) {
        return;
      }

      const legacyTitle = legacyTitles[Number(legacyStoryNumber) - 1];

      if (!legacyTitle) {
        return;
      }

      const titleKey = getStoryStorageKeyByTitle(legacyTitle);

      if (!levelProgress[titleKey]) {
        levelProgress[titleKey] = storyProgress;
      }

      delete levelProgress[legacyStoryNumber];
    });

    if (Object.keys(levelProgress).length === 0) {
      delete progress[level];
    }
  });

  return progress;
}

// Reading progress is a hot path: the library re-reads it several times per story
// on every render and keystroke. Merging the persistence layers is only needed
// once per page, so the merged state is cached and reused.
let cachedProgress = null;

function readMergedProgress() {
  return migrateLegacyProgressKeys(
    mergeProgress(
      parseProgress(readFromStorage(getBrowserStorage("localStorage"))),
      parseProgress(readFromStorage(getBrowserStorage("sessionStorage")))
    )
  );
}

function loadProgress() {
  if (cachedProgress) {
    return cachedProgress;
  }

  cachedProgress = readMergedProgress();

  // Consolidate the merged view into every layer once per page, so a layer that
  // was missing entries catches up without writing again on each later read.
  if (Object.keys(cachedProgress).length > 0) {
    persistProgress(cachedProgress);
  }

  return cachedProgress;
}

function persistProgress(progress) {
  const serialized = JSON.stringify(progress);
  writeToStorage(getBrowserStorage("localStorage"), serialized);
  writeToStorage(getBrowserStorage("sessionStorage"), serialized);
}

function saveProgress(progress) {
  cachedProgress = progress;
  persistProgress(progress);
}

// Another tab writing progress makes this tab's cache stale, so drop it and let
// the next read rebuild from storage.
try {
  window.addEventListener("storage", (event) => {
    if (!event.key || event.key === PROGRESS_STORAGE_KEY) {
      cachedProgress = null;
    }
  });
} catch (error) {
  // Without storage events the cache simply lives for the page's lifetime.
}

function getStoryProgress(level, storyId, title) {
  const progress = loadProgress();
  const storyKey = migrateStoryProgressToId(progress, level, storyId, title);
  return progress[level]?.[storyKey] || null;
}

function setStoryProgress(level, storyId, title, storyProgress) {
  const progress = loadProgress();
  const storyKey = migrateStoryProgressToId(progress, level, storyId, title);

  ensureLevel(progress, level)[storyKey] = storyProgress;
  saveProgress(progress);
}

function clearStoryProgress(level, storyId, title) {
  const progress = loadProgress();
  const storyKey = migrateStoryProgressToId(progress, level, storyId, title);

  if (!progress[level]?.[storyKey]) {
    return;
  }

  delete progress[level][storyKey];

  if (Object.keys(progress[level]).length === 0) {
    delete progress[level];
  }

  saveProgress(progress);
}

function isStoryBookmarked(level, storyId, title) {
  return Boolean(getStoryProgress(level, storyId, title)?.bookmarked);
}

function setStoryBookmarked(level, storyId, title, bookmarked) {
  const progress = loadProgress();
  const storyKey = migrateStoryProgressToId(progress, level, storyId, title);
  const levelProgress = ensureLevel(progress, level);

  levelProgress[storyKey] = {
    ...(levelProgress[storyKey] || emptyStoryProgress()),
    bookmarked
  };

  saveProgress(progress);
}

// Opening a text counts as starting it, so the library can show "reading"
// before the first question is answered.
function markStoryOpened(level, storyId, title) {
  const progress = loadProgress();
  const storyKey = migrateStoryProgressToId(progress, level, storyId, title);
  const existingStoryProgress = progress[level]?.[storyKey];

  if (existingStoryProgress?.opened) {
    return;
  }

  ensureLevel(progress, level)[storyKey] = {
    ...emptyStoryProgress(),
    ...existingStoryProgress,
    opened: true
  };

  saveProgress(progress);
}

function parseLastVisitedStory(raw) {
  try {
    const story = raw ? JSON.parse(raw) : null;
    return isPlainRecord(story) && story.level && (story.storyId || story.sortOrder) ? story : null;
  } catch (error) {
    return null;
  }
}

function getLastVisitedStory() {
  for (const storage of [getBrowserStorage("localStorage"), getBrowserStorage("sessionStorage")]) {
    try {
      const story = parseLastVisitedStory(storage?.getItem(LAST_STORY_STORAGE_KEY));
      if (story) {
        return story;
      }
    } catch (error) {
      // Continue to the next available persistence layer.
    }
  }

  return null;
}

function setLastVisitedStory(story) {
  if (!story?.level || (!story.storyId && !story.sortOrder)) {
    return;
  }

  const serialized = JSON.stringify({
    level: story.level,
    storyId: story.storyId,
    sortOrder: story.sortOrder,
    title: story.title || "",
    visitedAt: new Date().toISOString(),
  });

  for (const storage of [getBrowserStorage("localStorage"), getBrowserStorage("sessionStorage")]) {
    try {
      storage?.setItem(LAST_STORY_STORAGE_KEY, serialized);
    } catch (error) {
      // Progress persistence is best-effort when browser storage is restricted.
    }
  }
}
