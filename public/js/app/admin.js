const byId = (id) => document.getElementById(id);

const loginSection = byId("loginSection");
const adminSection = byId("adminSection");
const loginForm = byId("loginForm");
const loginStatus = byId("loginStatus");
const logoutButton = byId("logoutButton");
const userSummary = byId("userSummary");
const databaseVersion = byId("databaseVersion");
const speechSettingsForm = byId("speechSettingsForm");
const speechEnabledCheckbox = byId("speechEnabledCheckbox");
const speechVoiceSelect = byId("speechVoiceSelect");
const speechVoiceDescription = byId("speechVoiceDescription");
const saveSpeechSettingsButton = byId("saveSpeechSettingsButton");
const speechSettingsStatus = byId("speechSettingsStatus");
const speechVoiceLibrary = byId("speechVoiceLibrary");
const speechVoiceList = byId("speechVoiceList");
const speechPreviewText = byId("speechPreviewText");
const speechVoiceLibraryStatus = byId("speechVoiceLibraryStatus");
const speechVoiceFilterButtons = Array.from(speechVoiceLibrary.querySelectorAll("[data-voice-filter]"));
const dictionarySettingsSection = byId("dictionarySettingsSection");
const dictionaryPairs = byId("dictionaryPairs");
const dictionarySettingsStatus = byId("dictionarySettingsStatus");
const dictionaryReviewSection = byId("dictionaryReviewSection");
const refreshDictionarySuggestionsButton = byId("refreshDictionarySuggestionsButton");
const dictionarySuggestionsList = byId("dictionarySuggestionsList");
const dictionaryReportsSection = byId("dictionaryReportsSection");
const dictionaryReportsList = byId("dictionaryReportsList");
const refreshDictionaryReportsButton = byId("refreshDictionaryReportsButton");
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
const dictionaryCoveragePanel = byId("dictionaryCoveragePanel");
const checkDictionaryCoverageButton = byId("checkDictionaryCoverageButton");
const dictionaryCoverageStatus = byId("dictionaryCoverageStatus");
const dictionaryMissingList = byId("dictionaryMissingList");
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
const dictionarySuggestionDialog = byId("dictionarySuggestionDialog");
const dictionarySuggestionForm = byId("dictionarySuggestionForm");
const closeDictionarySuggestionButton = byId("closeDictionarySuggestionButton");
const dictionarySuggestionStatus = byId("dictionarySuggestionStatus");
const suggestDictionaryWordButton = byId("suggestDictionaryWordButton");

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
let savedSpeechEnabled = false;
let speechVoices = [];
let speechVoiceFilter = "all";
let pendingVoiceOptionId = "";
// Preview audio by voice and phrase, so replaying a voice costs no new request.
const speechPreviewUrls = new Map();
let speechPreviewAudio = null;
let speechPreviewVoiceId = "";
let speechPreviewToken = 0;
let dictionarySettingsPending = false;
let dictionaryCoveragePending = false;

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

