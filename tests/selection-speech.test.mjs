import test from "node:test";
import assert from "node:assert/strict";

import {
  initSelectionSpeech,
  normalizeSpeechText,
} from "../public/js/app/selection-speech.js";

class FakeElement extends EventTarget {
  constructor() {
    super();
    this.hidden = false;
    this.style = {};
    this.textContent = "";
    this.attributes = new Map();
    this.children = [];
    this.classList = { toggle: () => {} };
  }

  addChild(child) {
    this.children.push(child);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  append(...children) {
    for (const child of children) {
      if (typeof child === "string") {
        const text = new FakeElement();
        text.textContent = child;
        this.children.push(text);
      } else {
        this.children.push(child);
      }
    }
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }

  contains(node) {
    return node === this || this.children.some((child) => child?.contains?.(node) || child === node);
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }

  getBoundingClientRect() {
    return { width: 150, height: 46 };
  }
}

class FakeAudio extends EventTarget {
  constructor(source, playErrors = []) {
    super();
    this.source = source;
    this.playErrors = [...playErrors];
    this.playCalls = 0;
    this.pauseCalls = 0;
    this.currentTime = 0;
    this.preload = "";
  }

  play() {
    this.playCalls += 1;
    const error = this.playErrors.shift();
    return error ? Promise.reject(error) : Promise.resolve();
  }

