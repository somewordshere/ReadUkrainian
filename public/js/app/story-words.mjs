// Splits story prose into tappable words and applies stress marks for display.
// Shared by the reader and scripts/build-stress-map.mjs so both agree on what a
// "word" is and how a stress position is counted.

const WORD_PATTERN = /[\p{L}\p{M}\p{N}]+(?:['\u2019\u02BC\u2018-][\p{L}\p{M}\p{N}]+)*/gu;
const CYRILLIC_LETTER = /[\u0400-\u04FF]/u;
const APOSTROPHE_VARIANTS = /[\u2019\u02BC\u2018]/gu;
const STRESS_MARKS = /[\u0300\u0301]/gu;
const VOWELS = /[аеєиіїоуюя]/giu;

export const STRESS_MARK = "\u0301";

// Stripped from the decomposed text so a grave accent already merged into е or
// и (ѐ, ѝ) is removed too.
export function stripStressMarks(value) {
  return String(value ?? "").normalize("NFD").replace(STRESS_MARKS, "").normalize("NFC");
}

// The lookup key for a word: unstressed, lower-case, one apostrophe form.
// Cyrillic lower-casing never changes length, so character positions in the key
// line up with positions in the word as printed.
export function stressKey(word) {
  return stripStressMarks(word).normalize("NFC").toLocaleLowerCase("uk-UA").replace(APOSTROPHE_VARIANTS, "'");
}

export function countVowels(word) {
  return (String(word).match(VOWELS) || []).length;
}

// Returns [{ text, word: boolean }] covering the whole paragraph, so joining the
// pieces reproduces it exactly. Only words containing Cyrillic are marked as words.
export function tokenizeParagraph(text) {
  const source = String(text ?? "");
  const pieces = [];
  let offset = 0;

  for (const match of source.matchAll(WORD_PATTERN)) {
    if (!CYRILLIC_LETTER.test(match[0])) continue;
    if (match.index > offset) {
      pieces.push({ text: source.slice(offset, match.index), word: false });
    }
    pieces.push({ text: match[0], word: true });
    offset = match.index + match[0].length;
  }

  if (offset < source.length) {
    pieces.push({ text: source.slice(offset), word: false });
  }

  return pieces;
}

// stressMap values are the index of the stressed letter, or an array of indexes
// for compounds with more than one stress.
export function applyStress(word, stressMap) {
  const positions = stressMap?.[stressKey(word)];
  if (positions === undefined) return word;

  const stressed = new Set([positions].flat());
  const letters = Array.from(stripStressMarks(word).normalize("NFC"));
  return letters.map((letter, index) => (stressed.has(index) ? letter + STRESS_MARK : letter)).join("");
}