function setCoverageStatus(message, incomplete = false) {
  setStatus(dictionaryCoverageStatus, message);
  dictionaryCoverageStatus.classList.toggle("is-warning", incomplete);
  if (incomplete) dictionaryCoverageStatus.classList.remove("is-success");
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? String(value)
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

// D1 records applied_at as "YYYY-MM-DD HH:MM:SS" in UTC.
function formatMigrationDate(migration) {
  const appliedAt = new Date(`${String(migration?.appliedAt).replace(" ", "T")}Z`);
  return Number.isNaN(appliedAt.valueOf())
    ? ""
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(appliedAt);
}

function describeMigration(migration) {
  const appliedAt = formatMigrationDate(migration);
  return appliedAt ? `${migration.name}, applied ${appliedAt}` : migration.name;
}

function renderDatabaseVersion(database) {
  databaseVersion.hidden = !database?.latest;
  if (!database?.latest) return;
  const appliedAt = formatMigrationDate(database.latest);
  databaseVersion.textContent = `Database version ${database.latest.number}${appliedAt ? ` · applied ${appliedAt}` : ""}`;
  databaseVersion.title = `${database.latest.name} · ${database.count} migrations applied`;
}

function hasPermission(permission) {
  return currentUser?.permissions?.includes(permission) || false;
}

function updateSpeechVoiceDescription() {
  const selectedOption = speechVoiceSelect.selectedOptions[0];
  speechVoiceDescription.textContent = selectedOption?.dataset.description || "";
}

function speechSettingsAreDirty() {
  return speechVoiceSelect.value !== savedSpeechVoiceId
    || speechEnabledCheckbox.checked !== savedSpeechEnabled;
}

function currentSpeechSettingsStatus() {
  if (!savedSpeechEnabled) {
    return "Pronunciation is off for learners.";
  }

  const selectedLabel = speechVoiceSelect.selectedOptions[0]?.textContent || savedSpeechVoiceId;
  return `Pronunciation is on. Current voice: ${selectedLabel}.`;
}

function updateSpeechSettingsControls() {
  speechEnabledCheckbox.disabled = speechSettingsPending || !speechSettingsReady;
  speechVoiceSelect.disabled = speechSettingsPending
    || !speechSettingsReady
    || !speechEnabledCheckbox.checked;
  saveSpeechSettingsButton.disabled = speechSettingsPending
    || !speechSettingsReady
    || !speechVoiceSelect.value
    || !speechSettingsAreDirty();
}

function setSpeechSettingsPending(pending) {
  speechSettingsPending = pending;
  speechSettingsForm.setAttribute("aria-busy", String(pending));
  updateSpeechSettingsControls();
}

const SPEECH_GENDER_LABELS = { female: "Female", male: "Male" };

function describeSpeechVoice(voice) {
  return [SPEECH_GENDER_LABELS[voice.gender], voice.family].filter(Boolean).join(" · ");
}

// The site voice can only be one of the enabled voices.
function populateSpeechVoices(voices, selectedVoiceId) {
  speechVoiceSelect.replaceChildren();

  voices.filter((voice) => voice.enabled).forEach((voice) => {
    const option = document.createElement("option");
    option.value = voice.id;
    option.textContent = voice.label;
    option.dataset.description = describeSpeechVoice(voice);
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

function speechVoiceMatchesFilter(voice) {
  if (speechVoiceFilter === "enabled") return voice.enabled;
  if (speechVoiceFilter === "female" || speechVoiceFilter === "male") return voice.gender === speechVoiceFilter;
  return true;
}

function renderSpeechVoiceLibrary() {
  speechVoiceLibrary.hidden = !speechVoices.length;
  speechVoiceFilterButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.voiceFilter === speechVoiceFilter));
  });

  const visibleVoices = speechVoices.filter(speechVoiceMatchesFilter);
  speechVoiceList.replaceChildren(...visibleVoices.map((voice) => {
    const row = document.createElement("li");
    row.className = "admin-voice-row";
    row.classList.toggle("is-enabled", voice.enabled);

    const playing = speechPreviewVoiceId === voice.id;
    const play = document.createElement("button");
    play.type = "button";
    play.className = "admin-voice-play";
    play.dataset.voicePreview = voice.id;
    play.textContent = playing ? "■" : "▶";
    play.setAttribute("aria-label", `${playing ? "Stop" : "Play"} ${voice.label}`);
    play.setAttribute("aria-pressed", String(playing));

    const copy = document.createElement("div");
    copy.className = "admin-voice-copy";
    const name = document.createElement("strong");
    name.textContent = voice.label;
    const meta = document.createElement("span");
    meta.textContent = describeSpeechVoice(voice);
    copy.append(name, meta);

    row.append(play, copy);

    // The site voice stays enabled, so it shows a badge instead of a checkbox.
    if (voice.site) {
      const pill = document.createElement("span");
      pill.className = "admin-voice-site";
      pill.textContent = "Site voice";
      pill.title = "Choose another site voice before disabling this one.";
      row.appendChild(pill);
    } else {
      const toggle = document.createElement("label");
      toggle.className = "admin-voice-toggle";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = voice.enabled;
      checkbox.dataset.voiceOption = voice.id;
      checkbox.disabled = Boolean(pendingVoiceOptionId);
      const toggleLabel = document.createElement("span");
      toggleLabel.textContent = "Enabled";
      toggle.append(checkbox, toggleLabel);
      row.appendChild(toggle);
    }

    return row;
  }));

  if (!visibleVoices.length && speechVoices.length) {
    const empty = document.createElement("li");
    empty.className = "admin-voice-empty";
    empty.textContent = "No voices match this filter.";
    speechVoiceList.appendChild(empty);
  }
}

