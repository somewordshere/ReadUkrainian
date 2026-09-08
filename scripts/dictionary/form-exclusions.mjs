// Reviewed 2026-09-06 against the Kaikki Ukrainian word pages for these lemmas.
// Their inflection tables contain forms of мама, червоний and парк respectively.
// Match exact normalized forms and lemma/POS pairs, never a general stem rule:
// legitimate alternations such as схід -> сходи and хтіти -> хочу must survive.
// These apply to Kaikki imports in either target language, including forms copied
// from a supplementary source. Keep migration 0022 and its regression tests aligned.
const EXCLUDED_FORMS = new Map([
  ["noun\u0000озимина", new Set([
    "мама", "мами", "мам", "мамів", "мамі", "мамам", "маму", "мамою",
    "мамами", "мамах", "мамо",
  ])],
  ["adj\u0000рясний", new Set([
    "червоний", "червоне", "червона", "червоні", "червоного", "червоної",
    "червоних", "червоному", "червоній", "червоним", "червону", "червоною",
    "червоними", "червонім",
  ])],
  ["noun\u0000лісопарк", new Set([
    "парк", "парки", "парку", "парків", "паркові", "паркам", "парком",
    "парками", "парках",
  ])],
]);

export function removeKnownIncorrectForms(normalizedLemma, partOfSpeech, forms) {
  for (const form of EXCLUDED_FORMS.get(`${partOfSpeech}\u0000${normalizedLemma}`) || []) {
    forms.delete(form);
  }
}
