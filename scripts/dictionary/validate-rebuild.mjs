import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {seedDatabase} from '../lib/seed-database.mjs';
import {analyzeDictionaryCoverage} from '../../functions/_shared/dictionary-workflow.js';
import {
 checkCanaries,checkCanaryDiff,checkFormCaps,checkFormCrossings,checkNewTags,collectLemmas,
 databaseLookup,formTags,loadGuardConfig,mostFrequentWords,reportFailures,storyWordFrequency,
} from '../lib/dictionary-guards.mjs';
const {values}=parseArgs({options:{en:{type:'string'},de:{type:'string'},pl:{type:'string'},output:{type:'string'}}});
// Either or both languages: a dictionary update validates only the pair it changes.
const languages=['en','de','pl'].filter(language=>values[language]);
if(!languages.length||!values.output)throw new Error('--en, --de and/or --pl SQL, and --output NEW_REPORT, are required');
const allStories=JSON.parse(readFileSync(new URL('../../data/content-seed.json',import.meta.url),'utf8'));
const stories=allStories.filter(s=>['A1','A2'].includes(s.level)&&s.active!==false);
const guard=loadGuardConfig();
const frequency=storyWordFrequency(allStories);
const canaryWords=mostFrequentWords(frequency,guard.canaryDiffWords);
const {sqlite,db}=seedDatabase();
const lookup=databaseLookup(db);
const tables=['dictionary_sources','dictionary_lexemes','dictionary_forms','dictionary_senses','dictionary_translations','story_dictionary_preferences'];
try{
 const before=Object.fromEntries(tables.map(t=>[t,sqlite.prepare(`SELECT rowid AS _rowid,* FROM ${t} ORDER BY rowid`).all()]));
 const lemmasBefore=await collectLemmas(lookup,canaryWords,languages);
 const tagsBefore=new Set([...formTags(sqlite),...guard.knownTags]);
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
 }
 assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 // The guards (scripts/lib/dictionary-guards.mjs): an update that changes what the
 // most used words show, files whole tables under one entry, links a word to
 // another entry, or brings tags we have never seen stops here, before any branch.
 const failures=[
  ...checkNewTags(tagsBefore,formTags(sqlite)),
  ...checkCanaryDiff(lemmasBefore,await collectLemmas(lookup,canaryWords,languages),{frequency}),
  ...await checkCanaries(lookup,guard.canaries,{languages,frequency}),
  ...checkFormCaps(sqlite,guard.formCaps,{languages}),
  ...checkFormCrossings(sqlite,guard.approvedForms,{languages,frequency}),
 ];
 report.guards={canaryDiffWords:canaryWords.length,canaries:guard.canaries.length,failures};
 report.preserved=Object.fromEntries(tables.map(t=>[t,before[t].length]));
 // Kept even when the guards fail: the workflow uploads it with the run.
 writeFileSync(values.output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 reportFailures('Dictionary update guards',failures);
 console.log(JSON.stringify({...report,coverage:Object.fromEntries(Object.entries(report.coverage).map(([k,v])=>[k,{...v,missing:undefined}]))},null,2));
}finally{sqlite.close();}