function applySpeechSettingsPayload(payload) {
  speechVoices = Array.isArray(payload.voices) ? payload.voices : [];
  const selectedVoiceId = payload.setting?.voiceId || "";
  populateSpeechVoices(speechVoices, selectedVoiceId);
  speechEnabledCheckbox.checked = payload.setting?.enabled === true;
  savedSpeechVoiceId = speechVoiceSelect.value;
  savedSpeechEnabled = speechEnabledCheckbox.checked;
  renderSpeechVoiceLibrary();
  setStatus(speechVoiceLibraryStatus, payload.catalogError || "", Boolean(payload.catalogError));
}

async function loadSpeechSettings() {
  if (!hasPermission("settings")) {
    speechSettingsForm.hidden = true;
    return;
  }

  speechSettingsForm.hidden = false;
  speechSettingsReady = false;
  setSpeechSettingsPending(true);
  setStatus(speechSettingsStatus, "Loading audio settings…");

  try {
    applySpeechSettingsPayload(await api("./api/admin/settings/speech", { method: "GET" }));
    speechSettingsReady = true;
    setStatus(speechSettingsStatus, currentSpeechSettingsStatus());
  } catch (error) {
    speechSettingsReady = false;
    setStatus(speechSettingsStatus, `Could not load audio settings: ${error.message}`, true);
  } finally {
    setSpeechSettingsPending(false);
  }
}

async function saveSpeechSettings() {
  if (!speechSettingsReady || speechSettingsPending || !speechVoiceSelect.value) return;

  const requestedVoiceId = speechVoiceSelect.value;
  const requestedEnabled = speechEnabledCheckbox.checked;
  setSpeechSettingsPending(true);
  setStatus(speechSettingsStatus, "Saving audio settings…");

  try {
    applySpeechSettingsPayload(await api("./api/admin/settings/speech", {
      method: "PUT",
      body: JSON.stringify({ voiceId: requestedVoiceId, enabled: requestedEnabled }),
    }));
    setStatus(speechSettingsStatus, currentSpeechSettingsStatus());
  } catch (error) {
    setStatus(speechSettingsStatus, `Could not save audio settings: ${error.message}`, true);
  } finally {
    setSpeechSettingsPending(false);
  }
}

async function saveSpeechVoiceOption(voiceId, enabled) {
  if (pendingVoiceOptionId) return;

  const voice = speechVoices.find((item) => item.id === voiceId);
  const unsavedVoiceId = speechVoiceSelect.value;
  pendingVoiceOptionId = voiceId;
  renderSpeechVoiceLibrary();
  setStatus(speechVoiceLibraryStatus, `${enabled ? "Enabling" : "Disabling"} ${voice?.label || voiceId}…`);

  try {
    applySpeechSettingsPayload(await api("./api/admin/settings/speech/voices", {
      method: "PUT",
      body: JSON.stringify({ voiceId, enabled }),
    }));
    // Keep an unsaved site-voice choice if that voice is still enabled.
    if (Array.from(speechVoiceSelect.options).some((option) => option.value === unsavedVoiceId)) {
      speechVoiceSelect.value = unsavedVoiceId;
      updateSpeechVoiceDescription();
    }
    updateSpeechSettingsControls();
    setStatus(
      speechVoiceLibraryStatus,
      `${voice?.label || voiceId} is ${enabled ? "enabled and can be chosen as the site voice" : "disabled"}.`
    );
  } catch (error) {
    setStatus(speechVoiceLibraryStatus, `Could not update ${voice?.label || voiceId}: ${error.message}`, true);
  } finally {
    pendingVoiceOptionId = "";
    renderSpeechVoiceLibrary();
  }
}

function stopSpeechPreview() {
  speechPreviewToken += 1;
  speechPreviewAudio?.pause();
  speechPreviewAudio = null;
  speechPreviewVoiceId = "";
  renderSpeechVoiceLibrary();
}

