import assert from "node:assert/strict";
import test from "node:test";
import { checkLiveContent } from "../scripts/lib/live-content-check.mjs";

const seed = [{level:"A1",sortOrder:1,title:"Текст",paragraphs:["Наш текст."],active:true}];
const questions = Array.from({length:5},(_,i)=>({level:"A1",storyOrder:1,displayOrder:i+1,prompt:`Питання ${i}?`,correct:"Так",wrong:["Ні","Іноді","Ніколи"]}));
function fetcher({ alter = (value) => value, hiddenA1 = false, status = 200 } = {}) {
  return async (url) => {
    if (url.endsWith("/api/content")) return Response.json({levels:[{id:"A1",active:!hiddenA1,texts:seed},{id:"A2",active:true,texts:[]},{id:"B1",active:false,texts:[]}]});
    if (url.endsWith("version.js")) return new Response('const SITE_VERSION = "0.83";');
    return Response.json({story:alter({...seed[0],questions:structuredClone(questions)})},{status});
  };
}
test("live verification accepts complete matching stories and questions", async()=>{
  const result=await checkLiveContent({origin:"https://test.invalid",seed,questions,deep:true,expectedVersion:"0.83",fetchImpl:fetcher()});
  assert.equal(result.ok,true);
});
test("five questions with a changed correct answer or distractor fail live verification",async()=>{
  for(const field of ["correct","wrong","prompt"]){
    const fetchImpl=fetcher({alter:s=>{s.questions[0][field]=field==="wrong"?["Змінено","Іноді","Ніколи"]:"Змінено";return s;}});
    const result=await checkLiveContent({origin:"https://test.invalid",seed,questions,deep:true,fetchImpl});
    assert.equal(result.ok,false); assert.ok(result.issues.some(s=>s.includes("questions or answers")));
  }
});
test("hidden A1, stale assets and unavailable story endpoints cannot pass",async()=>{
  for(const opts of [{hiddenA1:true},{status:503}]) assert.equal((await checkLiveContent({origin:"https://test.invalid",seed,questions,deep:true,fetchImpl:fetcher(opts)})).ok,false);
  assert.equal((await checkLiveContent({origin:"https://test.invalid",seed,questions,expectedVersion:"0.84",fetchImpl:fetcher()})).ok,false);
});
