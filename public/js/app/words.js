// «Мої слова»: the words a reader saved from the word popup, newest first, with
// the sentence they came from, a link back to the story, pronunciation and a
// file to carry the list to another browser.
import {
  MAX_SAVED_WORDS,
  SAVED_WORDS_STORAGE_KEY,
  browserSavedWords,
  savedWordKey,
  wordsLabel,
} from "./saved-words.mjs";
import { stressKey, tokenizeParagraph } from "./story-words.mjs";

const VOICE_STORAGE_KEY = "readukrainian.speech-voice";
const MAX_IMPORT_BYTES = 1024 * 1024;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

const savedWords = browserSavedWords();
const list = document.getElementById("wordsList");
const empty = document.getElementById("wordsEmpty");
const count = document.getElementById("wordsCount");
const status = document.getElementById("wordsStatus");
const exportButton = document.getElementById("wordsExport");
const importInput = document.getElementById("wordsImport");

let activeAudio = null;
let activeObjectUrl = "";
let activeButton = null;

function announce(message, action = null) {
  status.replaceChildren(message);
  if (action) {
    status.append(" ", action);
  }
}

function storyHref(entry) {
  if (!entry.level || !entry.order) return "";
  const query = new URLSearchParams({ level: entry.level, order: String(entry.order) });
  if (entry.storyId) query.set("story", String(entry.storyId));
  return `./story.html?${query}`;
}

// The sentence with the saved word marked, built from text nodes only.
function sentenceElement(entry) {
  const quote = document.createElement("p");
  quote.className = "word-card-sentence";
  quote.lang = "uk";
  tokenizeParagraph(entry.sentence).forEach((piece) => {
    if (piece.word && stressKey(piece.text) === entry.key) {
      const mark = document.createElement("mark");
      mark.textContent = piece.text;
      quote.appendChild(mark);
    } else {
      quote.append(piece.text);
    }
  });
  return quote;
}