async function playSpeechPreview(voiceId) {
  if (speechPreviewVoiceId === voiceId) {
    stopSpeechPreview();
    return;
  }

  stopSpeechPreview();
  const text = speechPreviewText.value.trim();
  if (!text) {
    setStatus(speechVoiceLibraryStatus, "Type a test phrase first.", true);
    return;
  }

  const token = speechPreviewToken;
  const voice = speechVoices.find((item) => item.id === voiceId);
  speechPreviewVoiceId = voiceId;
  renderSpeechVoiceLibrary();

  try {
    const cacheKey = `${voiceId}\u0000${text}`;
    let url = speechPreviewUrls.get(cacheKey);
    if (!url) {
      setStatus(speechVoiceLibraryStatus, `Loading ${voice?.label || voiceId}…`);
      const response = await fetch("./api/admin/settings/speech/preview", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voiceId, text }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `Request failed with status ${response.status}`);
      }
      url = URL.createObjectURL(await response.blob());
      speechPreviewUrls.set(cacheKey, url);
    }
    if (token !== speechPreviewToken) return;

    const audio = new Audio(url);
    speechPreviewAudio = audio;
    audio.addEventListener("ended", () => {
      if (speechPreviewAudio === audio) stopSpeechPreview();
    });
    setStatus(speechVoiceLibraryStatus, `Playing ${voice?.label || voiceId}.`);
    await audio.play();
  } catch (error) {
    if (token !== speechPreviewToken) return;
    stopSpeechPreview();
    setStatus(speechVoiceLibraryStatus, `Could not play ${voice?.label || voiceId}: ${error.message}`, true);
  }
}

// The GitHub workflow that builds a reviewed update branch for one language.
const DICTIONARY_UPDATE_WORKFLOW_URL =
  "https://github.com/somewordshere/ReadUkrainian/actions/workflows/dictionary-update.yml";
const DICTIONARY_LANGUAGE_NAMES = { en: "English", de: "German" };
let dictionaryPairState = [];

function dictionaryUpdateAvailable(pair) {
  return Boolean(pair?.currentRevision && pair?.availableRevision && pair.availableRevision > pair.currentRevision);
}

function renderDictionaryPairs(pairs) {
  dictionaryPairState = pairs;
  dictionaryPairs.replaceChildren();
  const canCheck = hasPermission("settings");

  pairs.forEach((pair) => {
    const language = DICTIONARY_LANGUAGE_NAMES[pair.targetLanguage] || pair.targetLanguage;
    const updateAvailable = dictionaryUpdateAvailable(pair);
    const row = document.createElement("div");
    row.className = "admin-dictionary-pair";

    const name = document.createElement("h3");
    name.textContent = `Ukrainian → ${language}`;

    const versions = document.createElement("dl");
    versions.className = "admin-dictionary-version";
    [
      ["Installed", pair.currentRevision || "Unavailable"],
      ["Migration", pair.migration?.number || "Unknown", pair.migration && describeMigration(pair.migration)],
      ["Available", pair.availableRevision || "Not checked"],
      ["Last checked", pair.lastCheckedAt ? formatDate(pair.lastCheckedAt) : "Never"],
    ].forEach(([label, value, title]) => {
      const item = document.createElement("div");
      const term = document.createElement("dt");
      const detail = document.createElement("dd");
      term.textContent = label;
      detail.textContent = value;
      if (title) item.title = title;
      item.append(term, detail);
      versions.appendChild(item);
    });

    const note = document.createElement("p");
    note.className = "admin-dictionary-pair-note";
    note.textContent = updateAvailable
      ? `A newer source (${pair.availableRevision}) is available. Reviewed entries were not changed.`
      : pair.availableRevision
        ? "The installed source is current."
        : "Not compared with Kaikki.org yet.";

    const actions = document.createElement("div");
    actions.className = "admin-dictionary-pair-actions";
    if (canCheck) {
      const check = document.createElement("button");
      check.type = "button";
      check.className = "admin-secondary-button";
      check.textContent = "Check for update";
      check.disabled = dictionarySettingsPending;
      check.addEventListener("click", () => void checkDictionaryUpdate(pair.targetLanguage));

      // Building runs on GitHub, where "Run workflow" asks for the language.
      const prepare = document.createElement("a");
      prepare.className = updateAvailable ? "admin-primary-button" : "admin-secondary-button";
      prepare.href = DICTIONARY_UPDATE_WORKFLOW_URL;
      prepare.target = "_blank";
      prepare.rel = "noopener noreferrer";
      prepare.textContent = "Prepare update";
      prepare.title = `Opens GitHub: choose Run workflow, then “${pair.targetLanguage}”.`;
      actions.append(check, prepare);
    }

    row.append(name, versions, note, actions);
    dictionaryPairs.appendChild(row);
  });
}

