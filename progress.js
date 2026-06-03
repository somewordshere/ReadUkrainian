const PROGRESS_STORAGE_KEY = "isuk-progress";
const PROGRESS_WINDOW_KEY = "__isukProgress__";
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

function getStoryStorageKeyByTitle(title) {
  return `title:${title}`;
}

function getStoryTitle(level, storyNumber) {
  try {
    return storiesByLevel[level]?.[storyNumber - 1]?.title || null;
  } catch (error) {
    return null;
  }
}

function getStoryStorageKey(level, storyNumber) {
  const title = getStoryTitle(level, storyNumber);
  return title ? getStoryStorageKeyByTitle(title) : String(storyNumber);
}

function migrateLegacyProgressKeys(progress) {
  Object.entries(LEGACY_STORY_TITLES_BY_LEVEL).forEach(([level, legacyTitles]) => {
    const levelProgress = progress[level];

    if (!levelProgress) {
      return;
    }

    Object.entries({ ...levelProgress }).forEach(([storyNumber, storyProgress]) => {
      if (!/^\d+$/.test(storyNumber)) {
        return;
      }

      const legacyTitle = legacyTitles[Number(storyNumber) - 1];

      if (!legacyTitle) {
        return;
      }

      const titleKey = getStoryStorageKeyByTitle(legacyTitle);

      if (!levelProgress[titleKey]) {
        levelProgress[titleKey] = storyProgress;
      }

      delete levelProgress[storyNumber];
    });

    if (Object.keys(levelProgress).length === 0) {
      delete progress[level];
    }
  });

  return progress;
}

function loadProgress() {
  const local = getBrowserStorage("localStorage");
  const session = getBrowserStorage("sessionStorage");
  const progress = migrateLegacyProgressKeys(
    mergeProgress(
      parseProgress(readFromStorage(local)),
      parseProgress(readFromStorage(session)),
      parseProgress(readFromWindowName())
    )
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
  return progress?.[level]?.[getStoryStorageKey(level, storyNumber)] || null;
}

function setStoryProgress(level, storyNumber, storyProgress) {
  const progress = loadProgress();
  const storyKey = getStoryStorageKey(level, storyNumber);

  if (!progress[level]) {
    progress[level] = {};
  }

  progress[level][storyKey] = storyProgress;
  saveProgress(progress);
}

function clearStoryProgress(level, storyNumber) {
  const progress = loadProgress();
  const storyKey = getStoryStorageKey(level, storyNumber);

  if (!progress[level]?.[storyKey]) {
    return;
  }

  delete progress[level][storyKey];

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
  const storyKey = getStoryStorageKey(level, storyNumber);

  if (!progress[level]) {
    progress[level] = {};
  }

  const existingStoryProgress = progress[level][storyKey] || {
    answers: [null, null, null, null, null],
    completed: false,
    correctCount: 0
  };

  progress[level][storyKey] = {
    ...existingStoryProgress,
    bookmarked
  };

  saveProgress(progress);
}
