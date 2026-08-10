const COPY = {
  hint: "Виділіть одне слово, щоб прослухати вимову. Аудіо безкоштовно надходить із сервера.",
  unsupported: "Цей браузер не підтримує відтворення згенерованого аудіо.",
  listen: "Прослухати",
  stop: "Зупинити",
  preparing: "Завантажуємо українське аудіо із сервера…",
  speaking: "Відтворюємо вибране слово.",
  stopped: "Відтворення зупинено.",
  finished: "Відтворення завершено.",
  failed: "Не вдалося завантажити вимову слова. Спробуйте ще раз.",
  unavailableWord: "Для цього слова поки немає аудіо. Виберіть інше слово.",
  oneWord: "Виділіть лише одне слово без пробілів.",
  rateLimited: "Забагато запитів на озвучення. Спробуйте ще раз за хвилину.",
  dailyLimit: "Безкоштовний денний ліміт озвучення вичерпано. Спробуйте знову завтра.",
  playAgain: "Аудіо готове. Натисніть «Прослухати» ще раз, щоб відтворити його.",
  playReady: "Аудіо готове — відтворити",
  tooLong: "Виберіть коротше слово — не більше 80 символів.",
};

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_SPEECH_CHARACTERS = 80;

export function normalizeSpeechText(value) {
  return String(value || "")
    .replace(/\s+/gu, " ")
    .trim();
}

function rangeIsInside(root, range) {
  return root.contains(range.startContainer) && root.contains(range.endContainer);
}

function rangesMatch(first, second) {
  return Boolean(
    first &&
      second &&
      first.startContainer === second.startContainer &&
      first.startOffset === second.startOffset &&
      first.endContainer === second.endContainer &&
      first.endOffset === second.endOffset
  );
}

function getViewportBounds() {
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft || 0;
  const top = viewport?.offsetTop || 0;
  const width = viewport?.width || window.innerWidth;
  const height = viewport?.height || window.innerHeight;
  return { left, top, right: left + width, bottom: top + height };
}

