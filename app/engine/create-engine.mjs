import { chooseMove } from "../ai/choose-move.mjs";
import { DIRECTIONS, SNAKE_META, createConfig } from "../shared/config.mjs";
import {
  addPoint,
  clamp,
  createSquareBounds,
  getBoundsSize,
  isInsideBounds,
  keyOfCell,
  oppositeDirection,
  sameCell,
} from "../shared/geometry.mjs";
import { createRng } from "../shared/rng.mjs";

const STARTING_SNAKE_LENGTH = 3;

function cloneDirection(direction) {
  return {
    x: direction.x,
    y: direction.y,
  };
}

function clonePoint(point) {
  return {
    x: point.x,
    y: point.y,
  };
}

function getGrowthIntervalForSize(arenaSize, config) {
  const { initialSize, growthInterval, growthLogRamp, growthLogExponent } = config.world;
  const sizeRatio = Math.max(1, arenaSize / initialSize);
  const logDistance = Math.log2(sizeRatio);
  return (
    growthInterval +
    Math.max(0, Math.floor((logDistance ** growthLogExponent) * growthLogRamp))
  );
}

function getFoodsUntilGrowth(state, config) {
  if (
    Number.isFinite(config.world.maxSize) &&
    state.arenaSize >= config.world.maxSize
  ) {
    return 0;
  }
  const currentInterval = getGrowthIntervalForSize(state.arenaSize, config);
  return Math.max(0, currentInterval - state.foodsSinceGrowth);
}

function createSnakeState(meta) {
  return {
    id: meta.id,
    name: meta.name,
    palette: meta.palette,
    score: 0,
    storedLength: STARTING_SNAKE_LENGTH,
    alive: true,
    body: [],
    direction: { x: 1, y: 0 },
    status: "Scanning",
    mode: "route",
    lastDecision: null,
    recentHeadKeys: [],
  };
}

function createInitialState(config) {
  return {
    version: 0,
    tickRate: config.tickRate,
    paused: false,
    phase: "round_boot",
    roundNumber: 1,
    roundTick: 0,
    matchTick: 0,
    arenaSize: config.world.initialSize,
    totalFoodEaten: 0,
    foodsSinceGrowth: 0,
    growths: 0,
    intermissionTicksRemaining: 0,
    food: null,
    lastRound: null,
    matchWinnerId: null,
    snakes: {
      red: createSnakeState(SNAKE_META.red),
      cyan: createSnakeState(SNAKE_META.cyan),
    },
    events: [],
  };
}

function queueEvent(state, type, payload = {}) {
  state.events.push({
    type,
    tick: state.matchTick,
    roundNumber: state.roundNumber,
    ...payload,
  });
}

function createBoardSpawnPath(arenaSize) {
  const path = [];
  for (let x = 0; x < arenaSize; x += 1) {
    if (x % 2 === 0) {
      for (let y = 0; y < arenaSize; y += 1) {
        path.push({ x, y });
      }
      continue;
    }
    for (let y = arenaSize - 1; y >= 0; y -= 1) {
      path.push({ x, y });
    }
  }
  return path;
}

function createSpawnBody(path, length, edge) {
  if (edge === "start") {
    return path
      .slice(0, length)
      .reverse()
      .map(clonePoint);
  }
  return path
    .slice(path.length - length)
    .map(clonePoint);
}

function getDirectionFromBody(body, fallbackDirection) {
  if (body.length < 2) {
    return cloneDirection(fallbackDirection);
  }
  return {
    x: body[0].x - body[1].x,
    y: body[0].y - body[1].y,
  };
}

function ensureSpawnCapacity(state, config) {
  const requiredCells =
    state.snakes.red.storedLength + state.snakes.cyan.storedLength + 1;

  while (
    state.arenaSize * state.arenaSize < requiredCells &&
    state.arenaSize < config.world.maxSize
  ) {
    state.arenaSize += 1;
  }

  if (state.arenaSize * state.arenaSize < requiredCells) {
    throw new Error("Arena size cannot fit persistent snake lengths.");
  }
}

