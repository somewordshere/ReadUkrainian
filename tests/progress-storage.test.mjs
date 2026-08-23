import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const PROGRESS_SOURCE = fs.readFileSync("public/js/app/progress.js", "utf8");
const EXPORTED_NAMES = [
  "getStoryProgress",
  "setStoryProgress",
  "clearStoryProgress",
  "isStoryBookmarked",
  "setStoryBookmarked",
  "getLastVisitedStory",
  "setLastVisitedStory",
];

function createStorage(counters, label, seed = {}) {
  const entries = new Map(Object.entries(seed));

  return {
    entries,
    getItem(key) {
      counters[`${label}.get`] += 1;
      return entries.has(key) ? entries.get(key) : null;
    },
    setItem(key, value) {
      counters[`${label}.set`] += 1;
      entries.set(key, String(value));
    },
  };
}

// progress.js is a classic script that publishes globals, so it is evaluated in a
// VM with a browser-shaped `window` rather than imported.
function loadProgress({ local = {}, session = {}, windowName = "" } = {}) {
  const counters = {
    "local.get": 0,
    "local.set": 0,
    "session.get": 0,
    "session.set": 0,
    "windowName.set": 0,
  };
  const listeners = new Map();
  const win = {
    localStorage: createStorage(counters, "local", local),
    sessionStorage: createStorage(counters, "session", session),
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
  };

  let currentName = windowName;
  Object.defineProperty(win, "name", {
    get: () => currentName,
    set: (value) => {
      counters["windowName.set"] += 1;
      currentName = String(value);
    },
  });

  const context = vm.createContext({ window: win });
  context.window = win;
  vm.runInContext(
    `${PROGRESS_SOURCE}\n;globalThis.__api = { ${EXPORTED_NAMES.join(", ")} };`,
    context
  );

  return {
    api: context.__api,
    counters,
    window: win,
    emitStorageEvent: (key) => listeners.get("storage")?.({ key }),
    readLocal: () => JSON.parse(win.localStorage.entries.get("isuk-progress") || "{}"),
    readSession: () => JSON.parse(win.sessionStorage.entries.get("isuk-progress") || "{}"),
  };
}

const STORY = { level: "A1", storyId: 7, title: "Мій день" };
const SAMPLE = { answers: [0, 1, null, null, null], completed: false, correctCount: 1 };

