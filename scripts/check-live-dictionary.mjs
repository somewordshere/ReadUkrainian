import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
const source = JSON.parse(readFileSync(new URL("../data/dictionary-a1-015-019.uk-en.json",import.meta.url),"utf8"));
const expected = new Map(source.entries.flatMap((entry)=>entry.forms.map((f)=>[f.form.toLocaleLowerCase("uk"),{lemma:entry.lemma,translation:entry.translation}])));
const bad = new Map([["мама","озимина"],["червоний","рясний"],["парк","лісопарк"]]);
for(const [word] of bad) expected.set(word,null);
for(const [word,wanted] of expected){
  let result;
  for(let attempt=0;attempt<3;attempt++) {
    const response=await fetch("https://readukrainianapp.com/api/dictionary/lookup",{method:"POST",headers:{"content-type":"application/json",origin:"https://readukrainianapp.com"},body:JSON.stringify({text:word,targetLanguage:"en"}),signal:AbortSignal.timeout(20000)});
    if(response.ok){result=await response.json();break;}
    if(attempt===2||![429,502,503,504].includes(response.status))throw new Error(`Lookup ${word}: HTTP ${response.status}`);
    await setTimeout(2000);
  }
  assert.ok(result.entries?.length,`No translation for ${word}`);
  if(wanted) assert.ok(result.entries.some((entry)=>entry.lemma===wanted.lemma && entry.translations.some((t)=>t.text===wanted.translation)),`Reviewed entry missing for ${word}`);
  assert.ok(!result.entries.some((entry)=>entry.lemma===bad.get(word)),`Bad association returned for ${word}`);
}
console.log(`${expected.size} live word lookups verified, including the three repaired associations.`);