function savedVoice() {
  try {
    return window.localStorage.getItem(VOICE_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function stopAudio() {
  activeAudio?.pause();
  activeAudio = null;
  if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
  activeObjectUrl = "";
  if (activeButton) {
    activeButton.setAttribute("aria-pressed", "false");
    activeButton.textContent = "▶ Прослухати";
  }
  activeButton = null;
}

async function play(entry, button) {
  const wasPlaying = activeButton === button;
  stopAudio();
  if (wasPlaying) return;

  activeButton = button;
  button.setAttribute("aria-pressed", "true");
  button.textContent = "… Прослухати";
  const voiceId = savedVoice();
  try {
    const response = await fetch("/api/speech", {
      method: "POST",
      headers: { accept: "audio/mpeg", "content-type": "application/json" },
      body: JSON.stringify(voiceId ? { storyId: entry.storyId, text: entry.word, voiceId } : { storyId: entry.storyId, text: entry.word }),
    });
    if (activeButton !== button) return;
    if (!response.ok || !(response.headers.get("content-type") || "").startsWith("audio/")) {
      throw Object.assign(new Error("Speech request failed."), {
        status: response.status,
        disabled: response.headers.get("x-speech-disabled") === "true",
      });
    }
    const blob = await response.blob();
    if (activeButton !== button) return;
    if (!blob.size || blob.size > MAX_AUDIO_BYTES) throw new Error("The speech response was empty or too large.");

    activeObjectUrl = URL.createObjectURL(blob);
    activeAudio = new Audio(activeObjectUrl);
    activeAudio.addEventListener("ended", stopAudio);
    activeAudio.addEventListener("error", stopAudio);
    button.textContent = "■ Зупинити";
    await activeAudio.play();
  } catch (error) {
    if (activeButton !== button) return;
    stopAudio();
    announce(
      error?.status === 429
        ? "Забагато запитів на озвучення. Спробуйте ще раз за хвилину."
        : error?.disabled
          ? "Вимова зараз вимкнена. Спробуйте пізніше."
          : error?.status === 404
            ? "Для цього слова зараз немає аудіо: текст змінили або прибрали."
            : "Не вдалося завантажити вимову слова. Спробуйте ще раз."
    );
  }
}

function remove(entry) {
  if (!savedWords.remove(entry.word)) {
    announce("Не вдалося змінити список: браузер не дозволяє зберігати дані.");
    return;
  }
  const undo = document.createElement("button");
  undo.type = "button";
  undo.className = "words-undo-button";
  undo.textContent = "Повернути";
  undo.addEventListener("click", () => {
    savedWords.restore(entry);
    render();
    announce(`Слово «${entry.word}» повернуто.`);
  });
  render();
  announce(`Слово «${entry.word}» прибрано.`, undo);
}

function card(entry) {
  const item = document.createElement("li");
  item.className = "word-card";

  const heading = document.createElement("div");
  heading.className = "word-card-heading";
  const word = document.createElement("h2");
  word.className = "word-card-word";
  word.lang = "uk";
  word.textContent = entry.word;
  heading.appendChild(word);

  const actions = document.createElement("div");
  actions.className = "word-card-actions";
  if (entry.storyId) {
    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = "word-card-button";
    playButton.setAttribute("aria-pressed", "false");
    playButton.setAttribute("aria-label", `Прослухати «${entry.word}»`);
    playButton.textContent = "▶ Прослухати";
    playButton.addEventListener("click", () => void play(entry, playButton));
    actions.appendChild(playButton);
  }
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "word-card-button word-card-remove";
  removeButton.setAttribute("aria-label", `Прибрати «${entry.word}»`);
  removeButton.textContent = "Прибрати";
  removeButton.addEventListener("click", () => remove(entry));
  actions.appendChild(removeButton);
  heading.appendChild(actions);
  item.appendChild(heading);

  if (entry.lemma || entry.partOfSpeech) {
    const meta = document.createElement("p");
    meta.className = "word-card-meta";
    if (entry.lemma && savedWordKey(entry.lemma) !== entry.key) {
      const lemma = document.createElement("strong");
      lemma.lang = "uk";
      lemma.textContent = entry.lemma;
      meta.append("форма слова ", lemma);
      if (entry.partOfSpeech) meta.append(" · ");
    }
    if (entry.partOfSpeech) meta.append(entry.partOfSpeech);
    item.appendChild(meta);
  }

  const translations = document.createElement("p");
  translations.className = "word-card-translations";
  if (entry.translations.length) {
    translations.lang = entry.language;
    translations.textContent = entry.translations.join("; ");
  } else {
    translations.classList.add("is-missing");
    translations.textContent = "Переклад не знайдено.";
  }
  item.appendChild(translations);

  if (entry.sentence) item.appendChild(sentenceElement(entry));

  const source = document.createElement("p");
  source.className = "word-card-source";
  const href = storyHref(entry);
  if (href) {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = entry.storyTitle || "Відкрити текст";
    source.append(`${entry.level} · `, link, " · ");
  }
  const date = document.createElement("time");
  date.dateTime = entry.savedAt;
  date.textContent = new Date(entry.savedAt).toLocaleDateString("uk-UA", { day: "numeric", month: "long", year: "numeric" });
  source.append(date);
  item.appendChild(source);

  return item;
}

function render() {
  const words = savedWords.list();
  list.replaceChildren(...words.map(card));
  empty.hidden = words.length > 0;
  list.hidden = words.length === 0;
  exportButton.disabled = words.length === 0;
  count.textContent = words.length ? `${wordsLabel(words.length)} з ${MAX_SAVED_WORDS}` : "";
  if (!savedWords.available) {
    announce("Цей браузер не дозволяє сайтам зберігати дані, тому слова тут не збережуться.");
  }
}

exportButton.addEventListener("click", () => {
  const blob = new Blob([savedWords.exportJson()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `moi-slova-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  announce("Файл збережено. Відкрийте його на іншому пристрої кнопкою «Відкрити файл».");
});

importInput.addEventListener("change", async () => {
  const file = importInput.files?.[0];
  importInput.value = "";
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) {
    announce("Файл завеликий для списку слів.");
    return;
  }
  const added = savedWords.importJson(await file.text());
  render();
  if (added < 0) {
    announce("Цей файл не схожий на збережені слова з цього сайту.");
  } else {
    announce(added ? `Додано ${wordsLabel(added)}.` : "Нових слів у файлі немає: усі вже є в списку.");
  }
});

window.addEventListener("storage", (event) => {
  if (!event.key || event.key === SAVED_WORDS_STORAGE_KEY) render();
});

render();