function buildOccupiedSet(state) {
  const occupied = new Set();
  for (const snake of Object.values(state.snakes)) {
    for (const segment of snake.body) {
      occupied.add(keyOfCell(segment));
    }
  }
  return occupied;
}

function spawnFood(state, config, rng) {
  const bounds = createSquareBounds(state.arenaSize);
  const occupied = buildOccupiedSet(state);
  let bestScore = -Infinity;
  let bestCells = [];

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const cell = { x, y };
      if (occupied.has(keyOfCell(cell))) {
        continue;
      }
      const redDistance =
        Math.abs(cell.x - state.snakes.red.body[0].x) +
        Math.abs(cell.y - state.snakes.red.body[0].y);
      const cyanDistance =
        Math.abs(cell.x - state.snakes.cyan.body[0].x) +
        Math.abs(cell.y - state.snakes.cyan.body[0].y);
      const minHeadDistance = Math.min(redDistance, cyanDistance);
      const maxHeadDistance = Math.max(redDistance, cyanDistance);
      const distanceBufferScore =
        minHeadDistance >= config.food.spawnHeadBuffer ? 80 : minHeadDistance * 8;
      const spreadScore = maxHeadDistance - minHeadDistance;
      const score = distanceBufferScore - spreadScore + rng.next();

      if (score > bestScore) {
        bestScore = score;
        bestCells = [cell];
      } else if (Math.abs(score - bestScore) < 0.00001) {
        bestCells.push(cell);
      }
    }
  }

  if (!bestCells.length) {
    return null;
  }
  return clonePoint(bestCells[rng.int(bestCells.length)]);
}

function startRound(state, config, rng) {
  ensureSpawnCapacity(state, config);
  const spawnPath = createBoardSpawnPath(state.arenaSize);

  const redBody = createSpawnBody(
    spawnPath,
    state.snakes.red.storedLength,
    "start"
  );
  const cyanBody = createSpawnBody(
    spawnPath,
    state.snakes.cyan.storedLength,
    "end"
  );

  state.snakes.red.alive = true;
  state.snakes.red.body = redBody;
  state.snakes.red.direction = getDirectionFromBody(redBody, { x: 0, y: 1 });
  state.snakes.red.status = "Scanning";
  state.snakes.red.mode = "route";
  state.snakes.red.lastDecision = null;
  state.snakes.red.recentHeadKeys = [keyOfCell(redBody[0])];

  state.snakes.cyan.alive = true;
  state.snakes.cyan.body = cyanBody;
  state.snakes.cyan.direction = getDirectionFromBody(cyanBody, { x: 0, y: 1 });
  state.snakes.cyan.status = "Scanning";
  state.snakes.cyan.mode = "route";
  state.snakes.cyan.lastDecision = null;
  state.snakes.cyan.recentHeadKeys = [keyOfCell(cyanBody[0])];

  state.phase = "round_live";
  state.roundTick = 0;
  state.intermissionTicksRemaining = 0;
  state.matchWinnerId = null;
  state.food = spawnFood(state, config, rng);
  queueEvent(state, "round_started", {
    arenaSize: state.arenaSize,
    foodsUntilGrowth: getFoodsUntilGrowth(state, config),
    redLength: state.snakes.red.storedLength,
    cyanLength: state.snakes.cyan.storedLength,
  });
}

function updateHeadMemory(snake, limit) {
  snake.recentHeadKeys.push(keyOfCell(snake.body[0]));
  if (snake.recentHeadKeys.length > limit) {
    snake.recentHeadKeys.splice(0, snake.recentHeadKeys.length - limit);
  }
}

function createBodySet(body, trimTail) {
  const segments = trimTail ? body.slice(0, -1) : body;
  return new Set(segments.map(keyOfCell));
}

