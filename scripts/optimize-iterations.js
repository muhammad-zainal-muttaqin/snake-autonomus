const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { performance } = require("perf_hooks");

const REPO_ROOT = path.join(__dirname, "..");
const SCRIPT_PATH = path.join(REPO_ROOT, "script.js");
const OUTPUT_PATH = path.join(REPO_ROOT, "scripts", "perf-iterations.json");
const ITERATIONS = 100;

const PARAMS = {
  AI_ANALYSIS_MARGIN: { type: "int", min: 12, max: 32, step: 2 },
  LOOP_STALL_TRIGGER_TICKS: { type: "int", min: 16, max: 48, step: 4 },
  LOOP_REPEAT_TRIGGER: { type: "int", min: 4, max: 12, step: 1 },
  BREAKOUT_TICKS: { type: "int", min: 4, max: 16, step: 1 },
  BREAKOUT_EDGE_TARGET_DISTANCE: { type: "int", min: 4, max: 16, step: 1 },
  OPPONENT_PREDICTION_COUNT: { type: "int", min: 1, max: 4, step: 1 },
  OPPONENT_PREDICTION_FALLOFF: { type: "float", min: 0.35, max: 0.85, step: 0.03 },
  FOOD_RUSH_GATE_WIDTH: { type: "int", min: 18, max: 32, step: 2 },
  FOOD_RUSH_GATE_LENGTH: { type: "int", min: 6, max: 16, step: 1 },
  FOOD_RUSH_GATE_RATIO: { type: "float", min: 0.04, max: 0.14, step: 0.01 },
  FOOD_RUSH_BIAS_WIDTH: { type: "int", min: 20, max: 44, step: 2 },
  FOOD_RUSH_BIAS_BASE: { type: "float", min: 0.15, max: 0.8, step: 0.05 },
  FOOD_RUSH_LENGTH_OFFSET: { type: "int", min: 6, max: 16, step: 1 },
  FOOD_RUSH_LENGTH_WEIGHT: { type: "float", min: 0.02, max: 0.12, step: 0.01 },
  FOOD_RUSH_RATIO_OFFSET: { type: "float", min: 0.04, max: 0.14, step: 0.01 },
  FOOD_RUSH_RATIO_WEIGHT: { type: "float", min: 3, max: 12, step: 0.5 },
  FOOD_RUSH_CAP: { type: "float", min: 2.5, max: 5.5, step: 0.25 },
  FOOD_RUSH_OFFSET: { type: "float", min: 0.35, max: 1.05, step: 0.05 },
  LARGE_ARENA_THRESHOLD: { type: "int", min: 52, max: 88, step: 4 },
};

