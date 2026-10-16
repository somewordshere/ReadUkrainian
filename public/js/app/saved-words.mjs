// Words a reader saved from the word popup. They live in this browser only, like
// progress: no account, nothing sent to the server. One entry per word form,
// keyed the way the reader matches words (unstressed, lower-case, one apostrophe).
import { stressKey, stripStressMarks } from "./story-words.mjs";

export const SAVED_WORDS_STORAGE_KEY = "readukrainian.saved-words";
export const MAX_SAVED_WORDS = 500;
const STORE_VERSION = 1;
const MAX_TEXT = 80;
const MAX_TITLE = 200;
const MAX_SENTENCE = 400;
const MAX_TRANSLATION = 200;
const MAX_TRANSLATIONS = 3;
const LANGUAGES = new Set(["en", "de", "pl"]);
const LEVEL_PATTERN = /^[A-C][12]$/;

// 1 слово, 2 слова, 5 слів.
export function wordsLabel(number) {
  const lastTwo = number % 100;
  const last = number % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return `${number} слів`;
  if (last === 1) return `${number} слово`;
  if (last >= 2 && last <= 4) return `${number} слова`;
  return `${number} слів`;
}

export function savedWordKey(word) {
  return stressKey(String(word ?? "").trim());
}

function cleanText(value, limit) {
  return stripStressMarks(String(value ?? "")).replace(/\s+/gu, " ").trim().slice(0, limit);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function validDate(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

// Stored and imported entries are untrusted input: every field is rebuilt from
// known types and lengths, and anything without a usable word is dropped.
export function normalizeSavedWord(value, now = new Date()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const word = cleanText(value.word, MAX_TEXT);
  const key = savedWordKey(word);
  if (!key || /\s/u.test(key) || !/[Ѐ-ӿ]/u.test(key)) return null;

  const translations = (Array.isArray(value.translations) ? value.translations : [])
    .map((translation) => cleanText(translation, MAX_TRANSLATION))
    .filter(Boolean)
    .slice(0, MAX_TRANSLATIONS);
  const language = LANGUAGES.has(value.language) ? value.language : "en";
  const level = typeof value.level === "string" && LEVEL_PATTERN.test(value.level) ? value.level : "";

  return {
    key,
    word,
    lemma: cleanText(value.lemma, MAX_TEXT),
    partOfSpeech: cleanText(value.partOfSpeech, 40),
    translations,
    language,
    sentence: cleanText(value.sentence, MAX_SENTENCE),
    storyId: positiveInteger(value.storyId),
    level,
    order: positiveInteger(value.order),
    storyTitle: cleanText(value.storyTitle, MAX_TITLE),
    savedAt: validDate(value.savedAt) || now.toISOString(),
  };
}

// Newest first, one entry per key (the newest wins), at most MAX_SAVED_WORDS.
function normalizeList(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => normalizeSavedWord(value))
    .filter(Boolean)
    .sort((first, second) => second.savedAt.localeCompare(first.savedAt))
    .filter((entry) => {
      if (seen.has(entry.key)) return false;
      seen.add(entry.key);
      return true;
    })
    .slice(0, MAX_SAVED_WORDS);
}

export function parseSavedWords(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    return normalizeList(Array.isArray(parsed) ? parsed : parsed?.words);
  } catch {
    return [];
  }
}

export function serializeSavedWords(words) {
  return JSON.stringify({ version: STORE_VERSION, words });
}