function renderDictionarySuggestions(suggestions) {
  dictionarySuggestionsList.replaceChildren();
  if (!suggestions.length) {
    const empty = document.createElement("p");
    empty.className = "admin-empty-state";
    empty.textContent = "No suggestions are waiting for review.";
    dictionarySuggestionsList.appendChild(empty);
    return;
  }

  suggestions.forEach((suggestion) => {
    const row = document.createElement("div");
    row.className = "admin-dictionary-suggestion-row";
    const copy = document.createElement("p");
    const word = document.createElement("strong");
    word.lang = "uk";
    word.textContent = suggestion.word;
    copy.append(
      word,
      ` → ${suggestion.translation} · lemma ${suggestion.lemma} · ${suggestion.partOfSpeech}`,
      document.createElement("br"),
      `Suggested by ${suggestion.suggestedByEmail} on ${formatDate(suggestion.suggestedAt)}`
    );

    const actions = document.createElement("div");
    actions.className = "admin-dictionary-review-actions";
    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "admin-primary-button";
    approve.textContent = "Approve";
    approve.addEventListener("click", () => {
      void reviewDictionarySuggestion(suggestion.suggestionId, "approve");
    });
    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "admin-secondary-button";
    reject.textContent = "Reject";
    reject.addEventListener("click", () => {
      void reviewDictionarySuggestion(suggestion.suggestionId, "reject");
    });
    actions.append(approve, reject);
    row.append(copy, actions);
    dictionarySuggestionsList.appendChild(row);
  });
}

async function loadDictionarySuggestions() {
  if (!hasPermission("dictionary_approve")) return;
  dictionarySuggestionsList.textContent = "Loading suggestions…";
  try {
    const payload = await api("./api/admin/dictionary/suggestions", { method: "GET" });
    renderDictionarySuggestions(Array.isArray(payload.suggestions) ? payload.suggestions : []);
  } catch (error) {
    dictionarySuggestionsList.textContent = `Could not load suggestions: ${error.message}`;
  }
}

async function loadDictionaryStatus() {
  if (!hasPermission("dictionary_suggest")) {
    dictionarySettingsSection.hidden = true;
    return;
  }
  dictionarySettingsSection.hidden = false;
  dictionaryReviewSection.hidden = !hasPermission("dictionary_approve");
  dictionaryReportsSection.hidden = !hasPermission("dictionary_approve");
  dictionarySettingsSection.setAttribute("aria-busy", "true");
  try {
    const payload = await api("./api/admin/dictionary/status", { method: "GET" });
    renderDatabaseVersion(payload.database);
    renderDictionaryPairs(Array.isArray(payload.dictionaries) ? payload.dictionaries : [payload.dictionary].filter(Boolean));
    if (hasPermission("dictionary_approve")) await Promise.all([loadDictionarySuggestions(), loadDictionaryReports()]);
  } catch (error) {
    setStatus(dictionarySettingsStatus, `Could not load dictionary status: ${error.message}`, true);
  } finally {
    dictionarySettingsSection.setAttribute("aria-busy", "false");
  }
}

