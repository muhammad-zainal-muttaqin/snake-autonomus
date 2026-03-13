import { DurableObject } from "cloudflare:workers";
import { createEngine } from "../app/engine/create-engine.mjs";

const STORAGE_KEY = "global-arena-state";
const DEFAULT_REMOTE_TICK_RATES = [60, 120, 240, 512];
const DEFAULT_ACTIVE_FPS = 60;
const DEFAULT_ALARM_INTERVAL_MS = 1000;
const ACTIVE_PERSIST_INTERVAL_MS = 1000;
const CATCH_UP_CHUNK_STEPS = 4096;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function parseInteger(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.round(numericValue) : fallback;
}

function parseTickRateOptions(value) {
  if (!value) {
    return [...DEFAULT_REMOTE_TICK_RATES];
  }

  const values = String(value)
    .split(",")
    .map((item) => parseInteger(item, 0))
    .filter((item) => item > 0);

  return values.length
    ? [...new Set(values)].sort((left, right) => left - right)
    : [...DEFAULT_REMOTE_TICK_RATES];
}

function getRemoteConfig(env) {
  const allowedTickRates = parseTickRateOptions(env.REMOTE_TICK_RATE_OPTIONS);
  const tickRate = parseInteger(
    env.LIVE_SERVER_TPS,
    allowedTickRates[allowedTickRates.length - 1] ?? 512
  );

  return {
    allowedTickRates,
    tickRate,
    viewerStreamFps: parseInteger(env.VIEWER_STREAM_FPS, DEFAULT_ACTIVE_FPS),
    maxArenaSize: parseInteger(env.REMOTE_MAX_ARENA_SIZE, 96),
    maxStoredLength: parseInteger(env.REMOTE_MAX_STORED_LENGTH, 1024),
    alarmIntervalMs: parseInteger(
      env.REMOTE_ALARM_INTERVAL_MS,
      DEFAULT_ALARM_INTERVAL_MS
    ),
  };
}

function createEngineOverrides(env) {
  const remoteConfig = getRemoteConfig(env);
  return {
    tickRate: remoteConfig.tickRate,
    world: {
      maxSize: remoteConfig.maxArenaSize,
      maxStoredLength: remoteConfig.maxStoredLength,
    },
  };
}

function isAuthorized(request, env) {
  const configuredSecret = String(env.ADMIN_SECRET ?? "").trim();
  if (!configuredSecret) {
    return false;
  }

  const authorizationHeader = request.headers.get("authorization") || "";
  const [scheme, token] = authorizationHeader.split(" ");
  return scheme?.toLowerCase() === "bearer" && token === configuredSecret;
}

function normalizeRemoteTickRate(value, allowedTickRates) {
  const targetValue = parseInteger(value, allowedTickRates[0] ?? 60);
  let closest = allowedTickRates[0] ?? targetValue;

  for (const candidate of allowedTickRates) {
    if (Math.abs(candidate - targetValue) < Math.abs(closest - targetValue)) {
      closest = candidate;
    }
  }

  return closest;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const id = env.GLOBAL_ARENA.idFromName("global-arena");
      const stub = env.GLOBAL_ARENA.get(id);
      return stub.fetch(request);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Missing asset binding.", { status: 500 });
  },
};

