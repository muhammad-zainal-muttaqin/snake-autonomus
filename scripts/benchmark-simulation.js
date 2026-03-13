const path = require("path");
const { performance } = require("perf_hooks");
const { pathToFileURL } = require("url");

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function loadCreateEngine() {
  const modulePath = pathToFileURL(
    path.join(__dirname, "..", "app", "engine", "create-engine.mjs")
  ).href;
  const module = await import(modulePath);
  return module.createEngine;
}

function applyScenario(engine, scenario) {
  if (!scenario || scenario === "default") {
    return;
  }

  if (scenario === "edge-loop") {
    engine.debugMutate((state) => {
      state.roundNumber = 1;
      state.phase = "round_live";
      state.paused = false;
      state.arenaSize = 24;
      state.totalFoodEaten = 0;
      state.growths = 0;
      state.food = { x: 12, y: 12 };
      state.snakes.red.score = 0;
      state.snakes.cyan.score = 0;
      state.snakes.red.alive = true;
      state.snakes.cyan.alive = true;
      state.snakes.red.body = [
        { x: 19, y: 9 },
        { x: 20, y: 9 },
        { x: 21, y: 9 },
      ];
      state.snakes.red.storedLength = state.snakes.red.body.length;
      state.snakes.red.direction = { x: 0, y: 1 };
      state.snakes.red.recentHeadKeys = ["19,9", "19,10", "20,10", "20,9", "19,9"];
      state.snakes.red.status = "Breaking loop";
      state.snakes.cyan.body = [
        { x: 19, y: 14 },
        { x: 20, y: 14 },
        { x: 21, y: 14 },
      ];
      state.snakes.cyan.storedLength = state.snakes.cyan.body.length;
      state.snakes.cyan.direction = { x: 0, y: -1 };
      state.snakes.cyan.recentHeadKeys = ["19,14", "19,13", "20,13", "20,14", "19,14"];
      state.snakes.cyan.status = "Breaking loop";
    });
    return;
  }

  if (scenario === "food-clash") {
    engine.debugMutate((state) => {
      state.roundNumber = 1;
      state.phase = "round_live";
      state.paused = false;
      state.arenaSize = 11;
      state.totalFoodEaten = 0;
      state.foodsSinceGrowth = 0;
      state.growths = 0;
      state.food = { x: 5, y: 5 };

      state.snakes.red.score = 0;
      state.snakes.red.alive = true;
      state.snakes.red.body = [
        { x: 4, y: 5 },
        { x: 3, y: 5 },
        { x: 2, y: 5 },
      ];
      state.snakes.red.storedLength = state.snakes.red.body.length;
      state.snakes.red.direction = { x: 1, y: 0 };
      state.snakes.red.recentHeadKeys = ["4,5", "3,5", "2,5"];
      state.snakes.red.status = "Contesting food";

      state.snakes.cyan.score = 0;
      state.snakes.cyan.alive = true;
      state.snakes.cyan.body = [
        { x: 6, y: 5 },
        { x: 7, y: 5 },
        { x: 8, y: 5 },
      ];
      state.snakes.cyan.storedLength = state.snakes.cyan.body.length;
      state.snakes.cyan.direction = { x: -1, y: 0 };
      state.snakes.cyan.recentHeadKeys = ["6,5", "7,5", "8,5"];
      state.snakes.cyan.status = "Contesting food";
    });
    return;
  }

  throw new Error(`Unknown benchmark scenario: ${scenario}`);
}

async function runBenchmark({
  tickRate,
  ticks,
  scenario,
}) {
  const createEngine = await loadCreateEngine();
  const engine = createEngine({
    tickRate,
    seed: 1337,
  });

  applyScenario(engine, scenario);

  let maxWidth = 0;
  let roundsCompleted = 0;
  let breakoutStatusSeen = false;
  let escapedLoopRegion = false;
  let previousHeads = null;
  let executedTicks = 0;

  const startedAt = performance.now();

  for (let step = 0; step < ticks; step += 1) {
    engine.step();
    executedTicks += 1;
    const snapshot = engine.getSnapshot();
    const events = engine.consumeEvents();

    for (const event of events) {
      if (event.type === "round_resolved") {
        roundsCompleted += 1;
      }
    }

    const redStatus = snapshot.snakes.red.status;
    const cyanStatus = snapshot.snakes.cyan.status;
    breakoutStatusSeen =
      breakoutStatusSeen ||
      redStatus === "Breaking loop" ||
      cyanStatus === "Breaking loop" ||
      redStatus === "Escaping" ||
      cyanStatus === "Escaping";

    if (previousHeads) {
      const redMoved = previousHeads.red !== `${snapshot.snakes.red.head.x},${snapshot.snakes.red.head.y}`;
      const cyanMoved = previousHeads.cyan !== `${snapshot.snakes.cyan.head.x},${snapshot.snakes.cyan.head.y}`;
      escapedLoopRegion = escapedLoopRegion || redMoved || cyanMoved;
    }

    previousHeads = {
      red: `${snapshot.snakes.red.head.x},${snapshot.snakes.red.head.y}`,
      cyan: `${snapshot.snakes.cyan.head.x},${snapshot.snakes.cyan.head.y}`,
    };

    maxWidth = Math.max(maxWidth, snapshot.arena.size);
    if (snapshot.phase === "match_over") {
      break;
    }
  }

  const elapsedMs = performance.now() - startedAt;
  const snapshot = engine.getSnapshot();

  return {
    tickRate,
    ticksRequested: ticks,
    ticksExecuted: executedTicks,
    scenario,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    effectiveTicksPerSecond: Number(
      ((executedTicks / elapsedMs) * 1000).toFixed(2)
    ),
    roundsCompleted,
    maxWidth,
    breakoutStatusSeen,
    escapedLoopRegion,
    roundNumber: snapshot.roundNumber,
    width: snapshot.arena.width,
    height: snapshot.arena.height,
    occupancy: Number((snapshot.arena.occupancy ?? 0).toFixed(3)),
    pathPressure: Number((snapshot.arena.pathPressure ?? 0).toFixed(3)),
    foodCount: snapshot.arena.totalFoodEaten,
    red: snapshot.snakes.red.score,
    cyan: snapshot.snakes.cyan.score,
    phase: snapshot.phase,
    roundTicks: snapshot.roundTick,
    redStatus: snapshot.snakes.red.status,
    cyanStatus: snapshot.snakes.cyan.status,
  };
}

async function main() {
  const tickRate = parseNumber(process.argv[2], 1024);
  const ticks = parseNumber(process.argv[3], 1000);
  const scenario = process.argv[4] ?? "default";

  const result = await runBenchmark({
    tickRate,
    ticks,
    scenario,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
