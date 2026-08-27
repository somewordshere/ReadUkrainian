// Compare what the repository says the reading content is against what a running
// site actually serves.
//
// This exists because A2 #3 «Мій будинок» sat unpublished in production for an
// unknown length of time. Nothing was broken in the code: an editor had
// unpublished it, the app hid it exactly as designed, and every test passed.
// The only symptom was a 404 for anyone arriving at that story by a saved
// bookmark or by restored progress, and nothing compared production against the
// repository, so nothing noticed.
//
// A unit test cannot catch that, because the defect lives in the data rather
// than the code. What a unit test *can* cover is this comparison, so the logic
// that would have caught it is itself verified. scripts/check-live-content.mjs
// feeds it a live site.

// A story is identified by the pair the URL and the UNIQUE constraint both use.
const keyOf = (level, sortOrder) => `${level}#${sortOrder}`;

export function findContentDrift(seedStories, liveLevels) {
  // A level the site marks inactive is hidden from learners, so nothing inside
  // it can reach them and none of it is drift. B1 is hidden precisely because
  // its 15 rows are placeholders with no questions; reporting those every run
  // would train everyone to ignore this check.
  const hiddenLevels = (liveLevels || [])
    .filter((level) => level.active === false)
    .map((level) => level.id);
  const hidden = new Set(hiddenLevels);

  const seedActive = (seedStories || []).filter(
    (story) => story.active !== false && !hidden.has(story.level)
  );

  const live = new Map();
  for (const level of liveLevels || []) {
    if (hidden.has(level.id)) continue;
    for (const text of level.texts || []) {
      live.set(keyOf(level.id, text.sortOrder), { ...text, level: level.id });
    }
  }

  const seed = new Map();
  for (const story of seedActive) seed.set(keyOf(story.level, story.sortOrder), story);

  // Active in the repository, not served by the site. Either unpublished or
  // deleted; from a learner's side those are the same failure.
  const missingLive = [];
  const titleMismatch = [];
  for (const [key, story] of seed) {
    const served = live.get(key);
    if (!served) {
      missingLive.push({ key, level: story.level, sortOrder: story.sortOrder, title: story.title });
      continue;
    }
    if (served.title !== story.title) {
      titleMismatch.push({ key, expected: story.title, actual: served.title });
    }
  }

  // Served by the site, absent from the repository. Not learner-facing damage,
  // but it means a text nobody can regenerate or review.
  const extraLive = [];
  for (const [key, served] of live) {
    if (!seed.has(key)) {
      extraLive.push({ key, level: served.level, sortOrder: served.sortOrder, title: served.title });
    }
  }

  // Holes in the served reading order, judged without reference to the
  // repository so this still reports something useful when the seed is wrong
  // too. A learner walking a level in order lands on these.
  const gaps = [];
  const byLevel = new Map();
  for (const served of live.values()) {
    if (!byLevel.has(served.level)) byLevel.set(served.level, []);
    byLevel.get(served.level).push(served.sortOrder);
  }
  for (const [level, orders] of byLevel) {
    orders.sort((a, b) => a - b);
    for (let expected = orders[0]; expected < orders[orders.length - 1]; expected += 1) {
      if (!orders.includes(expected)) gaps.push({ level, sortOrder: expected });
    }
  }

  const ordered = (list) => list.sort((a, b) => (a.key || a.level).localeCompare(b.key || b.level));

  return {
    ok: !missingLive.length && !extraLive.length && !titleMismatch.length && !gaps.length,
    missingLive: ordered(missingLive),
    extraLive: ordered(extraLive),
    titleMismatch: ordered(titleMismatch),
    gaps: gaps.sort((a, b) => a.level.localeCompare(b.level) || a.sortOrder - b.sortOrder),
    hiddenLevels,
  };
}

export function formatDrift(drift) {
  const note = drift.hiddenLevels?.length
    ? ` (${drift.hiddenLevels.join(", ")} hidden from learners, not checked)`
    : "";
  if (drift.ok) return `live content matches the repository${note}`;

  const lines = note ? [`  note:${note.slice(1)}`] : [];
  for (const item of drift.missingLive) {
    lines.push(`  missing live   ${item.key.padEnd(8)} «${item.title}» — unpublished or deleted`);
  }
  for (const item of drift.gaps) {
    lines.push(`  reading gap    ${item.level}#${item.sortOrder} — learners reading in order hit a 404 here`);
  }
  for (const item of drift.titleMismatch) {
    lines.push(`  title differs  ${item.key.padEnd(8)} repo «${item.expected}» vs live «${item.actual}»`);
  }
  for (const item of drift.extraLive) {
    lines.push(`  extra live     ${item.key.padEnd(8)} «${item.title}» — not in the repository`);
  }
  return lines.join("\n");
}
