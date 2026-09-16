import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {seedDatabase} from '../scripts/lib/seed-database.mjs';
import {loadReleaseManifest} from '../scripts/lib/release-manifest.mjs';
import {validateMigrationFiles,validateLiveBaseline,pendingMigrations} from '../scripts/lib/release-validation.mjs';
import {extractUkrainianWords} from '../functions/_shared/ukrainian-word.js';
import {lookupDictionaryWord} from '../functions/_shared/dictionary.js';
const release=loadReleaseManifest('0.85');
const seed=JSON.parse(fs.readFileSync(new URL('../data/content-seed.json',import.meta.url)));
const questions=JSON.parse(fs.readFileSync(new URL('../data/questions-seed.json',import.meta.url)));
const count=s=>s.split(/\s+/).filter(w=>/[\p{L}\p{N}]/u.test(w)).length;
const sql=name=>fs.readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8');

test('revised A1 stories fill their original bands, retain topic structure and recycle vocabulary',()=>{
 const known=new Map();
 for(const s of seed.filter(s=>s.level==='A1'&&s.sortOrder<20))for(const w of new Set(extractUkrainianWords(s.paragraphs.join(' '))))known.set(w,(known.get(w)||0)+1);
 const targets=[[20,80,2],[21,95,3],[22,90,3],[23,80,2],[24,80,2]];
 for(const [order,min,n] of targets){
  const s=seed.find(s=>s.level==='A1'&&s.sortOrder===order),body=s.paragraphs.join(' ');
  const ps=s.paragraphs.map(p=>p.split(/(?<=[.!?…])\s+/)),lengths=ps.flat().map(count);
  assert.equal(count(body),min+10,`A1 ${order}: requested fuller passage`);
  assert.equal(ps.length,n);assert.ok(ps.every(p=>p.length<=6));
  assert.ok(Math.abs(ps[0].length-ps[1].length)<=(n===2?3:2));
  // The two-paragraph rule limits sentence imbalance, not paragraph word counts.
  if(n===3)assert.ok(count(s.paragraphs[2])<Math.min(...s.paragraphs.slice(0,2).map(count)));
  assert.ok(Math.max(...lengths)<=11);assert.ok(lengths.filter(n=>n<5).length>=2);
  assert.ok(Math.max(...lengths)-Math.min(...lengths)>=5);
  assert.doesNotMatch(body,/(?:^|\s)(?:якщо|щоб|хоча|поки|би|буду|буде|який|яка|які)(?:\s|[,.])/iu);
  assert.ok([...new Set(extractUkrainianWords(body))].filter(w=>known.get(w)===1).length>=5);
  const item=release.stories.find(s=>s.order===order);
  assert.deepEqual(item.after.questions,item.before.questions,'Existing quiz meanings and option order stay unchanged');
  assert.deepEqual(questions.filter(q=>q.level==='A1'&&q.storyOrder===order).map(({prompt,correct,wrong})=>({prompt,correct,wrong})),item.after.questions);
  assert.deepEqual(s.paragraphs,item.after.paragraphs);
 }
 assert.doesNotMatch(seed.find(s=>s.level==='A1'&&s.sortOrder===21).paragraphs.join(' '),/Дерево поруч\./);
 const clock=seed.find(s=>s.level==='A1'&&s.sortOrder===24).paragraphs.join(' ');
 assert.match(clock,/ключі лежать біля дверей/);
 assert.doesNotMatch(clock,/о восьмій|о першій/i);
});

test('paragraph revision preserves all IDs, quizzes, drafts, preferences, history and speech settings',()=>{
 const {sqlite}=seedDatabase({before:'0028'});
 try{
  sqlite.exec("UPDATE texts SET draft_json='{\"title\":\"Unpublished edit\"}',is_enabled=0 WHERE level='A1' AND display_order=20");
  sqlite.exec("INSERT INTO story_revisions(story_id,action,snapshot_json,created_by_email) SELECT id,'save_draft','{}','editor@example.com' FROM texts WHERE level='A1' AND display_order=20");
  sqlite.exec("INSERT INTO story_dictionary_preferences(story_id,normalized_form,target_language,sense_id,selected_by_email,selected_at) SELECT t.id,'сонце','en',s.id,'editor@example.com','2026-09-16' FROM texts t CROSS JOIN dictionary_senses s WHERE t.level='A1' AND t.display_order=20 LIMIT 1");
  const tables=['texts','questions','story_revisions','story_dictionary_preferences','speech_settings','dictionary_lexemes','dictionary_forms','dictionary_senses','dictionary_translations'];
  const before=Object.fromEntries(tables.map(t=>[t,sqlite.prepare(`SELECT rowid _rowid,* FROM ${t} ORDER BY rowid`).all()]));
  for(const name of release.releaseMigrations)sqlite.exec(sql(name));
  for(const table of tables)for(const row of before[table]){
   const after=sqlite.prepare(`SELECT rowid _rowid,* FROM ${table} WHERE rowid=?`).get(row._rowid);
   const changed=table==='texts'&&row.level==='A1'&&row.display_order>=20&&row.display_order<=24;
   if(changed){assert.deepEqual(JSON.parse(after.paragraphs_json),release.stories.find(s=>s.order===row.display_order).after.paragraphs);after.paragraphs_json=row.paragraphs_json;after.updated_at=row.updated_at;}
   assert.deepEqual(after,row,`${table}:${row._rowid}`);
  }
  assert.equal(sqlite.prepare('SELECT count(*) n FROM questions').get().n,635);
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{sqlite.close();}
});

test('revision stops on editorial drift and resumes after its additive dictionary migration',()=>{
 validateMigrationFiles(release,new URL('../migrations/',import.meta.url));
 const base=loadReleaseManifest('0.84').migrations.map(m=>m.name);
 assert.deepEqual(pendingMigrations(release,base),release.releaseMigrations);
 assert.deepEqual(pendingMigrations(release,[...base,release.releaseMigrations[0]]),[release.contentMigration]);
 for(const mutation of ["UPDATE texts SET title='Editor change' WHERE level='A1' AND display_order=20","UPDATE questions SET correct_answer='Editor change' WHERE story_id=(SELECT id FROM texts WHERE level='A1' AND display_order=24) AND display_order=1"]){
  const {sqlite}=seedDatabase({before:'0028'});
  try{sqlite.exec(mutation);sqlite.exec('BEGIN');assert.throws(()=>sqlite.exec(sql(release.contentMigration)),/CHECK/);sqlite.exec('ROLLBACK');
   assert.throws(()=>validateLiveBaseline(release,sqlite.prepare('SELECT * FROM texts').all(),sqlite.prepare('SELECT * FROM questions').all()));
  }finally{sqlite.close();}
 }
});

test('revised word forms resolve to the reviewed English and German meanings',async()=>{
 const {sqlite,db}=seedDatabase();
 try{for(const p of release.dictionaryProbes){const result=await lookupDictionaryWord(db,{text:p.text,targetLanguage:p.language});assert.ok(result.entries.some(e=>e.lemma===p.lemma&&e.translations.some(t=>t.text===p.translation)),`${p.language}:${p.text}`);}}
 finally{sqlite.close();}
});