function detectCollision(result, state, nextHeads, growsBySnake) {
  const bounds = createSquareBounds(state.arenaSize);
  const redSnake = state.snakes.red;
  const cyanSnake = state.snakes.cyan;
  const redHead = nextHeads.red;
  const cyanHead = nextHeads.cyan;

  if (!isInsideBounds(redHead, bounds)) {
    result.red.alive = false;
    result.red.reason = "wall";
  }
  if (!isInsideBounds(cyanHead, bounds)) {
    result.cyan.alive = false;
    result.cyan.reason = "wall";
  }

  if (sameCell(redHead, cyanHead)) {
    if (redSnake.body.length > cyanSnake.body.length) {
      result.cyan.alive = false;
      result.cyan.reason = "head_on";
    } else if (cyanSnake.body.length > redSnake.body.length) {
      result.red.alive = false;
      result.red.reason = "head_on";
    } else {
      result.red.alive = false;
      result.cyan.alive = false;
      result.red.reason = "head_on";
      result.cyan.reason = "head_on";
    }
  }

  if (
    result.red.alive &&
    result.cyan.alive &&
    sameCell(redHead, cyanSnake.body[0]) &&
    sameCell(cyanHead, redSnake.body[0])
  ) {
    if (redSnake.body.length > cyanSnake.body.length) {
      result.cyan.alive = false;
      result.cyan.reason = "head_swap";
    } else if (cyanSnake.body.length > redSnake.body.length) {
      result.red.alive = false;
      result.red.reason = "head_swap";
    } else {
      result.red.alive = false;
      result.cyan.alive = false;
      result.red.reason = "head_swap";
      result.cyan.reason = "head_swap";
    }
  }

  const redBody = createBodySet(redSnake.body, !growsBySnake.red);
  const cyanBody = createBodySet(cyanSnake.body, !growsBySnake.cyan);

  if (
    result.red.alive &&
    (redBody.has(keyOfCell(redHead)) || cyanBody.has(keyOfCell(redHead)))
  ) {
    result.red.alive = false;
    result.red.reason = "body";
  }

  if (
    result.cyan.alive &&
    (cyanBody.has(keyOfCell(cyanHead)) || redBody.has(keyOfCell(cyanHead)))
  ) {
    result.cyan.alive = false;
    result.cyan.reason = "body";
  }
}

function applyGrowth(state, config) {
  const currentInterval = getGrowthIntervalForSize(state.arenaSize, config);
  if (state.foodsSinceGrowth < currentInterval) {
    return;
  }
  const nextSize = Math.min(
    state.arenaSize + config.world.growthStep,
    config.world.maxSize
  );
  if (nextSize === state.arenaSize) {
    return;
  }
  state.arenaSize = nextSize;
  state.foodsSinceGrowth = 0;
  state.growths += 1;
  queueEvent(state, "arena_grew", {
    arenaSize: state.arenaSize,
    foodsUntilGrowth: getFoodsUntilGrowth(state, config),
  });
}

function resolveRound(state, config, winnerId, reason) {
  if (winnerId === "red" || winnerId === "cyan") {
    state.snakes[winnerId].score += 1;
  }

  const winnerName =
    winnerId === "red" || winnerId === "cyan"
      ? state.snakes[winnerId].name
      : "Draw";

  if (winnerId === "red" || winnerId === "cyan") {
    state.snakes[winnerId].status = "Wins round";
    const loserId = winnerId === "red" ? "cyan" : "red";
    state.snakes[loserId].status = "Downed";
  } else {
    state.snakes.red.status = "Crashed";
    state.snakes.cyan.status = "Crashed";
  }

  state.lastRound = {
    roundNumber: state.roundNumber,
    winnerId,
    winnerName,
    reason,
  };

  const winTarget = config.match.winTarget;
  const matchFinished =
    Number.isFinite(winTarget) &&
    (state.snakes.red.score >= winTarget || state.snakes.cyan.score >= winTarget);

  queueEvent(state, "round_resolved", {
    winnerId,
    winnerName,
    reason,
    matchFinished,
    redScore: state.snakes.red.score,
    cyanScore: state.snakes.cyan.score,
    redLength: state.snakes.red.storedLength,
    cyanLength: state.snakes.cyan.storedLength,
    nextRoundNumber: state.roundNumber + 1,
  });

  if (matchFinished) {
    state.phase = "match_over";
    state.matchWinnerId =
      state.snakes.red.score === state.snakes.cyan.score
        ? "draw"
        : state.snakes.red.score > state.snakes.cyan.score
        ? "red"
        : "cyan";
    queueEvent(state, "match_finished", {
      winnerId: state.matchWinnerId,
      winnerName:
        state.matchWinnerId === "red" || state.matchWinnerId === "cyan"
          ? state.snakes[state.matchWinnerId].name
          : "Draw",
    });
    return;
  }

  state.phase = "round_intermission";
  state.intermissionTicksRemaining = config.round.intermissionTicks;
}

