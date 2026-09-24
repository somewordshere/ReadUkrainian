// The site's Google Text-to-Speech budget. Every call the Worker makes to Google
// — a learner's pronunciation and an admin's voice preview — reserves its
// characters here first, atomically, so the site can never spend more than
// SPEECH_DAILY_CHARACTER_LIMIT in a UTC day or SPEECH_MONTHLY_CHARACTER_LIMIT in
// a UTC month, whichever is hit first. Google bills by characters sent; its free
// allowance is 1 million characters a month for Chirp 3 HD and Neural2 voices
// (4 million for Standard and WaveNet), so the monthly limit sits below 1 million.

const MONTH_USED_SQL = `(
  SELECT COALESCE(SUM(characters_used), 0)
  FROM speech_usage_daily
  WHERE day >= ?5 AND day < ?6
)`;

export function parseCharacterLimit(value) {
  const rawLimit = String(value ?? "").trim();
  if (!/^\d+$/.test(rawLimit)) return null;

  const limit = Number(rawLimit);
  return Number.isSafeInteger(limit) && limit > 0 ? limit : null;
}

// Both limits, or null when either is missing: speech then fails closed.
export function speechBudgetLimits(env) {
  const daily = parseCharacterLimit(env.SPEECH_DAILY_CHARACTER_LIMIT);
  const monthly = parseCharacterLimit(env.SPEECH_MONTHLY_CHARACTER_LIMIT);
  return daily && monthly ? { daily, monthly } : null;
}

export function speechBudgetPeriod(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    day,
    monthStart: `${day.slice(0, 7)}-01`,
    nextMonthStart: nextMonth.toISOString().slice(0, 10),
    secondsUntilNextDay: Math.max(
      60,
      Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000)
    ),
    secondsUntilNextMonth: Math.max(60, Math.ceil((nextMonth.getTime() - now.getTime()) / 1000)),
  };
}

export async function readSpeechBudgetUsage(db, period) {
  const row = await db
    .prepare(`
      SELECT
        COALESCE((SELECT characters_used FROM speech_usage_daily WHERE day = ?1), 0) AS today,
        ${MONTH_USED_SQL.replaceAll("?5", "?2").replaceAll("?6", "?3")} AS month
    `)
    .bind(period.day, period.monthStart, period.nextMonthStart)
    .first();

  return { today: Number(row?.today) || 0, month: Number(row?.month) || 0 };
}

// Reserves the characters against both limits in one statement, so concurrent
// requests cannot together overshoot. Returns null when reserved, otherwise the
// limit that refused: "daily" or "monthly".
export async function reserveSpeechBudget(db, period, characters, limits) {
  const row = await db
    .prepare(`
      INSERT INTO speech_usage_daily (day, characters_used, updated_at)
      SELECT ?1, ?2, CURRENT_TIMESTAMP
      WHERE ?2 <= ?3 AND ${MONTH_USED_SQL} + ?2 <= ?4
      ON CONFLICT(day) DO UPDATE SET
        characters_used = speech_usage_daily.characters_used + excluded.characters_used,
        updated_at = CURRENT_TIMESTAMP
      WHERE speech_usage_daily.characters_used + excluded.characters_used <= ?3
        AND ${MONTH_USED_SQL} + excluded.characters_used <= ?4
      RETURNING characters_used
    `)
    .bind(period.day, characters, limits.daily, limits.monthly, period.monthStart, period.nextMonthStart)
    .first();

  if (row) return null;

  const usage = await readSpeechBudgetUsage(db, period);
  return usage.month + characters > limits.monthly ? "monthly" : "daily";
}

// Gives characters back when Google produced nothing for them.
export function releaseSpeechBudget(db, period, characters) {
  return db
    .prepare(`
      UPDATE speech_usage_daily
      SET characters_used = MAX(0, characters_used - ?2), updated_at = CURRENT_TIMESTAMP
      WHERE day = ?1
    `)
    .bind(period.day, characters)
    .run();
}

export function speechBudgetRetryAfter(period, refusedLimit) {
  return String(refusedLimit === "monthly" ? period.secondsUntilNextMonth : period.secondsUntilNextDay);
}
