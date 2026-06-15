const loginSection = document.getElementById("loginSection");
const adminSection = document.getElementById("adminSection");
const loginForm = document.getElementById("loginForm");
const loginStatus = document.getElementById("loginStatus");
const logoutButton = document.getElementById("logoutButton");
const addStoryButton = document.getElementById("addStoryButton");
const textsList = document.getElementById("textsList");
const textCount = document.getElementById("textCount");
const editorForm = document.getElementById("editorForm");
const editorStatus = document.getElementById("editorStatus");
const editorKicker = document.getElementById("editorKicker");
const editorTitle = document.getElementById("editorTitle");
const editorSubmitButton = document.getElementById("editorSubmitButton");
const storyIdField = document.getElementById("storyIdField");

let stories = [];
let selectedStoryId = null;
let editorMode = "edit";

function setStatus(element, message, isError = false) {
  element.textContent = message || "";
  element.classList.toggle("is-error", Boolean(message) && isError);
  element.classList.toggle("is-success", Boolean(message) && !isError);
}

function getParagraphsFromTextarea(value) {
  return String(value)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
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
  if (!("credentials" in navigator) || !("PasswordCredential" in window)) {
    return;
  }

  try {
    const credential = new PasswordCredential({
      id: email,
      name: email,
      password,
    });
    await navigator.credentials.store(credential);
  } catch {
    // Saving credentials is optional and controlled by the browser/user.
  }
}

function renderStoryList() {
  textsList.innerHTML = "";
  textCount.textContent = `${stories.length} total`;

  stories.forEach((story) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "admin-text-row";
    button.classList.toggle("is-active", story.storyId === selectedStoryId);
    button.innerHTML = `
      <span><strong>${story.level} - ID ${story.storyId}</strong> ${story.title}</span>
      <span class="admin-pill ${story.active ? "is-enabled" : "is-disabled"}">
        ${story.active ? "Enabled" : "Disabled"}
      </span>
    `;
    button.addEventListener("click", () => {
      selectedStoryId = story.storyId;
      editorMode = "edit";
      populateEditor();
      renderStoryList();
    });
    textsList.appendChild(button);
  });
}

function populateEditor() {
  const story = stories.find((item) => item.storyId === selectedStoryId);

  if (!story) {
    enterCreateMode();
    return;
  }

  editorMode = "edit";
  editorForm.dataset.storyId = String(story.storyId);
  editorForm.elements.level.disabled = true;
  editorForm.elements.level.value = story.level;
  editorForm.elements.storyId.value = story.storyId;
  editorForm.elements.title.value = story.title;
  editorForm.elements.active.checked = story.active;
  editorForm.elements.showWordCount.checked = story.showWordCount;
  editorForm.elements.paragraphs.value = story.paragraphs.join("\n\n");
  editorKicker.textContent = "Selected story";
  editorTitle.textContent = "Edit story";
  editorSubmitButton.textContent = "Save changes";
  storyIdField.hidden = false;
  setStatus(editorStatus, "");
}

function enterCreateMode() {
  editorMode = "create";
  selectedStoryId = null;
  editorForm.reset();
  editorForm.dataset.storyId = "";
  editorForm.elements.level.disabled = false;
  editorForm.elements.level.value = "A1";
  editorForm.elements.active.checked = true;
  editorForm.elements.showWordCount.checked = true;
  editorKicker.textContent = "New story";
  editorTitle.textContent = "Add Story";
  editorSubmitButton.textContent = "Create Story";
  storyIdField.hidden = true;
  setStatus(editorStatus, "");
  renderStoryList();
  editorForm.elements.title.focus();
}

async function loadStories() {
  const payload = await api("./api/admin/texts", { method: "GET" });
  stories = payload.stories;

  if (!selectedStoryId && stories[0]) {
    selectedStoryId = stories[0].storyId;
  }

  if (selectedStoryId && !stories.some((story) => story.storyId === selectedStoryId)) {
    selectedStoryId = stories[0]?.storyId || null;
  }

  renderStoryList();
  populateEditor();
}

async function checkSession() {
  try {
    await api("./api/admin/session", { method: "GET" });
    loginSection.hidden = true;
    adminSection.hidden = false;
    await loadStories();
  } catch {
    loginSection.hidden = false;
    adminSection.hidden = true;
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(loginStatus, "");

  const email = loginForm.elements.email.value;
  const password = loginForm.elements.password.value;

  try {
    await api("./api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
      }),
    });
    await offerToSaveCredentials(email, password);
    loginForm.reset();
    await checkSession();
  } catch (error) {
    setStatus(loginStatus, error.message, true);
  }
});

logoutButton.addEventListener("click", async () => {
  await api("./api/admin/logout", { method: "POST" });
  loginSection.hidden = false;
  adminSection.hidden = true;
  setStatus(editorStatus, "");
});

addStoryButton.addEventListener("click", enterCreateMode);

editorForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const isCreating = editorMode === "create";
    const storyId = Number(editorForm.dataset.storyId);
    const path = isCreating ? "./api/admin/texts" : `./api/admin/texts/${storyId}`;
    const payload = await api(path, {
      method: isCreating ? "POST" : "PUT",
      body: JSON.stringify({
        level: editorForm.elements.level.value,
        title: editorForm.elements.title.value,
        paragraphs: getParagraphsFromTextarea(editorForm.elements.paragraphs.value),
        showWordCount: editorForm.elements.showWordCount.checked,
        active: editorForm.elements.active.checked,
      }),
    });

    if (isCreating) {
      stories.push(payload.story);
      selectedStoryId = payload.story.storyId;
      editorMode = "edit";
    } else {
      const index = stories.findIndex((story) => story.storyId === storyId);
      stories[index] = payload.story;
    }

    renderStoryList();
    populateEditor();
    setStatus(editorStatus, isCreating ? "Story created." : "Changes saved.");
  } catch (error) {
    setStatus(editorStatus, error.message, true);
  }
});

checkSession();