// The sentence of `text` that holds the character at `offset`, for the example
// shown next to a saved word.
export function sentenceAround(text, offset) {
  const source = String(text ?? "");
  const position = Math.max(0, Math.min(Number(offset) || 0, Math.max(source.length - 1, 0)));
  const sentences = source.match(/[^.!?…]+(?:[.!?…]+["»”’)]*)?\s*|[.!?…]+\s*/gu) || [source];
  let start = 0;
  for (const sentence of sentences) {
    if (position < start + sentence.length) return sentence.trim().slice(0, MAX_SENTENCE);
    start += sentence.length;
  }
  return source.trim().slice(0, MAX_SENTENCE);
}

// Turns a dictionary answer into the fields a saved word keeps: the first
// entry's lemma and part of speech, and its translations with the one marked
// for this story first.
export function savedWordFromLookup(word, payload) {
  const entry = (Array.isArray(payload?.entries) ? payload.entries : [])[0];
  const translations = (entry?.translations || [])
    .slice()
    .sort((first, second) => Number(second?.preferred === true) - Number(first?.preferred === true))
    .map((translation) => translation?.text);
  return {
    word,
    lemma: entry?.lemma || "",
    partOfSpeech: entry?.partOfSpeech || "",
    translations,
    language: payload?.query?.targetLanguage,
  };
}

export function createSavedWords(storage, { now = () => new Date() } = {}) {
  let cache = null;

  function read() {
    if (cache) return cache;
    try {
      cache = parseSavedWords(storage?.getItem(SAVED_WORDS_STORAGE_KEY));
    } catch {
      cache = [];
    }
    return cache;
  }

  function write(words) {
    try {
      if (!storage) return false;
      storage.setItem(SAVED_WORDS_STORAGE_KEY, serializeSavedWords(words));
      cache = words;
      return true;
    } catch {
      // Full or blocked storage: keep what was there.
      return false;
    }
  }

  return {
    available: Boolean(storage),
    list: () => read().slice(),
    count: () => read().length,
    has: (word) => {
      const key = savedWordKey(word);
      return Boolean(key) && read().some((entry) => entry.key === key);
    },
    keys: () => new Set(read().map((entry) => entry.key)),
    // Saving a word that is already there moves it to the top with the new
    // details. Returns "saved", "full" or "failed".
    save(value) {
      const entry = normalizeSavedWord({ ...value, savedAt: now().toISOString() }, now());
      if (!entry) return "failed";
      const others = read().filter((existing) => existing.key !== entry.key);
      if (others.length >= MAX_SAVED_WORDS) return "full";
      return write([entry, ...others]) ? "saved" : "failed";
    },
    // Puts back a word that was just removed, in its old place.
    restore(entry) {
      const others = read().filter((existing) => existing.key !== entry?.key);
      if (others.length >= MAX_SAVED_WORDS) return false;
      return write(normalizeList([...others, entry]));
    },
    remove(word) {
      const key = savedWordKey(word);
      const words = read();
      const remaining = words.filter((entry) => entry.key !== key);
      if (remaining.length === words.length) return true;
      return write(remaining);
    },
    exportJson: () => JSON.stringify({ app: "readukrainianapp.com", version: STORE_VERSION, words: read() }, null, 2),
    // Merges a file made by exportJson; the newer copy of a word wins and the
    // list keeps the cap. Returns the number of words added, or -1 for a file
    // that is not a saved-words export.
    importJson(text) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return -1;
      }
      const incoming = Array.isArray(parsed) ? parsed : parsed?.words;
      if (!Array.isArray(incoming)) return -1;
      const before = read();
      const known = new Set(before.map((entry) => entry.key));
      const merged = normalizeList([...before, ...incoming]);
      if (!write(merged)) return -1;
      return merged.filter((entry) => !known.has(entry.key)).length;
    },
    // Another tab changed the list.
    forget() {
      cache = null;
    },
  };
}

export function browserSavedWords() {
  let storage = null;
  try {
    storage = window.localStorage || null;
  } catch {
    storage = null;
  }
  const savedWords = createSavedWords(storage);
  try {
    window.addEventListener("storage", (event) => {
      if (!event.key || event.key === SAVED_WORDS_STORAGE_KEY) savedWords.forget();
    });
  } catch {
    // Without storage events the list is re-read on the next page load.
  }
  return savedWords;
}
