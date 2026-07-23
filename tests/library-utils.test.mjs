import test from "node:test";
import assert from "node:assert/strict";

import {
  findContinueStory,
  findNextIncompleteStory,
  flattenActiveStories,
  getStoryTopic,
  storyMatchesFilters,
} from "../public/js/app/library-utils.mjs";

const levels = [
  {
    id: "A1",
    description: "Starter",
    active: true,
    texts: [
      { storyId: "1", sortOrder: 1, title: "Мій звичайний день", active: true },
      { storyId: "2", sortOrder: 2, title: "Борщ — улюблена страва", active: true },
    ],
  },
  {
    id: "A2",
    description: "Elementary",
    active: true,
    texts: [
      { storyId: "3", sortOrder: 1, title: "Прогулянка Львовом", active: true },
      { storyId: "4", sortOrder: 2, title: "Hidden", active: false },
    ],
  },
  {
    id: "B1",
    active: false,
    texts: [{ storyId: "5", sortOrder: 1, title: "Inactive level", active: true }],
  },
];

test("flattens only active stories and adds display metadata", () => {
  const stories = flattenActiveStories(levels);

  assert.deepEqual(
    stories.map(({ storyId, levelId, displayNumber }) => ({ storyId, levelId, displayNumber })),
    [
      { storyId: "1", levelId: "A1", displayNumber: 1 },
      { storyId: "2", levelId: "A1", displayNumber: 2 },
      { storyId: "3", levelId: "A2", displayNumber: 1 },
    ]
  );
});

test("classifies common story topics", () => {
  assert.equal(getStoryTopic("Борщ — улюблена страва").id, "food");
  assert.equal(getStoryTopic("Прогулянка Львовом").id, "travel");
  assert.equal(getStoryTopic("Мій звичайний день").id, "everyday");
});

test("combines search, topic, and progress filters", () => {
  const story = flattenActiveStories(levels)[1];
  const progress = { completed: true, bookmarked: true };

  assert.equal(
    storyMatchesFilters(
      story,
      { query: "їжа", topic: "food", status: "bookmarked" },
      () => progress
    ),
    true
  );
  assert.equal(
    storyMatchesFilters(
      story,
      { query: "львів", topic: "all", status: "all" },
      () => progress
    ),
    false
  );
  assert.equal(
    storyMatchesFilters(
      story,
      { query: "", topic: "all", status: "incomplete" },
      () => progress
    ),
    false
  );
});

test("continues the last unfinished story, then advances after completion", () => {
  const progress = new Map([
    ["1", { answers: [0, null], completed: false }],
    ["2", { completed: false }],
  ]);
  const getProgress = (story) => progress.get(story.storyId);
  const lastVisited = { level: "A1", storyId: "1", sortOrder: 1 };

  assert.deepEqual(findContinueStory(levels, lastVisited, getProgress), {
    story: flattenActiveStories(levels)[0],
    mode: "continue",
  });

  progress.set("1", { completed: true });
  assert.equal(findContinueStory(levels, lastVisited, getProgress).story.storyId, "2");
  assert.equal(findContinueStory(levels, lastVisited, getProgress).mode, "next");
});

test("finds the next incomplete story across levels", () => {
  const stories = flattenActiveStories(levels);
  const currentStory = { ...stories[1], level: stories[1].levelId };
  const next = findNextIncompleteStory(
    levels,
    currentStory,
    (story) => ({ completed: story.storyId === "1" })
  );

  assert.equal(next.storyId, "3");
});