export class GlobalArena extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.engine = null;
    this.sequence = 0;
    this.lastWallClockAt = Date.now();
    this.accumulatorMs = 0;
    this.lastPersistedAt = 0;
    this.activeLoopHandle = null;
    this.initialized = this.ctx.blockConcurrencyWhile(async () => {
      const persisted = await this.ctx.storage.get(STORAGE_KEY);

      if (persisted?.engine?.state) {
        this.engine = createEngine({
          ...createEngineOverrides(env),
          persistedState: persisted.engine.state,
          persistedRngState: persisted.engine.rngState,
        });
        this.sequence = parseInteger(persisted.sequence, 0);
        this.lastWallClockAt = parseInteger(persisted.lastWallClockAt, Date.now());
        this.accumulatorMs = Number(persisted.accumulatorMs) || 0;
        this.lastPersistedAt = Date.now();
      } else {
        this.engine = createEngine(createEngineOverrides(env));
        this.sequence = 0;
        this.lastWallClockAt = Date.now();
        this.accumulatorMs = 0;
        await this.persistNow();
      }

      await this.scheduleAlarm();
      if (this.hasViewers() && !this.engine.getMeta().paused) {
        this.scheduleActiveLoop();
      }
    });
  }

  async ensureInitialized() {
    await this.initialized;
  }

  getRemoteState() {
    return getRemoteConfig(this.env);
  }

  hasViewers() {
    return this.ctx.getWebSockets().length > 0;
  }

  async scheduleAlarm() {
    await this.ctx.storage.setAlarm(Date.now() + this.getRemoteState().alarmIntervalMs);
  }

  stopActiveLoop() {
    if (this.activeLoopHandle !== null) {
      clearTimeout(this.activeLoopHandle);
      this.activeLoopHandle = null;
    }
  }

  scheduleActiveLoop() {
    if (this.activeLoopHandle !== null || !this.hasViewers()) {
      return;
    }
    if (this.engine.getMeta().paused || this.engine.getMeta().phase === "match_over") {
      return;
    }

    const frameDelay = Math.max(
      8,
      Math.round(1000 / this.getRemoteState().viewerStreamFps)
    );

    this.activeLoopHandle = setTimeout(async () => {
      this.activeLoopHandle = null;
      await this.tickAndBroadcast();
      if (this.hasViewers()) {
        this.scheduleActiveLoop();
      }
    }, frameDelay);
  }

  async advanceSimulation(now = Date.now()) {
    await this.ensureInitialized();

    const meta = this.engine.getMeta();
    if (meta.paused || meta.phase === "match_over") {
      this.lastWallClockAt = now;
      this.accumulatorMs = 0;
      return 0;
    }

    const delta = Math.max(0, now - this.lastWallClockAt);
    this.lastWallClockAt = now;
    this.accumulatorMs += delta;

    const stepDurationMs = 1000 / Math.max(1, meta.tickRate);
    let dueSteps = Math.floor(this.accumulatorMs / stepDurationMs);
    let executedSteps = 0;

    while (dueSteps > 0) {
      const chunkSize = Math.min(CATCH_UP_CHUNK_STEPS, dueSteps);
      const stepped = this.engine.stepMany(chunkSize);
      executedSteps += stepped;
      dueSteps -= stepped;

      if (stepped < chunkSize) {
        this.accumulatorMs = 0;
        break;
      }

      const nextMeta = this.engine.getMeta();
      if (nextMeta.paused || nextMeta.phase === "match_over") {
        this.accumulatorMs = 0;
        break;
      }
    }

    this.accumulatorMs = Math.max(
      0,
      this.accumulatorMs - executedSteps * stepDurationMs
    );

    return executedSteps;
  }

  createFramePayload(type, consumeEvents = true) {
    const remoteState = this.getRemoteState();
    return {
      type,
      sequence: ++this.sequence,
      snapshot: this.engine.getSnapshot(),
      events: consumeEvents ? this.engine.consumeEvents() : [],
      viewerStreamFps: remoteState.viewerStreamFps,
      allowedTickRates: remoteState.allowedTickRates,
    };
  }

  broadcastPayload(payload) {
    const message = JSON.stringify(payload);
    for (const socket of this.ctx.getWebSockets()) {
      socket.send(message);
    }
  }

  async persistNow() {
    await this.ctx.storage.put(STORAGE_KEY, {
      schemaVersion: 1,
      engine: this.engine.exportState(),
      sequence: this.sequence,
      lastWallClockAt: this.lastWallClockAt,
      accumulatorMs: this.accumulatorMs,
      persistedAt: Date.now(),
    });
    this.lastPersistedAt = Date.now();
    await this.scheduleAlarm();
  }

  async maybePersist() {
    if (Date.now() - this.lastPersistedAt >= ACTIVE_PERSIST_INTERVAL_MS) {
      await this.persistNow();
    }
  }

  async tickAndBroadcast() {
    await this.advanceSimulation(Date.now());
    const payload = this.createFramePayload("step_bundle");
    this.broadcastPayload(payload);
    await this.maybePersist();
  }

  async fetch(request) {
    await this.ensureInitialized();

    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === "/api/bootstrap" && request.method === "GET") {
      await this.advanceSimulation(Date.now());
      const remoteState = this.getRemoteState();
      return jsonResponse({
        mode: "remote",
        snapshot: this.engine.getSnapshot(),
        canControl: isAuthorized(request, this.env),
        allowedTickRates: remoteState.allowedTickRates,
        viewerStreamFps: remoteState.viewerStreamFps,
        remoteLabel: "Connected to the persistent global arena.",
      });
    }

    if (pathname === "/api/stream" && request.method === "GET") {
      if (request.headers.get("upgrade") !== "websocket") {
        return new Response("Expected WebSocket upgrade.", { status: 426 });
      }

      await this.advanceSimulation(Date.now());

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.ctx.acceptWebSocket(server);

      server.send(JSON.stringify(this.createFramePayload("full_snapshot", false)));

      if (!this.engine.getMeta().paused) {
        this.scheduleActiveLoop();
      }

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    if (!pathname.startsWith("/api/admin/")) {
      return jsonResponse({ error: "Not found." }, 404);
    }

    if (!isAuthorized(request, this.env)) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    await this.advanceSimulation(Date.now());

    if (pathname === "/api/admin/pause" && request.method === "POST") {
      this.engine.setPaused(true);
      this.stopActiveLoop();
      const payload = this.createFramePayload("system_notice");
      this.broadcastPayload(payload);
      await this.persistNow();
      return jsonResponse({
        ...payload,
        canControl: true,
      });
    }

    if (pathname === "/api/admin/resume" && request.method === "POST") {
      this.engine.setPaused(false);
      this.lastWallClockAt = Date.now();
      this.accumulatorMs = 0;
      const payload = this.createFramePayload("system_notice");
      this.broadcastPayload(payload);
      await this.persistNow();
      this.scheduleActiveLoop();
      return jsonResponse({
        ...payload,
        canControl: true,
      });
    }

    if (pathname === "/api/admin/reset" && request.method === "POST") {
      this.engine.resetMatch();
      this.lastWallClockAt = Date.now();
      this.accumulatorMs = 0;
      const payload = this.createFramePayload("system_notice");
      this.broadcastPayload(payload);
      await this.persistNow();
      if (!this.engine.getMeta().paused) {
        this.scheduleActiveLoop();
      }
      return jsonResponse({
        ...payload,
        canControl: true,
      });
    }

    if (pathname === "/api/admin/tick-rate" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const normalizedTickRate = normalizeRemoteTickRate(
        body.tickRate,
        this.getRemoteState().allowedTickRates
      );
      this.engine.setTickRate(normalizedTickRate);
      this.lastWallClockAt = Date.now();
      this.accumulatorMs = 0;
      const payload = this.createFramePayload("system_notice");
      this.broadcastPayload(payload);
      await this.persistNow();
      if (!this.engine.getMeta().paused) {
        this.scheduleActiveLoop();
      }
      return jsonResponse({
        ...payload,
        canControl: true,
      });
    }

    return jsonResponse({ error: "Not found." }, 404);
  }

  async alarm() {
    await this.ensureInitialized();
    await this.advanceSimulation(Date.now());

    if (!this.hasViewers()) {
      this.engine.consumeEvents();
    }

    await this.persistNow();
    if (this.hasViewers() && !this.engine.getMeta().paused) {
      this.scheduleActiveLoop();
    }
  }

  webSocketMessage() {}

  webSocketClose() {
    if (!this.hasViewers()) {
      this.stopActiveLoop();
    }
  }

  webSocketError() {
    if (!this.hasViewers()) {
      this.stopActiveLoop();
    }
  }
}
