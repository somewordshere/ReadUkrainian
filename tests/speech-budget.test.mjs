import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  readSpeechBudgetUsage,
  releaseSpeechBudget,
  reserveSpeechBudget,
  speechBudgetLimits,
  speechBudgetPeriod,
  speechBudgetRetryAfter,
} from "../functions/_shared/speech-budget.js";

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../migrations/0007_speech_usage.sql", import.meta.url), "utf8"));
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let parameters = [];
      const prepared = {
        bind(...values) {
          parameters = values;
          return prepared;
        },
        async first() {
          return statement.get(...parameters) ?? null;
        },
        async run() {
          return statement.run(...parameters);
        },
      };
      return prepared;
    },
  };
  return { sqlite, db };
}

const at = (iso) => speechBudgetPeriod(new Date(iso));
const LIMITS = { daily: 10, monthly: 25 };

test("the daily and monthly limits are both hard stops", async () => {
  const { db } = createDb();
  const outcomes = [];
  for (const [iso, characters] of [
    ["2026-09-01T10:00:00Z", 6],
    ["2026-09-01T11:00:00Z", 4],
    ["2026-09-01T12:00:00Z", 1], // day full at exactly 10
    ["2026-09-02T10:00:00Z", 10],
    ["2026-09-03T10:00:00Z", 6], // month would reach 26
    ["2026-09-03T10:05:00Z", 5], // month reaches exactly 25
    ["2026-09-04T10:00:00Z", 1], // month full
    ["2026-10-01T00:00:01Z", 10], // a new month starts from zero
  ]) {
    outcomes.push(await reserveSpeechBudget(db, at(iso), characters, LIMITS));
  }

  assert.deepEqual(outcomes, [null, null, "daily", null, "monthly", null, "monthly", null]);
  assert.deepEqual(await readSpeechBudgetUsage(db, at("2026-09-04T12:00:00Z")), { today: 0, month: 25 });
  assert.deepEqual(await readSpeechBudgetUsage(db, at("2026-10-01T12:00:00Z")), { today: 10, month: 10 });
});

test("concurrent reservations never overshoot the limit together", async () => {
  const { db } = createDb();
  const period = at("2026-09-10T10:00:00Z");
  const results = await Promise.all(Array.from({ length: 20 }, () => reserveSpeechBudget(db, period, 3, LIMITS)));

  assert.equal(results.filter((result) => result === null).length, 3);
  assert.equal((await readSpeechBudgetUsage(db, period)).today, 9);
});

test("released characters can be spent again, but never below zero", async () => {
  const { db } = createDb();
  const period = at("2026-09-10T10:00:00Z");
  await reserveSpeechBudget(db, period, 10, LIMITS);
  assert.equal(await reserveSpeechBudget(db, period, 1, LIMITS), "daily");

  await releaseSpeechBudget(db, period, 4);
  assert.equal(await reserveSpeechBudget(db, period, 4, LIMITS), null);
  await releaseSpeechBudget(db, period, 50);
  assert.equal((await readSpeechBudgetUsage(db, period)).today, 0);
});

test("both limits must be configured, and retry times point at the next day or month", () => {
  assert.equal(speechBudgetLimits({ SPEECH_DAILY_CHARACTER_LIMIT: "4500" }), null);
  assert.equal(speechBudgetLimits({ SPEECH_MONTHLY_CHARACTER_LIMIT: "900000" }), null);
  assert.deepEqual(
    speechBudgetLimits({ SPEECH_DAILY_CHARACTER_LIMIT: "4500", SPEECH_MONTHLY_CHARACTER_LIMIT: "900000" }),
    { daily: 4500, monthly: 900000 }
  );

  const period = at("2026-09-30T23:00:00Z");
  assert.equal(period.monthStart, "2026-09-01");
  assert.equal(period.nextMonthStart, "2026-10-01");
  assert.equal(speechBudgetRetryAfter(period, "daily"), "3600");
  assert.equal(speechBudgetRetryAfter(period, "monthly"), "3600");
  assert.equal(speechBudgetRetryAfter(at("2026-09-15T00:00:00Z"), "monthly"), String(16 * 24 * 3600));
});

test("the configured monthly limit stays inside Google's free allowance", () => {
  const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const monthly = Number(config.match(/"SPEECH_MONTHLY_CHARACTER_LIMIT":\s*"(\d+)"/)[1]);
  const daily = Number(config.match(/"SPEECH_DAILY_CHARACTER_LIMIT":\s*"(\d+)"/)[1]);

  // Chirp 3 HD and Neural2: 1,000,000 free characters a month.
  assert.ok(monthly < 1_000_000);
  assert.ok(daily <= monthly);
});
