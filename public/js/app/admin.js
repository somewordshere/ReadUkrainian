const byId = (id) => document.getElementById(id);

const loginSection = byId("loginSection");
const adminSection = byId("adminSection");
const loginForm = byId("loginForm");
const loginStatus = byId("loginStatus");
const logoutButton = byId("logoutButton");
const userSummary = byId("userSummary");
const speechSettingsForm = byId("speechSettingsForm");
const speechVoiceSelect = byId("speechVoiceSelect");
const speechVoiceDescription = byId("speechVoiceDescription");
const saveSpeechSettingsButton = byId("saveSpeechSettingsButton");
const speechSettingsStatus = byId("speechSettingsStatus");
const addStoryButton = byId("addStoryButton");
const textsList = byId("textsList");
const textCount = byId("textCount");
const storySearch = byId("storySearch");
const levelFilter = byId("levelFilter");
const statusFilter = byId("statusFilter");
const editorForm = byId("editorForm");
const editorCard = document.querySelector(".admin-editor-card");
const editorStatus = byId("editorStatus");
const editorKicker = byId("editorKicker");
const editorTitle = byId("editorTitle");
const storyStatus = byId("storyStatus");
const storyIdField = byId("storyIdField");
const editorAttribution = byId("editorAttribution");
const addQuestionButton = byId("addQuestionButton");
const questionsEditor = byId("questionsEditor");
const undoBar = byId("undoBar");
const undoQuestionButton = byId("undoQuestionButton");
const historyList = byId("historyList");
const refreshHistoryButton = byId("refreshHistoryButton");
const saveState = byId("saveState");
const previewButton = byId("previewButton");
const saveDraftButton = byId("saveDraftButton");
const publishButton = byId("publishButton");
const unpublishButton = byId("unpublishButton");
const previewDialog = byId("previewDialog");
const previewTitle = byId("previewTitle");
const previewStory = byId("previewStory");
const previewQuiz = byId("previewQuiz");
const closePreviewButton = byId("closePreviewButton");

const STATUS_LABELS = {
  draft: "Draft",
  published: "Published",
  published_with_draft: "Published + draft",
  unpublished: "Unpublished",
};

