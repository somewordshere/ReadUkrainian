#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { setTimeout } from "node:timers/promises";
import { checkLiveContent } from "./lib/live-content-check.mjs";

const { values } = parseArgs({ options: {
  origin: { type: "string", default: "https://readukrainianapp.com" },
  deep: { type: "boolean", default: false },
  attempts: { type: "string", default: "1" },
  "retry-ms": { type: "string", default: "25000" },
  "expect-version": { type: "string" },
} });
const attempts = Number(values.attempts), delay = Number(values["retry-ms"]);
if (!Number.isInteger(attempts) || attempts < 1 || attempts > 4 || !Number.isInteger(delay) || delay < 0 || delay > 30000) throw new Error("Use 1–4 attempts and a retry delay of 0–30000 ms.");
const seed = JSON.parse(readFileSync(new URL("../data/content-seed.json", import.meta.url), "utf8"));
const questions = JSON.parse(readFileSync(new URL("../data/questions-seed.json", import.meta.url), "utf8"));
for (let attempt = 1; attempt <= attempts; attempt++) {
  try {
    const result = await checkLiveContent({ origin: values.origin, seed, questions, deep: values.deep, expectedVersion: values["expect-version"] });
    if (result.ok) {
      console.log(values.deep ? `${result.stories} public stories and ${result.questions} questions match the repository.` : `${result.stories} public story listings match the repository.`);
      process.exitCode = 0;
      break;
    }
    console.error(result.issues.join("\n"));
  } catch (error) { console.error(error.message); }
  process.exitCode = 1;
  if (attempt < attempts) { console.log(`Rechecking after cache propagation (${attempt}/${attempts}).`); await setTimeout(delay); }
}
