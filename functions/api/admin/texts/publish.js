import { requirePermission } from "../../../_shared/auth.js";
import { analyzeEnabledDictionaryCoverage } from "../../../_shared/dictionary-workflow.js";
import { error, json, readJson } from "../../../_shared/http.js";
import { publishText, validateTextPayload } from "../../../_shared/texts.js";

export async function onRequestPost(context) {
  const auth = await requirePermission(context, "publish");
  if (!auth.ok) return auth.response;

  const storyId = Number(context.params.id);
  if (!Number.isInteger(storyId)) return error(400, "Invalid story ID.");

  const payload = await readJson(context.request);
  const validation = validateTextPayload(payload, { allowLevel: true });
  if (!validation.ok) return error(400, validation.message);

  let dictionaryCoverages;
  try {
    dictionaryCoverages = await analyzeEnabledDictionaryCoverage(
      context.env.DB,
      validation.value.paragraphs
    );
  } catch (coverageError) {
    console.error(JSON.stringify({
      message: "dictionary_publish_coverage_failed",
      storyId,
      targetLanguage: "en",
      error: coverageError instanceof Error ? coverageError.message : String(coverageError),
    }));
    dictionaryCoverages = [{
      available: false,
      targetLanguage: "en",
      message: "Dictionary coverage could not be checked.",
    }];
  }

  const story = await publishText(context.env.DB, storyId, validation.value, auth.session);
  if (!story) return error(404, "Story not found.");

  return json({
    story,
    dictionaryCoverage: dictionaryCoverages.find((coverage) => coverage.targetLanguage === "en")
      || dictionaryCoverages[0]
      || null,
    dictionaryCoverages,
  });
}