let summaries = [];
let selectedStoryId = null;
let currentStory = null;
let editorMode = "edit";
let currentUser = null;
let cleanFingerprint = "";
let cleanStateMessage = "No unsaved changes";
let removedQuestion = null;
let requestPending = false;
let speechSettingsPending = false;
let speechSettingsReady = false;
let savedSpeechVoiceId = "";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setStatus(element, message, isError = false) {
  element.textContent = message || "";
  element.classList.toggle("is-error", Boolean(message) && isError);
  element.classList.toggle("is-success", Boolean(message) && !isError);
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? String(value)
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function hasPermission(permission) {
  return currentUser?.permissions?.includes(permission) || false;
}

function updateSpeechVoiceDescription() {
  const selectedOption = speechVoiceSelect.selectedOptions[0];
  speechVoiceDescription.textContent = selectedOption?.dataset.description || "";
}

function updateSpeechSettingsControls() {
  speechVoiceSelect.disabled = speechSettingsPending || !speechSettingsReady;
  saveSpeechSettingsButton.disabled = speechSettingsPending
    || !speechSettingsReady
    || !speechVoiceSelect.value
    || speechVoiceSelect.value === savedSpeechVoiceId;
}

function setSpeechSettingsPending(pending) {
  speechSettingsPending = pending;
  speechSettingsForm.setAttribute("aria-busy", String(pending));
  updateSpeechSettingsControls();
}

function populateSpeechVoices(voices, selectedVoiceId) {
  speechVoiceSelect.replaceChildren();

  voices.forEach((voice) => {
    const voiceId = voice.id || voice.voiceId;
    if (!voiceId) return;

    const option = document.createElement("option");
    option.value = voiceId;
    option.textContent = voice.label || voice.name || voiceId;
    option.dataset.description = voice.description || "";
    speechVoiceSelect.appendChild(option);
  });

  if (!speechVoiceSelect.options.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No voices available";
    speechVoiceSelect.appendChild(option);
    throw new Error("No pronunciation voices are available.");
  }

  const hasSelectedVoice = Array.from(speechVoiceSelect.options)
    .some((option) => option.value === selectedVoiceId);
  speechVoiceSelect.value = hasSelectedVoice ? selectedVoiceId : speechVoiceSelect.options[0].value;
  updateSpeechVoiceDescription();
}

async function loadSpeechSettings() {
  if (!hasPermission("settings")) {
    speechSettingsForm.hidden = true;
    return;
  }

  speechSettingsForm.hidden = false;
  speechSettingsReady = false;
  setSpeechSettingsPending(true);
  setStatus(speechSettingsStatus, "Loading voice settings…");

  try {
    const payload = await api("./api/admin/settings/speech", { method: "GET" });
    const voices = Array.isArray(payload.voices) ? payload.voices : [];
    const selectedVoiceId = payload.setting?.voiceId || payload.voiceId || "";
    populateSpeechVoices(voices, selectedVoiceId);
    savedSpeechVoiceId = speechVoiceSelect.value;
    speechSettingsReady = true;
    const selectedLabel = speechVoiceSelect.selectedOptions[0]?.textContent || savedSpeechVoiceId;
    setStatus(speechSettingsStatus, `Current voice: ${selectedLabel}.`);
  } catch (error) {
    speechSettingsReady = false;
    setStatus(speechSettingsStatus, `Could not load voice settings: ${error.message}`, true);
  } finally {
    setSpeechSettingsPending(false);
  }
}

async function saveSpeechSettings() {
  if (!speechSettingsReady || speechSettingsPending || !speechVoiceSelect.value) return;

  const requestedVoiceId = speechVoiceSelect.value;
  setSpeechSettingsPending(true);
  setStatus(speechSettingsStatus, "Saving voice…");

  try {
    const payload = await api("./api/admin/settings/speech", {
      method: "PUT",
      body: JSON.stringify({ voiceId: requestedVoiceId }),
    });
    const savedVoiceId = payload.setting?.voiceId || payload.voiceId || requestedVoiceId;
    const hasSavedVoice = Array.from(speechVoiceSelect.options)
      .some((option) => option.value === savedVoiceId);
    if (hasSavedVoice) speechVoiceSelect.value = savedVoiceId;
    savedSpeechVoiceId = speechVoiceSelect.value;
    updateSpeechVoiceDescription();
    const selectedLabel = speechVoiceSelect.selectedOptions[0]?.textContent || savedSpeechVoiceId;
    setStatus(speechSettingsStatus, `Pronunciation voice changed to ${selectedLabel}.`);
  } catch (error) {
    setStatus(speechSettingsStatus, `Could not save voice: ${error.message}`, true);
  } finally {
    setSpeechSettingsPending(false);
  }
}

function getParagraphs(value) {
  return String(value)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function questionFromCard(card) {
  return {
    prompt: card.querySelector('[name="prompt"]').value.trim(),
    correct: card.querySelector('[name="correct"]').value.trim(),
    wrong: [1, 2, 3].map((position) =>
      card.querySelector(`[name="wrong-${position}"]`).value.trim()
    ),
  };
}

function getQuestions() {
  return Array.from(questionsEditor.querySelectorAll(".admin-question-card")).map(questionFromCard);
}

function getEditorPayload() {
  return {
    level: editorForm.elements.level.value,
    title: editorForm.elements.title.value.trim(),
    paragraphs: getParagraphs(editorForm.elements.paragraphs.value),
    questions: getQuestions(),
    showWordCount: editorForm.elements.showWordCount.checked,
  };
}

function editorFingerprint() {
  return JSON.stringify({
    level: editorForm.elements.level.value,
    title: editorForm.elements.title.value,
    paragraphs: editorForm.elements.paragraphs.value,
    questions: getQuestions(),
    showWordCount: editorForm.elements.showWordCount.checked,
  });
}

function isDirty() {
  return editorFingerprint() !== cleanFingerprint;
}

function updateDirtyState() {
  const dirty = isDirty();
  editorForm.classList.toggle("is-dirty", dirty);
  saveState.textContent = dirty ? "Unsaved changes" : cleanStateMessage;
  saveState.classList.toggle("is-dirty", dirty);
  saveDraftButton.disabled = requestPending || !dirty;
}

function markClean(message = "No unsaved changes") {
  cleanFingerprint = editorFingerprint();
  cleanStateMessage = message;
  updateDirtyState();
}

function confirmDiscard() {
  return !isDirty() || window.confirm("Discard your unsaved changes?");
}

function setPending(pending, message = "") {
  requestPending = pending;
  editorCard.setAttribute("aria-busy", String(pending));
  [saveDraftButton, publishButton, unpublishButton].forEach((button) => {
    button.disabled = pending;
  });
  if (message) saveState.textContent = message;
  if (!pending) updateDirtyState();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }

  return payload;
}

async function offerToSaveCredentials(email, password) {
  if (!("credentials" in navigator) || !("PasswordCredential" in window)) return;

  try {
    await navigator.credentials.store(new PasswordCredential({ id: email, name: email, password }));
  } catch {
    // Credential storage is optional and controlled by the browser.
  }
}

function sortSummaries() {
  summaries.sort((left, right) =>
    left.level.localeCompare(right.level) || left.sortOrder - right.sortOrder
  );
}

function filteredSummaries() {
  const query = storySearch.value.trim().toLocaleLowerCase();
  return summaries.filter((story) => {
    const matchesQuery = !query || `${story.title} ${story.storyId}`.toLocaleLowerCase().includes(query);
    const matchesLevel = levelFilter.value === "all" || story.level === levelFilter.value;
    const matchesStatus = statusFilter.value === "all" || story.publicationStatus === statusFilter.value;
    return matchesQuery && matchesLevel && matchesStatus;
  });
}

function renderStoryList() {
  const visibleStories = filteredSummaries();
  textsList.innerHTML = "";
  textCount.textContent = visibleStories.length === summaries.length
    ? `${summaries.length} total`
    : `${visibleStories.length} of ${summaries.length}`;

  if (!visibleStories.length) {
    textsList.innerHTML = '<p class="admin-empty-state">No stories match these filters.</p>';
    return;
  }

  visibleStories.forEach((story) => {
    const button = document.createElement("button");
    const label = STATUS_LABELS[story.publicationStatus] || story.publicationStatus;
    button.type = "button";
    button.className = "admin-text-row";
    button.classList.toggle("is-active", story.storyId === selectedStoryId);
    button.innerHTML = `
      <span class="admin-text-row-copy">
        <strong>${escapeHtml(story.level)} · ID ${story.storyId}</strong>
        <span>${escapeHtml(story.title)}</span>
      </span>
      <span class="admin-pill is-${escapeHtml(story.publicationStatus)}">${escapeHtml(label)}</span>
    `;
    button.addEventListener("click", async () => {
      if (story.storyId === selectedStoryId || !confirmDiscard()) return;
      await loadStory(story.storyId);
    });
    textsList.appendChild(button);
  });
}

function validateQuestionCard(card, showError = false) {
  const question = questionFromCard(card);
  const fields = Array.from(card.querySelectorAll("textarea, input"));
  fields.forEach((field) => field.setCustomValidity(""));

  let message = "";
  if (!question.prompt || !question.correct || question.wrong.some((answer) => !answer)) {
    message = "Complete the prompt and all four answers.";
  } else {
    const normalized = [question.correct, ...question.wrong].map((answer) => answer.toLocaleLowerCase());
    if (new Set(normalized).size !== 4) message = "All four answers must be distinct.";
  }

  if (message) fields[0].setCustomValidity(message);
  const error = card.querySelector(".admin-question-error");
  error.textContent = showError || (message && fields.every((field) => field.value.trim())) ? message : "";
  card.classList.toggle("has-error", Boolean(error.textContent));
  return !message;
}

function updateQuestionCards() {
  Array.from(questionsEditor.querySelectorAll(".admin-question-card")).forEach((card, index, cards) => {
    const question = questionFromCard(card);
    card.querySelector(".admin-question-number").textContent = `Question ${index + 1}`;
    card.querySelector(".admin-question-summary-prompt").textContent = question.prompt || "Untitled question";
    card.querySelector('[data-action="up"]').disabled = index === 0;
    card.querySelector('[data-action="down"]').disabled = index === cards.length - 1;
  });
}

function createQuestionEditor(question = {}, { open = true } = {}) {
  const card = document.createElement("details");
  card.className = "admin-question-card";
  card.open = open;
  card.innerHTML = `
    <summary>
      <span class="admin-question-number">Question</span>
      <span class="admin-question-summary-prompt">${escapeHtml(question.prompt || "Untitled question")}</span>
    </summary>
    <div class="admin-question-card-body">
      <div class="admin-question-actions" aria-label="Question actions">
        <button type="button" data-action="up" aria-label="Move question up">↑ Move up</button>
        <button type="button" data-action="down" aria-label="Move question down">↓ Move down</button>
        <button type="button" data-action="duplicate">Duplicate</button>
        <button class="admin-question-remove" type="button" data-action="remove">Remove</button>
      </div>
      <label>
        <span>Prompt</span>
        <textarea name="prompt" rows="3" required>${escapeHtml(question.prompt || "")}</textarea>
      </label>
      <div class="admin-question-grid">
        <label><span>Correct answer</span><input name="correct" type="text" value="${escapeHtml(question.correct || "")}" required /></label>
        <label><span>Wrong answer 1</span><input name="wrong-1" type="text" value="${escapeHtml(question.wrong?.[0] || "")}" required /></label>
        <label><span>Wrong answer 2</span><input name="wrong-2" type="text" value="${escapeHtml(question.wrong?.[1] || "")}" required /></label>
        <label><span>Wrong answer 3</span><input name="wrong-3" type="text" value="${escapeHtml(question.wrong?.[2] || "")}" required /></label>
      </div>
      <p class="admin-question-error" aria-live="polite"></p>
    </div>
  `;

  card.addEventListener("input", () => {
    validateQuestionCard(card);
    updateQuestionCards();
    updateDirtyState();
  });

  card.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    const action = actionButton.dataset.action;

    if (action === "up" && card.previousElementSibling) {
      questionsEditor.insertBefore(card, card.previousElementSibling);
    } else if (action === "down" && card.nextElementSibling) {
      questionsEditor.insertBefore(card.nextElementSibling, card);
    } else if (action === "duplicate") {
      const duplicate = createQuestionEditor(questionFromCard(card));
      card.after(duplicate);
      duplicate.querySelector('[name="prompt"]').focus();
    } else if (action === "remove") {
      removedQuestion = {
        question: questionFromCard(card),
        index: Array.from(questionsEditor.children).indexOf(card),
      };
      card.remove();
      undoBar.hidden = false;
    }

    updateQuestionCards();
    updateDirtyState();
  });

  return card;
}

