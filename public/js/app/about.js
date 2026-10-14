// The feedback form on the About page. The page a reader came from (and its story,
// if any) is attached so a message about «this word» can be traced.
const form = document.getElementById("feedbackForm");
const messageInput = document.getElementById("feedbackMessage");
const emailInput = document.getElementById("feedbackEmail");
const submitButton = document.getElementById("feedbackSubmit");
const statusLine = document.getElementById("feedbackStatus");

function origin() {
  try {
    const referrer = new URL(document.referrer);
    if (referrer.origin !== window.location.origin) return {};
    const storyId = Number(referrer.searchParams.get("story"));
    return {
      page: `${referrer.pathname}${referrer.search}`.slice(0, 200),
      ...(Number.isSafeInteger(storyId) && storyId > 0 ? { storyId } : {}),
    };
  } catch {
    return {};
  }
}

function setStatus(text, isError = false) {
  statusLine.textContent = text;
  statusLine.classList.toggle("is-error", isError);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = messageInput.value.trim();
  const email = emailInput.value.trim();
  if (!message) {
    setStatus("Напишіть повідомлення. · Please write a message.", true);
    messageInput.focus();
    return;
  }
  if (email && !emailInput.checkValidity()) {
    setStatus("Перевірте email або залиште поле порожнім. · Check the email or leave it empty.", true);
    emailInput.focus();
    return;
  }

  submitButton.disabled = true;
  setStatus("Надсилаємо… · Sending…");
  try {
    const response = await fetch("./api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, ...(email ? { email } : {}), ...origin() }),
    });
    if (response.ok) {
      form.reset();
      setStatus("Дякуємо! Ваше повідомлення надіслано. · Thank you, your message was sent.");
      return;
    }
    const payload = await response.json().catch(() => ({}));
    setStatus(payload.error || `Не вдалося надіслати (HTTP ${response.status}). · Could not send.`, true);
  } catch {
    setStatus("Немає з'єднання. Спробуйте ще раз. · No connection, please try again.", true);
  } finally {
    submitButton.disabled = false;
  }
});