  pause() {
    this.pauseCalls += 1;
  }
}

function audioResponse(bytes = [1, 2, 3]) {
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": "audio/mpeg" },
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function allText(element) {
  return [
    element?.textContent || "",
    ...(element?.children || []).map(allText),
  ].join(" ");
}

async function flushAsyncWork() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function createHarness({
  fetchImpl = async () => audioResponse(),
  audioPlayErrors = [],
  selectionText = "  Привіт,  ",
  visualViewport = null,
  createAudioThrows = false,
  popoverWidth = 150,
} = {}) {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const root = new FakeElement();
  const textNode = {};
  root.addChild(textNode);
  const popover = new FakeElement();
  const button = new FakeElement();
  popover.addChild(button);
  const translateButton = new FakeElement();
  popover.addChild(translateButton);
  popover.hidden = true;
  popover.getBoundingClientRect = function getBoundingClientRect() {
    const maximumWidth = Number.parseFloat(this.style.maxWidth);
    return {
      width: Number.isFinite(maximumWidth) ? Math.min(popoverWidth, maximumWidth) : popoverWidth,
      height: 46,
    };
  };
  const hint = new FakeElement();
  const icon = new FakeElement();
  const label = new FakeElement();
  const translateLabel = new FakeElement();
  const translationResult = new FakeElement();
  translationResult.hidden = true;
  const unavailable = new FakeElement();
  const status = new FakeElement();
  const documentTarget = new EventTarget();
  const requests = [];
  const audios = [];
  const revokedUrls = [];
  let nextObjectUrl = 1;
  const range = {
    startContainer: textNode,
    startOffset: 0,
    endContainer: textNode,
    endOffset: 12,
    cloneRange() {
      return this;
    },
    getClientRects() {
      return [{ left: 80, right: 180, top: 120, bottom: 142, width: 100, height: 22 }];
    },
    getBoundingClientRect() {
      return this.getClientRects()[0];
    },
  };
  const selection = {
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt() {
      return range;
    },
    toString() {
      return selectionText;
    },
  };
  const windowTarget = new EventTarget();
  const visualViewportTarget = visualViewport
    ? Object.assign(new EventTarget(), visualViewport)
    : null;

  Object.assign(documentTarget, {
    activeElement: null,
    createElement: () => new FakeElement(),
  });
  Object.assign(windowTarget, {
    innerWidth: 1024,
    innerHeight: 768,
    visualViewport: visualViewportTarget,
    getSelection: () => selection,
    requestAnimationFrame(callback) {
      callback();
      return 0;
    },
    cancelAnimationFrame() {},
    setTimeout(callback) {
      callback();
      return 0;
    },
  });

  globalThis.window = windowTarget;
  globalThis.document = documentTarget;

  const controller = initSelectionSpeech(
    {
      root,
      hint,
      popover,
      button,
      icon,
      label,
      translateButton,
      translateLabel,
      translationResult,
      unavailable,
      status,
    },
    {
      fetch: async (...args) => {
        requests.push(args);
        return fetchImpl(...args);
      },
      AbortController,
      createAudio(source) {
        if (createAudioThrows) throw new Error("Audio construction failed");
        const audio = new FakeAudio(source, audios.length === 0 ? audioPlayErrors : []);
        audios.push(audio);
        return audio;
      },
      createObjectURL() {
        return `blob:test-${nextObjectUrl++}`;
      },
      revokeObjectURL(url) {
        revokedUrls.push(url);
      },
    }
  );

  return {
    audios,
    button,
    controller,
    documentTarget,
    hint,
    label,
    popover,
    requests,
    revokedUrls,
    selection,
    status,
    translateButton,
    translateLabel,
    translationResult,
    unavailable,
    restore() {
      controller.reset();
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    },
  };
}

function showSelection(harness) {
  harness.controller.setContext({ storyId: 42 });
  harness.controller.setEnabled(true);
  harness.documentTarget.dispatchEvent(new Event("selectionchange"));
}

test("normalizes only whitespace without changing punctuation or Unicode composition", () => {
  assert.equal(normalizeSpeechText("  Привіт,\n\tдрузі!  "), "Привіт, друзі!");
  assert.equal(normalizeSpeechText("  і\u0308жа,  "), "і\u0308жа,");
});

test("posts normalized text and plays the returned server audio", async () => {
  const harness = createHarness();
  try {
    showSelection(harness);
    harness.button.dispatchEvent(new Event("click"));
    await flushAsyncWork();

    assert.equal(harness.requests.length, 1);
    assert.equal(harness.requests[0][0], "/api/speech");
    assert.equal(harness.requests[0][1].method, "POST");
    assert.deepEqual(JSON.parse(harness.requests[0][1].body), {
      storyId: 42,
      text: "Привіт,",
    });
    assert.match(harness.hint.textContent, /прослухати/);
    assert.match(harness.hint.textContent, /перекласти/);
    assert.doesNotMatch(harness.hint.textContent, /пристро|OpenAI|TTS\.ai/i);
    assert.equal(harness.audios.length, 1);
    assert.equal(harness.audios[0].playCalls, 1);
    assert.equal(harness.button.getAttribute("aria-pressed"), "true");
  } finally {
    harness.restore();
  }
});

test("requests fresh server audio after playback ends so voice changes take effect", async () => {
  const harness = createHarness();
  try {
    showSelection(harness);
    harness.button.dispatchEvent(new Event("click"));
    await flushAsyncWork();
    harness.audios[0].dispatchEvent(new Event("ended"));

    assert.equal(harness.button.getAttribute("aria-pressed"), "false");
    harness.button.dispatchEvent(new Event("click"));
    await flushAsyncWork();

    assert.equal(harness.requests.length, 2);
    assert.equal(harness.audios.length, 2);
    assert.equal(harness.audios[0].playCalls, 1);
    assert.equal(harness.audios[1].playCalls, 1);
    assert.deepEqual(harness.revokedUrls, ["blob:test-1"]);
  } finally {
    harness.restore();
  }
});

test("a second click aborts a pending speech request", async () => {
  const pending = deferred();
  const harness = createHarness({
    fetchImpl: (_url, options) => {
      options.signal.addEventListener("abort", () => {
        pending.reject(new DOMException("Aborted", "AbortError"));
      });
      return pending.promise;
    },
  });
  try {
    showSelection(harness);
    harness.button.dispatchEvent(new Event("click"));
    assert.equal(harness.button.getAttribute("aria-busy"), "true");

    harness.button.dispatchEvent(new Event("click"));
    await flushAsyncWork();

    assert.equal(harness.requests[0][1].signal.aborted, true);
    assert.equal(harness.button.getAttribute("aria-pressed"), "false");
    assert.equal(harness.audios.length, 0);
  } finally {
    harness.restore();
  }
});

test("keeps prepared audio for a user-activation retry", async () => {
  const notAllowed = Object.assign(new Error("Playback blocked"), { name: "NotAllowedError" });
  const harness = createHarness({ audioPlayErrors: [notAllowed] });
  try {
    showSelection(harness);
    harness.button.dispatchEvent(new Event("click"));
    await flushAsyncWork();

    assert.equal(harness.audios[0].playCalls, 1);
    assert.match(harness.status.textContent, /ще раз/);
    assert.equal(harness.label.textContent, "Аудіо готове — відтворити");
    assert.equal(harness.button.getAttribute("aria-pressed"), "false");

    harness.button.dispatchEvent(new Event("click"));
    await flushAsyncWork();
    assert.equal(harness.audios[0].playCalls, 2);
    assert.equal(harness.requests.length, 1);
  } finally {
    harness.restore();
  }
});

test("revokes the object URL when audio construction fails", async () => {
  const harness = createHarness({ createAudioThrows: true });
  try {
    showSelection(harness);
    harness.button.dispatchEvent(new Event("click"));
    await flushAsyncWork();

    assert.deepEqual(harness.revokedUrls, ["blob:test-1"]);
    assert.match(harness.status.textContent, /Не вдалося/);
  } finally {
    harness.restore();
  }
});

test("shows an actionable message instead of sending an oversized word", () => {
  const harness = createHarness({ selectionText: "а".repeat(81) });
  try {
    showSelection(harness);

    assert.equal(harness.popover.hidden, false);
    assert.equal(harness.button.hidden, true);
    assert.equal(harness.unavailable.hidden, false);
    assert.match(harness.unavailable.textContent, /80/);
    assert.equal(harness.requests.length, 0);
  } finally {
    harness.restore();
  }
});

test("rejects a multi-word selection locally with clear guidance", () => {
  const harness = createHarness({ selectionText: "Добрий день" });
  try {
    showSelection(harness);

    assert.equal(harness.popover.hidden, false);
    assert.equal(harness.button.hidden, true);
    assert.equal(harness.unavailable.hidden, false);
    assert.match(harness.unavailable.textContent, /лише одне слово/);
    assert.equal(harness.requests.length, 0);
  } finally {
    harness.restore();
  }
});

test("keeps server-side translation available when pronunciation is disabled", () => {
  const harness = createHarness({ selectionText: "мали" });
  try {
    harness.controller.setContext({ storyId: 42 });
    harness.controller.setEnabled(true);
    harness.controller.setSpeechEnabled(false);
    harness.documentTarget.dispatchEvent(new Event("selectionchange"));

    assert.equal(harness.popover.hidden, false);
    assert.equal(harness.button.hidden, true);
    assert.equal(harness.translateButton.hidden, false);
    assert.match(harness.hint.textContent, /перекласти/);
  } finally {
    harness.restore();
  }
});

test("requests one selected word and renders lemma, grammar, and translation", async () => {
  const dictionaryPayload = {
    query: { text: "мали", sourceLanguage: "uk", targetLanguage: "en" },
    entries: [{
      lemma: "мати",
      normalizedLemma: "мати",
      partOfSpeech: "verb",
      forms: [{
        form: "мали",
        grammar: {
          tense: "past",
          number: "plural",
          gender: "gender-not-distinguished",
        },
      }],
      translations: [{ text: "to have" }],
    }],
    attribution: {
      sourceName: "English Wiktionary via Kaikki.org",
      sourceUrl: "https://kaikki.org/dictionary/Ukrainian/",
      licenseName: "CC BY-SA 4.0 / GFDL",
      licenseUrl: "https://en.wiktionary.org/wiki/Wiktionary:Copyrights",
    },
  };
  const harness = createHarness({
    selectionText: "мали",
    fetchImpl: async (url) => {
      assert.equal(url, "/api/dictionary/lookup");
      return Response.json(dictionaryPayload);
    },
  });
  try {
    showSelection(harness);
    harness.translateButton.dispatchEvent(new Event("click"));
    await flushAsyncWork();

    assert.equal(harness.requests.length, 1);
    assert.deepEqual(JSON.parse(harness.requests[0][1].body), {
      text: "мали",
      targetLanguage: "en",
      storyId: 42,
    });
    assert.equal(harness.translationResult.hidden, false);
    assert.match(allText(harness.translationResult), /мати/);
    assert.match(allText(harness.translationResult), /минулий час/);
    assert.match(allText(harness.translationResult), /множина/);
    assert.match(allText(harness.translationResult), /рід не розрізняється/);
    assert.match(allText(harness.translationResult), /to have/);
    assert.equal(harness.translateButton.getAttribute("aria-expanded"), "true");
  } finally {
    harness.restore();
  }
});

test("switches the server-side dictionary request to German", async () => {
  const harness = createHarness({
    selectionText: "мама",
    fetchImpl: async () => Response.json({
      query: { text: "мама", sourceLanguage: "uk", targetLanguage: "de" },
      entries: [{
        lemma: "мама",
        normalizedLemma: "мама",
        partOfSpeech: "noun",
        forms: [{ form: "мама", grammar: { nominative: "nominative", number: "singular" } }],
        translations: [{ text: "Mama" }],
      }],
      attribution: null,
    }),
  });
  try {
    harness.controller.setTargetLanguage("de");
    showSelection(harness);
    harness.translateButton.dispatchEvent(new Event("click"));
    await flushAsyncWork();

    assert.deepEqual(JSON.parse(harness.requests[0][1].body), {
      text: "мама",
      targetLanguage: "de",
      storyId: 42,
    });
    assert.match(allText(harness.translationResult), /Mama/);
  } finally {
    harness.restore();
  }
});

test("shows a clear message when the dictionary has no matching entry", async () => {
  const harness = createHarness({
    selectionText: "марійка",
    fetchImpl: async () => Response.json({
      query: { text: "марійка", sourceLanguage: "uk", targetLanguage: "en" },
      entries: [],
      attribution: null,
    }),
  });
  try {
    showSelection(harness);
    harness.translateButton.dispatchEvent(new Event("click"));
    await flushAsyncWork();

    assert.match(allText(harness.translationResult), /Не знайшли перекладу/);
    assert.match(harness.status.textContent, /Не знайшли перекладу/);
  } finally {
    harness.restore();
  }
});

test("reset aborts translation and ignores a late dictionary response", async () => {
  const pending = deferred();
  const harness = createHarness({
    selectionText: "мали",
    fetchImpl: (_url, options) => {
      options.signal.addEventListener("abort", () => {});
      return pending.promise;
    },
  });
  try {
    showSelection(harness);
    harness.translateButton.dispatchEvent(new Event("click"));
    assert.equal(harness.translateButton.getAttribute("aria-busy"), "true");

    harness.controller.reset();
    pending.resolve(Response.json({
      query: { text: "мали", sourceLanguage: "uk", targetLanguage: "en" },
      entries: [{ lemma: "мати", forms: [], translations: [{ text: "to have" }] }],
      attribution: null,
    }));
    await flushAsyncWork();

    assert.equal(harness.requests[0][1].signal.aborted, true);
    assert.equal(harness.translationResult.hidden, true);
    assert.equal(harness.popover.hidden, true);
  } finally {
    harness.restore();
  }
});

test("positions and sizes the popover within an offset visual viewport", () => {
  const harness = createHarness({
    visualViewport: { offsetLeft: 100, offsetTop: 50, width: 180, height: 480 },
    popoverWidth: 400,
  });
  try {
    showSelection(harness);

    const left = Number.parseInt(harness.popover.style.left, 10);
    const maximumWidth = Number.parseInt(harness.popover.style.maxWidth, 10);
    assert.equal(maximumWidth, 156);
    assert.ok(left >= 112);
    assert.ok(left + maximumWidth <= 268);
    assert.ok(Number.parseInt(harness.popover.style.top, 10) >= 62);
  } finally {
    harness.restore();
  }
});

test("reset prevents a late response from starting audio", async () => {
  const pending = deferred();
  const harness = createHarness({ fetchImpl: () => pending.promise });
  try {
    showSelection(harness);
    harness.button.dispatchEvent(new Event("click"));
    harness.controller.reset();
    pending.resolve(audioResponse());
    await flushAsyncWork();

    assert.equal(harness.audios.length, 0);
    assert.equal(harness.popover.hidden, true);
    assert.equal(harness.hint.hidden, true);
  } finally {
    harness.restore();
  }
});

test("explains when the selected word has no server audio", async () => {
  const harness = createHarness({
    fetchImpl: async () => new Response("missing", { status: 404 }),
  });
  try {
    showSelection(harness);
    harness.button.dispatchEvent(new Event("click"));
    await flushAsyncWork();

    assert.match(harness.status.textContent, /немає аудіо/);
    assert.equal(harness.unavailable.hidden, false);
    assert.match(harness.unavailable.textContent, /інше слово/);
    assert.equal(harness.button.getAttribute("aria-pressed"), "false");
  } finally {
    harness.restore();
  }
});

test("shows one-word guidance when the server rejects the selection", async () => {
  const harness = createHarness({
    fetchImpl: async () => new Response("invalid", { status: 422 }),
  });
  try {
    showSelection(harness);
    harness.button.dispatchEvent(new Event("click"));
    await flushAsyncWork();

    assert.match(harness.status.textContent, /лише одне слово/);
    assert.equal(harness.unavailable.hidden, false);
    assert.match(harness.unavailable.textContent, /без пробілів/);
  } finally {
    harness.restore();
  }
});

test("shows the free daily-limit message for a daily 429", async () => {
  const harness = createHarness({
    fetchImpl: async () => new Response("limited", {
      status: 429,
      headers: { "x-speech-limit": "daily" },
    }),
  });
  try {
    showSelection(harness);
    harness.button.dispatchEvent(new Event("click"));
    await flushAsyncWork();

    assert.match(harness.status.textContent, /Безкоштовний денний ліміт/);
    assert.match(harness.status.textContent, /завтра/);
    assert.equal(harness.unavailable.hidden, false);
    assert.doesNotMatch(harness.unavailable.textContent, /OpenAI|TTS\.ai|пристро/i);
  } finally {
    harness.restore();
  }
});

test("asks the reader to retry in one minute for other 429 responses", async () => {
  const harness = createHarness({
    fetchImpl: async () => new Response("limited", { status: 429 }),
  });
  try {
    showSelection(harness);
    harness.button.dispatchEvent(new Event("click"));
    await flushAsyncWork();

    assert.match(harness.status.textContent, /за хвилину/);
    assert.equal(harness.unavailable.hidden, false);
    assert.doesNotMatch(harness.unavailable.textContent, /OpenAI|TTS\.ai|пристро/i);
  } finally {
    harness.restore();
  }
});

test("recovers visibly when an unrequested AbortError occurs", async () => {
  const harness = createHarness({
    fetchImpl: async () => {
      throw new DOMException("Response body aborted", "AbortError");
    },
  });
  try {
    showSelection(harness);
    harness.button.dispatchEvent(new Event("click"));
    await flushAsyncWork();

    assert.equal(harness.button.getAttribute("aria-busy"), "false");
    assert.equal(harness.button.getAttribute("aria-pressed"), "false");
    assert.equal(harness.unavailable.hidden, false);
    assert.match(harness.unavailable.textContent, /Не вдалося/);
  } finally {
    harness.restore();
  }
});

test("does not reopen a dismissed offer on an unrelated pointer release", () => {
  const harness = createHarness();
  try {
    showSelection(harness);
    harness.documentTarget.dispatchEvent(new Event("pointerdown"));
    assert.equal(harness.popover.hidden, true);

    harness.documentTarget.dispatchEvent(new Event("pointerup"));
    assert.equal(harness.popover.hidden, true);
  } finally {
    harness.restore();
  }
});