function renderQuestions(questions = []) {
  questionsEditor.innerHTML = "";
  questions.forEach((question, index) => {
    questionsEditor.appendChild(createQuestionEditor(question, { open: index === 0 }));
  });
  removedQuestion = null;
  undoBar.hidden = true;
  updateQuestionCards();
}

function validateEditor() {
  let questionsValid = true;
  questionsEditor.querySelectorAll(".admin-question-card").forEach((card) => {
    if (!validateQuestionCard(card, true)) {
      questionsValid = false;
      card.open = true;
    }
  });

  if (!editorForm.checkValidity() || !questionsValid) {
    editorForm.reportValidity();
    setStatus(editorStatus, "Please fix the highlighted fields before continuing.", true);
    return false;
  }

  return true;
}

function updateEditorControls() {
  const canPublish = hasPermission("publish");
  const active = Boolean(currentStory?.active);
  publishButton.hidden = !canPublish;
  unpublishButton.hidden = !canPublish || editorMode === "create" || !active;
  publishButton.textContent = active ? "Publish changes" : "Publish";
  refreshHistoryButton.hidden = editorMode === "create";
}

function setStoryStatus(status) {
  storyStatus.className = `admin-story-status is-${status}`;
  storyStatus.textContent = STATUS_LABELS[status] || status;
}

