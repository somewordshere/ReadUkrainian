import {
  buildReplaceQuestionStatements,
  listQuestionsForStory,
  validateQuestionsPayload,
} from "./questions.js";
import { LEVELS, LEVELS_BY_ID } from "./levels.js";

const TEXT_COLUMNS = `
  id, level, display_order, question_index, title, paragraphs_json,
  show_word_count, is_enabled, created_at, updated_at
`;

const TEXT_SUMMARY_COLUMNS = `
  id, level, display_order, question_index, title, show_word_count, is_enabled
`;

// Far above any real story (the longest today is 49 title characters and
// 1,211 characters of text) while keeping one save well inside a D1 row.
const MAX_TITLE_CHARACTERS = 200;
const MAX_PARAGRAPHS = 50;
const MAX_STORY_CHARACTERS = 20_000;

export class RevisionDataError extends Error {}

const ADMIN_TEXT_COLUMNS = `
  ${TEXT_COLUMNS}, draft_json, draft_updated_at, draft_updated_by_user_id,
  draft_updated_by_email, updated_by_user_id, updated_by_email, published_at, edit_version
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

async function withQuestionsForStory(db, story, includeQuestions) {
  if (!story || !includeQuestions) return story;

  return {
    ...story,
    questions: await listQuestionsForStory(db, story.storyId),
  };
}

// The next free position in a level, computed inside the statement that uses
// it: reading MAX()+1 first and writing it separately let two concurrent saves
// pick the same position and fail on UNIQUE(level, display_order).
function nextDisplayOrderSql(levelParameter) {
  return `(SELECT COALESCE(MAX(display_order), 0) + 1 FROM texts WHERE level = ${levelParameter})`;
}

// Moving a story to another level puts it at the end of that level; staying in
// its level keeps its position. question_index follows display_order as before.
function placementSql(levelParameter) {
  const next = nextDisplayOrderSql(levelParameter);
  return `display_order = CASE WHEN level = ${levelParameter} THEN display_order ELSE ${next} END,
          question_index = CASE WHEN level = ${levelParameter} THEN display_order ELSE ${next} END`;
}

// The version an editor last saw. Every draft save, publish, unpublish and
// restore writes a fresh random token, so no two writes share one (timestamps
// can: two saves in the same millisecond).
function editVersionOf(row) {
  return row.edit_version;
}

function newEditVersion() {
  return crypto.randomUUID();
}

const EDIT_VERSION_SQL = "edit_version";

export class EditConflictError extends Error {
  constructor() {
    super("This story was changed by someone else after you opened it. Reload it to see their changes, then save again.");
  }
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

// Guarded like the UPDATE it precedes: if the story changed after it was read,
// the checkpoint is not written either.
function revisionStatement(db, storyId, action, snapshot, actor, now, expectedVersion) {
  return db
    .prepare(`
      INSERT INTO story_revisions
        (story_id, action, snapshot_json, created_by_user_id, created_by_email, created_at)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6
      WHERE EXISTS (SELECT 1 FROM texts WHERE id = ?1 AND ${EDIT_VERSION_SQL} = ?7)
    `)
    .bind(storyId, action, snapshot, actor.userId, actor.email, now, expectedVersion);
}

// The library listing shows titles and progress markers, never body text, so it
// selects only the columns groupStories keeps. Reading paragraphs_json here cost
// 160 KB of story text per request that was parsed and then thrown away.
export async function listStorySummaries(db) {
  const result = await db.prepare(`
    SELECT ${TEXT_SUMMARY_COLUMNS}
    FROM texts
    WHERE is_enabled = 1
    ORDER BY level ASC, display_order ASC
  `).all();

  return (result.results || []).map((row) => ({
    storyId: row.id,
    level: row.level,
    sortOrder: row.display_order,
    questionIndex: row.question_index,
    title: row.title,
    showWordCount: Boolean(row.show_word_count),
    active: Boolean(row.is_enabled),
  }));
}

export async function storyExists(db, storyId) {
  const row = await db.prepare("SELECT 1 AS found FROM texts WHERE id = ?1 LIMIT 1").bind(storyId).first();
  return Boolean(row);
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
    editVersion: editVersionOf(row),
    draftUpdatedAt: row.draft_updated_at,
    draftUpdatedByEmail: row.draft_updated_by_email,
    updatedAt: row.updated_at,
    updatedByEmail: row.updated_by_email,
    publishedAt: row.published_at,
  };
}

export async function createTextDraft(db, payload, actor) {
  const now = new Date().toISOString();
  const insertResult = await db
    .prepare(`
      INSERT INTO texts (
        level, display_order, question_index, title, paragraphs_json,
        show_word_count, is_enabled, created_at, updated_at,
        draft_json, draft_updated_at, draft_updated_by_user_id, draft_updated_by_email,
        edit_version
      )
      SELECT ?1, next_order, next_order, ?2, ?3, ?4, 0, ?5, ?5, ?6, ?5, ?7, ?8, ?9
      FROM (SELECT ${nextDisplayOrderSql("?1")} AS next_order)
    `)
    .bind(
      payload.level,
      payload.title,
      JSON.stringify(payload.paragraphs),
      payload.showWordCount ? 1 : 0,
      now,
      toDraftJson(payload),
      actor.userId,
      actor.email,
      newEditVersion()
    )
    .run();

  return getAdminStoryById(db, insertResult.meta.last_row_id);
}

// baseVersion is the editVersion the editor loaded; null skips the check (a
// browser tab opened before this check existed).
export async function saveTextDraft(db, storyId, payload, actor, baseVersion = null) {
  const now = new Date().toISOString();
  const result = await db
    .prepare(`
      UPDATE texts
      SET draft_json = ?1,
          draft_updated_at = ?2,
          draft_updated_by_user_id = ?3,
          draft_updated_by_email = ?4,
          edit_version = ?7
      WHERE id = ?5 AND (?6 IS NULL OR ${EDIT_VERSION_SQL} = ?6)
    `)
    .bind(toDraftJson(payload), now, actor.userId, actor.email, storyId, baseVersion, newEditVersion())
    .run();

  if (!result.meta.changes) {
    if (!(await storyExists(db, storyId))) return null;
    throw new EditConflictError();
  }

  return getAdminStoryById(db, storyId);
}

// Runs the batch and reports whether its guarded UPDATE applied; when it did
// not, every other guarded statement in the batch was a no-op as well.
async function runGuardedBatch(db, statements, updateIndex) {
  const results = await db.batch(statements);
  return Boolean(results[updateIndex]?.meta?.changes);
}

export async function publishText(db, storyId, payload, actor, baseVersion = null) {
  const row = await getAdminTextRow(db, storyId);
  if (!row) return null;

  const readVersion = editVersionOf(row);
  if (baseVersion !== null && baseVersion !== readVersion) throw new EditConflictError();

  const current = await withQuestionsForStory(db, toStoryRecord(row), true);
  const now = new Date().toISOString();
  const writeVersion = newEditVersion();
  const statements = [];

  if (row.published_at) {
    statements.push(revisionStatement(db, storyId, "before_publish", toSnapshot(current), actor, now, readVersion));
  }

  const updateIndex = statements.length;
  statements.push(
    db.prepare(`
      UPDATE texts
      SET ${placementSql("?1")},
          level = ?1,
          title = ?2,
          paragraphs_json = ?3,
          show_word_count = ?4,
          is_enabled = 1,
          draft_json = NULL,
          draft_updated_at = NULL,
          draft_updated_by_user_id = NULL,
          draft_updated_by_email = NULL,
          updated_at = ?5,
          updated_by_user_id = ?6,
          updated_by_email = ?7,
          published_at = ?5,
          edit_version = ?10
      WHERE id = ?8 AND ${EDIT_VERSION_SQL} = ?9
    `).bind(
      payload.level,
      payload.title,
      JSON.stringify(payload.paragraphs),
      payload.showWordCount ? 1 : 0,
      now,
      actor.userId,
      actor.email,
      storyId,
      readVersion,
      writeVersion
    ),
    ...buildReplaceQuestionStatements(db, storyId, payload.questions || [], writeVersion)
  );

  if (!(await runGuardedBatch(db, statements, updateIndex))) throw new EditConflictError();
  return getAdminStoryById(db, storyId);
}

export async function unpublishText(db, storyId, actor) {
  const row = await getAdminTextRow(db, storyId);
  if (!row) return null;
  if (!row.is_enabled) return getAdminStoryById(db, storyId);

  const readVersion = editVersionOf(row);
  const current = await withQuestionsForStory(db, toStoryRecord(row), true);
  const now = new Date().toISOString();
  const applied = await runGuardedBatch(db, [
    revisionStatement(db, storyId, "before_unpublish", toSnapshot(current), actor, now, readVersion),
    db.prepare(`
      UPDATE texts
      SET is_enabled = 0,
          updated_at = ?1,
          updated_by_user_id = ?2,
          updated_by_email = ?3,
          edit_version = ?6
      WHERE id = ?4 AND ${EDIT_VERSION_SQL} = ?5
    `).bind(now, actor.userId, actor.email, storyId, readVersion, newEditVersion()),
  ], 1);

  if (!applied) throw new EditConflictError();
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
  if (!validation.ok) throw new RevisionDataError("The selected revision contains invalid story data.");

  const readVersion = editVersionOf(row);
  const current = await withQuestionsForStory(db, toStoryRecord(row), true);
  const target = validation.value;
  const now = new Date().toISOString();
  const writeVersion = newEditVersion();
  const statements = [
    revisionStatement(db, storyId, "before_restore", toSnapshot(current), actor, now, readVersion),
    db.prepare(`
      UPDATE texts
      SET ${placementSql("?1")},
          level = ?1,
          title = ?2,
          paragraphs_json = ?3,
          show_word_count = ?4,
          is_enabled = ?5,
          draft_json = NULL,
          draft_updated_at = NULL,
          draft_updated_by_user_id = NULL,
          draft_updated_by_email = NULL,
          updated_at = ?6,
          updated_by_user_id = ?7,
          updated_by_email = ?8,
          published_at = CASE WHEN ?5 = 1 THEN ?6 ELSE published_at END,
          edit_version = ?11
      WHERE id = ?9 AND ${EDIT_VERSION_SQL} = ?10
    `).bind(
      target.level,
      target.title,
      JSON.stringify(target.paragraphs),
      target.showWordCount ? 1 : 0,
      snapshot.active ? 1 : 0,
      now,
      actor.userId,
      actor.email,
      storyId,
      readVersion,
      writeVersion
    ),
    ...buildReplaceQuestionStatements(db, storyId, target.questions || [], writeVersion),
  ];

  if (!(await runGuardedBatch(db, statements, 1))) throw new EditConflictError();
  return getAdminStoryById(db, storyId);
}

export function validateTextPayload(payload, { allowLevel = false } = {}) {
  const paragraphs = Array.isArray(payload?.paragraphs)
    ? payload.paragraphs.map((paragraph) => String(paragraph).trim()).filter(Boolean)
    : [];

  if (allowLevel && !LEVELS_BY_ID[payload?.level]) {
    return { ok: false, message: "Invalid level." };
  }

  const title = String(payload?.title || "").trim();

  if (!title) {
    return { ok: false, message: "Title is required." };
  }

  if (title.length > MAX_TITLE_CHARACTERS) {
    return { ok: false, message: `Title must not exceed ${MAX_TITLE_CHARACTERS} characters.` };
  }

  if (paragraphs.length === 0) {
    return { ok: false, message: "At least one paragraph is required." };
  }

  if (paragraphs.length > MAX_PARAGRAPHS) {
    return { ok: false, message: `A story may have at most ${MAX_PARAGRAPHS} paragraphs.` };
  }

  if (paragraphs.join("").length > MAX_STORY_CHARACTERS) {
    return { ok: false, message: `Story text must not exceed ${MAX_STORY_CHARACTERS} characters.` };
  }

  const questionValidation = validateQuestionsPayload(payload?.questions);
  if (!questionValidation.ok) return questionValidation;

  return {
    ok: true,
    value: {
      level: payload?.level,
      title,
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