function getWinnerFromSurvivors(result) {
  if (result.red.alive && !result.cyan.alive) {
    return "red";
  }
  if (result.cyan.alive && !result.red.alive) {
    return "cyan";
  }
  return "draw";
}

function selectRoundReason(result) {
  return result.red.reason || result.cyan.reason || "board_lock";
}

function createSnapshot(state, config) {
  return {
    version: state.version,
    paused: state.paused,
    tickRate: state.tickRate,
    phase: state.phase,
    roundNumber: state.roundNumber,
    roundTick: state.roundTick,
    matchTick: state.matchTick,
    lastRound: state.lastRound ? { ...state.lastRound } : null,
    arena: {
      size: state.arenaSize,
      maxSize: config.world.maxSize,
      totalFoodEaten: state.totalFoodEaten,
      growthInterval: getGrowthIntervalForSize(state.arenaSize, config),
      foodsUntilGrowth: getFoodsUntilGrowth(state, config),
      growths: state.growths,
      width: state.arenaSize,
      height: state.arenaSize,
    },
    food: state.food ? clonePoint(state.food) : null,
    match: {
      winTarget: config.match.winTarget,
      winnerId: state.matchWinnerId,
    },
    snakes: Object.fromEntries(
      Object.entries(state.snakes).map(([snakeId, snake]) => [
        snakeId,
        {
          id: snake.id,
          name: snake.name,
          palette: snake.palette,
          score: snake.score,
          alive: snake.alive,
          length: snake.storedLength,
          status: snake.status,
          mode: snake.mode,
          direction: cloneDirection(snake.direction),
          head: clonePoint(snake.body[0]),
          body: snake.body.map(clonePoint),
        },
      ])
    ),
  };
}

