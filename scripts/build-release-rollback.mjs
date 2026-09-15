import { loadReleaseManifest } from "./lib/release-manifest.mjs";
// Generate, but never execute, a guarded rollback for this content release.
import { readFileSync, writeFileSync } from "node:fs";
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=="--output") throw new Error("Use --output NEW_SQL_FILE");
const manifest = loadReleaseManifest(process.env.RELEASE_VERSION);
const quote=(s)=>`'${String(s).replaceAll("'","''")}'`;
const where=(s)=>`level=${quote(s.level)} AND display_order=${s.order}`;
const id=(s)=>`(SELECT id FROM texts WHERE ${where(s)})`;
const guards=manifest.stories.flatMap(s=>[
  `(SELECT COUNT(*) FROM texts WHERE ${where(s)} AND title=${quote(s.after.title)} AND json(paragraphs_json)=json(${quote(JSON.stringify(s.after.paragraphs))}))=1`,
  `(SELECT COUNT(*) FROM questions WHERE story_id=${id(s)})=5`,
  ...s.after.questions.map((q,i)=>`(SELECT COUNT(*) FROM questions WHERE story_id=${id(s)} AND display_order=${i+1} AND prompt=${quote(q.prompt)} AND correct_answer=${quote(q.correct)} AND json(wrong_answers_json)=json(${quote(JSON.stringify(q.wrong))}))=1`),
]);
const lines=[`-- Run only after release ${manifest.version} has been applied. Stops if an editor changed affected content.`,"-- New stories are hidden, not deleted. Drafts, revisions and dictionary additions remain.","CREATE TABLE _content_rollback_guard (ok INTEGER NOT NULL CHECK(ok=1));",`INSERT INTO _content_rollback_guard SELECT CASE WHEN ${guards.join(" AND ")} THEN 1 ELSE 0 END;`,"DROP TABLE _content_rollback_guard;"];
for(const s of manifest.stories){
  if(!s.before){lines.push(`UPDATE texts SET is_enabled=0, updated_at=CURRENT_TIMESTAMP WHERE ${where(s)};`);continue;}
  lines.push(`UPDATE texts SET title=${quote(s.before.title)}, paragraphs_json=${quote(JSON.stringify(s.before.paragraphs))}, show_word_count=${s.before.showWordCount?1:0}, updated_at=CURRENT_TIMESTAMP WHERE ${where(s)};`,`DELETE FROM questions WHERE story_id=${id(s)};`);
  s.before.questions.forEach((q,i)=>lines.push(`INSERT INTO questions(story_id,display_order,prompt,correct_answer,wrong_answers_json) VALUES(${id(s)},${i+1},${quote(q.prompt)},${quote(q.correct)},${quote(JSON.stringify(q.wrong))});`));
}
writeFileSync(args[1],lines.join("\n")+"\n",{flag:"wx"});
console.log("Guarded rollback SQL written; production was not changed.");