const PATTERNS = {
  AI_ANALYSIS_MARGIN: /const AI_ANALYSIS_MARGIN = [^;]+;/,
  LOOP_STALL_TRIGGER_TICKS: /const LOOP_STALL_TRIGGER_TICKS = [^;]+;/,
  LOOP_REPEAT_TRIGGER: /const LOOP_REPEAT_TRIGGER = [^;]+;/,
  BREAKOUT_TICKS: /const BREAKOUT_TICKS = [^;]+;/,
  BREAKOUT_EDGE_TARGET_DISTANCE: /const BREAKOUT_EDGE_TARGET_DISTANCE = [^;]+;/,
  OPPONENT_PREDICTION_COUNT: /const OPPONENT_PREDICTION_COUNT = [^;]+;/,
  OPPONENT_PREDICTION_FALLOFF: /const OPPONENT_PREDICTION_FALLOFF = [^;]+;/,
  FOOD_RUSH_GATE: /if \(worldWidth < 24 && crowding\.longestSnake < 10 && crowding\.ratio < 0\.08\) \{/,
  FOOD_RUSH_BIAS_WIDTH: /\(worldWidth >= 28 \? 0\.45 : 0\)/,
  FOOD_RUSH_LENGTH_WEIGHT: /Math\.max\(0, crowding\.longestSnake - 10\) \* 0\.06/,
  FOOD_RUSH_RATIO_WEIGHT: /Math\.max\(0, crowding\.ratio - 0\.08\) \* 8/,
  FOOD_RUSH_CAP_LINE: /Math\.min\(4\.5, staleSeconds \+ boardBias - 0\.65\)/,
  LARGE_ARENA_THRESHOLD: /const largeArena = worldWidth >= 64;/,
};

const BASE_PARAMS = {
  AI_ANALYSIS_MARGIN: 24,
  LOOP_STALL_TRIGGER_TICKS: 32,
  LOOP_REPEAT_TRIGGER: 8,
  BREAKOUT_TICKS: 10,
  BREAKOUT_EDGE_TARGET_DISTANCE: 8,
  OPPONENT_PREDICTION_COUNT: 3,
  OPPONENT_PREDICTION_FALLOFF: 0.62,
  FOOD_RUSH_GATE_WIDTH: 24,
  FOOD_RUSH_GATE_LENGTH: 10,
  FOOD_RUSH_GATE_RATIO: 0.08,
  FOOD_RUSH_BIAS_WIDTH: 28,
  FOOD_RUSH_BIAS_BASE: 0.45,
  FOOD_RUSH_LENGTH_OFFSET: 10,
  FOOD_RUSH_LENGTH_WEIGHT: 0.06,
  FOOD_RUSH_RATIO_OFFSET: 0.08,
  FOOD_RUSH_RATIO_WEIGHT: 8,
  FOOD_RUSH_CAP: 4.5,
  FOOD_RUSH_OFFSET: 0.65,
  LARGE_ARENA_THRESHOLD: 64,
};

function createSeededMath(seed) {
  let state = seed >>> 0;
  return Object.assign(Object.create(Math), Math, {
    random() {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    },
  });
}

function makeNode(overrides = {}) {
  return {
    textContent: "",
    hidden: false,
    dataset: {},
    value: "1",
    width: 720,
    height: 720,
    addEventListener() {},
    getContext() {
      return {
        fillRect() {},
        strokeRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        arc() {},
        fill() {},
        drawImage() {},
        save() {},
        restore() {},
        fillText() {},
        roundRect() {},
        clearRect() {},
        set fillStyle(value) {},
        set strokeStyle(value) {},
        set lineWidth(value) {},
        set shadowBlur(value) {},
        set shadowColor(value) {},
        set font(value) {},
        set textAlign(value) {},
      };
    },
    ...overrides,
  };
}

function buildSource(baseSource, params) {
  let source = baseSource;
  source = source.replace(PATTERNS.AI_ANALYSIS_MARGIN, `const AI_ANALYSIS_MARGIN = ${params.AI_ANALYSIS_MARGIN};`);
  source = source.replace(PATTERNS.LOOP_STALL_TRIGGER_TICKS, `const LOOP_STALL_TRIGGER_TICKS = ${params.LOOP_STALL_TRIGGER_TICKS};`);
  source = source.replace(PATTERNS.LOOP_REPEAT_TRIGGER, `const LOOP_REPEAT_TRIGGER = ${params.LOOP_REPEAT_TRIGGER};`);
  source = source.replace(PATTERNS.BREAKOUT_TICKS, `const BREAKOUT_TICKS = ${params.BREAKOUT_TICKS};`);
  source = source.replace(
    PATTERNS.BREAKOUT_EDGE_TARGET_DISTANCE,
    `const BREAKOUT_EDGE_TARGET_DISTANCE = ${params.BREAKOUT_EDGE_TARGET_DISTANCE};`
  );
  source = source.replace(
    PATTERNS.OPPONENT_PREDICTION_COUNT,
    `const OPPONENT_PREDICTION_COUNT = ${params.OPPONENT_PREDICTION_COUNT};`
  );
  source = source.replace(
    PATTERNS.OPPONENT_PREDICTION_FALLOFF,
    `const OPPONENT_PREDICTION_FALLOFF = ${params.OPPONENT_PREDICTION_FALLOFF.toFixed(2)};`
  );
  source = source.replace(
    PATTERNS.FOOD_RUSH_GATE,
    `if (worldWidth < ${params.FOOD_RUSH_GATE_WIDTH} && crowding.longestSnake < ${params.FOOD_RUSH_GATE_LENGTH} && crowding.ratio < ${params.FOOD_RUSH_GATE_RATIO.toFixed(2)}) {`
  );
  source = source.replace(
    PATTERNS.FOOD_RUSH_BIAS_WIDTH,
    `(worldWidth >= ${params.FOOD_RUSH_BIAS_WIDTH} ? ${params.FOOD_RUSH_BIAS_BASE.toFixed(2)} : 0)`
  );
  source = source.replace(
    PATTERNS.FOOD_RUSH_LENGTH_WEIGHT,
    `Math.max(0, crowding.longestSnake - ${params.FOOD_RUSH_LENGTH_OFFSET}) * ${params.FOOD_RUSH_LENGTH_WEIGHT.toFixed(2)}`
  );
  source = source.replace(
    PATTERNS.FOOD_RUSH_RATIO_WEIGHT,
    `Math.max(0, crowding.ratio - ${params.FOOD_RUSH_RATIO_OFFSET.toFixed(2)}) * ${params.FOOD_RUSH_RATIO_WEIGHT.toFixed(1)}`
  );
  source = source.replace(
    PATTERNS.FOOD_RUSH_CAP_LINE,
    `Math.min(${params.FOOD_RUSH_CAP.toFixed(2)}, staleSeconds + boardBias - ${params.FOOD_RUSH_OFFSET.toFixed(2)})`
  );
  source = source.replace(
    PATTERNS.LARGE_ARENA_THRESHOLD,
    `const largeArena = worldWidth >= ${params.LARGE_ARENA_THRESHOLD};`
  );
  return source;
}

function createHarness(source, tickRate, seed) {
  const nodes = new Map();
  const ids = [
    "game",
    "red-score",
    "cyan-score",
    "round-count",
    "red-status",
    "cyan-status",
    "round-status",
    "arena-growth",
    "arena-size",
    "arena-notice",
    "arena-notice-title",
    "arena-notice-detail",
    "speed",
    "speed-value",
    "zoom",
    "zoom-value",
    "zoom-out",
    "zoom-in",
    "toggle-run",
    "restart",
  ];
  ids.forEach((id) => nodes.set(id, makeNode()));
  nodes.get("speed").value = String(tickRate);
  nodes.get("zoom").value = "1";

  const context = {
    console,
    Math: createSeededMath(seed),
    performance,
    document: {
      getElementById(id) {
        return nodes.get(id) ?? makeNode();
      },
      createElement() {
        return makeNode();
      },
    },
    window: {
      requestAnimationFrame() {
        return 1;
      },
      cancelAnimationFrame() {},
      setTimeout() {
        return 1;
      },
      clearTimeout() {},
    },
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
  };
  context.global = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

function setupScenario(context, scenario) {
  if (scenario === "default") {
    return;
  }
  if (scenario === "large-open") {
    vm.runInContext(
      `
        roundNumber = 1;
        matchFoodCount = 40;
        paused = false;
        matchOver = false;
        roundTransition = false;
        resetRound(false);
        persistentArenaSize = 72;
        arenaGrowthPhase = 0;
        gameState.world.bounds = createInitialBounds(72);
        gameState.world.expansions = 0;
        gameState.foodCount = 0;
        gameState.roundTicks = 0;
        gameState.ticksSinceFood = 0;
        gameState.snakes.red.body = [{ x: 12, y: 18 }, { x: 11, y: 18 }, { x: 10, y: 18 }, { x: 9, y: 18 }, { x: 8, y: 18 }, { x: 7, y: 18 }, { x: 6, y: 18 }, { x: 5, y: 18 }, { x: 4, y: 18 }, { x: 3, y: 18 }, { x: 2, y: 18 }, { x: 1, y: 18 }];
        gameState.snakes.red.direction = { x: 1, y: 0 };
        gameState.snakes.red.plannedDirection = { x: 1, y: 0 };
        gameState.snakes.cyan.body = [{ x: 60, y: 50 }, { x: 61, y: 50 }, { x: 62, y: 50 }, { x: 63, y: 50 }, { x: 64, y: 50 }, { x: 65, y: 50 }, { x: 66, y: 50 }, { x: 67, y: 50 }, { x: 68, y: 50 }, { x: 69, y: 50 }, { x: 70, y: 50 }];
        gameState.snakes.cyan.direction = { x: -1, y: 0 };
        gameState.snakes.cyan.plannedDirection = { x: -1, y: 0 };
        gameState.food = { x: 36, y: 36 };
      `,
      context
    );
    return;
  }
  throw new Error(`Unknown scenario: ${scenario}`);
}

function runScenario(source, config) {
  const context = createHarness(source, config.tickRate, config.seed);
  vm.runInContext(
    `tickRate = ${config.tickRate}; paused = false; matchOver = false; roundTransition = false;`,
    context
  );
  setupScenario(context, config.name);

  const startedAt = performance.now();
  for (let step = 0; step < config.ticks; step += 1) {
    vm.runInContext("tick()", context);
  }
  const elapsedMs = performance.now() - startedAt;
  const summary = vm.runInContext(
    "({ width: getWorldWidth(), height: getWorldHeight(), foodCount: gameState.foodCount, roundNumber, roundTicks: gameState.roundTicks, redStatus: gameState.snakes.red.status, cyanStatus: gameState.snakes.cyan.status, redLength: gameState.snakes.red.body.length, cyanLength: gameState.snakes.cyan.body.length, redScore: gameState.snakes.red.score, cyanScore: gameState.snakes.cyan.score, matchOver })",
    context
  );

  return {
    name: config.name,
    tickRate: config.tickRate,
    ticks: config.ticks,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    effectiveTicksPerSecond: Number(((config.ticks / elapsedMs) * 1000).toFixed(2)),
    ...summary,
  };
}

function evaluate(source) {
  const scenarios = [
    { name: "default", tickRate: 1024, ticks: 900, seed: 7 },
    { name: "large-open", tickRate: 1024, ticks: 180, seed: 19 },
  ];
  const results = scenarios.map((scenario) => runScenario(source, scenario));
  const defaultResult = results[0];
  const largeResult = results[1];

  let score = 0;
  score += defaultResult.effectiveTicksPerSecond;
  score += largeResult.effectiveTicksPerSecond * 1.15;
  score += defaultResult.foodCount * 18;
  score += largeResult.foodCount * 8;
  score += Math.max(defaultResult.redLength, defaultResult.cyanLength) * 2.5;
  score += defaultResult.roundNumber * 4;
  if (defaultResult.matchOver || largeResult.matchOver) {
    score -= 500;
  }
  if (defaultResult.foodCount === 0) {
    score -= 180;
  }
  if (largeResult.foodCount === 0) {
    score -= 120;
  }
  return {
    score: Number(score.toFixed(2)),
    results,
  };
}

function roundToStep(value, meta) {
  const rounded = meta.type === "int" ? Math.round(value / meta.step) * meta.step : Math.round(value / meta.step) * meta.step;
  const clamped = Math.max(meta.min, Math.min(meta.max, rounded));
  return meta.type === "int" ? Math.round(clamped) : Number(clamped.toFixed(3));
}

function mutateParams(base, iteration, rng) {
  const candidate = { ...base };
  const keys = Object.keys(PARAMS);
  const mutations = 1 + Math.floor(rng() * 3);
  const changed = [];

  for (let i = 0; i < mutations; i += 1) {
    const key = keys[Math.floor(rng() * keys.length)];
    const meta = PARAMS[key];
    const direction = rng() < 0.5 ? -1 : 1;
    const magnitudeSteps = 1 + Math.floor(rng() * (iteration < 20 ? 3 : 2));
    const nextValue = roundToStep(candidate[key] + direction * meta.step * magnitudeSteps, meta);
    if (nextValue !== candidate[key]) {
      candidate[key] = nextValue;
      changed.push(key);
    }
  }

  return {
    params: candidate,
    changed: [...new Set(changed)],
  };
}

function main() {
  const baseSource = fs.readFileSync(SCRIPT_PATH, "utf8");
  const rng = createSeededMath(123456789).random;
  const baselineSource = buildSource(baseSource, BASE_PARAMS);
  const baseline = evaluate(baselineSource);

  let bestParams = { ...BASE_PARAMS };
  let bestEval = baseline;
  const iterations = [];

  for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
    const mutation = mutateParams(bestParams, iteration, rng);
    const candidateSource = buildSource(baseSource, mutation.params);
    const candidateEval = evaluate(candidateSource);
    const accepted = candidateEval.score > bestEval.score;
    if (accepted) {
      bestParams = mutation.params;
      bestEval = candidateEval;
    }

    iterations.push({
      iteration,
      changed: mutation.changed,
      accepted,
      score: candidateEval.score,
      bestScoreAfterIteration: bestEval.score,
      deltaFromBestBefore: Number((candidateEval.score - (accepted ? iterations.at(-1)?.bestScoreAfterIteration ?? baseline.score : bestEval.score)).toFixed(2)),
      defaultTPS: candidateEval.results[0].effectiveTicksPerSecond,
      largeTPS: candidateEval.results[1].effectiveTicksPerSecond,
      defaultFood: candidateEval.results[0].foodCount,
      largeFood: candidateEval.results[1].foodCount,
      params: mutation.params,
    });
  }

  const output = {
    baseline: {
      params: BASE_PARAMS,
      score: baseline.score,
      results: baseline.results,
    },
    best: {
      params: bestParams,
      score: bestEval.score,
      results: bestEval.results,
    },
    iterations,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output.best, null, 2));
}

main();