function populateEditor(story) {
  currentStory = story;
  editorMode = "edit";
  selectedStoryId = story.storyId;
  editorForm.dataset.storyId = String(story.storyId);
  editorForm.elements.level.value = story.level;
  editorForm.elements.storyId.value = story.storyId;
  editorForm.elements.title.value = story.title;
  editorForm.elements.paragraphs.value = story.paragraphs.join("\n\n");
  editorForm.elements.showWordCount.checked = story.showWordCount;
  renderQuestions(story.questions || []);
  editorKicker.textContent = "Selected story";
  editorTitle.textContent = "Edit story";
  storyIdField.hidden = false;
  setStoryStatus(story.publicationStatus);
  editorAttribution.textContent = story.hasDraft
    ? `Draft saved ${formatDate(story.draftUpdatedAt)}${story.draftUpdatedByEmail ? ` by ${story.draftUpdatedByEmail}` : ""}`
    : story.updatedAt
      ? `Last published change ${formatDate(story.updatedAt)}${story.updatedByEmail ? ` by ${story.updatedByEmail}` : ""}`
      : "";
  setStatus(editorStatus, "");
  markClean(story.hasDraft ? `Draft saved ${formatDate(story.draftUpdatedAt)}` : "No unsaved changes");
  updateEditorControls();
  renderStoryList();
  updateUrl(story.storyId);
}

