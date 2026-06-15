import { LEVELS, LEVELS_BY_ID } from "./levels.js";

function toStoryRecord(row) {
  return {
    id: row.id,
    level: row.level,
    storyNumber: row.display_order,
    title: row.title,
    paragraphs: JSON.parse(row.paragraphs_json),
    showWordCount: Boolean(row.show_word_count),
    active: Boolean(row.is_enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listTexts(db, { includeDisabled = false } = {}) {
  const filterSql = includeDisabled ? "" : "WHERE is_enabled = 1";
  const statement = db.prepare(`
    SELECT id, level, display_order, title, paragraphs_json, show_word_count, is_enabled, created_at, updated_at
    FROM texts
    ${filterSql}
    ORDER BY level ASC, display_order ASC
  `);
  const result = await statement.all();
  return (result.results || []).map(toStoryRecord);
}

export async function getStoryByLevelAndNumber(db, level, storyNumber) {
  const result = await db
    .prepare(`
      SELECT id, level, display_order, title, paragraphs_json, show_word_count, is_enabled, created_at, updated_at
      FROM texts
      WHERE level = ?1 AND display_order = ?2
      LIMIT 1
    `)
    .bind(level, storyNumber)
    .first();

  return result ? toStoryRecord(result) : null;
}

export async function getTextById(db, id) {
  const result = await db
    .prepare(`
      SELECT id, level, display_order, title, paragraphs_json, show_word_count, is_enabled, created_at, updated_at
      FROM texts
      WHERE id = ?1
      LIMIT 1
    `)
    .bind(id)
    .first();

  return result ? toStoryRecord(result) : null;
}

export async function createText(db, payload) {
  const nextOrderRow = await db
    .prepare(`
      SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order
      FROM texts
      WHERE level = ?1
    `)
    .bind(payload.level)
    .first();

  const storyNumber = Number(nextOrderRow?.next_order || 1);
  const now = new Date().toISOString();
  const insertResult = await db
    .prepare(`
      INSERT INTO texts (level, display_order, title, paragraphs_json, show_word_count, is_enabled, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
    `)
    .bind(
      payload.level,
      storyNumber,
      payload.title,
      JSON.stringify(payload.paragraphs),
      payload.showWordCount ? 1 : 0,
      payload.active ? 1 : 0,
      now
    )
    .run();

  return getTextById(db, insertResult.meta.last_row_id);
}

export async function updateText(db, id, payload) {
  const now = new Date().toISOString();
  await db
    .prepare(`
      UPDATE texts
      SET title = ?1,
          paragraphs_json = ?2,
          show_word_count = ?3,
          is_enabled = ?4,
          updated_at = ?5
      WHERE id = ?6
    `)
    .bind(
      payload.title,
      JSON.stringify(payload.paragraphs),
      payload.showWordCount ? 1 : 0,
      payload.active ? 1 : 0,
      now,
      id
    )
    .run();

  return getTextById(db, id);
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

  return {
    ok: true,
    value: {
      level: payload?.level,
      title: String(payload.title).trim(),
      paragraphs,
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
        id: story.id,
        storyNumber: story.storyNumber,
        title: story.title,
        active: story.active,
        showWordCount: story.showWordCount,
      })),
  }));
}
