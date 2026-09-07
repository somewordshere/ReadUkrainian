import { findContentDrift, formatDrift } from "./content-drift.mjs";

export const comparableQuestions = (questions = []) => questions.map(({ prompt, correct, wrong }) => ({ prompt, correct, wrong }));

export async function checkLiveContent({ origin, seed, questions, deep = false, expectedVersion, fetchImpl = fetch }) {
  const issues = [];
  const request = async (path) => {
    const response = await fetchImpl(`${origin}${path}`, { headers: { "cache-control": "no-cache" }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response;
  };
  const { levels } = await (await request("/api/content")).json();
  for (const id of ["A1", "A2"]) if (!levels?.some((l) => l.id === id && l.active !== false)) issues.push(`${id} must remain visible`);
  if (!levels?.some((l) => l.id === "B1" && l.active === false)) issues.push("B1 must remain hidden until real content is released");
  const drift = findContentDrift(seed, levels);
  if (!drift.ok) issues.push(formatDrift(drift));
  const stories = seed.filter((s) => s.active !== false && ["A1", "A2"].includes(s.level));
  if (deep) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(6, stories.length) }, async () => {
      while (next < stories.length) {
        const story = stories[next++];
        const key = `${story.level}#${story.sortOrder}`;
        try {
          const { story: actual } = await (await request(`/api/content/story?level=${story.level}&text=${story.sortOrder}`)).json();
          if (actual?.title !== story.title || JSON.stringify(actual?.paragraphs) !== JSON.stringify(story.paragraphs)) issues.push(`${key}: story differs`);
          const expected = questions.filter((q) => q.level === story.level && q.storyOrder === story.sortOrder).sort((a,b) => a.displayOrder - b.displayOrder);
          if (expected.length !== 5 || JSON.stringify(comparableQuestions(actual?.questions)) !== JSON.stringify(comparableQuestions(expected))) issues.push(`${key}: questions or answers differ`);
        } catch (error) { issues.push(`${key}: ${error.message}`); }
      }
    }));
  }
  if (expectedVersion) {
    const script = await (await request("/js/app/version.js")).text();
    if (!script.includes(`const SITE_VERSION = "${expectedVersion}"`)) issues.push(`Expected public version ${expectedVersion}`);
  }
  return { ok: issues.length === 0, stories: stories.length, questions: stories.length * 5, issues: issues.sort() };
}
