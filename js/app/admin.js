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
const storyNumberField = document.getElementById("storyNumberField");

let texts = [];
let selectedTextId = null;
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

function renderTextList() {
  textsList.innerHTML = "";
  textCount.textContent = `${texts.length} total`;

  texts.forEach((text) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "admin-text-row";
    button.classList.toggle("is-active", text.id === selectedTextId);
    button.innerHTML = `
      <span><strong>${text.level} ${text.storyNumber}.</strong> ${text.title}</span>
      <span class="admin-pill ${text.active ? "is-enabled" : "is-disabled"}">
        ${text.active ? "Enabled" : "Disabled"}
      </span>
    `;
    button.addEventListener("click", () => {
      selectedTextId = text.id;
      editorMode = "edit";
      populateEditor();
      renderTextList();
    });
    textsList.appendChild(button);
  });
}

function populateEditor() {
  const text = texts.find((item) => item.id === selectedTextId);

  if (!text) {
    enterCreateMode();
    return;
  }

  editorMode = "edit";
  editorForm.dataset.textId = String(text.id);
  editorForm.elements.level.disabled = true;
  editorForm.elements.level.value = text.level;
  editorForm.elements.storyNumber.value = text.storyNumber;
  editorForm.elements.title.value = text.title;
  editorForm.elements.active.checked = text.active;
  editorForm.elements.showWordCount.checked = text.showWordCount;
  editorForm.elements.paragraphs.value = text.paragraphs.join("\n\n");
  editorKicker.textContent = "Selected text";
  editorTitle.textContent = "Edit text";
  editorSubmitButton.textContent = "Save changes";
  storyNumberField.hidden = false;
  setStatus(editorStatus, "");
}

function enterCreateMode() {
  editorMode = "create";
  selectedTextId = null;
  editorForm.reset();
  editorForm.dataset.textId = "";
  editorForm.elements.level.disabled = false;
  editorForm.elements.level.value = "A1";
  editorForm.elements.active.checked = true;
  editorForm.elements.showWordCount.checked = true;
  editorKicker.textContent = "New story";
  editorTitle.textContent = "Add Story";
  editorSubmitButton.textContent = "Create Story";
  storyNumberField.hidden = true;
  setStatus(editorStatus, "");
  renderTextList();
  editorForm.elements.title.focus();
}

async function loadTexts() {
  const payload = await api("./api/admin/texts", { method: "GET" });
  texts = payload.texts;

  if (!selectedTextId && texts[0]) {
    selectedTextId = texts[0].id;
  }

  if (selectedTextId && !texts.some((text) => text.id === selectedTextId)) {
    selectedTextId = texts[0]?.id || null;
  }

  renderTextList();
  populateEditor();
}

async function checkSession() {
  try {
    await api("./api/admin/session", { method: "GET" });
    loginSection.hidden = true;
    adminSection.hidden = false;
    await loadTexts();
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
    const id = Number(editorForm.dataset.textId);
    const path = isCreating ? "./api/admin/texts" : `./api/admin/texts/${id}`;
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
      texts.push(payload.text);
      selectedTextId = payload.text.id;
      editorMode = "edit";
    } else {
      const index = texts.findIndex((text) => text.id === id);
      texts[index] = payload.text;
    }

    renderTextList();
    populateEditor();
    setStatus(editorStatus, isCreating ? "Story created." : "Changes saved.");
  } catch (error) {
    setStatus(editorStatus, error.message, true);
  }
});

checkSession();
