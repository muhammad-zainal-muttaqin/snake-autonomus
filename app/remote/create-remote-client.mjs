const ADMIN_SECRET_STORAGE_KEY = "snakeArenaAdminSecret";
const DEFAULT_REMOTE_TICK_RATES = [60, 120, 240, 512];
const RECONNECT_DELAY_MS = 1500;

function parseJsonSafe(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function createApiUrl(path, locationObject) {
  return new URL(path, locationObject.href).toString();
}

function createWebSocketUrl(path, locationObject) {
  const streamUrl = new URL(path, locationObject.href);
  streamUrl.protocol = streamUrl.protocol === "https:" ? "wss:" : "ws:";
  return streamUrl;
}

function readStoredAdminSecret(sessionStorageObject, locationObject) {
  const querySecret = new URL(locationObject.href).searchParams.get("admin");
  if (querySecret) {
    sessionStorageObject?.setItem(ADMIN_SECRET_STORAGE_KEY, querySecret);
    return querySecret;
  }
  return sessionStorageObject?.getItem(ADMIN_SECRET_STORAGE_KEY) ?? "";
}

function normalizeTickRate(value, allowedTickRates) {
  const numericValue = Math.round(Number(value) || allowedTickRates[0]);
  let closest = allowedTickRates[0];

  for (const candidate of allowedTickRates) {
    if (Math.abs(candidate - numericValue) < Math.abs(closest - numericValue)) {
      closest = candidate;
    }
  }

  return closest;
}

function createSyntheticNotice(type, detail) {
  return {
    type,
    detail,
  };
}

export function shouldPreferRemoteMode(locationObject) {
  const url = new URL(locationObject.href);
  const requestedMode = url.searchParams.get("mode");

  if (requestedMode === "local") {
    return false;
  }
  if (requestedMode === "remote") {
    return true;
  }
  return locationObject.protocol !== "file:";
}

export function createRemoteClient({
  windowObject,
  fetchImpl,
  locationObject,
  sessionStorageObject,
}) {
  let snapshot = null;
  let pendingEvents = [];
  let socket = null;
  let reconnectTimer = null;
  let stopped = false;
  let handlers = null;
  let canControl = false;
  let connected = false;
  let allowedTickRates = [...DEFAULT_REMOTE_TICK_RATES];
  let viewerStreamFps = 60;
  let adminSecret = readStoredAdminSecret(sessionStorageObject, locationObject);

  function flushEvents() {
    const events = pendingEvents;
    pendingEvents = [];
    return events;
  }

  function notifyFrame() {
    if (!handlers || !snapshot) {
      return;
    }

    handlers.onFrame(snapshot, flushEvents(), {
      isRemote: true,
      canControl,
      viewerStreamFps,
      allowedTickRates,
    });
  }

  function queueNotice(type, detail) {
    pendingEvents.push(createSyntheticNotice(type, detail));
  }

  function clearReconnectTimer() {
    if (reconnectTimer !== null) {
      windowObject.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer !== null) {
      return;
    }

    reconnectTimer = windowObject.setTimeout(async () => {
      reconnectTimer = null;
      try {
        await connectStream();
      } catch (error) {
        queueNotice("remote_disconnected", error.message || "Reconnect failed.");
        notifyFrame();
        scheduleReconnect();
      }
    }, RECONNECT_DELAY_MS);
  }

  function getAdminHeaders(includeJson = true) {
    const headers = {};
    if (includeJson) {
      headers["content-type"] = "application/json";
    }
    if (adminSecret) {
      headers.authorization = `Bearer ${adminSecret}`;
    }
    return headers;
  }

  async function bootstrap() {
    const response = await fetchImpl(createApiUrl("/api/bootstrap", locationObject), {
      headers: getAdminHeaders(false),
    });

    if (!response.ok) {
      throw new Error(`Remote bootstrap failed (${response.status}).`);
    }

    const payload = await response.json();
    snapshot = payload.snapshot;
    canControl = Boolean(payload.canControl);
    allowedTickRates = payload.allowedTickRates?.length
      ? payload.allowedTickRates
      : [...DEFAULT_REMOTE_TICK_RATES];
    viewerStreamFps = Number(payload.viewerStreamFps) || 60;
    pendingEvents.push(
      createSyntheticNotice(
        "remote_connected",
        payload.remoteLabel || "Connected to the global arena."
      )
    );
    notifyFrame();
  }

  async function connectStream() {
    const streamUrl = createWebSocketUrl("/api/stream", locationObject);
    if (adminSecret) {
      streamUrl.searchParams.set("admin", adminSecret);
    }

    const nextSocket = new windowObject.WebSocket(streamUrl.toString());

    await new Promise((resolve, reject) => {
      nextSocket.addEventListener(
        "open",
        () => {
          connected = true;
          resolve();
        },
        { once: true }
      );
      nextSocket.addEventListener(
        "error",
        () => {
          reject(new Error("Remote stream could not connect."));
        },
        { once: true }
      );
    });

    socket = nextSocket;
    socket.addEventListener("message", (event) => {
      const payload = parseJsonSafe(event.data);
      if (!payload) {
        return;
      }

      if (typeof payload.canControl === "boolean") {
        canControl = payload.canControl;
      }
      if (payload.viewerStreamFps) {
        viewerStreamFps = Number(payload.viewerStreamFps) || viewerStreamFps;
      }
      if (Array.isArray(payload.allowedTickRates) && payload.allowedTickRates.length) {
        allowedTickRates = payload.allowedTickRates;
      }
      if (payload.snapshot) {
        snapshot = payload.snapshot;
      }
      if (Array.isArray(payload.events) && payload.events.length) {
        pendingEvents.push(...payload.events);
      }
      notifyFrame();
    });

    socket.addEventListener("close", () => {
      connected = false;
      socket = null;
      if (!stopped) {
        queueNotice("remote_disconnected", "Remote stream disconnected. Reconnecting.");
        notifyFrame();
        scheduleReconnect();
      }
    });
  }

  function ensureAdminSecret() {
    if (adminSecret) {
      return true;
    }
    const entered = windowObject.prompt("Enter admin secret for global arena controls:");
    if (!entered) {
      return false;
    }
    adminSecret = entered.trim();
    if (!adminSecret) {
      return false;
    }
    sessionStorageObject?.setItem(ADMIN_SECRET_STORAGE_KEY, adminSecret);
    queueNotice("admin_unlocked", "Admin controls unlocked for this browser session.");
    return true;
  }

  async function postAdmin(path, body = {}) {
    if (!ensureAdminSecret()) {
      return null;
    }

    const response = await fetchImpl(createApiUrl(path, locationObject), {
      method: "POST",
      headers: getAdminHeaders(true),
      body: JSON.stringify(body),
    });

    if (response.status === 401) {
      adminSecret = "";
      canControl = false;
      sessionStorageObject?.removeItem(ADMIN_SECRET_STORAGE_KEY);
      queueNotice("remote_unauthorized", "Admin secret rejected.");
      notifyFrame();
      throw new Error("Admin secret rejected.");
    }

    if (!response.ok) {
      throw new Error(`Remote control failed (${response.status}).`);
    }

    const payload = await response.json();
    snapshot = payload.snapshot ?? snapshot;
    canControl = Boolean(payload.canControl);
    if (Array.isArray(payload.events) && payload.events.length) {
      pendingEvents.push(...payload.events);
    }
    notifyFrame();
    return payload;
  }

  async function start(nextHandlers) {
    handlers = nextHandlers;
    await bootstrap();
    await connectStream();
  }

  function stop() {
    stopped = true;
    clearReconnectTimer();
    if (socket) {
      socket.close(1000, "Client shutdown");
      socket = null;
    }
  }

  return {
    async start(nextHandlers) {
      await start(nextHandlers);
    },
    stop,
    isRemote() {
      return true;
    },
    isConnected() {
      return connected;
    },
    canControl() {
      return canControl;
    },
    getAllowedTickRates() {
      return [...allowedTickRates];
    },
    getViewerStreamFps() {
      return viewerStreamFps;
    },
    getSnapshot() {
      return snapshot;
    },
    async toggleRun() {
      if (!snapshot) {
        return null;
      }
      return postAdmin(snapshot.paused ? "/api/admin/resume" : "/api/admin/pause");
    },
    async restart() {
      return postAdmin("/api/admin/reset");
    },
    async setTickRate(value) {
      return postAdmin("/api/admin/tick-rate", {
        tickRate: normalizeTickRate(value, allowedTickRates),
      });
    },
  };
}
