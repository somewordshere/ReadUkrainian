import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {seedDatabase} from '../lib/seed-database.mjs';
import {analyzeDictionaryCoverage} from '../../functions/_shared/dictionary-workflow.js';
import {lookupDictionaryWord} from '../../functions/_shared/dictionary.js';
const {values}=parseArgs({options:{en:{type:'string'},de:{type:'string'},output:{type:'string'}}});
// Either or both languages: a dictionary update validates only the pair it changes.
const languages=['en','de'].filter(language=>values[language]);
if(!languages.length||!values.output)throw new Error('--en SQL and/or --de SQL, and --output NEW_REPORT, are required');
const stories=JSON.parse(readFileSync(new URL('../../data/content-seed.json',import.meta.url),'utf8')).filter(s=>['A1','A2'].includes(s.level)&&s.active!==false);
const {sqlite,db}=seedDatabase();
const tables=['dictionary_sources','dictionary_lexemes','dictionary_forms','dictionary_senses','dictionary_translations','story_dictionary_preferences'];
try{
 const before=Object.fromEntries(tables.map(t=>[t,sqlite.prepare(`SELECT rowid AS _rowid,* FROM ${t} ORDER BY rowid`).all()]));
 const report={kind:'Scratch-database additive rebuild validation; not a production replacement',stories:stories.length,inputs:{},coverage:{}};
 for(const language of languages){
  const sql=readFileSync(values[language],'utf8');
  // Full rebuild outputs are intentionally scratch artifacts, never auto-published.
  report.inputs[language]={sha256:createHash('sha256').update(sql).digest('hex')};
  const c=await analyzeDictionaryCoverage(db,stories.flatMap(s=>s.paragraphs),{targetLanguage:language});
  report.coverage[language]={before:c.coveredUniqueWords,total:c.totalUniqueWords};
  sqlite.exec(sql);
 }
 for(const t of tables)for(const row of before[t])assert.deepEqual(sqlite.prepare(`SELECT rowid AS _rowid,* FROM ${t} WHERE rowid=?`).get(row._rowid),row,`Existing ${t} record changed`);
 for(const language of languages){
  const c=await analyzeDictionaryCoverage(db,stories.flatMap(s=>s.paragraphs),{targetLanguage:language});
  Object.assign(report.coverage[language],{after:c.coveredUniqueWords,percent:c.coveragePercent,missing:c.missing});
  assert.ok(c.coveredUniqueWords>=report.coverage[language].before);
  if(language==='en')assert.equal(c.missingCount,0);
  for(const [text,bad]of [['мама','озимина'],['червоний','рясний'],['парк','лісопарк']]){const r=await lookupDictionaryWord(db,{text,targetLanguage:language});assert.ok(!r.entries.some(e=>e.lemma===bad));}
 }
 assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 report.preserved=Object.fromEntries(tables.map(t=>[t,before[t].length]));
 writeFileSync(values.output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({...report,coverage:Object.fromEntries(Object.entries(report.coverage).map(([k,v])=>[k,{...v,missing:undefined}]))},null,2));
}finally{sqlite.close();}