function enterCreateMode() {
  if (!confirmDiscard()) return;
  currentStory = null;
  selectedStoryId = null;
  editorMode = "create";
  editorForm.reset();
  editorForm.dataset.storyId = "";
  editorForm.elements.level.value = "A1";
  editorForm.elements.showWordCount.checked = true;
  renderQuestions([]);
  editorKicker.textContent = "New story";
  editorTitle.textContent = "Add story";
  storyIdField.hidden = true;
  editorAttribution.textContent = "Save a draft before publishing.";
  setStoryStatus("draft");
  historyList.innerHTML = '<p class="admin-empty-state">Revision history starts after the first publish.</p>';
  setStatus(editorStatus, "");
  markClean();
  updateEditorControls();
  renderStoryList();
  updateUrl(null);
  editorForm.elements.title.focus();
}

function updateUrl(storyId) {
  const url = new URL(window.location.href);
  if (storyId) url.searchParams.set("story", String(storyId));
  else url.searchParams.delete("story");
  window.history.replaceState({}, "", url);
}

async function loadSummaries() {
  const payload = await api("./api/admin/texts", { method: "GET" });
  summaries = payload.stories;
  sortSummaries();
  renderStoryList();
}

async function loadStory(storyId) {
  editorCard.setAttribute("aria-busy", "true");
  setStatus(editorStatus, "Loading story…");

  try {
    const payload = await api(`./api/admin/texts/${storyId}`, { method: "GET" });
    populateEditor(payload.story);
    await loadHistory();
  } catch (error) {
    setStatus(editorStatus, `Could not load story: ${error.message}`, true);
  } finally {
    editorCard.setAttribute("aria-busy", "false");
  }
}

