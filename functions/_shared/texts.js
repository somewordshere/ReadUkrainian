import {
  buildReplaceQuestionStatements,
  listQuestionsForStories,
  listQuestionsForStory,
  validateQuestionsPayload,
} from "./questions.js";
import { LEVELS, LEVELS_BY_ID } from "./levels.js";

const TEXT_COLUMNS = `
  id, level, display_order, question_index, title, paragraphs_json,
  show_word_count, is_enabled, created_at, updated_at
`;

const ADMIN_TEXT_COLUMNS = `
  ${TEXT_COLUMNS}, draft_json, draft_updated_at, draft_updated_by_user_id,
  draft_updated_by_email, updated_by_user_id, updated_by_email, published_at
`;

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toStoryRecord(row) {
  return {
    storyId: row.id,
    level: row.level,
    sortOrder: row.display_order,
    questionIndex: row.question_index,
    title: row.title,
    paragraphs: parseJson(row.paragraphs_json, []),
    showWordCount: Boolean(row.show_word_count),
    active: Boolean(row.is_enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function draftPayload(row) {
  const draft = row.draft_json ? parseJson(row.draft_json, null) : null;
  return draft && typeof draft === "object" ? draft : null;
}

export function derivePublicationStatus({ active, hasDraft }) {
  if (active && hasDraft) return "published_with_draft";
  if (active) return "published";
  if (hasDraft) return "draft";
  return "unpublished";
}

async function withQuestions(db, stories) {
  if (!stories.length) return stories;

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
  if (!story || !includeQuestions) return story;

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

async function getAdminTextRow(db, storyId) {
  return db
    .prepare(`SELECT ${ADMIN_TEXT_COLUMNS} FROM texts WHERE id = ?1 LIMIT 1`)
    .bind(storyId)
    .first();
}

function toDraftJson(payload) {
  return JSON.stringify({
    level: payload.level,
    title: payload.title,
    paragraphs: payload.paragraphs,
    questions: payload.questions || [],
    showWordCount: payload.showWordCount,
  });
}

function toSnapshot(story) {
  return JSON.stringify({
    level: story.level,
    sortOrder: story.sortOrder,
    title: story.title,
    paragraphs: story.paragraphs,
    questions: story.questions || [],
    showWordCount: story.showWordCount,
    active: story.active,
  });
}

function revisionStatement(db, storyId, action, snapshot, actor, now) {
  return db
    .prepare(`
      INSERT INTO story_revisions
        (story_id, action, snapshot_json, created_by_user_id, created_by_email, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    `)
    .bind(storyId, action, snapshot, actor.userId, actor.email, now);
}

export async function listTexts(db, { includeDisabled = false, includeQuestions = false } = {}) {
  const filterSql = includeDisabled ? "" : "WHERE is_enabled = 1";
  const result = await db.prepare(`
    SELECT ${TEXT_COLUMNS}
    FROM texts
    ${filterSql}
    ORDER BY level ASC, display_order ASC
  `).all();
  const stories = (result.results || []).map(toStoryRecord);
  return includeQuestions ? withQuestions(db, stories) : stories;
}

export async function listAdminTextSummaries(db) {
  const result = await db.prepare(`
    SELECT id, level, display_order, title, is_enabled, updated_at,
           draft_json, draft_updated_at, draft_updated_by_email,
           updated_by_email, published_at
    FROM texts
    ORDER BY level ASC, display_order ASC
  `).all();

  return (result.results || []).map((row) => {
    const draft = draftPayload(row);
    const active = Boolean(row.is_enabled);
    const hasDraft = Boolean(draft);

    return {
      storyId: row.id,
      level: draft?.level || row.level,
      sortOrder: row.display_order,
      title: draft?.title || row.title,
      active,
      hasDraft,
      publicationStatus: derivePublicationStatus({ active, hasDraft }),
      updatedAt: row.draft_updated_at || row.updated_at,
      updatedByEmail: row.draft_updated_by_email || row.updated_by_email,
      publishedAt: row.published_at,
    };
  });
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
  // The questions lookup only needs the id, so it runs alongside the story query
  // instead of waiting for it.
  const [result, questions] = await Promise.all([
    db
      .prepare(`SELECT ${TEXT_COLUMNS} FROM texts WHERE id = ?1 LIMIT 1`)
      .bind(storyId)
      .first(),
    includeQuestions ? listQuestionsForStory(db, storyId) : null,
  ]);

  if (!result) {
    return null;
  }

  const story = toStoryRecord(result);
  return includeQuestions ? { ...story, questions } : story;
}

export async function getAdminStoryById(db, storyId) {
  const row = await getAdminTextRow(db, storyId);
  if (!row) return null;

  const published = await withQuestionsForStory(db, toStoryRecord(row), true);
  const draft = draftPayload(row);
  const active = Boolean(row.is_enabled);
  const hasDraft = Boolean(draft);

  return {
    ...published,
    ...(draft || {}),
    storyId: row.id,
    sortOrder: row.display_order,
    questionIndex: row.question_index,
    active,
    hasDraft,
    publicationStatus: derivePublicationStatus({ active, hasDraft }),
    draftUpdatedAt: row.draft_updated_at,
    draftUpdatedByEmail: row.draft_updated_by_email,
    updatedAt: row.updated_at,
    updatedByEmail: row.updated_by_email,
    publishedAt: row.published_at,
  };
}

export async function createTextDraft(db, payload, actor) {
  const sortOrder = await getNextDisplayOrder(db, payload.level);
  const now = new Date().toISOString();
  const insertResult = await db
    .prepare(`
      INSERT INTO texts (
        level, display_order, question_index, title, paragraphs_json,
        show_word_count, is_enabled, created_at, updated_at,
        draft_json, draft_updated_at, draft_updated_by_user_id, draft_updated_by_email
      )
      VALUES (?1, ?2, ?2, ?3, ?4, ?5, 0, ?6, ?6, ?7, ?6, ?8, ?9)
    `)
    .bind(
      payload.level,
      sortOrder,
      payload.title,
      JSON.stringify(payload.paragraphs),
      payload.showWordCount ? 1 : 0,
      now,
      toDraftJson(payload),
      actor.userId,
      actor.email
    )
    .run();

  return getAdminStoryById(db, insertResult.meta.last_row_id);
}

export async function saveTextDraft(db, storyId, payload, actor) {
  const existing = await getAdminTextRow(db, storyId);
  if (!existing) return null;

  const now = new Date().toISOString();
  await db
    .prepare(`
      UPDATE texts
      SET draft_json = ?1,
          draft_updated_at = ?2,
          draft_updated_by_user_id = ?3,
          draft_updated_by_email = ?4
      WHERE id = ?5
    `)
    .bind(toDraftJson(payload), now, actor.userId, actor.email, storyId)
    .run();

  return getAdminStoryById(db, storyId);
}

export async function publishText(db, storyId, payload, actor) {
  const row = await getAdminTextRow(db, storyId);
  if (!row) return null;

  const current = await withQuestionsForStory(db, toStoryRecord(row), true);
  const sortOrder = payload.level === row.level
    ? row.display_order
    : await getNextDisplayOrder(db, payload.level);
  const now = new Date().toISOString();
  const statements = [];

  if (row.published_at) {
    statements.push(revisionStatement(db, storyId, "before_publish", toSnapshot(current), actor, now));
  }

  statements.push(
    db.prepare(`
      UPDATE texts
      SET level = ?1,
          display_order = ?2,
          question_index = ?2,
          title = ?3,
          paragraphs_json = ?4,
          show_word_count = ?5,
          is_enabled = 1,
          draft_json = NULL,
          draft_updated_at = NULL,
          draft_updated_by_user_id = NULL,
          draft_updated_by_email = NULL,
          updated_at = ?6,
          updated_by_user_id = ?7,
          updated_by_email = ?8,
          published_at = ?6
      WHERE id = ?9
    `).bind(
      payload.level,
      sortOrder,
      payload.title,
      JSON.stringify(payload.paragraphs),
      payload.showWordCount ? 1 : 0,
      now,
      actor.userId,
      actor.email,
      storyId
    ),
    ...buildReplaceQuestionStatements(db, storyId, payload.questions || [])
  );

  await db.batch(statements);
  return getAdminStoryById(db, storyId);
}

export async function unpublishText(db, storyId, actor) {
  const row = await getAdminTextRow(db, storyId);
  if (!row) return null;
  if (!row.is_enabled) return getAdminStoryById(db, storyId);

  const current = await withQuestionsForStory(db, toStoryRecord(row), true);
  const now = new Date().toISOString();
  await db.batch([
    revisionStatement(db, storyId, "before_unpublish", toSnapshot(current), actor, now),
    db.prepare(`
      UPDATE texts
      SET is_enabled = 0,
          updated_at = ?1,
          updated_by_user_id = ?2,
          updated_by_email = ?3
      WHERE id = ?4
    `).bind(now, actor.userId, actor.email, storyId),
  ]);

  return getAdminStoryById(db, storyId);
}

export async function listTextRevisions(db, storyId) {
  const result = await db
    .prepare(`
      SELECT id, action, snapshot_json, created_by_email, created_at
      FROM story_revisions
      WHERE story_id = ?1
      ORDER BY created_at DESC, id DESC
      LIMIT 50
    `)
    .bind(storyId)
    .all();

  return (result.results || []).map((row) => {
    const snapshot = parseJson(row.snapshot_json, {});
    return {
      revisionId: row.id,
      action: row.action,
      title: snapshot.title || "Untitled story",
      level: snapshot.level || null,
      active: Boolean(snapshot.active),
      createdByEmail: row.created_by_email,
      createdAt: row.created_at,
    };
  });
}

export async function restoreTextRevision(db, storyId, revisionId, actor) {
  const [row, revision] = await Promise.all([
    getAdminTextRow(db, storyId),
    db.prepare(`
      SELECT id, snapshot_json
      FROM story_revisions
      WHERE id = ?1 AND story_id = ?2
      LIMIT 1
    `).bind(revisionId, storyId).first(),
  ]);

  if (!row || !revision) return null;

  const snapshot = parseJson(revision.snapshot_json, null);
  const validation = validateTextPayload(snapshot, { allowLevel: true });
  if (!validation.ok) throw new Error("The selected revision contains invalid story data.");

  const current = await withQuestionsForStory(db, toStoryRecord(row), true);
  const target = validation.value;
  const sortOrder = target.level === row.level
    ? row.display_order
    : await getNextDisplayOrder(db, target.level);
  const now = new Date().toISOString();
  const statements = [
    revisionStatement(db, storyId, "before_restore", toSnapshot(current), actor, now),
    db.prepare(`
      UPDATE texts
      SET level = ?1,
          display_order = ?2,
          question_index = ?2,
          title = ?3,
          paragraphs_json = ?4,
          show_word_count = ?5,
          is_enabled = ?6,
          draft_json = NULL,
          draft_updated_at = NULL,
          draft_updated_by_user_id = NULL,
          draft_updated_by_email = NULL,
          updated_at = ?7,
          updated_by_user_id = ?8,
          updated_by_email = ?9,
          published_at = CASE WHEN ?6 = 1 THEN ?7 ELSE published_at END
      WHERE id = ?10
    `).bind(
      target.level,
      sortOrder,
      target.title,
      JSON.stringify(target.paragraphs),
      target.showWordCount ? 1 : 0,
      snapshot.active ? 1 : 0,
      now,
      actor.userId,
      actor.email,
      storyId
    ),
    ...buildReplaceQuestionStatements(db, storyId, target.questions || []),
  ];

  await db.batch(statements);
  return getAdminStoryById(db, storyId);
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
  if (!questionValidation.ok) return questionValidation;

  return {
    ok: true,
    value: {
      level: payload?.level,
      title: String(payload.title).trim(),
      paragraphs,
      questions: questionValidation.value,
      showWordCount: payload?.showWordCount !== false,
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
