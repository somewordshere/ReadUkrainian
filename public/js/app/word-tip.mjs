// A one-time tip that points at a word near the start of the story and says it
// can be tapped to translate or hear it. It keeps appearing on each story until
// the learner taps a word or closes it.

// No word appears in every story, so these are the words found in at least 15%
// of the published stories (checked against the live site on 2026-09-23), three
// letters or longer so they are easy to tap, and translated in both the English
// and the German dictionary.
export const TIP_WORDS = Object.freeze([
  "біля", "після", "мене", "для", "але", "мені", "мама", "вона", "звати", "коли",
  "день", "увечері", "дуже", "тому", "тут", "тихо", "стіл", "там", "вікна", "від",
  "люди", "сьогодні", "вони", "довго", "він", "його", "тато", "стоїть", "часто",
  "школи", "бабуся", "уроку", "вдома", "було",
]);

const TIP_WORD_SET = new Set(TIP_WORDS);
const STORAGE_KEY = "readukrainian.word-tip";
const MIN_FALLBACK_LETTERS = 3;
// The tip fades in this long after the page opened, so the story is seen first.
const SHOW_DELAY_MS = 2500;

function normalize(word) {
  return String(word || "").toLocaleLowerCase("uk-UA").replace(/[’ʼ`]/gu, "'");
}

function randomItem(items, random) {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

// words: [{ word, paragraph }] in reading order. Returns the index of the word
// to point at, or -1. Prefers a common word in the first paragraph so the tip
// is on screen without scrolling, then the second paragraph, then any longer
// word in the first paragraph. Each distinct word is equally likely; its first
// occurrence is used.
export function pickTipWordIndex(words, random = Math.random) {
  const firstIndexByWord = (paragraphLimit, accept) => {
    const found = new Map();
    words.forEach(({ word, paragraph }, index) => {
      const normalized = normalize(word);
      if (paragraph < paragraphLimit && accept(normalized) && !found.has(normalized)) {
        found.set(normalized, index);
      }
    });
    return [...found.values()];
  };

  for (const candidates of [
    firstIndexByWord(1, (word) => TIP_WORD_SET.has(word)),
    firstIndexByWord(2, (word) => TIP_WORD_SET.has(word)),
    firstIndexByWord(1, (word) => [...word].length >= MIN_FALLBACK_LETTERS),
  ]) {
    if (candidates.length) return randomItem(candidates, random);
  }
  return -1;
}

function tipDismissed() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "done";
  } catch {
    return false;
  }
}

export function initWordTip({ container, root, tip, message, closeButton }) {
  let target = null;
  let resizeObserver = null;
  let showTimer = null;

  function position() {
    if (!target || tip.hidden) return;
    const containerRect = container.getBoundingClientRect();
    const wordRect = target.getBoundingClientRect();
    const tipWidth = tip.offsetWidth;
    const wordCenter = wordRect.left + wordRect.width / 2 - containerRect.left;
    const left = Math.min(Math.max(0, wordCenter - tipWidth / 2), Math.max(0, containerRect.width - tipWidth));

    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(wordRect.bottom - containerRect.top + 10)}px`;
    tip.style.setProperty("--tip-arrow-left", `${Math.round(wordCenter - left)}px`);
  }

  function hide({ remember = false } = {}) {
    if (remember) {
      try {
        window.localStorage.setItem(STORAGE_KEY, "done");
      } catch {
        // The tip simply returns on the next story.
      }
    }
    clearTimeout(showTimer);
    showTimer = null;
    tip.hidden = true;
    target?.classList.remove("is-tip-target");
    target = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
  }

  function reveal() {
    showTimer = null;
    target.classList.add("is-tip-target");
    tip.hidden = false;
    position();
    // Stress marks and web fonts change word widths after the story renders.
    resizeObserver = new ResizeObserver(position);
    resizeObserver.observe(root);
    document.fonts?.ready.then(position);
  }

  closeButton.addEventListener("click", () => hide({ remember: true }));
  // Tapping any word means the learner has found the feature.
  root.addEventListener("click", (event) => {
    if (target && event.target.closest?.("[data-word]")) hide({ remember: true });
  });
  window.addEventListener("resize", position);

  return {
    show({ speechEnabled = false } = {}) {
      hide();
      if (tipDismissed()) return;

      const wordElements = [...root.querySelectorAll("[data-word]")];
      const paragraphs = [...root.children];
      const index = pickTipWordIndex(
        wordElements.map((element) => ({
          word: element.dataset.word,
          paragraph: paragraphs.findIndex((paragraph) => paragraph.contains(element)),
        }))
      );
      if (index < 0) return;

      target = wordElements[index];
      message.textContent = speechEnabled
        ? `Торкніться слова «${target.dataset.word}», щоб перекласти або прослухати його.`
        : `Торкніться слова «${target.dataset.word}», щоб перекласти його.`;
      showTimer = setTimeout(reveal, Math.max(0, SHOW_DELAY_MS - performance.now()));
    },
    hide,
    position,
  };
}
