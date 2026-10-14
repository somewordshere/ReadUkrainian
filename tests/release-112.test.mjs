import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {seedDatabase} from '../scripts/lib/seed-database.mjs';
import {loadReleaseManifest} from '../scripts/lib/release-manifest.mjs';
import {validateMigrationFiles,validateLiveBaseline,pendingMigrations} from '../scripts/lib/release-validation.mjs';
import {extractUkrainianWords} from '../functions/_shared/ukrainian-word.js';

// Release 1.12: owner-reviewed corrections of 14 published A1 stories, paragraphs only.
const release=loadReleaseManifest('1.12');
const seed=JSON.parse(fs.readFileSync(new URL('../data/content-seed.json',import.meta.url)));
const questions=JSON.parse(fs.readFileSync(new URL('../data/questions-seed.json',import.meta.url)));
const sql=name=>fs.readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8');
const words=s=>s.split(/\s+/).filter(w=>/[\p{L}\p{N}]/u.test(w));

test('the corrected stories are the seed, keep their titles and quizzes, and stay inside A1 limits',()=>{
 assert.deepEqual(release.stories.map(s=>s.order),[1,2,3,4,7,9,10,12,13,14,18,20,22,23]);
 for(const item of release.stories){
  const s=seed.find(s=>s.level==='A1'&&s.sortOrder===item.order);
  assert.deepEqual(s.paragraphs,item.after.paragraphs,`A1 ${item.order}: seed is the reviewed text`);
  assert.equal(s.title,item.before.title);
  assert.deepEqual(item.after.questions,item.before.questions,'quizzes are unchanged');
  assert.deepEqual(questions.filter(q=>q.level==='A1'&&q.storyOrder===item.order).sort((a,b)=>a.displayOrder-b.displayOrder).map(({prompt,correct,wrong})=>({prompt,correct,wrong})),item.after.questions);
  const body=s.paragraphs.join(' ');
  assert.ok(words(body).length>=75&&words(body).length<=120,`A1 ${item.order}: inside the A1 band`);
  assert.ok(s.paragraphs.flatMap(p=>p.split(/(?<=[.!?…][»"]?)\s+/u)).every(sentence=>words(sentence).length<=14),`A1 ${item.order}: no sentence longer than before`);
 }
});

test('the corrections add no word form the collection did not already have',()=>{
 const changedOrders=new Set(release.stories.map(s=>s.order));
 const known=new Set(seed.filter(s=>!(s.level==='A1'&&changedOrders.has(s.sortOrder))).flatMap(s=>extractUkrainianWords(s.paragraphs.join(' '))));
 for(const item of release.stories)for(const w of extractUkrainianWords(item.before.paragraphs.join(' ')))known.add(w);
 const fresh=release.stories.flatMap(item=>extractUkrainianWords(item.after.paragraphs.join(' ')).filter(w=>!known.has(w)).map(w=>`A1 ${item.order}: ${w}`));
 assert.deepEqual(fresh,[],'so the dictionary, coverage and the audio need no change');
});

test('0041 changes only the paragraphs of the 14 stories and preserves IDs, quizzes, drafts, preferences and history',()=>{
 const {sqlite}=seedDatabase({before:'0041'});
 try{
  sqlite.exec("UPDATE texts SET draft_json='{\"title\":\"Unpublished edit\"}',is_enabled=0 WHERE level='A1' AND display_order=1");
  sqlite.exec("INSERT INTO story_revisions(story_id,action,snapshot_json,created_by_email) SELECT id,'save_draft','{}','editor@example.com' FROM texts WHERE level='A1' AND display_order=1");
  const tables=['texts','questions','story_revisions','story_dictionary_preferences','speech_settings','dictionary_lexemes','dictionary_forms','feedback'];
  const before=Object.fromEntries(tables.map(t=>[t,sqlite.prepare(`SELECT rowid _rowid,* FROM ${t} ORDER BY rowid`).all()]));
  sqlite.exec(sql(release.contentMigration));
  const orders=release.stories.map(s=>s.order);
  for(const table of tables)for(const row of before[table]){
   const after=sqlite.prepare(`SELECT rowid _rowid,* FROM ${table} WHERE rowid=?`).get(row._rowid);
   if(table==='texts'&&row.level==='A1'&&orders.includes(row.display_order)){
    assert.deepEqual(JSON.parse(after.paragraphs_json),release.stories.find(s=>s.order===row.display_order).after.paragraphs);
    after.paragraphs_json=row.paragraphs_json;after.updated_at=row.updated_at;
   }
   assert.deepEqual(after,row,`${table}:${row._rowid}`);
  }
  assert.equal(sqlite.prepare('SELECT count(*) n FROM questions').get().n,635);
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{sqlite.close();}
});

test('0041 stops on editorial drift, and the release resumes cleanly after it ran',()=>{
 validateMigrationFiles(release,new URL('../migrations/',import.meta.url),{allowLater:true});
 const base=loadReleaseManifest('1.11').migrations.map(m=>m.name);
 assert.deepEqual(pendingMigrations(release,base),[release.contentMigration]);
 assert.deepEqual(pendingMigrations(release,[...base,release.contentMigration]),[]);
 for(const mutation of ["UPDATE texts SET title='Editor change' WHERE level='A1' AND display_order=7","UPDATE questions SET correct_answer='Editor change' WHERE story_id=(SELECT id FROM texts WHERE level='A1' AND display_order=23) AND display_order=1"]){
  const {sqlite}=seedDatabase({before:'0041'});
  try{
   sqlite.exec(mutation);sqlite.exec('BEGIN');
   assert.throws(()=>sqlite.exec(sql(release.contentMigration)),/CHECK/);
   sqlite.exec('ROLLBACK');
   assert.throws(()=>validateLiveBaseline(release,sqlite.prepare('SELECT * FROM texts').all(),sqlite.prepare('SELECT * FROM questions').all()));
  }finally{sqlite.close();}
 }
 // The unchanged baseline passes before the migration, and the corrected text passes after it.
 const {sqlite}=seedDatabase({before:'0041'});
 try{
  validateLiveBaseline(release,sqlite.prepare('SELECT * FROM texts').all(),sqlite.prepare('SELECT * FROM questions').all(),false);
  sqlite.exec(sql(release.contentMigration));
  validateLiveBaseline(release,sqlite.prepare('SELECT * FROM texts').all(),sqlite.prepare('SELECT * FROM questions').all(),true);
 }finally{sqlite.close();}
});
