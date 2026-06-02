/* Data for this level is loaded after the shared base file. */
function getA2WrongOptions(pool, correct, offset) {
  const uniquePool = [...new Set(pool)].filter((item) => item !== correct);
  return Array.from({ length: 3 }, (_, index) => uniquePool[(offset + index) % uniquePool.length]);
}

const a2QuestionPools = {
  heroes: a2StorySeeds.map((story) => story.hero),
  places: a2StorySeeds.map((story) => story.place),
  actions: a2StorySeeds.map((story) => story.action),
  objects: a2StorySeeds.map((story) => story.object),
  results: a2StorySeeds.map((story) => story.result)
};

questionDataByLevel.A2 = a2StorySeeds.map((story, index) => [
  q("Хто є головним героєм тексту?", story.hero, getA2WrongOptions(a2QuestionPools.heroes, story.hero, index + 1)),
  q("Де відбувається історія?", story.place, getA2WrongOptions(a2QuestionPools.places, story.place, index + 2)),
  q("Що робить герой у тексті?", story.action, getA2WrongOptions(a2QuestionPools.actions, story.action, index + 3)),
  q("Яка важлива річ згадується в тексті?", story.object, getA2WrongOptions(a2QuestionPools.objects, story.object, index + 4)),
  q("Що відбувається або як герой почувається наприкінці?", story.result, getA2WrongOptions(a2QuestionPools.results, story.result, index + 5))
]);