// Values crossing back from the VM carry that realm's prototypes, which strict
// deep-equality rejects, so normalise them into this realm before comparing.
function plain(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function serialized(progress) {
  return JSON.stringify(progress);
}

test("round-trips story progress through every persistence layer", () => {
  const harness = loadProgress();

  harness.api.setStoryProgress(STORY.level, STORY.storyId, STORY.title, SAMPLE);

  assert.deepEqual(
    plain(harness.api.getStoryProgress(STORY.level, STORY.storyId, STORY.title)),
    SAMPLE
  );
  assert.deepEqual(harness.readLocal(), { A1: { "id:7": SAMPLE } });
  assert.deepEqual(harness.readSession(), { A1: { "id:7": SAMPLE } });
  assert.match(harness.window.name, /__isukProgress__/);
});

test("reads saved progress without writing to storage", () => {
  const stored = serialized({ A1: { "id:7": SAMPLE } });
  const harness = loadProgress({ local: { "isuk-progress": stored } });

  // The first read consolidates the merged view into every layer once.
  harness.api.getStoryProgress(STORY.level, STORY.storyId, STORY.title);
  const writesAfterFirstRead = harness.counters["local.set"];
  const readsAfterFirstRead = harness.counters["local.get"];

  for (let index = 0; index < 200; index += 1) {
    harness.api.getStoryProgress(STORY.level, STORY.storyId, STORY.title);
    harness.api.isStoryBookmarked(STORY.level, STORY.storyId, STORY.title);
  }

  assert.equal(harness.counters["local.set"], writesAfterFirstRead);
  assert.equal(harness.counters["session.set"], writesAfterFirstRead);
  assert.equal(harness.counters["local.get"], readsAfterFirstRead);
  assert.equal(harness.counters["windowName.set"], writesAfterFirstRead);
});

test("merges progress recorded in different persistence layers", () => {
  const harness = loadProgress({
    local: { "isuk-progress": serialized({ A1: { "id:1": SAMPLE } }) },
    session: { "isuk-progress": serialized({ A2: { "id:2": SAMPLE } }) },
    windowName: serialized({
      __isukProgress__: serialized({ B1: { "id:3": SAMPLE } }),
    }),
  });

  assert.deepEqual(plain(harness.api.getStoryProgress("A1", 1, "One")), SAMPLE);
  assert.deepEqual(plain(harness.api.getStoryProgress("A2", 2, "Two")), SAMPLE);
  assert.deepEqual(plain(harness.api.getStoryProgress("B1", 3, "Three")), SAMPLE);
  // The merged view is written back so every layer carries all three entries.
  assert.deepEqual(Object.keys(harness.readLocal()).sort(), ["A1", "A2", "B1"]);
});

test("migrates title-keyed progress onto the story id", () => {
  const harness = loadProgress({
    local: { "isuk-progress": serialized({ A1: { "title:Мій день": SAMPLE } }) },
  });

  assert.deepEqual(
    plain(harness.api.getStoryProgress(STORY.level, STORY.storyId, STORY.title)),
    SAMPLE
  );
  assert.deepEqual(harness.readLocal(), { A1: { "id:7": SAMPLE } });
});

test("migrates legacy numeric keys onto known story titles", () => {
  const harness = loadProgress({
    local: { "isuk-progress": serialized({ A1: { 11: SAMPLE } }) },
  });

  // "Мій день" is the 11th legacy A1 title.
  assert.deepEqual(plain(harness.api.getStoryProgress("A1", 99, "Мій день")), SAMPLE);
});

test("clearing progress removes the story and prunes empty levels", () => {
  const harness = loadProgress();

  harness.api.setStoryProgress(STORY.level, STORY.storyId, STORY.title, SAMPLE);
  harness.api.clearStoryProgress(STORY.level, STORY.storyId, STORY.title);

  assert.equal(harness.api.getStoryProgress(STORY.level, STORY.storyId, STORY.title), null);
  assert.deepEqual(harness.readLocal(), {});
});

test("toggling a bookmark preserves existing answers", () => {
  const harness = loadProgress();

  harness.api.setStoryProgress(STORY.level, STORY.storyId, STORY.title, SAMPLE);
  harness.api.setStoryBookmarked(STORY.level, STORY.storyId, STORY.title, true);

  assert.equal(harness.api.isStoryBookmarked(STORY.level, STORY.storyId, STORY.title), true);
  assert.deepEqual(
    plain(harness.api.getStoryProgress(STORY.level, STORY.storyId, STORY.title).answers),
    SAMPLE.answers
  );

  harness.api.setStoryBookmarked(STORY.level, STORY.storyId, STORY.title, false);
  assert.equal(harness.api.isStoryBookmarked(STORY.level, STORY.storyId, STORY.title), false);
});

test("a storage event from another tab refreshes the cached progress", () => {
  const harness = loadProgress();

  assert.equal(harness.api.getStoryProgress("A1", 42, "Later"), null);

  // Simulate another tab writing progress straight into shared storage.
  harness.window.localStorage.entries.set(
    "isuk-progress",
    serialized({ A1: { "id:42": SAMPLE } })
  );
  harness.emitStorageEvent("isuk-progress");

  assert.deepEqual(plain(harness.api.getStoryProgress("A1", 42, "Later")), SAMPLE);
});

test("survives storage that throws on access", () => {
  const context = vm.createContext({});
  const throwingStorage = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
  };
  const win = {
    localStorage: throwingStorage,
    sessionStorage: throwingStorage,
    name: "",
    addEventListener() {},
  };
  context.window = win;
  vm.runInContext(
    `${PROGRESS_SOURCE}\n;globalThis.__api = { ${EXPORTED_NAMES.join(", ")} };`,
    context
  );

  assert.doesNotThrow(() => {
    context.__api.setStoryProgress("A1", 1, "One", SAMPLE);
    context.__api.getStoryProgress("A1", 1, "One");
  });
});

test("last visited story round-trips and rejects incomplete references", () => {
  const harness = loadProgress();

  harness.api.setLastVisitedStory({ level: "A2", storyId: 5, sortOrder: 5, title: "Борщ" });
  const visited = harness.api.getLastVisitedStory();

  assert.equal(visited.level, "A2");
  assert.equal(visited.storyId, 5);
  assert.equal(visited.title, "Борщ");

  harness.api.setLastVisitedStory({ title: "No level" });
  assert.equal(harness.api.getLastVisitedStory().level, "A2");
});