export function createEngine(overrides = {}) {
  const config = createConfig(overrides);
  let rng = createRng(config.seed);
  const state = createInitialState(config);

  startRound(state, config, rng);
  state.version += 1;

  function advanceIntermission() {
    if (state.phase !== "round_intermission") {
      return false;
    }
    state.intermissionTicksRemaining -= 1;
    if (state.intermissionTicksRemaining <= 0) {
      state.roundNumber += 1;
      startRound(state, config, rng);
    }
    state.matchTick += 1;
    state.version += 1;
    return true;
  }

  function step() {
    if (state.paused || state.phase === "match_over") {
      return false;
    }

    if (state.phase === "round_intermission") {
      return advanceIntermission();
    }

    const decisions = {
      red: chooseMove({ state, snakeId: "red", config }),
      cyan: chooseMove({ state, snakeId: "cyan", config }),
    };

    const nextHeads = {
      red: addPoint(state.snakes.red.body[0], decisions.red.direction),
      cyan: addPoint(state.snakes.cyan.body[0], decisions.cyan.direction),
    };
    const growsBySnake = {
      red: Boolean(state.food && sameCell(nextHeads.red, state.food)),
      cyan: Boolean(state.food && sameCell(nextHeads.cyan, state.food)),
    };
    const result = {
      red: { alive: true, reason: "" },
      cyan: { alive: true, reason: "" },
    };

    detectCollision(result, state, nextHeads, growsBySnake);

    state.snakes.red.lastDecision = decisions.red;
    state.snakes.cyan.lastDecision = decisions.cyan;
    state.snakes.red.direction = cloneDirection(decisions.red.direction);
    state.snakes.cyan.direction = cloneDirection(decisions.cyan.direction);
    state.snakes.red.mode = decisions.red.mode;
    state.snakes.cyan.mode = decisions.cyan.mode;
    state.snakes.red.status = decisions.red.status;
    state.snakes.cyan.status = decisions.cyan.status;

    if (!result.red.alive || !result.cyan.alive) {
      state.snakes.red.alive = result.red.alive;
      state.snakes.cyan.alive = result.cyan.alive;
      resolveRound(
        state,
        config,
        getWinnerFromSurvivors(result),
        selectRoundReason(result)
      );
      state.matchTick += 1;
      state.roundTick += 1;
      state.version += 1;
      return true;
    }

    for (const snakeId of ["red", "cyan"]) {
      const snake = state.snakes[snakeId];
      snake.body.unshift(nextHeads[snakeId]);
      if (!growsBySnake[snakeId]) {
        snake.body.pop();
      }
      updateHeadMemory(snake, config.ai.revisitMemory * 2);
    }

    let eaterId = null;
    if (growsBySnake.red) {
      eaterId = "red";
    } else if (growsBySnake.cyan) {
      eaterId = "cyan";
    }

    if (eaterId) {
      state.snakes[eaterId].storedLength += 1;
      state.totalFoodEaten += 1;
      state.foodsSinceGrowth += 1;
      queueEvent(state, "food_eaten", {
        snakeId: eaterId,
        snakeLength: state.snakes[eaterId].storedLength,
        totalFoodEaten: state.totalFoodEaten,
      });
      applyGrowth(state, config);
      state.food = spawnFood(state, config, rng);
    }

    state.roundTick += 1;
    state.matchTick += 1;
    state.version += 1;
    return true;
  }

  function resetMatch() {
    const redScore = state.snakes.red.score;
    const cyanScore = state.snakes.cyan.score;
    rng = createRng(config.seed);
    state.version = 0;
    state.paused = false;
    state.phase = "round_boot";
    state.roundNumber = 1;
    state.roundTick = 0;
    state.matchTick = 0;
    state.arenaSize = config.world.initialSize;
    state.totalFoodEaten = 0;
    state.foodsSinceGrowth = 0;
    state.growths = 0;
    state.lastRound = null;
    state.matchWinnerId = null;
    state.snakes.red.score = 0;
    state.snakes.cyan.score = 0;
    state.snakes.red.storedLength = STARTING_SNAKE_LENGTH;
    state.snakes.cyan.storedLength = STARTING_SNAKE_LENGTH;
    queueEvent(state, "match_reset", {
      previousRedScore: redScore,
      previousCyanScore: cyanScore,
    });
    startRound(state, config, rng);
    state.version += 1;
  }

  function setPaused(nextPaused) {
    const normalized = Boolean(nextPaused);
    if (state.paused === normalized) {
      return;
    }
    state.paused = normalized;
    queueEvent(state, normalized ? "match_paused" : "match_resumed");
    state.version += 1;
  }

  function setTickRate(nextTickRate) {
    const normalized = clamp(
      Math.round(Number(nextTickRate) || config.tickRate),
      1,
      4096
    );
    if (state.tickRate === normalized) {
      return;
    }
    state.tickRate = normalized;
    queueEvent(state, "tick_rate_changed", {
      tickRate: state.tickRate,
    });
    state.version += 1;
  }

  function getSnapshot() {
    return createSnapshot(state, config);
  }

  function consumeEvents() {
    const events = state.events.slice();
    state.events.length = 0;
    return events;
  }

  function getMeta() {
    return {
      paused: state.paused,
      phase: state.phase,
      tickRate: state.tickRate,
      version: state.version,
    };
  }

  function debugMutate(mutator) {
    if (typeof mutator === "function") {
      mutator(state, {
        DIRECTIONS,
        createSquareBounds,
        getBoundsSize,
        keyOfCell,
        oppositeDirection,
        spawnFood: () => spawnFood(state, config, rng),
      });
      state.version += 1;
    }
  }

  return {
    config,
    step,
    resetMatch,
    setPaused,
    setTickRate,
    getSnapshot,
    consumeEvents,
    getMeta,
    debugMutate,
  };
}