async function checkDictionaryUpdate(targetLanguage) {
  if (dictionarySettingsPending || !hasPermission("settings")) return;
  const language = DICTIONARY_LANGUAGE_NAMES[targetLanguage] || targetLanguage;
  dictionarySettingsPending = true;
  renderDictionaryPairs(dictionaryPairState);
  dictionarySettingsSection.setAttribute("aria-busy", "true");
  setStatus(dictionarySettingsStatus, `Checking the ${language} source version on Kaikki.org…`);
  try {
    const payload = await api("./api/admin/dictionary/check-update", {
      method: "POST",
      body: JSON.stringify({ targetLanguage }),
    });
    dictionaryPairState = dictionaryPairState.map((pair) => (
      pair.targetLanguage === targetLanguage
        ? { ...pair, currentRevision: payload.currentRevision, availableRevision: payload.availableRevision, lastCheckedAt: payload.lastCheckedAt }
        : pair
    ));
    setStatus(dictionarySettingsStatus, payload.updateAvailable
      ? `${language}: version ${payload.availableRevision} is available. Use “Prepare update” to build it for review.`
      : `${language}: the installed source is current.`);
  } catch (error) {
    setStatus(dictionarySettingsStatus, `Could not check for an update: ${error.message}`, true);
  } finally {
    dictionarySettingsPending = false;
    renderDictionaryPairs(dictionaryPairState);
    dictionarySettingsSection.setAttribute("aria-busy", "false");
  }
}

function renderDictionaryReports(reports) {
  dictionaryReportsList.replaceChildren();
  if (!reports.length) {
    const empty = document.createElement("p");
    empty.className = "admin-empty-state";
    empty.textContent = "No open reports from learners.";
    dictionaryReportsList.appendChild(empty);
    return;
  }

  reports.forEach((report) => {
    const row = document.createElement("div");
    row.className = "admin-dictionary-suggestion-row";
    const copy = document.createElement("p");
    const word = document.createElement("strong");
    word.lang = "uk";
    word.textContent = report.word;
    const language = DICTIONARY_LANGUAGE_NAMES[report.targetLanguage] || report.targetLanguage;
    const shown = report.shown.length
      ? report.shown.map((entry) => `${entry.lemma} — ${entry.translations.join(", ")}`).join("; ")
      : "no translation";
    copy.append(
      word,
      ` · ${language} · ${report.reports} ${report.reports === 1 ? "report" : "reports"}`,
      report.storyTitle ? ` · «${report.storyTitle}»` : "",
      document.createElement("br"),
      `Learners saw: ${shown}`,
      document.createElement("br"),
      `Last reported ${formatDate(report.lastReportedAt)}`
    );

    const actions = document.createElement("div");
    actions.className = "admin-dictionary-review-actions";
    const suggest = document.createElement("button");
    suggest.type = "button";
    suggest.className = "admin-secondary-button";
    suggest.textContent = "Suggest a fix";
    suggest.addEventListener("click", () => openDictionarySuggestion(report.word));
    const fixed = document.createElement("button");
    fixed.type = "button";
    fixed.className = "admin-primary-button";
    fixed.textContent = "Mark fixed";
    fixed.addEventListener("click", () => void resolveDictionaryReport(report.reportId, "fixed"));
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "admin-secondary-button";
    dismiss.textContent = "Dismiss";
    dismiss.addEventListener("click", () => void resolveDictionaryReport(report.reportId, "dismissed"));
    actions.append(suggest, fixed, dismiss);
    row.append(copy, actions);
    dictionaryReportsList.appendChild(row);
  });
}

async function loadDictionaryReports() {
  if (!hasPermission("dictionary_approve")) return;
  dictionaryReportsList.textContent = "Loading reports…";
  try {
    const payload = await api("./api/admin/dictionary/reports", { method: "GET" });
    renderDictionaryReports(Array.isArray(payload.reports) ? payload.reports : []);
  } catch (error) {
    dictionaryReportsList.textContent = `Could not load reports: ${error.message}`;
  }
}

