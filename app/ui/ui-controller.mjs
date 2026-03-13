import {
  formatTickRate,
  formatZoom,
  getArenaGrowthLabel,
  getArenaSizeLabel,
  getAssistiveSummary,
  getMajorNotice,
  getRoundStatusLabel,
  getSnakeDetailLabel,
} from "../shared/selectors.mjs";

function setText(node, value) {
  if (!node) {
    return;
  }
  const nextValue = String(value);
  if (node.textContent !== nextValue) {
    node.textContent = nextValue;
  }
}

function setAttribute(node, name, value) {
  if (!node) {
    return;
  }
  node.setAttribute(name, value);
}

export function createUiController(elements, windowObject) {
  let noticeTimer = null;

  function clearNoticeTimer() {
    if (noticeTimer !== null) {
      windowObject.clearTimeout(noticeTimer);
      noticeTimer = null;
    }
  }

  function speak(message) {
    if (!elements.screenReaderStatus || !message) {
      return;
    }
    setText(elements.screenReaderStatus, "");
    windowObject.setTimeout(() => {
      setText(elements.screenReaderStatus, message);
    }, 30);
  }

  function syncToggle(snapshot) {
    const label = snapshot.paused ? "Resume" : "Pause";
    setText(elements.toggleButton, label);
    setAttribute(elements.toggleButton, "aria-pressed", snapshot.paused ? "true" : "false");
    setAttribute(elements.toggleButton, "aria-label", snapshot.paused ? "Resume match" : "Pause match");
  }

  function showNotice(notice) {
    if (!notice || !elements.notice) {
      return;
    }
    clearNoticeTimer();
    elements.notice.hidden = false;
    elements.notice.dataset.tone = notice.tone;
    setText(elements.noticeTitle, notice.title);
    setText(elements.noticeDetail, notice.detail);
    if (notice.speak) {
      speak(notice.speak);
    }
    noticeTimer = windowObject.setTimeout(() => {
      elements.notice.hidden = true;
      noticeTimer = null;
    }, 2200);
  }

  function update(snapshot, events, viewState) {
    setText(elements.redScore, snapshot.snakes.red.score);
    setText(elements.cyanScore, snapshot.snakes.cyan.score);
    setText(elements.roundCount, snapshot.roundNumber);
    setText(elements.redStatus, getSnakeDetailLabel(snapshot.snakes.red));
    setText(elements.cyanStatus, getSnakeDetailLabel(snapshot.snakes.cyan));
    setText(elements.roundStatus, getRoundStatusLabel(snapshot));
    setText(elements.arenaSize, getArenaSizeLabel(snapshot));
    setText(elements.arenaGrowth, getArenaGrowthLabel(snapshot));
    setText(elements.speedValue, formatTickRate(snapshot.tickRate));
    setText(elements.zoomValue, formatZoom(viewState.zoom));
    setText(elements.arenaSummary, getAssistiveSummary(snapshot));
    syncToggle(snapshot);

    if (elements.speedInput && String(elements.speedInput.value) !== String(snapshot.tickRate)) {
      elements.speedInput.value = String(snapshot.tickRate);
    }

    if (elements.zoomInput) {
      const normalizedZoom = Number(viewState.zoom).toFixed(2);
      const currentValue = Number(elements.zoomInput.value).toFixed(2);
      if (currentValue !== normalizedZoom) {
        elements.zoomInput.value = String(viewState.zoom);
      }
    }

    const notice = [...events]
      .reverse()
      .map((event) => getMajorNotice(event))
      .find(Boolean);
    if (notice) {
      showNotice(notice);
    }
  }

  function bind(handlers) {
    elements.toggleButton?.addEventListener("click", () => {
      handlers.onToggleRun();
    });

    elements.restartButton?.addEventListener("click", () => {
      handlers.onRestart();
    });

    elements.speedInput?.addEventListener("input", (event) => {
      handlers.onSpeedChange(Number(event.currentTarget.value));
    });

    elements.zoomInput?.addEventListener("input", (event) => {
      handlers.onZoomChange(Number(event.currentTarget.value));
    });

    elements.zoomOutButton?.addEventListener("click", () => {
      handlers.onZoomNudge(-0.05);
    });

    elements.zoomInButton?.addEventListener("click", () => {
      handlers.onZoomNudge(0.05);
    });
  }

  return {
    bind,
    update,
  };
}
