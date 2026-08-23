import { createHash } from "node:crypto";

export const SPEECH_CANONICALIZATION_VERSION = "uk-word-nfc-v1";

const APOSTROPHE_VARIANTS = /[\u2019\u2018\u02BC\uFF07\u0060\u00B4]/gu;
const HYPHEN_VARIANTS = /[\u2010\u2011\u2012\u2013\u2014\u2212]/gu;
const UKRAINIAN_WORD_SOURCE = "[а-щьюяєіїґ]+(?:['-][а-щьюяєіїґ]+)*";
const UKRAINIAN_WORD_PATTERN = new RegExp(`^${UKRAINIAN_WORD_SOURCE}$`, "u");
const STORY_TOKEN_PATTERN = /[\p{L}\p{M}\p{N}]+(?:['-][\p{L}\p{M}\p{N}]+)*/gu;

function normalizeJoiners(value) {
  return value
    .replace(APOSTROPHE_VARIANTS, "'")
    .replace(HYPHEN_VARIANTS, "-");
}

export function normalizeUkrainianText(value) {
  return normalizeJoiners(
    String(value ?? "")
      .normalize("NFC")
      .trim()
      .toLocaleLowerCase("uk-UA")
  ).normalize("NFC");
}

export function canonicalizeSpeechWord(value) {
  const normalized = normalizeUkrainianText(value);
  return UKRAINIAN_WORD_PATTERN.test(normalized) ? normalized : null;
}

export function extractCanonicalSpeechWords(value) {
  const words = [];
  for (const match of normalizeUkrainianText(value).matchAll(STORY_TOKEN_PATTERN)) {
    if (UKRAINIAN_WORD_PATTERN.test(match[0])) words.push(match[0]);
  }
  return words;
}

function speechAssetHash(canonicalWord) {
  const word = canonicalizeSpeechWord(canonicalWord);
  if (!word) {
    throw new TypeError(`Not one canonical Ukrainian word: ${JSON.stringify(canonicalWord)}`);
  }

  return createHash("sha256").update(word, "utf8").digest("hex");
}

export function speechAssetFilename(canonicalWord) {
  return `${speechAssetHash(canonicalWord)}.mp3`;
}