async function resolveDictionaryReport(reportId, status) {
  dictionarySettingsSection.setAttribute("aria-busy", "true");
  try {
    await api(`./api/admin/dictionary/reports/${reportId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
    setStatus(dictionarySettingsStatus, status === "fixed" ? "Report marked fixed." : "Report dismissed.");
    await loadDictionaryReports();
  } catch (error) {
    setStatus(dictionarySettingsStatus, `Could not update the report: ${error.message}`, true);
  } finally {
    dictionarySettingsSection.setAttribute("aria-busy", "false");
  }
}

async function reviewDictionarySuggestion(suggestionId, decision) {
  dictionarySettingsSection.setAttribute("aria-busy", "true");
  try {
    await api(`./api/admin/dictionary/suggestions/${suggestionId}/${decision}`, {
      method: "POST",
      body: JSON.stringify({ note: "" }),
    });
    setStatus(dictionarySettingsStatus, decision === "approve"
      ? "Dictionary suggestion approved."
      : "Dictionary suggestion rejected.");
    await loadDictionarySuggestions();
  } catch (error) {
    setStatus(dictionarySettingsStatus, `Could not review suggestion: ${error.message}`, true);
  } finally {
    dictionarySettingsSection.setAttribute("aria-busy", "false");
  }
}

// A word from a coverage row or report is fixed; without one the editor types any word.
function openDictionarySuggestion(word = "") {
  dictionarySuggestionForm.reset();
  const { word: wordField, lemma: lemmaField } = dictionarySuggestionForm.elements;
  wordField.value = word;
  wordField.readOnly = Boolean(word);
  lemmaField.value = word;
  delete lemmaField.dataset.followsWord;
  setStatus(dictionarySuggestionStatus, "");
  dictionarySuggestionDialog.showModal();
  (word ? lemmaField : wordField).focus();
}

function renderDictionaryCoverage(coverage) {
  dictionaryMissingList.replaceChildren();
  if (!coverage?.available) {
    dictionaryCoveragePanel.classList.add("is-incomplete");
    setCoverageStatus(coverage?.message || "Dictionary coverage could not be checked.", true);
    return;
  }

  const incomplete = coverage.missingCount > 0;
  dictionaryCoveragePanel.classList.toggle("is-incomplete", incomplete);
  setCoverageStatus(
    incomplete
      ? `${coverage.coveragePercent}% covered · ${coverage.missingCount} unique words need English translations. Publication is still allowed.`
      : `100% covered · all ${coverage.totalUniqueWords} unique words have English translations.`,
    incomplete
  );

  (coverage.missing || []).forEach(({ word, count }) => {
    const row = document.createElement("div");
    row.className = "admin-dictionary-missing-row";
    const copy = document.createElement("p");
    const strong = document.createElement("strong");
    strong.lang = "uk";
    strong.textContent = word;
    copy.append(strong, ` · ${count} occurrence${count === 1 ? "" : "s"}`);
    row.appendChild(copy);
    if (hasPermission("dictionary_suggest")) {
      const actions = document.createElement("div");
      actions.className = "admin-dictionary-missing-actions";
      const suggest = document.createElement("button");
      suggest.type = "button";
      suggest.className = "admin-secondary-button";
      suggest.textContent = "Suggest translation";
      suggest.addEventListener("click", () => openDictionarySuggestion(word));
      actions.appendChild(suggest);
      row.appendChild(actions);
    }
    dictionaryMissingList.appendChild(row);
  });
}

function resetDictionaryCoverage() {
  dictionaryCoveragePanel.classList.remove("is-incomplete");
  dictionaryMissingList.replaceChildren();
  setCoverageStatus("Not checked for this draft.");
}

async function checkDictionaryCoverage() {
  if (dictionaryCoveragePending) return;
  dictionaryCoveragePending = true;
  checkDictionaryCoverageButton.disabled = true;
  dictionaryCoveragePanel.setAttribute("aria-busy", "true");
  setCoverageStatus("Checking English translations…");
  try {
    const payload = await api("./api/admin/dictionary/coverage", {
      method: "POST",
      body: JSON.stringify({
        paragraphs: getEditorPayload().paragraphs,
        targetLanguage: "en",
      }),
    });
    renderDictionaryCoverage(payload.coverage);
  } catch (error) {
    renderDictionaryCoverage({ available: false, message: error.message });
  } finally {
    dictionaryCoveragePending = false;
    checkDictionaryCoverageButton.disabled = false;
    dictionaryCoveragePanel.setAttribute("aria-busy", "false");
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
  resetDictionaryCoverage();
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
  resetDictionaryCoverage();
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
    renderDictionaryCoverage(payload.dictionaryCoverage);
    markClean(`Published ${formatDate(payload.story.publishedAt)}`);
    await Promise.all([loadSummaries(), loadHistory()]);
    const coverageWarnings = (payload.dictionaryCoverages || [payload.dictionaryCoverage])
      .filter((coverage) => coverage?.missingCount > 0);
    setStatus(
      editorStatus,
      coverageWarnings.length
        ? `Published with dictionary warnings: ${coverageWarnings
            .map((coverage) => `${coverage.targetLanguage.toUpperCase()} ${coverage.missingCount} missing`)
            .join(" · ")}.`
        : "Published. This version is now visible to learners."
    );
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
  dictionaryCoveragePanel.hidden = !hasPermission("dictionary_suggest");

  try {
    await Promise.all([loadSummaries(), loadDictionaryStatus()]);
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
  setStatus(
    speechSettingsStatus,
    speechSettingsAreDirty() ? "Audio settings have unsaved changes." : currentSpeechSettingsStatus()
  );
});
speechEnabledCheckbox.addEventListener("change", () => {
  updateSpeechSettingsControls();
  setStatus(
    speechSettingsStatus,
    speechSettingsAreDirty() ? "Audio settings have unsaved changes." : currentSpeechSettingsStatus()
  );
});
speechSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveSpeechSettings();
});
speechVoiceList.addEventListener("click", (event) => {
  const play = event.target.closest("[data-voice-preview]");
  if (play) void playSpeechPreview(play.dataset.voicePreview);
});
speechVoiceList.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-voice-option]");
  if (checkbox) void saveSpeechVoiceOption(checkbox.dataset.voiceOption, checkbox.checked);
});
speechVoiceFilterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    speechVoiceFilter = button.dataset.voiceFilter;
    renderSpeechVoiceLibrary();
  });
});
// Enter in the test phrase plays nothing and must not save the settings form.
speechPreviewText.addEventListener("keydown", (event) => {
  if (event.key === "Enter") event.preventDefault();
});

refreshDictionarySuggestionsButton.addEventListener("click", () => void loadDictionarySuggestions());
refreshDictionaryReportsButton.addEventListener("click", () => void loadDictionaryReports());
checkDictionaryCoverageButton.addEventListener("click", () => void checkDictionaryCoverage());
suggestDictionaryWordButton.addEventListener("click", () => openDictionarySuggestion());
// Most words are their own lemma, so the lemma follows the word until edited apart.
dictionarySuggestionForm.elements.word.addEventListener("input", (event) => {
  const lemmaField = dictionarySuggestionForm.elements.lemma;
  if (lemmaField.dataset.followsWord !== "false") lemmaField.value = event.target.value;
});
dictionarySuggestionForm.elements.lemma.addEventListener("input", (event) => {
  event.target.dataset.followsWord = String(event.target.value === dictionarySuggestionForm.elements.word.value);
});
closeDictionarySuggestionButton.addEventListener("click", () => dictionarySuggestionDialog.close());
dictionarySuggestionDialog.addEventListener("click", (event) => {
  if (event.target === dictionarySuggestionDialog) dictionarySuggestionDialog.close();
});
dictionarySuggestionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = dictionarySuggestionForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  setStatus(dictionarySuggestionStatus, "Sending suggestion for administrator review…");
  try {
    const tags = dictionarySuggestionForm.elements.tags.value
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);
    await api("./api/admin/dictionary/suggestions", {
      method: "POST",
      body: JSON.stringify({
        word: dictionarySuggestionForm.elements.word.value,
        lemma: dictionarySuggestionForm.elements.lemma.value,
        partOfSpeech: dictionarySuggestionForm.elements.partOfSpeech.value,
        tags,
        targetLanguage: "en",
        translation: dictionarySuggestionForm.elements.translation.value,
        explanation: dictionarySuggestionForm.elements.explanation.value,
      }),
    });
    setStatus(dictionarySuggestionStatus, "Suggestion sent. An administrator must approve it before learners see it.");
    await loadDictionaryStatus();
  } catch (error) {
    setStatus(dictionarySuggestionStatus, error.message, true);
  } finally {
    submitButton.disabled = false;
  }
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
