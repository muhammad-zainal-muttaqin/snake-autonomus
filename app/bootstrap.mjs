import { createEngine } from "./engine/create-engine.mjs";
import { createRemoteClient, shouldPreferRemoteMode } from "./remote/create-remote-client.mjs";
import { createCanvasRenderer } from "./render/canvas-renderer.mjs";
import { clamp } from "./shared/geometry.mjs";
import { createUiController } from "./ui/ui-controller.mjs";

const MAX_FRAME_DELTA = 120;
const MAX_TICKS_PER_PASS = 2048;
const SIMULATION_BUDGET_MS = 10;
const ZOOM_MIN = 0.55;
const ZOOM_MAX = 2.2;
const ZOOM_STEP = 0.05;

function getCssVariable(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function createThemeFromCss() {
  return {
    boardFill: getCssVariable("--surface-soft", "#0d1422"),
    boardBackdrop: getCssVariable("--bg-deep", "#060911"),
    boardBorder: getCssVariable("--board-border", "rgba(255, 255, 255, 0.13)"),
    boardGrid: getCssVariable("--grid", "rgba(255, 255, 255, 0.045)"),
    centerMark: getCssVariable("--center-mark", "rgba(241, 207, 105, 0.24)"),
    overlay: getCssVariable("--overlay", "rgba(0, 0, 0, 0.42)"),
    overlayText: getCssVariable("--text", "#f4f0e6"),
    overlayMuted: getCssVariable("--muted", "#a6b0c4"),
    food: getCssVariable("--accent", "#f1cf69"),
    foodGlow: getCssVariable("--food-glow", "rgba(241, 207, 105, 0.5)"),
    red: {
      body: getCssVariable("--red", "#ff6b63"),
      head: getCssVariable("--red-head", "#ffd6d1"),
      glow: getCssVariable("--red-glow", "rgba(255, 107, 99, 0.32)"),
    },
    cyan: {
      body: getCssVariable("--cyan", "#52d9cb"),
      head: getCssVariable("--cyan-head", "#ddfffb"),
      glow: getCssVariable("--cyan-glow", "rgba(82, 217, 203, 0.32)"),
    },
  };
}

function getElements() {
  return {
    canvas: document.getElementById("game"),
    redScore: document.getElementById("red-score"),
    cyanScore: document.getElementById("cyan-score"),
    roundCount: document.getElementById("round-count"),
    redStatus: document.getElementById("red-status"),
    cyanStatus: document.getElementById("cyan-status"),
    roundStatus: document.getElementById("round-status"),
    arenaGrowth: document.getElementById("arena-growth"),
    arenaSize: document.getElementById("arena-size"),
    notice: document.getElementById("arena-notice"),
    noticeTitle: document.getElementById("arena-notice-title"),
    noticeDetail: document.getElementById("arena-notice-detail"),
    arenaSummary: document.getElementById("arena-summary"),
    screenReaderStatus: document.getElementById("sr-status"),
    speedInput: document.getElementById("speed"),
    speedValue: document.getElementById("speed-value"),
    zoomInput: document.getElementById("zoom"),
    zoomValue: document.getElementById("zoom-value"),
    zoomOutButton: document.getElementById("zoom-out"),
    zoomInButton: document.getElementById("zoom-in"),
    toggleButton: document.getElementById("toggle-run"),
    restartButton: document.getElementById("restart"),
  };
}

function createViewState(elements) {
  return {
    zoom: clamp(Number(elements.zoomInput?.value) || 1, ZOOM_MIN, ZOOM_MAX),
    isRemote: false,
    canControl: true,
    viewerStreamFps: 60,
    allowedTickRates: [],
  };
}

function setSpeedRange(elements, min, max, step = 1) {
  if (!elements.speedInput) {
    return;
  }
  elements.speedInput.min = String(min);
  elements.speedInput.max = String(max);
  elements.speedInput.step = String(step);
}

function createLocalRuntime(elements, renderer, ui, viewState) {
  const engine = createEngine({
    tickRate: Number(elements.speedInput?.value) || 64,
  });
  let pendingEvents = engine.consumeEvents();
  let animationFrameHandle = null;
  let simulationTimerHandle = null;
  let lastSimulationTime = 0;
  let accumulator = 0;

  function scheduleRender() {
    if (animationFrameHandle !== null) {
      return;
    }
    animationFrameHandle = window.requestAnimationFrame(renderFrame);
  }

  function stopSimulation() {
    if (simulationTimerHandle !== null) {
      window.clearTimeout(simulationTimerHandle);
      simulationTimerHandle = null;
    }
  }

  function syncSimulationLoop() {
    const meta = engine.getMeta();
    if (meta.paused || meta.phase === "match_over") {
      stopSimulation();
      return;
    }
    if (simulationTimerHandle !== null) {
      return;
    }
    simulationTimerHandle = window.setTimeout(runSimulationLoop, 0);
  }

  function flushEvents() {
    const events = pendingEvents;
    pendingEvents = [];
    return events;
  }

  function renderFrame() {
    animationFrameHandle = null;
    const snapshot = engine.getSnapshot();
    try {
      renderer.render(snapshot, viewState);
    } catch (error) {
      console.error("Snake arena render failed.", error);
    }
    ui.update(snapshot, flushEvents(), viewState);
    syncSimulationLoop();
  }

  function queueStepEvents() {
    const events = engine.consumeEvents();
    if (events.length) {
      pendingEvents.push(...events);
    }
  }

  function runSimulationLoop() {
    simulationTimerHandle = null;
    const meta = engine.getMeta();
    if (meta.paused || meta.phase === "match_over") {
      return;
    }

    const now = performance.now();
    if (!lastSimulationTime) {
      lastSimulationTime = now;
    }

    const delta = Math.min(now - lastSimulationTime, MAX_FRAME_DELTA);
    lastSimulationTime = now;
    accumulator += (delta * meta.tickRate) / 1000;

    const budgetStart = performance.now();
    let steps = 0;

    while (
      accumulator >= 1 &&
      steps < MAX_TICKS_PER_PASS &&
      performance.now() - budgetStart < SIMULATION_BUDGET_MS
    ) {
      engine.step();
      queueStepEvents();
      accumulator -= 1;
      steps += 1;

      const stepMeta = engine.getMeta();
      if (stepMeta.paused || stepMeta.phase === "match_over") {
        break;
      }
    }

    if (steps > 0 || pendingEvents.length) {
      scheduleRender();
    }

    syncSimulationLoop();
  }

  function syncNow() {
    queueStepEvents();
    scheduleRender();
    syncSimulationLoop();
  }

  ui.bind({
    onToggleRun() {
      engine.setPaused(!engine.getMeta().paused);
      lastSimulationTime = 0;
      syncNow();
    },
    onRestart() {
      accumulator = 0;
      lastSimulationTime = 0;
      engine.resetMatch();
      syncNow();
    },
    onSpeedChange(value) {
      engine.setTickRate(value);
      syncNow();
    },
    onZoomChange(value) {
      viewState.zoom = clamp(value, ZOOM_MIN, ZOOM_MAX);
      syncNow();
    },
    onZoomNudge(delta) {
      viewState.zoom = clamp(viewState.zoom + delta, ZOOM_MIN, ZOOM_MAX);
      if (elements.zoomInput) {
        elements.zoomInput.value = String(viewState.zoom);
      }
      syncNow();
    },
  });

  setSpeedRange(elements, 4, 2048);
  syncNow();

  return {
    mode: "local",
    engine,
    destroy() {
      stopSimulation();
      if (animationFrameHandle !== null) {
        window.cancelAnimationFrame(animationFrameHandle);
      }
    },
  };
}

async function createRemoteRuntime(elements, renderer, ui, viewState) {
  const remoteClient = createRemoteClient({
    windowObject: window,
    fetchImpl: window.fetch.bind(window),
    locationObject: window.location,
    sessionStorageObject: window.sessionStorage,
  });

  let latestSnapshot = null;
  let pendingEvents = [];
  let animationFrameHandle = null;

  function scheduleRender() {
    if (animationFrameHandle !== null || !latestSnapshot) {
      return;
    }
    animationFrameHandle = window.requestAnimationFrame(() => {
      animationFrameHandle = null;
      try {
        renderer.render(latestSnapshot, viewState);
      } catch (error) {
        console.error("Snake arena render failed.", error);
      }
      ui.update(latestSnapshot, pendingEvents.splice(0), viewState);
    });
  }

  await remoteClient.start({
    onFrame(snapshot, events, remoteState) {
      latestSnapshot = snapshot;
      pendingEvents.push(...events);
      viewState.isRemote = true;
      viewState.canControl = remoteState.canControl;
      viewState.viewerStreamFps = remoteState.viewerStreamFps;
      viewState.allowedTickRates = remoteState.allowedTickRates;
      if (remoteState.allowedTickRates.length) {
        setSpeedRange(
          elements,
          remoteState.allowedTickRates[0],
          remoteState.allowedTickRates[remoteState.allowedTickRates.length - 1]
        );
      }
      scheduleRender();
    },
  });

  ui.bind({
    async onToggleRun() {
      await remoteClient.toggleRun();
    },
    async onRestart() {
      await remoteClient.restart();
    },
    async onSpeedChange(value) {
      await remoteClient.setTickRate(value);
    },
    onZoomChange(value) {
      viewState.zoom = clamp(value, ZOOM_MIN, ZOOM_MAX);
      scheduleRender();
    },
    onZoomNudge(delta) {
      viewState.zoom = clamp(viewState.zoom + delta, ZOOM_MIN, ZOOM_MAX);
      if (elements.zoomInput) {
        elements.zoomInput.value = String(viewState.zoom);
      }
      scheduleRender();
    },
  });

  return {
    mode: "remote",
    remoteClient,
    destroy() {
      if (animationFrameHandle !== null) {
        window.cancelAnimationFrame(animationFrameHandle);
      }
      remoteClient.stop();
    },
  };
}

export async function bootstrap() {
  const elements = getElements();
  if (!elements.canvas) {
    throw new Error("Missing #game canvas.");
  }

  const renderer = createCanvasRenderer(elements.canvas, createThemeFromCss());
  const ui = createUiController(elements, window);
  const viewState = createViewState(elements);

  if (elements.zoomInput) {
    elements.zoomInput.step = String(ZOOM_STEP);
  }

  if (shouldPreferRemoteMode(window.location)) {
    try {
      return await createRemoteRuntime(elements, renderer, ui, viewState);
    } catch (error) {
      console.warn("Remote arena bootstrap failed. Falling back to local mode.", error);
    }
  }

  return createLocalRuntime(elements, renderer, ui, viewState);
}
