import { listQuestionsForStories, listQuestionsForStory, replaceQuestionsForStory, validateQuestionsPayload } from "./questions.js";
import { LEVELS, LEVELS_BY_ID } from "./levels.js";

const TEXT_COLUMNS = `
  id, level, display_order, question_index, title, paragraphs_json,
  show_word_count, is_enabled, created_at, updated_at
`;

function toStoryRecord(row) {
  return {
    storyId: row.id,
    level: row.level,
    sortOrder: row.display_order,
    questionIndex: row.question_index,
    title: row.title,
    paragraphs: JSON.parse(row.paragraphs_json),
    showWordCount: Boolean(row.show_word_count),
    active: Boolean(row.is_enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function withQuestions(db, stories) {
  if (!stories.length) {
    return stories;
  }

  const questionsByStoryId = await listQuestionsForStories(
    db,
    stories.map((story) => story.storyId)
  );

  return stories.map((story) => ({
    ...story,
    questions: questionsByStoryId.get(story.storyId) || [],
  }));
}

async function withQuestionsForStory(db, story, includeQuestions) {
  if (!story || !includeQuestions) {
    return story;
  }

  return {
    ...story,
    questions: await listQuestionsForStory(db, story.storyId),
  };
}

async function getNextDisplayOrder(db, level) {
  const row = await db
    .prepare(`
      SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order
      FROM texts
      WHERE level = ?1
    `)
    .bind(level)
    .first();

  return Number(row?.next_order || 1);
}

export async function listTexts(db, { includeDisabled = false, includeQuestions = false } = {}) {
  const filterSql = includeDisabled ? "" : "WHERE is_enabled = 1";
  const statement = db.prepare(`
    SELECT ${TEXT_COLUMNS}
    FROM texts
    ${filterSql}
    ORDER BY level ASC, display_order ASC
  `);
  const result = await statement.all();
  const stories = (result.results || []).map(toStoryRecord);
  return includeQuestions ? withQuestions(db, stories) : stories;
}

export async function getStoryByLevelAndOrder(db, level, sortOrder, { includeQuestions = false } = {}) {
  const result = await db
    .prepare(`
      SELECT ${TEXT_COLUMNS}
      FROM texts
      WHERE level = ?1 AND display_order = ?2
      LIMIT 1
    `)
    .bind(level, sortOrder)
    .first();

  return withQuestionsForStory(db, result ? toStoryRecord(result) : null, includeQuestions);
}

export async function getStoryById(db, storyId, { includeQuestions = false } = {}) {
  const result = await db
    .prepare(`
      SELECT ${TEXT_COLUMNS}
      FROM texts
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(storyId)
    .first();

  return withQuestionsForStory(db, result ? toStoryRecord(result) : null, includeQuestions);
}

export async function createText(db, payload) {
  const sortOrder = await getNextDisplayOrder(db, payload.level);
  const now = new Date().toISOString();
  const insertResult = await db
    .prepare(`
      INSERT INTO texts (level, display_order, question_index, title, paragraphs_json, show_word_count, is_enabled, created_at, updated_at)
      VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
    `)
    .bind(
      payload.level,
      sortOrder,
      payload.title,
      JSON.stringify(payload.paragraphs),
      payload.showWordCount ? 1 : 0,
      payload.active ? 1 : 0,
      now
    )
    .run();

  const storyId = insertResult.meta.last_row_id;
  await replaceQuestionsForStory(db, storyId, payload.questions || []);
  return getStoryById(db, storyId, { includeQuestions: true });
}

export async function updateText(db, storyId, payload) {
  const existingStory = await getStoryById(db, storyId);

  if (!existingStory) {
    return null;
  }

  let sortOrder = existingStory.sortOrder;

  if (payload.level !== existingStory.level) {
    sortOrder = await getNextDisplayOrder(db, payload.level);
  }

  const now = new Date().toISOString();
  await db
    .prepare(`
      UPDATE texts
      SET level = ?1,
          display_order = ?2,
          question_index = ?2,
          title = ?3,
          paragraphs_json = ?4,
          show_word_count = ?5,
          is_enabled = ?6,
          updated_at = ?7
      WHERE id = ?8
    `)
    .bind(
      payload.level,
      sortOrder,
      payload.title,
      JSON.stringify(payload.paragraphs),
      payload.showWordCount ? 1 : 0,
      payload.active ? 1 : 0,
      now,
      storyId
    )
    .run();

  await replaceQuestionsForStory(db, storyId, payload.questions || []);
  return getStoryById(db, storyId, { includeQuestions: true });
}

export function validateTextPayload(payload, { allowLevel = false } = {}) {
  const paragraphs = Array.isArray(payload?.paragraphs)
    ? payload.paragraphs.map((paragraph) => String(paragraph).trim()).filter(Boolean)
    : [];

  if (allowLevel && !LEVELS_BY_ID[payload?.level]) {
    return { ok: false, message: "Invalid level." };
  }

  if (!String(payload?.title || "").trim()) {
    return { ok: false, message: "Title is required." };
  }

  if (paragraphs.length === 0) {
    return { ok: false, message: "At least one paragraph is required." };
  }

  const questionValidation = validateQuestionsPayload(payload?.questions);

  if (!questionValidation.ok) {
    return questionValidation;
  }

  return {
    ok: true,
    value: {
      level: payload?.level,
      title: String(payload.title).trim(),
      paragraphs,
      questions: questionValidation.value,
      showWordCount: payload?.showWordCount !== false,
      active: payload?.active !== false,
    },
  };
}

export function groupStories(stories) {
  return LEVELS.map((level) => ({
    ...level,
    texts: stories
      .filter((story) => story.level === level.id)
      .map((story) => ({
        storyId: story.storyId,
        sortOrder: story.sortOrder,
        questionIndex: story.questionIndex,
        title: story.title,
        active: story.active,
        showWordCount: story.showWordCount,
      })),
  }));
}
