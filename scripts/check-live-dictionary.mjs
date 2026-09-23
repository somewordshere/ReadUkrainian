import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";
import { loadReleaseManifest } from "./lib/release-manifest.mjs";
import { checkCanaries, loadGuardConfig, reportFailures } from "./lib/dictionary-guards.mjs";
const { values } = parseArgs({ options: { origin: { type: "string", default: "https://readukrainianapp.com" } } });
const origin = new URL(values.origin).origin;
const source = JSON.parse(readFileSync(new URL("../data/dictionary-a1-015-019.uk-en.json",import.meta.url),"utf8"));
const manifest = loadReleaseManifest(process.env.RELEASE_VERSION);
const probes = manifest.dictionaryProbes || source.entries.flatMap(entry=>entry.forms.map(f=>({text:f.form,language:"en",lemma:entry.lemma,translation:entry.translation})));
const expected = new Map(probes.map(p=>[`${p.language}:${p.text}`,p]));
const bad = new Map([["мама","озимина"],["червоний","рясний"],["парк","лісопарк"]]);
for(const [word] of bad) expected.set(`en:${word}`,{text:word,language:"en"});
async function lookup(word, language) {
  for(let attempt=0;attempt<3;attempt++) {
    const response=await fetch(`${origin}/api/dictionary/lookup`,{method:"POST",headers:{"content-type":"application/json",origin},body:JSON.stringify({text:word,targetLanguage:language}),signal:AbortSignal.timeout(20000)});
    if(response.ok)return response.json();
    if(attempt===2||![429,502,503,504].includes(response.status))throw new Error(`Lookup ${word}: HTTP ${response.status}`);
    await setTimeout(2000);
  }
}
for(const [,wanted] of expected){
  const word=wanted.text;
  const result=await lookup(word,wanted.language);
  assert.ok(result.entries?.length,`No translation for ${word}`);
  if(wanted.lemma) assert.ok(result.entries.some((entry)=>entry.lemma===wanted.lemma && entry.translations.some((t)=>t.text===wanted.translation)),`Reviewed entry missing for ${wanted.language}:${word}`);
  assert.ok(!result.entries.some((entry)=>entry.lemma===bad.get(word)),`Bad association returned for ${word}`);
}
console.log(`${expected.size} live word lookups verified, including the three repaired associations.`);
// The same canary words the build checks, as learners see them on the live site.
const {canaries}=loadGuardConfig();
reportFailures("Live dictionary canaries",await checkCanaries(
  async(word,language)=>(await lookup(word,language)).entries.map((entry)=>entry.normalizedLemma||entry.lemma),
  canaries,
));
console.log(`${canaries.length} canary words verified live in English and German.`);