function renderHistory(revisions) {
  if (!revisions.length) {
    historyList.innerHTML = '<p class="admin-empty-state">No checkpoints yet. The first is created when this story changes publication state.</p>';
    return;
  }

  historyList.innerHTML = "";
  revisions.forEach((revision) => {
    const row = document.createElement("div");
    row.className = "admin-history-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(revision.title)}</strong>
        <span>${escapeHtml(revision.level || "")} · ${revision.active ? "Published" : "Unpublished"}</span>
        <small>${escapeHtml(formatDate(revision.createdAt))} by ${escapeHtml(revision.createdByEmail)}</small>
      </div>
    `;

    if (hasPermission("restore")) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "admin-text-action";
      button.textContent = "Restore";
      button.setAttribute(
        "aria-label",
        `Restore ${revision.title} from ${formatDate(revision.createdAt)}`
      );
      button.addEventListener("click", () => restoreRevision(revision.revisionId));
      row.appendChild(button);
    }
    historyList.appendChild(row);
  });
}

async function loadHistory() {
  if (!selectedStoryId) return;
  historyList.innerHTML = '<p class="admin-empty-state">Loading history…</p>';
  try {
    const payload = await api(`./api/admin/texts/${selectedStoryId}/revisions`, { method: "GET" });
    renderHistory(payload.revisions);
  } catch (error) {
    historyList.innerHTML = `<p class="admin-empty-state is-error">${escapeHtml(error.message)}</p>`;
  }
}

async function saveDraft({ quiet = false } = {}) {
  if (!validateEditor()) return null;
  setPending(true, "Saving draft…");
  setStatus(editorStatus, "");

  try {
    const isCreating = editorMode === "create";
    const storyId = Number(editorForm.dataset.storyId);
    const payload = await api(isCreating ? "./api/admin/texts" : `./api/admin/texts/${storyId}`, {
      method: isCreating ? "POST" : "PUT",
      body: JSON.stringify(getEditorPayload()),
    });
    populateEditor(payload.story);
    cleanStateMessage = `Draft saved ${formatDate(payload.story.draftUpdatedAt)}`;
    markClean(cleanStateMessage);
    await loadSummaries();
    if (!quiet) setStatus(editorStatus, "Draft saved. Learners still see the last published version.");
    return payload.story;
  } catch (error) {
    setStatus(editorStatus, error.message, true);
    return null;
  } finally {
    setPending(false);
  }
}

async function publishStory() {
  if (!validateEditor()) return;

  if (editorMode === "create") {
    const created = await saveDraft({ quiet: true });
    if (!created) return;
  }

  setPending(true, "Publishing…");
  setStatus(editorStatus, "");
  try {
    const payload = await api(`./api/admin/texts/${selectedStoryId}/publish`, {
      method: "POST",
      body: JSON.stringify(getEditorPayload()),
    });
    populateEditor(payload.story);
    markClean(`Published ${formatDate(payload.story.publishedAt)}`);
    await Promise.all([loadSummaries(), loadHistory()]);
    setStatus(editorStatus, "Published. This version is now visible to learners.");
  } catch (error) {
    setStatus(editorStatus, error.message, true);
  } finally {
    setPending(false);
  }
}

async function unpublishStory() {
  if (isDirty()) {
    const saved = await saveDraft({ quiet: true });
    if (!saved) return;
  }

  if (!window.confirm("Unpublish this story? Learners will no longer be able to open it.")) return;
  setPending(true, "Unpublishing…");
  try {
    const payload = await api(`./api/admin/texts/${selectedStoryId}/unpublish`, { method: "POST" });
    populateEditor(payload.story);
    await Promise.all([loadSummaries(), loadHistory()]);
    setStatus(editorStatus, "Story unpublished. Its content is retained in the editor.");
  } catch (error) {
    setStatus(editorStatus, error.message, true);
  } finally {
    setPending(false);
  }
}

async function restoreRevision(revisionId) {
  if (!confirmDiscard()) return;
  if (!window.confirm("Restore this checkpoint? The current version will be saved as another checkpoint first.")) return;

  setPending(true, "Restoring checkpoint…");
  try {
    const payload = await api(`./api/admin/texts/${selectedStoryId}/revisions/${revisionId}/restore`, {
      method: "POST",
    });
    populateEditor(payload.story);
    await Promise.all([loadSummaries(), loadHistory()]);
    setStatus(editorStatus, "Checkpoint restored.");
  } catch (error) {
    setStatus(editorStatus, error.message, true);
  } finally {
    setPending(false);
  }
}

function openPreview() {
  const payload = getEditorPayload();
  previewTitle.textContent = payload.title || "Untitled story";
  previewStory.innerHTML = payload.paragraphs.length
    ? payload.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")
    : '<p class="admin-empty-state">Add story text to preview it.</p>';
  previewQuiz.innerHTML = payload.questions.length
    ? `<h3>Quiz preview</h3>${payload.questions.map((question, index) => `
        <section><strong>${index + 1}. ${escapeHtml(question.prompt || "Untitled question")}</strong>
        <ul>${[question.correct, ...question.wrong].map((answer) => `<li>${escapeHtml(answer || "Empty answer")}</li>`).join("")}</ul></section>
      `).join("")}`
    : "";
  previewDialog.showModal();
}

async function enterAdminPanel(user) {
  currentUser = user;
  loginSection.hidden = true;
  adminSection.hidden = false;
  userSummary.textContent = `${user.email} · ${user.role}`;
  addStoryButton.hidden = !hasPermission("edit");
  speechSettingsForm.hidden = !hasPermission("settings");
  if (hasPermission("settings")) void loadSpeechSettings();

  try {
    await loadSummaries();
    const requestedId = Number(new URL(window.location.href).searchParams.get("story"));
    const initialId = summaries.some((story) => story.storyId === requestedId)
      ? requestedId
      : summaries[0]?.storyId;
    if (initialId) await loadStory(initialId);
    else enterCreateMode();
  } catch (error) {
    setStatus(editorStatus, `Could not load stories: ${error.message}`, true);
  }
}

async function checkSession() {
  try {
    const payload = await api("./api/admin/session", { method: "GET" });
    await enterAdminPanel(payload.user);
  } catch {
    loginSection.hidden = false;
    adminSection.hidden = true;
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(loginStatus, "Signing in…");
  const email = loginForm.elements.email.value;
  const password = loginForm.elements.password.value;

  try {
    await api("./api/admin/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    await offerToSaveCredentials(email, password);
    loginForm.reset();
    const session = await api("./api/admin/session", { method: "GET" });
    setStatus(loginStatus, "");
    await enterAdminPanel(session.user);
  } catch (error) {
    setStatus(loginStatus, error.message, true);
  }
});

logoutButton.addEventListener("click", async () => {
  if (!confirmDiscard()) return;
  await api("./api/admin/logout", { method: "POST" });
  currentUser = null;
  loginSection.hidden = false;
  adminSection.hidden = true;
});

[storySearch, levelFilter, statusFilter].forEach((control) => {
  control.addEventListener("input", renderStoryList);
  control.addEventListener("change", renderStoryList);
});

speechVoiceSelect.addEventListener("change", () => {
  updateSpeechVoiceDescription();
  updateSpeechSettingsControls();
  if (speechVoiceSelect.value !== savedSpeechVoiceId) {
    setStatus(speechSettingsStatus, "Voice change not saved yet.");
  } else {
    const selectedLabel = speechVoiceSelect.selectedOptions[0]?.textContent || savedSpeechVoiceId;
    setStatus(speechSettingsStatus, `Current voice: ${selectedLabel}.`);
  }
});
speechSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveSpeechSettings();
});

addStoryButton.addEventListener("click", enterCreateMode);
editorForm.addEventListener("input", updateDirtyState);
editorForm.addEventListener("change", updateDirtyState);
editorForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveDraft();
});

addQuestionButton.addEventListener("click", () => {
  const card = createQuestionEditor();
  questionsEditor.appendChild(card);
  updateQuestionCards();
  updateDirtyState();
  card.querySelector('[name="prompt"]').focus();
});

undoQuestionButton.addEventListener("click", () => {
  if (!removedQuestion) return;
  const card = createQuestionEditor(removedQuestion.question);
  const before = questionsEditor.children[removedQuestion.index] || null;
  questionsEditor.insertBefore(card, before);
  removedQuestion = null;
  undoBar.hidden = true;
  updateQuestionCards();
  updateDirtyState();
});

previewButton.addEventListener("click", openPreview);
closePreviewButton.addEventListener("click", () => previewDialog.close());
previewDialog.addEventListener("click", (event) => {
  if (event.target === previewDialog) previewDialog.close();
});
publishButton.addEventListener("click", publishStory);
unpublishButton.addEventListener("click", unpublishStory);
refreshHistoryButton.addEventListener("click", loadHistory);

window.addEventListener("beforeunload", (event) => {
  if (!isDirty()) return;
  event.preventDefault();
  event.returnValue = "";
});

checkSession();
