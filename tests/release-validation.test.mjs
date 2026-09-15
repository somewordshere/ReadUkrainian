import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { seedDatabase } from "../scripts/lib/seed-database.mjs";
import { pendingMigrations, validateLiveBaseline, validateMigrationFiles } from "../scripts/lib/release-validation.mjs";
const manifest = JSON.parse(readFileSync(new URL("../data/releases/0.83.json",import.meta.url),"utf8"));
const all = manifest.migrations.map((m)=>m.name);
const before = all.filter((n)=>!manifest.releaseMigrations.includes(n));
const snapshot = (sqlite) => ({rows:sqlite.prepare("SELECT * FROM texts WHERE level='A1' AND display_order IN (5,8,9,15,16,17,18,19)").all(), questions:sqlite.prepare("SELECT * FROM questions ORDER BY display_order").all()});

test("release preflight only accepts the reviewed migration order, including safe retries",()=>{
  assert.deepEqual(pendingMigrations(manifest,before),manifest.releaseMigrations);
  assert.deepEqual(pendingMigrations(manifest,[...before,manifest.releaseMigrations[0]]),[manifest.contentMigration]);
  assert.deepEqual(pendingMigrations(manifest,all),[]);
  assert.throws(()=>pendingMigrations(manifest,before.slice(1)));
  assert.throws(()=>pendingMigrations(manifest,[...before,'9999_surprise.sql']));
  assert.throws(()=>pendingMigrations(manifest,[...before,manifest.contentMigration]));
  validateMigrationFiles(manifest,new URL("../migrations/",import.meta.url), { allowLater: true });
});
test("preflight catches changed stories, changed answers and new rows at reserved orders",()=>{
  const {sqlite}=seedDatabase({before:'0023'});
  try {
    const state=snapshot(sqlite);
    validateLiveBaseline(manifest,state.rows,state.questions);
    for(const mutate of [s=>s.rows[0].title='Editor changed this',s=>s.questions.find(q=>q.story_id===s.rows[0].id).correct_answer='Changed',s=>s.rows.push({level:'A1',display_order:15})]){
      const changed=structuredClone(state);mutate(changed);assert.throws(()=>validateLiveBaseline(manifest,changed.rows,changed.questions));
    }
  } finally {sqlite.close();}
});
test("database guard rejects content changed after preflight without overwriting it",()=>{
  const {sqlite}=seedDatabase({before:'0024'});
  try {
    sqlite.exec("UPDATE texts SET paragraphs_json='[\"Editorial change\"]' WHERE level='A1' AND display_order=5");
    const before=JSON.stringify(snapshot(sqlite));
    sqlite.exec('BEGIN');
    assert.throws(()=>sqlite.exec(readFileSync(new URL('../migrations/0024_a1_batch_015_019.sql',import.meta.url),'utf8')),/CHECK constraint/);
    sqlite.exec('ROLLBACK');
    assert.equal(JSON.stringify(snapshot(sqlite)),before);
  } finally {sqlite.close();}
});
test("fresh database matches the release and preflight can recognize an already-applied batch",()=>{
  const {sqlite}=seedDatabase({before:'0025'});
  try {
    const state=snapshot(sqlite);validateLiveBaseline(manifest,state.rows,state.questions,true);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM texts WHERE level IN ('A1','A2') AND is_enabled=1").get().n,122);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM questions q JOIN texts t ON t.id=q.story_id WHERE t.level IN ('A1','A2') AND t.is_enabled=1").get().n,610);
  } finally {sqlite.close();}
});

test("rollback restores earlier passages, hides additions and preserves drafts and revisions",()=>{
  const path=join(mkdtempSync(join(tmpdir(),'a1-rollback-')),'rollback.sql');
  const run=spawnSync(process.execPath,['scripts/build-release-rollback.mjs','--output',path],{encoding:'utf8',env:{...process.env,RELEASE_VERSION:'0.83'}});
  assert.equal(run.status,0,run.stderr);
  const {sqlite}=seedDatabase({before:'0025'});
  try {
    sqlite.exec("UPDATE texts SET draft_json='{\"title\":\"Keep\"}' WHERE level='A1' AND display_order=15");
    const ids=sqlite.prepare("SELECT id FROM texts ORDER BY id").all();
    const forms=sqlite.prepare("SELECT COUNT(*) AS n FROM dictionary_forms").get().n;
    sqlite.exec(readFileSync(path,'utf8'));
    assert.deepEqual(sqlite.prepare("SELECT id FROM texts ORDER BY id").all(),ids);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM dictionary_forms").get().n,forms);
    for(const s of manifest.stories) {
      const row=sqlite.prepare("SELECT * FROM texts WHERE level=? AND display_order=?").get(s.level,s.order);
      if(s.before) assert.deepEqual(JSON.parse(row.paragraphs_json),s.before.paragraphs);
      else assert.equal(row.is_enabled,0);
    }
    assert.equal(sqlite.prepare("SELECT draft_json FROM texts WHERE level='A1' AND display_order=15").get().draft_json,'{"title":"Keep"}');
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(),[]);
  } finally {sqlite.close();}
});
