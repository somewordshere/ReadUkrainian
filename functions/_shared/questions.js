const MAX_QUESTIONS = 20;
const MAX_PROMPT_CHARACTERS = 500;
const MAX_ANSWER_CHARACTERS = 200;

function toQuestionRecord(row) {
  return {
    id: row.id,
    prompt: row.prompt,
    correct: row.correct_answer,
    wrong: JSON.parse(row.wrong_answers_json),
  };
}

export async function listQuestionsForStory(db, storyId) {
  const result = await db
    .prepare(`
      SELECT id, prompt, correct_answer, wrong_answers_json
      FROM questions
      WHERE story_id = ?1
      ORDER BY display_order ASC, id ASC
    `)
    .bind(storyId)
    .all();

  return (result.results || []).map(toQuestionRecord);
}

export function buildReplaceQuestionStatements(db, storyId, questions) {
  const statements = [
    db.prepare("DELETE FROM questions WHERE story_id = ?1").bind(storyId),
  ];

  questions.forEach((question, index) => {
    statements.push(
      db
        .prepare(`
          INSERT INTO questions (story_id, display_order, prompt, correct_answer, wrong_answers_json)
          VALUES (?1, ?2, ?3, ?4, ?5)
        `)
        .bind(
          storyId,
          index + 1,
          question.prompt,
          question.correct,
          JSON.stringify(question.wrong)
        )
    );
  });

  return statements;
}

export function validateQuestionsPayload(payload) {
  if (payload === undefined) {
    return { ok: true, value: [] };
  }

  if (!Array.isArray(payload)) {
    return { ok: false, message: "Questions must be an array." };
  }

  if (payload.length > MAX_QUESTIONS) {
    return { ok: false, message: `A story may have at most ${MAX_QUESTIONS} questions.` };
  }

  const normalizedQuestions = [];

  for (const [index, question] of payload.entries()) {
    const prompt = String(question?.prompt || "").trim();
    const correct = String(question?.correct || "").trim();
    const wrong = Array.isArray(question?.wrong)
      ? question.wrong.map((answer) => String(answer).trim()).filter(Boolean)
      : [];

    if (!prompt) {
      return { ok: false, message: `Question ${index + 1} is missing a prompt.` };
    }

    if (!correct) {
      return { ok: false, message: `Question ${index + 1} is missing a correct answer.` };
    }

    if (prompt.length > MAX_PROMPT_CHARACTERS) {
      return {
        ok: false,
        message: `Question ${index + 1}'s prompt must not exceed ${MAX_PROMPT_CHARACTERS} characters.`,
      };
    }

    if ([correct, ...wrong].some((answer) => answer.length > MAX_ANSWER_CHARACTERS)) {
      return {
        ok: false,
        message: `Question ${index + 1}'s answers must not exceed ${MAX_ANSWER_CHARACTERS} characters each.`,
      };
    }

    if (wrong.length !== 3) {
      return {
        ok: false,
        message: `Question ${index + 1} must have exactly 3 wrong answers.`,
      };
    }

    const uniqueAnswers = new Set([correct, ...wrong].map((answer) => answer.toLocaleLowerCase()));

    if (uniqueAnswers.size !== 4) {
      return {
        ok: false,
        message: `Question ${index + 1} must have 4 distinct answers.`,
      };
    }

    normalizedQuestions.push({
      prompt,
      correct,
      wrong,
    });
  }

  return { ok: true, value: normalizedQuestions };
}