function getVisibleRangeRect(range) {
  const viewport = getViewportBounds();
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0
  );
  const visibleRects = rects.filter(
    (rect) =>
      rect.bottom >= viewport.top &&
      rect.top <= viewport.bottom &&
      rect.right >= viewport.left &&
      rect.left <= viewport.right
  );

  return (
    visibleRects[visibleRects.length - 1] ||
    rects[rects.length - 1] ||
    range.getBoundingClientRect()
  );
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function initSelectionSpeech(
  { root, hint, popover, button, icon, label, unavailable, status },
  dependencies = {}
) {
  const fetchImpl = dependencies.fetch || window.fetch?.bind(window);
  const AbortControllerImpl = dependencies.AbortController || window.AbortController;
  const createAudio = dependencies.createAudio || ((source) => new window.Audio(source));
  const createObjectURL = dependencies.createObjectURL || window.URL?.createObjectURL?.bind(window.URL);
  const revokeObjectURL = dependencies.revokeObjectURL || window.URL?.revokeObjectURL?.bind(window.URL);
  const speechSupported = Boolean(
    typeof fetchImpl === "function" &&
      typeof AbortControllerImpl === "function" &&
      typeof createAudio === "function" &&
      typeof createObjectURL === "function" &&
      typeof revokeObjectURL === "function"
  );

  let enabled = false;
  let storyId = null;
  let selectedText = "";
  let selectionIssue = "";
  let visibleError = "";
  let selectedRange = null;
  let suppressedRange = null;
  let playbackState = "idle";
  let requestController = null;
  let activeAudio = null;
  let activeObjectUrl = "";
  let activeAudioText = "";
  let operationToken = 0;
  let selectionFrame = 0;
  let statusFrame = 0;
  let interactingWithPopover = false;

  function setStatus(message = "") {
    if (statusFrame) {
      window.cancelAnimationFrame(statusFrame);
      statusFrame = 0;
    }
    status.textContent = "";
    if (message) {
      statusFrame = window.requestAnimationFrame(() => {
        statusFrame = 0;
        status.textContent = message;
      });
    }
  }

  function updateHint() {
    hint.hidden = !enabled;
    if (!enabled) return;

    hint.textContent = speechSupported ? COPY.hint : COPY.unsupported;
    hint.classList.toggle("is-unavailable", !speechSupported);
  }

  function updatePopoverContent() {
    const canRequest = speechSupported && !selectionIssue;
    button.hidden = !canRequest;
    unavailable.hidden = canRequest && !visibleError;

    if (!canRequest) {
      unavailable.textContent = selectionIssue || COPY.unsupported;
      return;
    }

    unavailable.textContent = visibleError;

    const active = playbackState === "loading" || playbackState === "playing";
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-busy", String(playbackState === "loading"));
    label.textContent = active
      ? COPY.stop
      : playbackState === "awaiting-play"
        ? COPY.playReady
        : COPY.listen;
    icon.textContent = playbackState === "loading" ? "…" : playbackState === "playing" ? "■" : "▶";
  }

  function releaseAudio() {
    if (activeAudio) {
      try {
        activeAudio.pause();
        activeAudio.currentTime = 0;
      } catch {
        // The media element may already have released its source.
      }
    }
    if (activeObjectUrl) {
      revokeObjectURL(activeObjectUrl);
    }
    activeAudio = null;
    activeObjectUrl = "";
    activeAudioText = "";
  }

  function stopPlayback({ announce = false } = {}) {
    operationToken += 1;
    if (requestController) {
      requestController.abort();
      requestController = null;
    }

    if (activeAudio) {
      try {
        activeAudio.pause();
        activeAudio.currentTime = 0;
      } catch {
        // Ignore media cleanup failures.
      }
    }

    releaseAudio();
    playbackState = "idle";
    visibleError = "";
    updatePopoverContent();
    if (announce) {
      setStatus(COPY.stopped);
    }
  }

  function dismissOffer({ stop = false, suppress = false } = {}) {
    interactingWithPopover = false;
    if (stop || playbackState !== "playing") {
      stopPlayback();
    }
    if (suppress && selectedRange) {
      suppressedRange = selectedRange.cloneRange();
    }
    popover.hidden = true;
    popover.style.visibility = "";
    selectedText = "";
    selectionIssue = "";
    visibleError = "";
    selectedRange = null;
  }

  function positionPopover() {
    if (popover.hidden || !selectedRange) {
      return;
    }

    try {
      if (!rangeIsInside(root, selectedRange)) {
        dismissOffer({ stop: true });
        return;
      }

      const selectionRect = getVisibleRangeRect(selectedRange);
      if (!selectionRect || (!selectionRect.width && !selectionRect.height)) {
        dismissOffer({ stop: true });
        return;
      }

      popover.style.visibility = "hidden";
      popover.style.left = "0px";
      popover.style.top = "0px";
      const viewport = getViewportBounds();
      const viewportPadding = 12;
      popover.style.maxWidth = `${Math.max(0, viewport.right - viewport.left - viewportPadding * 2)}px`;
      const popoverRect = popover.getBoundingClientRect();
      const gap = 10;
      const minimumLeft = viewport.left + viewportPadding;
      const maximumLeft = Math.max(
        minimumLeft,
        viewport.right - popoverRect.width - viewportPadding
      );
      const left = clamp(
        selectionRect.left + selectionRect.width / 2 - popoverRect.width / 2,
        minimumLeft,
        maximumLeft
      );
      const roomAbove = selectionRect.top - popoverRect.height - gap;
      const roomBelow = selectionRect.bottom + gap;
      const minimumTop = viewport.top + viewportPadding;
      const preferredTop =
        roomAbove >= minimumTop
          ? roomAbove
          : Math.min(roomBelow, viewport.bottom - popoverRect.height - viewportPadding);
      const top = clamp(
        preferredTop,
        minimumTop,
        Math.max(minimumTop, viewport.bottom - popoverRect.height - viewportPadding)
      );

      popover.style.left = `${Math.round(left)}px`;
      popover.style.top = `${Math.round(top)}px`;
      popover.style.visibility = "visible";
    } catch {
      dismissOffer({ stop: true });
    }
  }

  function showOffer() {
    if (!enabled || !storyId || !selectedText || !selectedRange) {
      return;
    }

    updatePopoverContent();
    popover.hidden = false;
    positionPopover();
  }

  function finishAudio(audio) {
    if (audio !== activeAudio) return;

    operationToken += 1;
    releaseAudio();
    playbackState = "idle";
    updatePopoverContent();
    setStatus(COPY.finished);
  }

  function failAudio(audio) {
    if (audio !== activeAudio) return;

    operationToken += 1;
    releaseAudio();
    playbackState = "idle";
    visibleError = COPY.failed;
    updatePopoverContent();
    setStatus(COPY.failed);
  }

  function playPreparedAudio() {
    if (!activeAudio || activeAudioText !== selectedText) {
      releaseAudio();
      playbackState = "idle";
      updatePopoverContent();
      return;
    }

    const audio = activeAudio;
    const token = operationToken + 1;
    operationToken = token;
    playbackState = "playing";
    visibleError = "";
    updatePopoverContent();
    setStatus(COPY.speaking);

    let playResult;
    try {
      audio.currentTime = 0;
      playResult = audio.play();
    } catch (error) {
      playResult = Promise.reject(error);
    }

    Promise.resolve(playResult).catch((error) => {
      if (token !== operationToken || audio !== activeAudio) return;

      if (error?.name === "NotAllowedError") {
        playbackState = "awaiting-play";
        updatePopoverContent();
        setStatus(COPY.playAgain);
        return;
      }

      failAudio(audio);
    });
  }

  async function requestSpeech() {
    if (!speechSupported || !storyId || !selectedText || selectionIssue) return;

    stopPlayback();
    const token = operationToken + 1;
    operationToken = token;
    requestController = new AbortControllerImpl();
    playbackState = "loading";
    visibleError = "";
    updatePopoverContent();
    setStatus(COPY.preparing);

    try {
      const response = await fetchImpl("/api/speech", {
        method: "POST",
        headers: {
          accept: "audio/mpeg",
          "content-type": "application/json",
        },
        body: JSON.stringify({ storyId, text: selectedText }),
        signal: requestController.signal,
      });

      if (token !== operationToken) return;
      if (!response.ok) {
        throw Object.assign(new Error("Speech request failed."), {
          status: response.status,
          limit: response.headers.get("x-speech-limit") || "",
        });
      }

      const contentType = response.headers.get("content-type") || "";
      const declaredLength = Number(response.headers.get("content-length"));
      if (!contentType.startsWith("audio/") || (Number.isFinite(declaredLength) && declaredLength > MAX_AUDIO_BYTES)) {
        throw new Error("The speech response was not valid audio.");
      }

      const blob = await response.blob();
      if (token !== operationToken) return;
      if (!blob.size || blob.size > MAX_AUDIO_BYTES) {
        throw new Error("The speech response was empty or too large.");
      }

      const objectUrl = createObjectURL(blob);
      if (token !== operationToken) {
        revokeObjectURL(objectUrl);
        return;
      }

      activeObjectUrl = objectUrl;
      const audio = createAudio(objectUrl);
      activeAudio = audio;
      activeAudioText = selectedText;
      audio.preload = "auto";
      audio.addEventListener("ended", () => finishAudio(audio));
      audio.addEventListener("error", () => failAudio(audio));
      requestController = null;
      playbackState = "ready";
      playPreparedAudio();
    } catch (error) {
      if (token !== operationToken) return;

      requestController = null;
      releaseAudio();
      playbackState = "idle";
      const errorMessage =
        error?.status === 429
          ? error?.limit === "daily"
            ? COPY.dailyLimit
            : COPY.rateLimited
          : error?.status === 404
            ? COPY.unavailableWord
          : error?.status === 422
            ? COPY.oneWord
            : error?.status === 413
              ? COPY.tooLong
              : COPY.failed;
      visibleError = errorMessage;
      updatePopoverContent();
      setStatus(errorMessage);
    }
  }

  function captureSelection() {
    selectionFrame = 0;
    if (!enabled) return;

    const selection = window.getSelection();
    const active = playbackState === "loading" || playbackState === "playing";
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      suppressedRange = null;
      if (!active && !interactingWithPopover && !popover.contains(document.activeElement)) {
        dismissOffer({ stop: true });
      }
      return;
    }

    const range = selection.getRangeAt(0);
    const text = normalizeSpeechText(selection.toString());
    if (!text || !rangeIsInside(root, range)) {
      if (!active && !interactingWithPopover && !popover.contains(document.activeElement)) {
        dismissOffer({ stop: true });
      }
      return;
    }

    if (suppressedRange && rangesMatch(suppressedRange, range)) return;
    suppressedRange = null;

    if (text !== selectedText) {
      visibleError = "";
      stopPlayback();
    }
    selectedText = text;
    selectionIssue =
      text.length > MAX_SPEECH_CHARACTERS
        ? COPY.tooLong
        : /\s/u.test(text)
          ? COPY.oneWord
          : "";
    selectedRange = range.cloneRange();
    showOffer();
  }

  function scheduleSelectionCapture() {
    if (selectionFrame) {
      window.cancelAnimationFrame(selectionFrame);
    }
    selectionFrame = window.requestAnimationFrame(captureSelection);
  }

  button.addEventListener("click", () => {
    if (playbackState === "loading") {
      stopPlayback({ announce: true });
      return;
    }
    if (playbackState === "playing") {
      stopPlayback({ announce: true });
      return;
    }
    if (
      playbackState === "awaiting-play" &&
      activeAudio &&
      activeAudioText === selectedText
    ) {
      playPreparedAudio();
      return;
    }
    void requestSpeech();
  });

  popover.addEventListener("pointerdown", () => {
    interactingWithPopover = true;
  });
  const finishPopoverInteraction = () => {
    const shouldRecapture = interactingWithPopover;
    window.setTimeout(() => {
      interactingWithPopover = false;
      if (shouldRecapture) scheduleSelectionCapture();
    });
  };
  document.addEventListener("pointerup", finishPopoverInteraction);
  document.addEventListener("pointercancel", finishPopoverInteraction);

  document.addEventListener("selectionchange", scheduleSelectionCapture);
  root.addEventListener("pointerup", scheduleSelectionCapture);
  root.addEventListener("keyup", scheduleSelectionCapture);
  document.addEventListener("pointerdown", (event) => {
    if (!popover.hidden && !popover.contains(event.target)) {
      dismissOffer({ stop: true });
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !popover.hidden) {
      dismissOffer({ stop: true, suppress: true });
    }
  });
  window.addEventListener("scroll", positionPopover, { passive: true });
  window.addEventListener("resize", positionPopover);
  window.visualViewport?.addEventListener("resize", positionPopover);
  window.visualViewport?.addEventListener("scroll", positionPopover);
  window.addEventListener("pagehide", () => stopPlayback());

  updateHint();
  updatePopoverContent();

  return {
    reset() {
      enabled = false;
      storyId = null;
      suppressedRange = null;
      selectionIssue = "";
      visibleError = "";
      dismissOffer({ stop: true });
      hint.hidden = true;
      setStatus();
    },
    setContext(context = {}) {
      const nextStoryId = Number(context.storyId);
      const validStoryId = Number.isSafeInteger(nextStoryId) && nextStoryId > 0 ? nextStoryId : null;
      if (validStoryId !== storyId) {
        stopPlayback();
      }
      storyId = validStoryId;
    },
    setEnabled(nextEnabled) {
      enabled = Boolean(nextEnabled && storyId);
      if (!enabled) {
        suppressedRange = null;
        dismissOffer({ stop: true });
      }
      updateHint();
    },
  };
}
