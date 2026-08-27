import assert from "node:assert/strict";
import test from "node:test";

import { findContentDrift, formatDrift } from "../scripts/lib/content-drift.mjs";

// The A2 #3 incident: a story active in the repository was unpublished in
// production, so /api/content omitted it and /api/content/story returned 404 for
// anyone arriving by bookmark or restored progress. No code was wrong and every
// test passed, because nothing compared the live site against the repository.
// These tests cover the comparison that would have caught it.

const seed = [
  { level: "A1", sortOrder: 1, title: "Будинок моєї сім'ї", active: true },
  { level: "A2", sortOrder: 1, title: "Мій день", active: true },
  { level: "A2", sortOrder: 2, title: "Моя сім'я", active: true },
  { level: "A2", sortOrder: 3, title: "Мій будинок", active: true },
  { level: "A2", sortOrder: 4, title: "У школі", active: true },
  { level: "B1", sortOrder: 1, title: "Чернетка", active: false },
];

const liveFrom = (entries) => {
  const byLevel = new Map();
  for (const [level, sortOrder, title] of entries) {
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level).push({ sortOrder, title, storyId: sortOrder, active: true });
  }
  return [...byLevel].map(([id, texts]) => ({ id, texts }));
};

const healthy = liveFrom([
  ["A1", 1, "Будинок моєї сім'ї"],
  ["A2", 1, "Мій день"],
  ["A2", 2, "Моя сім'я"],
  ["A2", 3, "Мій будинок"],
  ["A2", 4, "У школі"],
]);

test("a site serving exactly the repository content reports no drift", () => {
  const drift = findContentDrift(seed, healthy);

  assert.equal(drift.ok, true);
  assert.deepEqual(drift.missingLive, []);
  assert.deepEqual(drift.gaps, []);
  assert.equal(formatDrift(drift), "live content matches the repository");
});

test("a story inactive in the repository is not expected live", () => {
  // B1 #1 is active: false in the seed and absent from the live site. That is
  // agreement, not drift; flagging it would make the check cry wolf.
  const drift = findContentDrift(seed, healthy);
  assert.ok(!drift.missingLive.some((item) => item.key === "B1#1"));
});

test("the A2 #3 incident is caught: unpublished live, active in the repository", () => {
  const live = liveFrom([
    ["A1", 1, "Будинок моєї сім'ї"],
    ["A2", 1, "Мій день"],
    ["A2", 2, "Моя сім'я"],
    ["A2", 4, "У школі"],
  ]);

  const drift = findContentDrift(seed, live);

  assert.equal(drift.ok, false);
  assert.deepEqual(drift.missingLive, [
    { key: "A2#3", level: "A2", sortOrder: 3, title: "Мій будинок" },
  ]);
  // Reported twice on purpose, from two independent angles: it is missing
  // relative to the repository, and it is a hole in the served reading order.
  assert.deepEqual(drift.gaps, [{ level: "A2", sortOrder: 3 }]);
  assert.match(formatDrift(drift), /A2#3.*unpublished or deleted/);
  assert.match(formatDrift(drift), /reading gap\s+A2#3/);
});

test("a hole in the reading order is reported even when the repository shares the mistake", () => {
  // Both sides missing A2 #3 means no repository mismatch, but a learner reading
  // A2 in order still hits a 404 at position three.
  const seedWithHole = seed.filter((story) => !(story.level === "A2" && story.sortOrder === 3));
  const live = liveFrom([
    ["A2", 1, "Мій день"],
    ["A2", 2, "Моя сім'я"],
    ["A2", 4, "У школі"],
    ["A1", 1, "Будинок моєї сім'ї"],
  ]);

  const drift = findContentDrift(seedWithHole, live);

  assert.deepEqual(drift.missingLive, []);
  assert.deepEqual(drift.gaps, [{ level: "A2", sortOrder: 3 }]);
  assert.equal(drift.ok, false);
});

test("a story served but absent from the repository is reported", () => {
  const live = liveFrom([
    ["A1", 1, "Будинок моєї сім'ї"],
    ["A2", 1, "Мій день"],
    ["A2", 2, "Моя сім'я"],
    ["A2", 3, "Мій будинок"],
    ["A2", 4, "У школі"],
    ["B1", 16, "Тільки в продакшені"],
  ]);

  const drift = findContentDrift(seed, live);

  assert.deepEqual(drift.extraLive, [
    { key: "B1#16", level: "B1", sortOrder: 16, title: "Тільки в продакшені" },
  ]);
  assert.deepEqual(drift.gaps, [], "a single live-only story is not a gap");
});

test("a story whose live title has drifted from the repository is reported", () => {
  const live = liveFrom([
    ["A1", 1, "Будинок моєї сім'ї"],
    ["A2", 1, "Мій день"],
    ["A2", 2, "Стара назва"],
    ["A2", 3, "Мій будинок"],
    ["A2", 4, "У школі"],
  ]);

  const drift = findContentDrift(seed, live);

  assert.deepEqual(drift.titleMismatch, [
    { key: "A2#2", expected: "Моя сім'я", actual: "Стара назва" },
  ]);
});

test("a level hidden from learners is excluded rather than reported every run", () => {
  // B1 is active: false on the live site because all 15 rows are placeholders
  // with no questions. Nothing in it can reach a learner, so none of it is
  // drift; reporting it every run is how a check gets ignored.
  const seedWithB1 = [
    ...seed.filter((story) => story.level !== "B1"),
    { level: "B1", sortOrder: 1, title: "Текст 1", active: true },
    { level: "B1", sortOrder: 2, title: "Текст 2", active: true },
  ];
  const live = [
    ...healthy,
    // Hidden, and deliberately inconsistent: a gap, a rename, an extra row.
    {
      id: "B1",
      active: false,
      texts: [
        { sortOrder: 1, title: "Зовсім інша назва" },
        { sortOrder: 3, title: "67" },
      ],
    },
  ];

  const drift = findContentDrift(seedWithB1, live);

  assert.equal(drift.ok, true);
  assert.deepEqual(drift.hiddenLevels, ["B1"]);
  assert.deepEqual(drift.missingLive, []);
  assert.deepEqual(drift.extraLive, []);
  assert.deepEqual(drift.titleMismatch, []);
  assert.deepEqual(drift.gaps, []);
  assert.match(formatDrift(drift), /B1 hidden from learners/);
});

test("an empty response is drift, not agreement", () => {
  // A content service returning nothing must never read as a healthy site.
  const drift = findContentDrift(seed, []);

  assert.equal(drift.ok, false);
  assert.equal(drift.missingLive.length, 5);
});
