import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {gzipSync} from 'node:zlib';
import {seedDatabase} from '../scripts/lib/seed-database.mjs';
import {loadReleaseManifest} from '../scripts/lib/release-manifest.mjs';
import {pendingMigrations,validateLiveBaseline,validateMigrationFiles} from '../scripts/lib/release-validation.mjs';
import {extractUkrainianWords} from '../functions/_shared/ukrainian-word.js';
import {lookupDictionaryWord} from '../functions/_shared/dictionary.js';
const read=p=>JSON.parse(fs.readFileSync(new URL(p,import.meta.url),'utf8'));
const old=read('./fixtures/content-083.json');
const historical=loadReleaseManifest('0.84');
const seed=[...old,...historical.stories.map(({level,order,after})=>({level,sortOrder:order,title:after.title,paragraphs:after.paragraphs,showWordCount:after.showWordCount,active:after.active}))];
const qs=historical.stories.flatMap(s=>s.after.questions.map((q,i)=>({...q,level:s.level,storyOrder:s.order,displayOrder:i+1})));
const words=s=>s.split(/\s+/).filter(w=>/[\p{L}\p{N}]/u.test(w));
test('every release dictionary probe is reachable through the public lookup contract',async()=>{
 const {sqlite,db}=seedDatabase();
 try{for(const p of loadReleaseManifest('0.84').dictionaryProbes){
  const r=await lookupDictionaryWord(db,{text:p.text,targetLanguage:p.language});
  assert.ok(r.entries.some(e=>e.lemma===p.lemma&&e.translations.some(t=>t.text===p.translation)),`${p.language}:${p.text}`);
 }}finally{sqlite.close();}
});
test('0.84 A1 mechanics, recycling, complete questions and unchanged prior stories',()=>{
 const once=new Map();for(const s of old.filter(s=>s.level==='A1'))for(const w of new Set(extractUkrainianWords(s.paragraphs.join(' '))))once.set(w,(once.get(w)||0)+1);
 for(const [order,min,paras,title] of [[20,80,2,'Погода сьогодні'],[21,95,3,'Пори року'],[22,90,3,'Мій одяг'],[23,80,2,'Кольори навколо мене'],[24,80,2,'Котра година?']]){
  const s=seed.find(s=>s.level==='A1'&&s.sortOrder===order),body=s.paragraphs.join(' '),ps=s.paragraphs.map(p=>p.split(/(?<=[.!?…])\s+/)),ns=ps.flat().map(s=>words(s).length);
  assert.equal(s.title,title);assert.equal(ps.length,paras);assert.ok(words(body).length>=min&&words(body).length<=min+10);
  assert.ok(Math.max(...ns)<=11);assert.ok(Math.max(...ns)-Math.min(...ns)>=5);assert.ok(ns.filter(n=>n<5).length>=2);
  assert.ok(ps.every(p=>p.length<=6));assert.ok(Math.abs(ps[0].length-ps[1].length)<=(paras===2?3:2));
  assert.ok(words(s.paragraphs.at(-1)).length<words(s.paragraphs[0]).length);
  assert.doesNotMatch(body,/(?:^|\s)(?:якщо|щоб|хоча|поки|би|буду|буде)(?:\s|[,.])/iu);
  assert.ok([...new Set(extractUkrainianWords(body))].filter(w=>once.get(w)===1).length>=5);
  const set=qs.filter(q=>q.level==='A1'&&q.storyOrder===order);assert.equal(set.length,5);
  set.forEach(q=>{assert.ok(q.prompt.length<=30);assert.doesNotMatch(q.prompt,/^Чому/);assert.equal(q.wrong.length,3);assert.equal(new Set([q.correct,...q.wrong]).size,4);assert.ok([q.correct,...q.wrong].every(a=>a.length<=29));});
 }
 for(const s of old)assert.deepEqual(seed.find(n=>n.level===s.level&&n.sortOrder===s.sortOrder),s);
});
test('0.84 preserves prior records, preferences, drafts and revision history',()=>{
 const {sqlite}=seedDatabase({before:'0025'});
 try{
  sqlite.exec("UPDATE texts SET draft_json='{\"title\":\"Keep\"}',is_enabled=0 WHERE level='A1' AND display_order=15");
  sqlite.exec("INSERT INTO story_revisions(story_id,action,snapshot_json,created_by_email) SELECT id,'save_draft','{}','editor@example.com' FROM texts WHERE level='A1' AND display_order=15");
  sqlite.exec("INSERT INTO story_dictionary_preferences(story_id,normalized_form,target_language,sense_id,selected_by_email,selected_at) SELECT t.id,'мама','en',s.id,'editor@example.com','2026-09-15' FROM texts t CROSS JOIN dictionary_senses s WHERE t.level='A1' AND t.display_order=15 LIMIT 1");
  const tables=['texts','questions','story_revisions','dictionary_lexemes','dictionary_forms','dictionary_senses','dictionary_translations','story_dictionary_preferences'];
  const before=Object.fromEntries(tables.map(t=>[t,sqlite.prepare(`SELECT rowid AS _rowid,* FROM ${t} ORDER BY rowid`).all()]));
  for(const m of loadReleaseManifest('0.84').releaseMigrations)sqlite.exec(fs.readFileSync(new URL('../migrations/'+m,import.meta.url),'utf8'));
  for(const t of tables)for(const row of before[t])assert.deepEqual(sqlite.prepare(`SELECT rowid AS _rowid,* FROM ${t} WHERE rowid=?`).get(row._rowid),row);
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM texts WHERE level IN ('A1','A2') AND is_enabled=1").get().n,126);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM questions').get().n,635);
 }finally{sqlite.close();}
});
test('0.84 rejects occupied slots, validates migration order and supports retries',()=>{
 const manifest=loadReleaseManifest('0.84'),all=manifest.migrations.map(m=>m.name),base=all.filter(n=>!manifest.releaseMigrations.includes(n));
 validateMigrationFiles(manifest,new URL('../migrations/',import.meta.url),{allowLater:true});
 for(let n=0;n<=3;n++)assert.deepEqual(pendingMigrations(manifest,[...base,...manifest.releaseMigrations.slice(0,n)]),manifest.releaseMigrations.slice(n));
 assert.throws(()=>pendingMigrations(manifest,[...base,manifest.contentMigration]));
 assert.equal(loadReleaseManifest('0.83').version,'0.83');assert.throws(()=>loadReleaseManifest('../0.83'));
 const {sqlite}=seedDatabase({before:'0027'});
 try{sqlite.exec("INSERT INTO texts(level,display_order,title,paragraphs_json) VALUES('A1',20,'Editor draft','[]')");
  sqlite.exec('BEGIN');assert.throws(()=>sqlite.exec(fs.readFileSync(new URL('../migrations/0027_a1_batch_020_024.sql',import.meta.url),'utf8')),/CHECK/);sqlite.exec('ROLLBACK');
  assert.equal(sqlite.prepare("SELECT title FROM texts WHERE level='A1' AND display_order=20").get().title,'Editor draft');
  assert.throws(()=>validateLiveBaseline(manifest,sqlite.prepare('SELECT * FROM texts').all(),[]));
 }finally{sqlite.close();}
});
test('raw extraction and ID-less builds are reproducible and refuse overwrites',()=>{
 const dir=fs.mkdtempSync(join(tmpdir(),'raw-dictionary-')),source=join(dir,'raw.gz'),filtered=join(dir,'uk.jsonl');
 fs.writeFileSync(source,gzipSync([{lang_code:'en',word:'skip',pos:'noun'},...Array.from({length:3},()=>({lang:'Ukrainian',lang_code:'uk',word:'мама',pos:'noun',senses:[{glosses:['mother']}],forms:[{form:'мами',tags:['genitive','singular']}]}))].map(e=>JSON.stringify(e)).join('\n')));
 const run=(script,args)=>spawnSync(process.execPath,['scripts/dictionary/'+script,...args],{encoding:'utf8'});
 const args=['--source',source,'--edition','en','--revision','2026-09-02','--source-url','https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz','--output',filtered];
 assert.equal(run('extract-raw-ukrainian.mjs',args).status,0);const saved=fs.readFileSync(filtered,'utf8');assert.equal(saved.trim().split('\n').length,3);
 assert.notEqual(run('extract-raw-ukrainian.mjs',args).status,0);assert.equal(fs.readFileSync(filtered,'utf8'),saved);
 const build=['--source',filtered,'--revision','2026-09-02','--scope','all'];
 assert.notEqual(run('build-dictionary-seed.mjs',build).status,0);
 for(const n of [1,2]){const r=run('build-dictionary-seed.mjs',[...build,'--output',join(dir,n+'.sql')]);assert.equal(r.status,0,r.stderr);}
 assert.equal(fs.readFileSync(join(dir,'1.sql'),'utf8'),fs.readFileSync(join(dir,'2.sql'),'utf8'));
 assert.match(fs.readFileSync(join(dir,'1.sql'),'utf8'),/mother/);
 assert.notEqual(run('build-dictionary-seed.mjs',[...build,'--output',join(dir,'1.sql')]).status,0);
 for(const script of ['build-curated-seed.mjs','build-linguisto-seed.mjs'])assert.notEqual(run(script,[]).status,0);
});
