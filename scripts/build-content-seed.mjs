import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const rootDir = process.cwd();
const args = process.argv.slice(2);
if (args.some((arg) => !["--json-only", "--check"].includes(arg))) throw new Error("Use --json-only or --check.");
// Historical migrations are immutable. Even the default now generates JSON only.
const checkOnly = args.includes("--check");
const storyFiles = [
  "public/js/data/stories.js",
  "public/js/data/a1-stories.js",
  "public/js/data/a2-stories.js",
  "public/js/data/b1-stories.js",
];
const questionFiles = [
  "public/js/app/questions.js",
  "public/js/data/a1-questions.js",
  "public/js/data/a2-questions.js",
  "public/js/data/b1-questions.js",
];

async function runFiles(files, setupSource, outputExpression, filename) {
  const context = {};
  context.window = context;
  vm.createContext(context);
  const combinedSourceParts = [setupSource];

  for (const relativeFile of files) {
    const absoluteFile = path.join(rootDir, relativeFile);
    const source = await fs.readFile(absoluteFile, "utf8");
    combinedSourceParts.push(`\n// ${relativeFile}\n${source}`);
  }

  combinedSourceParts.push(`\nglobalThis.__output = ${outputExpression};\n`);
  vm.runInContext(combinedSourceParts.join("\n"), context, { filename });
  return context.__output;
}

const storiesByLevel = await runFiles(
  storyFiles,
  "",
  "storiesByLevel",
  "stories-bundle.js"
);

const questionDataByLevel = await runFiles(
  questionFiles,
  "",
  "questionDataByLevel",
  "questions-bundle.js"
);

const levels = Object.keys(storiesByLevel || {}).sort();
const storyRecords = [];
const questionRecords = [];

for (const level of levels) {
  const stories = storiesByLevel[level] || [];
  const storyQuestions = questionDataByLevel[level] || [];

  for (const [index, story] of stories.entries()) {
    const sortOrder = index + 1;
    storyRecords.push({
      level,
      sortOrder,
      title: story.title,
      paragraphs: story.paragraphs || [],
      showWordCount: story.showWordCount !== false,
      active: story.active !== false,
    });

    const questions = storyQuestions[index] || [];
    questions.forEach((question, questionIndex) => {
      questionRecords.push({
        level,
        storyOrder: sortOrder,
        displayOrder: questionIndex + 1,
        prompt: question.prompt,
        correct: question.correct,
        wrong: question.wrong || [],
      });
    });
  }
}

const seedDir = path.join(rootDir, "data");
const outputs = {
  "content-seed.json": `${JSON.stringify(storyRecords, null, 2)}\n`,
  "questions-seed.json": `${JSON.stringify(questionRecords, null, 2)}\n`,
};
if (checkOnly) {
  for (const [name, expected] of Object.entries(outputs)) {
    if ((await fs.readFile(path.join(seedDir, name), "utf8")).replaceAll("\r\n", "\n") !== expected) {
      throw new Error(`${name} differs from the frontend bundles; regenerate the JSON seeds.`);
    }
  }
  console.log("Both JSON seeds match the frontend bundles.");
} else {
  await fs.mkdir(seedDir, { recursive: true });
  for (const [name, content] of Object.entries(outputs)) await fs.writeFile(path.join(seedDir, name), content, "utf8");
  console.log(`Generated ${storyRecords.length} story records and ${questionRecords.length} question records; historical migrations untouched.`);
}
