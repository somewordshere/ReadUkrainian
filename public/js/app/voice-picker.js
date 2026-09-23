// The reader's voice menu: a button that opens a listbox, styled like the other
// reader controls instead of a native <select>. Keyboard follows the WAI-ARIA
// "select-only combobox" pattern: arrows move, Enter/Space choose, Escape closes.

const GENDER_LABELS = { female: "жіночий", male: "чоловічий" };

export function initVoicePicker({ root, button, value, list }, { onChange } = {}) {
  let voices = [];
  let selectedId = "";
  let defaultId = "";
  let activeIndex = -1;

  function optionId(index) {
    return `${list.id}-option-${index}`;
  }

  function isOpen() {
    return !list.hidden;
  }

  function renderValue() {
    const voice = voices.find((item) => item.id === selectedId);
    value.textContent = voice?.label || "";
  }

  function setActive(index) {
    const options = list.querySelectorAll("[role='option']");
    if (!options.length) return;

    activeIndex = (index + options.length) % options.length;
    options.forEach((option, optionIndex) => {
      option.classList.toggle("is-active", optionIndex === activeIndex);
    });
    list.setAttribute("aria-activedescendant", optionId(activeIndex));
    options[activeIndex].scrollIntoView({ block: "nearest" });
  }

  function renderOptions() {
    list.replaceChildren();
    voices.forEach((voice, index) => {
      const option = document.createElement("li");
      option.id = optionId(index);
      option.className = "voice-option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(voice.id === selectedId));
      option.dataset.voiceId = voice.id;

      const name = document.createElement("span");
      name.className = "voice-option-name";
      name.textContent = voice.label;

      const details = [GENDER_LABELS[voice.gender], voice.id === defaultId ? "основний" : ""]
        .filter(Boolean)
        .join(" · ");
      option.append(name);
      if (details) {
        const meta = document.createElement("span");
        meta.className = "voice-option-meta";
        meta.textContent = details;
        option.append(meta);
      }

      option.addEventListener("pointerdown", (event) => {
        // Keep focus on the list so choosing does not blur and close it first.
        event.preventDefault();
      });
      option.addEventListener("click", () => choose(index));
      list.appendChild(option);
    });
  }

  function open() {
    if (isOpen() || !voices.length) return;
    list.hidden = false;
    button.setAttribute("aria-expanded", "true");
    root.classList.add("is-open");
    setActive(Math.max(0, voices.findIndex((voice) => voice.id === selectedId)));
    list.focus();
  }

  function close({ restoreFocus = true } = {}) {
    if (!isOpen()) return;
    list.hidden = true;
    button.setAttribute("aria-expanded", "false");
    root.classList.remove("is-open");
    list.removeAttribute("aria-activedescendant");
    if (restoreFocus) button.focus();
  }

  function choose(index) {
    const voice = voices[index];
    close();
    if (!voice || voice.id === selectedId) return;

    selectedId = voice.id;
    renderValue();
    list.querySelectorAll("[role='option']").forEach((option) => {
      option.setAttribute("aria-selected", String(option.dataset.voiceId === selectedId));
    });
    onChange?.(voice.id);
  }

  button.addEventListener("click", () => (isOpen() ? close() : open()));
  button.addEventListener("keydown", (event) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      open();
    }
  });

  list.addEventListener("keydown", (event) => {
    const moves = {
      ArrowDown: activeIndex + 1,
      ArrowUp: activeIndex - 1,
      Home: 0,
      End: voices.length - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      setActive(moves[event.key]);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(activeIndex);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      close({ restoreFocus: false });
    }
  });
  list.addEventListener("focusout", (event) => {
    if (!root.contains(event.relatedTarget)) close({ restoreFocus: false });
  });
  document.addEventListener("pointerdown", (event) => {
    if (isOpen() && !root.contains(event.target)) close({ restoreFocus: false });
  });

  return {
    // Shows the menu only when there is a real choice to make.
    setVoices(nextVoices, { siteVoiceId = "", selectedVoiceId = "" } = {}) {
      voices = Array.isArray(nextVoices) ? nextVoices : [];
      defaultId = siteVoiceId;
      selectedId = voices.some((voice) => voice.id === selectedVoiceId)
        ? selectedVoiceId
        : voices.some((voice) => voice.id === siteVoiceId)
          ? siteVoiceId
          : voices[0]?.id || "";
      close({ restoreFocus: false });
      renderOptions();
      renderValue();
      root.hidden = voices.length < 2;
      return selectedId;
    },
  };
}
