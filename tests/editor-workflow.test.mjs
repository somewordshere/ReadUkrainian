import assert from "node:assert/strict";
import test from "node:test";

import { derivePublicationStatus, validateTextPayload } from "../functions/_shared/texts.js";

test("derives explicit publication states from live and draft data", () => {
  assert.equal(derivePublicationStatus({ active: true, hasDraft: false }), "published");
  assert.equal(derivePublicationStatus({ active: true, hasDraft: true }), "published_with_draft");
  assert.equal(derivePublicationStatus({ active: false, hasDraft: true }), "draft");
  assert.equal(derivePublicationStatus({ active: false, hasDraft: false }), "unpublished");
});

test("normalizes valid editor payloads and rejects duplicate quiz answers", () => {
  const valid = validateTextPayload({
    level: "A1",
    title: "  A title  ",
    paragraphs: [" First paragraph ", "", "Second paragraph"],
    questions: [{ prompt: "Question?", correct: "Yes", wrong: ["No", "Maybe", "Never"] }],
    showWordCount: false,
  }, { allowLevel: true });

  assert.equal(valid.ok, true);
  assert.equal(valid.value.title, "A title");
  assert.deepEqual(valid.value.paragraphs, ["First paragraph", "Second paragraph"]);
  assert.equal(valid.value.showWordCount, false);

  const duplicate = validateTextPayload({
    level: "A1",
    title: "A title",
    paragraphs: ["Paragraph"],
    questions: [{ prompt: "Question?", correct: "Same", wrong: ["same", "Other", "Another"] }],
  }, { allowLevel: true });

  assert.equal(duplicate.ok, false);
  assert.match(duplicate.message, /distinct answers/);
});
