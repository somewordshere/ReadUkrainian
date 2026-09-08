// Read-only production preflight; saves public content and recovery identifiers locally.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { validateMigrationFiles, pendingMigrations, validateLiveBaseline } from "./lib/release-validation.mjs";

if (process.argv.slice(2).join(" ") !== "--remote") throw new Error("Use --remote to check the configured production database.");
const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(root,"data/releases/0.83.json"),"utf8"));
validateMigrationFiles(manifest, new URL("../migrations/", import.meta.url));
function wrangler(args) {
  const result = spawnSync(process.execPath, [resolve(root,"node_modules/wrangler/bin/wrangler.js"),...args], {cwd:root,encoding:"utf8",maxBuffer:8*1024*1024,timeout:120000,env:{...process.env,CI:"true",WRANGLER_SEND_METRICS:"false"}});
  if (result.status !== 0) throw new Error(`Wrangler ${args.slice(0,3).join(" ")} failed; check account authentication and permissions.`);
  try { return JSON.parse(result.stdout); } catch { throw new Error("Wrangler returned unexpected non-JSON output"); }
}
function query(sql) {
  const result = wrangler(["d1","execute","DB","--remote","--json","--command",sql]);
  if (!Array.isArray(result) || result.some((r) => r.success === false || !Array.isArray(r.results))) throw new Error("D1 preflight query failed");
  return result.flatMap((r) => r.results);
}
const applied = query("SELECT name FROM d1_migrations ORDER BY id").map((r) => r.name);
const pending = pendingMigrations(manifest, applied);
const condition = manifest.stories.map((s) => `(level='${s.level}' AND display_order=${s.order})`).join(" OR ");
const rows = query(`SELECT id,level,display_order,title,paragraphs_json,show_word_count,is_enabled,question_index FROM texts WHERE ${condition}`);
const questions = query(`SELECT id,story_id,display_order,prompt,correct_answer,wrong_answers_json FROM questions WHERE story_id IN (SELECT id FROM texts WHERE ${condition}) ORDER BY story_id,display_order`);
validateLiveBaseline(manifest, rows, questions, applied.includes(manifest.contentMigration));
const recovery = {
  version:manifest.version, capturedAt:new Date().toISOString(), commit:process.env.GITHUB_SHA || spawnSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).stdout.trim(),
  pending, bookmark:wrangler(["d1","time-travel","info","DB","--json"]),
  deployments:wrangler(["deployments","list","--json"]).map(({id,versions,created_on})=>({id,versions,created_on})),
  rows, questions,
};
const directory = resolve(root,".local-release/recovery"); mkdirSync(directory,{recursive:true});
const path = resolve(directory,`${manifest.version}-${Date.now()}.json`);
writeFileSync(path,JSON.stringify(recovery,null,2)+"\n",{flag:"wx"});
console.log(`Production baseline verified. ${pending.length} reviewed migrations pending. Recovery record saved.`);
