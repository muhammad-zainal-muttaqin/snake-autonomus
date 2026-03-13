(function bootstrapSnakeArenaBundle() {
  "use strict";

// app/shared/config.mjs
const DIRECTIONS = Object.freeze([
  Object.freeze({ x: 1, y: 0, name: "right" }),
  Object.freeze({ x: -1, y: 0, name: "left" }),
  Object.freeze({ x: 0, y: 1, name: "down" }),
  Object.freeze({ x: 0, y: -1, name: "up" }),
]);

const SNAKE_META = Object.freeze({
  red: Object.freeze({
    id: "red",
    name: "Red Viper",
    palette: "red",
  }),
  cyan: Object.freeze({
    id: "cyan",
    name: "Cyan Cobra",
    palette: "cyan",
  }),
});

const DEFAULT_CONFIG = Object.freeze({
  seed: 1337,
  tickRate: 64,
  match: Object.freeze({
    winTarget: null,
  }),
  world: Object.freeze({
    initialSize: 16,
    maxSize: Number.POSITIVE_INFINITY,
    maxStoredLength: Number.POSITIVE_INFINITY,
    growthInterval: 20,
    growthStep: 1,
    growthLogRamp: 2,
    growthLogExponent: 1.85,
    minGrowthInterval: 12,
    maxGrowthInterval: 64,
    adaptiveGrowthEnabled: true,
    targetOccupancyMin: 0.32,
    targetOccupancyMax: 0.36,
    hardOccupancyThreshold: 0.38,
    lowOccupancyThreshold: 0.3,
    targetPathPressure: 7,
    hardPathPressureThreshold: 8,
    lowPathPressureThreshold: 5.5,
  }),
  food: Object.freeze({
    spawnHeadBuffer: 4,
  }),
  round: Object.freeze({
    intermissionTicks: 22,
  }),
  ai: Object.freeze({
    floodFillLimit: 196,
    revisitMemory: 12,
    tacticalLookaheadDepth: 2,
    tacticalActivationDistance: 2,
    tacticalSpaceLimit: 48,
  }),
});

function sanitizeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mergeSection(baseSection, overrideSection) {
  return {
    ...baseSection,
    ...(overrideSection ?? {}),
  };
}

function createConfig(overrides = {}) {
  return {
    seed: sanitizeNumber(overrides.seed, DEFAULT_CONFIG.seed),
    tickRate: sanitizeNumber(overrides.tickRate, DEFAULT_CONFIG.tickRate),
    match: mergeSection(DEFAULT_CONFIG.match, overrides.match),
    world: mergeSection(DEFAULT_CONFIG.world, overrides.world),
    food: mergeSection(DEFAULT_CONFIG.food, overrides.food),
    round: mergeSection(DEFAULT_CONFIG.round, overrides.round),
    ai: mergeSection(DEFAULT_CONFIG.ai, overrides.ai),
  };
}

// app/shared/rng.mjs
function hashSeed(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) {
    return seed >>> 0;
  }
  const value = String(seed ?? "");
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seed) {
  let state = hashSeed(seed) || 0x6d2b79f5;

  function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    int(maxExclusive) {
      if (!Number.isFinite(maxExclusive) || maxExclusive <= 0) {
        return 0;
      }
      return Math.floor(next() * maxExclusive);
    },
    state() {
      return state >>> 0;
    },
  };
}

function createRngFromState(seedState) {
  const normalizedState =
    typeof seedState === "number" && Number.isFinite(seedState)
      ? seedState >>> 0
      : hashSeed(seedState);
  return createRng(normalizedState || 0x6d2b79f5);
}

// app/shared/geometry.mjs
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createSquareBounds(size) {
  return {
    minX: 0,
    maxX: size - 1,
    minY: 0,
    maxY: size - 1,
  };
}

function getBoundsSize(bounds) {
  return bounds.maxX - bounds.minX + 1;
}

function centerCell(bounds) {
  return {
    x: Math.floor((bounds.minX + bounds.maxX) / 2),
    y: Math.floor((bounds.minY + bounds.maxY) / 2),
  };
}

function keyOfCell(cell) {
  return `${cell.x},${cell.y}`;
}

function sameCell(a, b) {
  return Boolean(a && b) && a.x === b.x && a.y === b.y;
}

function addPoint(point, vector) {
  return {
    x: point.x + vector.x,
    y: point.y + vector.y,
  };
}

function manhattanDistance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function isInsideBounds(cell, bounds) {
  return (
    cell.x >= bounds.minX &&
    cell.x <= bounds.maxX &&
    cell.y >= bounds.minY &&
    cell.y <= bounds.maxY
  );
}

function minEdgeDistance(cell, bounds) {
  return Math.min(
    cell.x - bounds.minX,
    bounds.maxX - cell.x,
    cell.y - bounds.minY,
    bounds.maxY - cell.y
  );
}

function oppositeDirection(a, b) {
  return Boolean(a && b) && a.x === -b.x && a.y === -b.y;
}

function directionKey(direction) {
  return `${direction.x},${direction.y}`;
}

// app/shared/selectors.mjs
function pluralize(count, singular, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function formatTickRate(tickRate) {
  return `${Math.round(tickRate)} TPS`;
}

function formatZoom(zoom) {
  return `${zoom.toFixed(2)}x`;
}

function getArenaSizeLabel(snapshot) {
  const { size } = snapshot.arena;
  return `${size} x ${size}`;
}

function getSnakeDetailLabel(snake) {
  return `Len ${snake.length} | ${snake.status}`;
}

function getArenaGrowthLabel(snapshot) {
  if (
    Number.isFinite(snapshot.arena.maxSize) &&
    snapshot.arena.size >= snapshot.arena.maxSize
  ) {
    return "Growth capped";
  }
  const foods = snapshot.arena.foodsUntilGrowth;
  return `+1 in ${foods} ${pluralize(foods, "food")}`;
}

function getRoundStatusLabel(snapshot) {
  if (snapshot.phase === "match_over") {
    return "Match finished";
  }
  if (snapshot.paused) {
    return "Paused";
  }
  if (snapshot.phase === "round_intermission") {
    return "Fresh round loading";
  }
  return "Live duel";
}

function getAssistiveSummary(snapshot) {
  const roundLead =
    snapshot.phase === "match_over"
      ? snapshot.match.winnerId === "draw"
        ? "Match finished in a draw."
        : snapshot.match.winnerId
        ? `${snapshot.snakes[snapshot.match.winnerId].name} wins the match.`
        : "Match finished."
      : snapshot.phase === "round_intermission"
      ? `Round ${snapshot.roundNumber} complete.`
      : snapshot.paused
      ? "Match paused."
      : `Round ${snapshot.roundNumber} live.`;

  return [
    roundLead,
    `${snapshot.snakes.red.name}: ${snapshot.snakes.red.score} wins, length ${snapshot.snakes.red.length}, ${snapshot.snakes.red.status}.`,
    `${snapshot.snakes.cyan.name}: ${snapshot.snakes.cyan.score} wins, length ${snapshot.snakes.cyan.length}, ${snapshot.snakes.cyan.status}.`,
    `Arena ${getArenaSizeLabel(snapshot)}. ${getArenaGrowthLabel(snapshot)}.`,
  ].join(" ");
}

function describeWinner(event) {
  if (event.winnerId === "draw") {
    return "Draw round";
  }
  return `${event.winnerName} wins round`;
}

function describeResolution(event) {
  const reasons = {
    wall: "A wall collision ended the round.",
    body: "A body collision ended the round.",
    head_on: "The heads collided in the same lane.",
    head_swap: "The snakes crossed into each other.",
    board_lock: "No safe route remained.",
  };
  return reasons[event.reason] ?? "The duel reset for a new round.";
}

function getMajorNotice(event) {
  if (!event) {
    return null;
  }

  if (event.type === "remote_connected") {
    return {
      tone: "match",
      title: "Global arena live",
      detail: event.detail,
      speak: "Connected to the global arena.",
    };
  }

  if (event.type === "remote_disconnected") {
    return {
      tone: "round",
      title: "Reconnecting",
      detail: event.detail,
      speak: "Remote stream disconnected. Reconnecting.",
    };
  }

  if (event.type === "remote_unauthorized") {
    return {
      tone: "round",
      title: "Admin key rejected",
      detail: event.detail,
      speak: "Admin secret rejected.",
    };
  }

  if (event.type === "admin_unlocked") {
    return {
      tone: "match",
      title: "Admin unlocked",
      detail: event.detail,
      speak: "Admin controls unlocked.",
    };
  }

  if (event.type === "match_reset") {
    return {
      tone: "round",
      title: "Match reset",
      detail: "Scores, growth progress, and the arena returned to the opening state.",
      speak: "Match reset.",
    };
  }

  if (event.type === "arena_grew") {
    return {
      tone: "round",
      title: "Arena expanded",
      detail: `The board is now ${event.arenaSize} x ${event.arenaSize}.`,
      speak: `Arena expanded to ${event.arenaSize} by ${event.arenaSize}.`,
    };
  }

  if (event.type === "round_resolved") {
    return {
      tone: event.matchFinished ? "match" : "round",
      title: describeWinner(event),
      detail: describeResolution(event),
      speak: `${describeWinner(event)}. ${describeResolution(event)}`,
    };
  }

  if (event.type === "match_finished") {
    return {
      tone: "match",
      title:
        event.winnerId === "draw"
          ? "Match drawn"
          : `${event.winnerName} takes the match`,
      detail:
        event.winnerId === "draw"
          ? "Neither snake finished ahead."
          : `${event.winnerName} reached the win target.`,
      speak:
        event.winnerId === "draw"
          ? "Match drawn."
          : `${event.winnerName} wins the match.`,
    };
  }

  return null;
}

// app/ai/choose-move.mjs
const DIRECTION_ORDER = new Map(
  DIRECTIONS.map((direction, index) => [directionKey(direction), index])
);

const TACTICAL_OUTCOME_SCORE = Object.freeze({
  win_head_on: 280,
  safe_food: 210,
  contesting_food: 56,
  yield_safe: 22,
  unresolved: 0,
  opponent_gets_food: -82,
  dead_end_after_food: -190,
  equal_trade: -260,
  lose_head_on: -340,
  trapped: -360,
});

const TACTICAL_OUTCOME_PRIORITY = Object.freeze({
  win_head_on: 9,
  safe_food: 8,
  contesting_food: 7,
  yield_safe: 6,
  unresolved: 5,
  opponent_gets_food: 4,
  dead_end_after_food: 3,
  equal_trade: 2,
  lose_head_on: 1,
  trapped: 0,
});

const LOSING_TACTICAL_OUTCOMES = new Set([
  "lose_head_on",
  "equal_trade",
  "dead_end_after_food",
  "trapped",
]);

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

function cloneSimulationState(state) {
  return {
    arenaSize: state.arenaSize,
    food: state.food ? clonePoint(state.food) : null,
    snakes: Object.fromEntries(
      Object.entries(state.snakes).map(([snakeId, snake]) => [
        snakeId,
        {
          alive: snake.alive !== false,
          body: snake.body.map(clonePoint),
          direction: cloneDirection(snake.direction),
        },
      ])
    ),
    foodEatenBy: state.foodEatenBy ?? null,
    collisionReason: state.collisionReason ?? "",
  };
}

function createOccupancy(state) {
  const occupied = new Set();
  for (const snake of Object.values(state.snakes)) {
    if (!snake.alive) {
      continue;
    }
    for (const segment of snake.body) {
      occupied.add(keyOfCell(segment));
    }
  }
  return occupied;
}

function canUseOwnTail(snake, nextHead, grows) {
  if (grows || !snake.body.length) {
    return false;
  }
  const tail = snake.body[snake.body.length - 1];
  return sameCell(nextHead, tail);
}

function isCandidateBlocked(state, snakeId, nextHead, grows) {
  const snake = state.snakes[snakeId];
  const occupied = createOccupancy(state);
  if (canUseOwnTail(snake, nextHead, grows)) {
    occupied.delete(keyOfCell(snake.body[snake.body.length - 1]));
  }
  return occupied.has(keyOfCell(nextHead));
}

function getOpponentThreatCells(state, opponentId, bounds) {
  const opponent = state.snakes[opponentId];
  return DIRECTIONS
    .filter((direction) => !oppositeDirection(direction, opponent.direction))
    .map((direction) => addPoint(opponent.body[0], direction))
    .filter((cell) => isInsideBounds(cell, bounds));
}

function countReachableArea(state, snakeId, nextHead, grows, limit) {
  const snake = state.snakes[snakeId];
  const occupied = createOccupancy(state);
  if (!grows) {
    occupied.delete(keyOfCell(snake.body[snake.body.length - 1]));
  }
  occupied.delete(keyOfCell(nextHead));

  const bounds = createSquareBounds(state.arenaSize);
  const queue = [nextHead];
  const seen = new Set();
  let area = 0;
  let queueIndex = 0;

  while (queueIndex < queue.length && area < limit) {
    const cell = queue[queueIndex++];
    const cellKey = keyOfCell(cell);
    if (seen.has(cellKey)) {
      continue;
    }
    seen.add(cellKey);
    if (!isInsideBounds(cell, bounds) || occupied.has(cellKey)) {
      continue;
    }
    area += 1;
    for (const direction of DIRECTIONS) {
      queue.push(addPoint(cell, direction));
    }
  }

  return area;
}

function countReachableAreaFromCurrentState(state, snakeId, limit) {
  const snake = state.snakes[snakeId];
  if (!snake.alive || !snake.body.length) {
    return 0;
  }

  const occupied = createOccupancy(state);
  const head = snake.body[0];
  occupied.delete(keyOfCell(head));

  const bounds = createSquareBounds(state.arenaSize);
  const queue = [head];
  const seen = new Set();
  let area = 0;
  let queueIndex = 0;

  while (queueIndex < queue.length && area < limit) {
    const cell = queue[queueIndex++];
    const cellKey = keyOfCell(cell);
    if (seen.has(cellKey)) {
      continue;
    }
    seen.add(cellKey);
    if (!isInsideBounds(cell, bounds) || occupied.has(cellKey)) {
      continue;
    }
    area += 1;
    for (const direction of DIRECTIONS) {
      queue.push(addPoint(cell, direction));
    }
  }

  return area;
}

function getLegalDirectionsForState(state, snakeId) {
  const snake = state.snakes[snakeId];
  if (!snake.alive) {
    return [];
  }

  const legalDirections = [];
  const bounds = createSquareBounds(state.arenaSize);

  for (const direction of DIRECTIONS) {
    if (oppositeDirection(direction, snake.direction)) {
      continue;
    }

    const nextHead = addPoint(snake.body[0], direction);
    if (!isInsideBounds(nextHead, bounds)) {
      continue;
    }

    const grows = Boolean(state.food && sameCell(nextHead, state.food));
    if (isCandidateBlocked(state, snakeId, nextHead, grows)) {
      continue;
    }

    legalDirections.push(direction);
  }

  if (!legalDirections.length) {
    return [cloneDirection(snake.direction)];
  }

  return legalDirections;
}

function createBodySet(body, trimTail) {
  const segments = trimTail ? body.slice(0, -1) : body;
  return new Set(segments.map(keyOfCell));
}

function simulateTurn(state, directionBySnake) {
  const nextState = cloneSimulationState(state);
  const bounds = createSquareBounds(nextState.arenaSize);
  const nextHeads = {};
  const growsBySnake = {};
  const result = {
    red: { alive: true, reason: "" },
    cyan: { alive: true, reason: "" },
  };

  for (const snakeId of ["red", "cyan"]) {
    const snake = nextState.snakes[snakeId];
    const direction = directionBySnake[snakeId] ?? snake.direction;
    snake.direction = cloneDirection(direction);
    nextHeads[snakeId] = addPoint(snake.body[0], direction);
    growsBySnake[snakeId] = Boolean(
      nextState.food && sameCell(nextHeads[snakeId], nextState.food)
    );
  }

  if (!isInsideBounds(nextHeads.red, bounds)) {
    result.red.alive = false;
    result.red.reason = "wall";
  }
  if (!isInsideBounds(nextHeads.cyan, bounds)) {
    result.cyan.alive = false;
    result.cyan.reason = "wall";
  }

  if (sameCell(nextHeads.red, nextHeads.cyan)) {
    const redLength = nextState.snakes.red.body.length;
    const cyanLength = nextState.snakes.cyan.body.length;
    if (redLength > cyanLength) {
      result.cyan.alive = false;
      result.cyan.reason = "head_on";
    } else if (cyanLength > redLength) {
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
    sameCell(nextHeads.red, nextState.snakes.cyan.body[0]) &&
    sameCell(nextHeads.cyan, nextState.snakes.red.body[0])
  ) {
    const redLength = nextState.snakes.red.body.length;
    const cyanLength = nextState.snakes.cyan.body.length;
    if (redLength > cyanLength) {
      result.cyan.alive = false;
      result.cyan.reason = "head_swap";
    } else if (cyanLength > redLength) {
      result.red.alive = false;
      result.red.reason = "head_swap";
    } else {
      result.red.alive = false;
      result.cyan.alive = false;
      result.red.reason = "head_swap";
      result.cyan.reason = "head_swap";
    }
  }

  const redBody = createBodySet(nextState.snakes.red.body, !growsBySnake.red);
  const cyanBody = createBodySet(nextState.snakes.cyan.body, !growsBySnake.cyan);

  if (
    result.red.alive &&
    (redBody.has(keyOfCell(nextHeads.red)) || cyanBody.has(keyOfCell(nextHeads.red)))
  ) {
    result.red.alive = false;
    result.red.reason = "body";
  }

  if (
    result.cyan.alive &&
    (cyanBody.has(keyOfCell(nextHeads.cyan)) || redBody.has(keyOfCell(nextHeads.cyan)))
  ) {
    result.cyan.alive = false;
    result.cyan.reason = "body";
  }

  nextState.snakes.red.alive = result.red.alive;
  nextState.snakes.cyan.alive = result.cyan.alive;
  nextState.collisionReason = result.red.reason || result.cyan.reason || "";
  nextState.foodEatenBy = null;

  if (!result.red.alive || !result.cyan.alive) {
    return nextState;
  }

  for (const snakeId of ["red", "cyan"]) {
    const snake = nextState.snakes[snakeId];
    snake.body.unshift(nextHeads[snakeId]);
    if (!growsBySnake[snakeId]) {
      snake.body.pop();
    }
  }

  if (growsBySnake.red) {
    nextState.foodEatenBy = "red";
    nextState.food = null;
  } else if (growsBySnake.cyan) {
    nextState.foodEatenBy = "cyan";
    nextState.food = null;
  }

  return nextState;
}

function createOutcome(outcome, score, survives) {
  return {
    outcome,
    score,
    survives,
  };
}

function chooseBetterOutcome(currentBest, candidate) {
  if (!currentBest) {
    return candidate;
  }
  if (candidate.score !== currentBest.score) {
    return candidate.score > currentBest.score ? candidate : currentBest;
  }
  return TACTICAL_OUTCOME_PRIORITY[candidate.outcome] >
    TACTICAL_OUTCOME_PRIORITY[currentBest.outcome]
    ? candidate
    : currentBest;
}

function chooseWorseOutcome(currentWorst, candidate) {
  if (!currentWorst) {
    return candidate;
  }
  if (candidate.score !== currentWorst.score) {
    return candidate.score < currentWorst.score ? candidate : currentWorst;
  }
  return TACTICAL_OUTCOME_PRIORITY[candidate.outcome] <
    TACTICAL_OUTCOME_PRIORITY[currentWorst.outcome]
    ? candidate
    : currentWorst;
}

function evaluateResolvedTacticalState(state, snakeId, config) {
  const opponentId = snakeId === "red" ? "cyan" : "red";
  const snake = state.snakes[snakeId];
  const opponent = state.snakes[opponentId];

  if (!snake.alive && !opponent.alive) {
    return createOutcome(
      "equal_trade",
      TACTICAL_OUTCOME_SCORE.equal_trade,
      false
    );
  }

  if (!snake.alive) {
    return createOutcome(
      "lose_head_on",
      TACTICAL_OUTCOME_SCORE.lose_head_on,
      false
    );
  }

  if (!opponent.alive) {
    return createOutcome(
      "win_head_on",
      TACTICAL_OUTCOME_SCORE.win_head_on,
      true
    );
  }

  if (state.foodEatenBy === snakeId) {
    const area = countReachableAreaFromCurrentState(
      state,
      snakeId,
      config.ai.tacticalSpaceLimit
    );
    if (area <= snake.body.length + 1) {
      return createOutcome(
        "dead_end_after_food",
        TACTICAL_OUTCOME_SCORE.dead_end_after_food,
        false
      );
    }
    return createOutcome("safe_food", TACTICAL_OUTCOME_SCORE.safe_food, true);
  }

  if (state.foodEatenBy === opponentId) {
    return createOutcome(
      "opponent_gets_food",
      TACTICAL_OUTCOME_SCORE.opponent_gets_food,
      true
    );
  }

  return null;
}

function evaluateUnresolvedTacticalState(state, snakeId, config) {
  const opponentId = snakeId === "red" ? "cyan" : "red";
  const snake = state.snakes[snakeId];
  const opponent = state.snakes[opponentId];
  const food = state.food;

  if (!food) {
    return createOutcome("unresolved", TACTICAL_OUTCOME_SCORE.unresolved, true);
  }

  const ownDistance = manhattanDistance(snake.body[0], food);
  const opponentDistance = manhattanDistance(opponent.body[0], food);
  const ownArea = countReachableAreaFromCurrentState(
    state,
    snakeId,
    config.ai.tacticalSpaceLimit
  );
  const opponentArea = countReachableAreaFromCurrentState(
    state,
    opponentId,
    config.ai.tacticalSpaceLimit
  );
  const pressurePenalty =
    manhattanDistance(snake.body[0], opponent.body[0]) <= 1 ? 18 : 0;
  const score =
    (opponentDistance - ownDistance) * 18 +
    (ownArea - opponentArea) * 0.45 -
    pressurePenalty;

  if (ownDistance <= opponentDistance) {
    return createOutcome("contesting_food", score + 18, true);
  }

  return createOutcome("yield_safe", score + 8, true);
}

function searchTacticalLine(state, snakeId, depth, config) {
  const resolved = evaluateResolvedTacticalState(state, snakeId, config);
  if (resolved) {
    return resolved;
  }

  if (depth <= 0) {
    return evaluateUnresolvedTacticalState(state, snakeId, config);
  }

  const opponentId = snakeId === "red" ? "cyan" : "red";
  const ownMoves = getLegalDirectionsForState(state, snakeId);
  const opponentMoves = getLegalDirectionsForState(state, opponentId);
  let bestOutcome = null;

  for (const ownMove of ownMoves) {
    let worstOutcome = null;

    for (const opponentMove of opponentMoves) {
      const nextState = simulateTurn(state, {
        [snakeId]: ownMove,
        [opponentId]: opponentMove,
      });
      const branchOutcome = searchTacticalLine(
        nextState,
        snakeId,
        depth - 1,
        config
      );
      worstOutcome = chooseWorseOutcome(worstOutcome, branchOutcome);
    }

    bestOutcome = chooseBetterOutcome(bestOutcome, worstOutcome);
  }

  return (
    bestOutcome ??
    createOutcome("trapped", TACTICAL_OUTCOME_SCORE.trapped, false)
  );
}

function evaluateCandidateContest(state, snakeId, direction, config) {
  const opponentId = snakeId === "red" ? "cyan" : "red";
  const simulationState = cloneSimulationState(state);
  const opponentMoves = getLegalDirectionsForState(simulationState, opponentId);
  let worstOutcome = null;

  for (const opponentMove of opponentMoves) {
    const nextState = simulateTurn(simulationState, {
      [snakeId]: direction,
      [opponentId]: opponentMove,
    });
    const branchOutcome = searchTacticalLine(
      nextState,
      snakeId,
      config.ai.tacticalLookaheadDepth - 1,
      config
    );
    worstOutcome = chooseWorseOutcome(worstOutcome, branchOutcome);
  }

  return (
    worstOutcome ??
    createOutcome("trapped", TACTICAL_OUTCOME_SCORE.trapped, false)
  );
}

function shouldRunTacticalContestLookahead(state, snakeId, config) {
  if (!state.food) {
    return false;
  }

  const opponentId = snakeId === "red" ? "cyan" : "red";
  const snake = state.snakes[snakeId];
  const opponent = state.snakes[opponentId];
  const ownFoodDistance = manhattanDistance(snake.body[0], state.food);
  const opponentFoodDistance = manhattanDistance(opponent.body[0], state.food);
  const headDistance = manhattanDistance(snake.body[0], opponent.body[0]);

  return (
    ownFoodDistance <= config.ai.tacticalActivationDistance &&
    opponentFoodDistance <= config.ai.tacticalActivationDistance &&
    Math.abs(ownFoodDistance - opponentFoodDistance) <= 1 &&
    headDistance <= config.ai.tacticalActivationDistance + 1
  );
}

function applyTacticalScoring(candidates, tacticalActive) {
  if (!tacticalActive) {
    return;
  }

  const hasSurvivingAlternative = candidates.some(
    (candidate) => !LOSING_TACTICAL_OUTCOMES.has(candidate.tacticalOutcome)
  );

  if (!hasSurvivingAlternative) {
    return;
  }

  for (const candidate of candidates) {
    if (LOSING_TACTICAL_OUTCOMES.has(candidate.tacticalOutcome)) {
      candidate.score -= 600;
    }
  }
}

function classifyCandidate(bestCandidate, snake, currentFoodDistance) {
  if (bestCandidate.tacticalOutcome === "win_head_on") {
    return {
      mode: "pressure",
      status: "Winning contest",
    };
  }

  if (
    bestCandidate.tacticalOutcome === "safe_food" ||
    bestCandidate.tacticalOutcome === "contesting_food"
  ) {
    return {
      mode: "food",
      status: "Contesting food",
    };
  }

  if (
    bestCandidate.tacticalOutcome === "yield_safe" ||
    bestCandidate.tacticalOutcome === "opponent_gets_food"
  ) {
    return {
      mode: "escape",
      status: "Yielding clash",
    };
  }

  if (bestCandidate.directFoodBonus > 0) {
    return {
      mode: "food",
      status: "Eating",
    };
  }

  if (bestCandidate.area <= snake.body.length + 3) {
    return {
      mode: "escape",
      status: "Escaping",
    };
  }

  if (bestCandidate.headOnRisk < 0) {
    return {
      mode: "pressure",
      status: "Pressuring",
    };
  }

  if (bestCandidate.foodDistance < currentFoodDistance) {
    return {
      mode: "food",
      status: "Chasing food",
    };
  }

  if (bestCandidate.revisitPenalty > 0) {
    return {
      mode: "escape",
      status: "Breaking loop",
    };
  }

  return {
    mode: "route",
    status: "Re-routing",
  };
}

function chooseMove({ state, snakeId, config }) {
  const snake = state.snakes[snakeId];
  const opponentId = snakeId === "red" ? "cyan" : "red";
  const opponent = state.snakes[opponentId];
  const bounds = createSquareBounds(state.arenaSize);
  const food = state.food;
  const boardCenter = centerCell(bounds);
  const currentFoodDistance = food ? manhattanDistance(snake.body[0], food) : 0;
  const recentHeads = new Set(
    snake.recentHeadKeys.slice(-config.ai.revisitMemory)
  );
  const opponentThreatCells = getOpponentThreatCells(state, opponentId, bounds);
  const candidates = [];

  for (const direction of DIRECTIONS) {
    if (oppositeDirection(direction, snake.direction)) {
      continue;
    }

    const nextHead = addPoint(snake.body[0], direction);
    if (!isInsideBounds(nextHead, bounds)) {
      continue;
    }

    const grows = Boolean(food && sameCell(nextHead, food));
    if (isCandidateBlocked(state, snakeId, nextHead, grows)) {
      continue;
    }

    const area = countReachableArea(
      state,
      snakeId,
      nextHead,
      grows,
      config.ai.floodFillLimit
    );
    const foodDistance = food ? manhattanDistance(nextHead, food) : 0;
    const centerDistance = manhattanDistance(nextHead, boardCenter);
    const edgeDistance = minEdgeDistance(nextHead, bounds);
    const revisitPenalty = recentHeads.has(keyOfCell(nextHead)) ? 18 : 0;
    const threatened = opponentThreatCells.some((cell) => sameCell(cell, nextHead));
    const headOnRisk = threatened
      ? snake.body.length > opponent.body.length
        ? -8
        : 28
      : 0;
    const adjacentPressure =
      manhattanDistance(nextHead, opponent.body[0]) === 1 &&
      snake.body.length <= opponent.body.length
        ? 10
        : 0;
    const directFoodBonus = grows ? 28 : 0;
    const foodProgressBonus =
      food && foodDistance < currentFoodDistance ? 6 : 0;
    const trappedPenalty = area <= snake.body.length + 2 ? 38 : 0;

    const score =
      area * 1.4 +
      directFoodBonus +
      foodProgressBonus -
      foodDistance * 2.05 +
      edgeDistance * 0.8 -
      centerDistance * 0.12 -
      revisitPenalty -
      headOnRisk -
      adjacentPressure -
      trappedPenalty;

    candidates.push({
      direction,
      nextHead,
      area,
      foodDistance,
      revisitPenalty,
      headOnRisk,
      directFoodBonus,
      score,
      tacticalOutcome: "",
      tacticalScore: 0,
    });
  }

  if (!candidates.length) {
    return {
      direction: snake.direction,
      mode: "trapped",
      status: "Trapped",
      target: snake.body[0],
      debug: {
        area: 0,
        foodDistance: currentFoodDistance,
        score: -Infinity,
      },
    };
  }

  const tacticalActive = shouldRunTacticalContestLookahead(
    state,
    snakeId,
    config
  );

  if (tacticalActive) {
    for (const candidate of candidates) {
      const tacticalResult = evaluateCandidateContest(
        state,
        snakeId,
        candidate.direction,
        config
      );
      candidate.tacticalOutcome = tacticalResult.outcome;
      candidate.tacticalScore = tacticalResult.score;
      candidate.score += tacticalResult.score;
    }

    applyTacticalScoring(candidates, tacticalActive);
  }

  candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return (
      DIRECTION_ORDER.get(directionKey(left.direction)) -
      DIRECTION_ORDER.get(directionKey(right.direction))
    );
  });

  const bestCandidate = candidates[0];
  const classification = classifyCandidate(
    bestCandidate,
    snake,
    currentFoodDistance
  );

  return {
    direction: bestCandidate.direction,
    mode: classification.mode,
    status: classification.status,
    target: bestCandidate.nextHead,
    debug: {
      area: bestCandidate.area,
      foodDistance: bestCandidate.foodDistance,
      score: bestCandidate.score,
      tacticalOutcome: bestCandidate.tacticalOutcome || "none",
      tacticalScore: bestCandidate.tacticalScore,
    },
  };
}

// app/engine/create-engine.mjs
const STARTING_SNAKE_LENGTH = 3;
const ENGINE_STATE_VERSION = 1;

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

function getBaseGrowthIntervalForSize(arenaSize, config) {
  const { initialSize, growthInterval, growthLogRamp, growthLogExponent } = config.world;
  const sizeRatio = Math.max(1, arenaSize / initialSize);
  const logDistance = Math.log2(sizeRatio);
  return (
    growthInterval +
    Math.max(0, Math.floor((logDistance ** growthLogExponent) * growthLogRamp))
  );
}

function getOccupancyRatio(state) {
  const boardArea = Math.max(1, state.arenaSize * state.arenaSize);
  const totalLength = state.snakes.red.storedLength + state.snakes.cyan.storedLength;
  return totalLength / boardArea;
}

function getPathPressure(state) {
  return (
    Math.max(state.snakes.red.storedLength, state.snakes.cyan.storedLength) /
    Math.max(1, state.arenaSize)
  );
}

function getGrowthIntervalForState(state, config) {
  const baseInterval = getBaseGrowthIntervalForSize(state.arenaSize, config);
  if (!config.world.adaptiveGrowthEnabled) {
    return baseInterval;
  }

  const occupancy = getOccupancyRatio(state);
  const pathPressure = getPathPressure(state);
  let multiplier = 1;

  if (
    occupancy > config.world.hardOccupancyThreshold ||
    pathPressure > config.world.hardPathPressureThreshold
  ) {
    multiplier = 0.65;
  } else if (
    occupancy > config.world.targetOccupancyMax ||
    pathPressure > config.world.targetPathPressure
  ) {
    multiplier = 0.82;
  } else if (
    occupancy < config.world.lowOccupancyThreshold &&
    pathPressure < config.world.lowPathPressureThreshold
  ) {
    multiplier = 1.1;
  }

  return clamp(
    Math.round(baseInterval * multiplier),
    config.world.minGrowthInterval,
    config.world.maxGrowthInterval
  );
}

function getFoodsUntilGrowth(state, config) {
  if (
    Number.isFinite(config.world.maxSize) &&
    state.arenaSize >= config.world.maxSize
  ) {
    return 0;
  }
  const currentInterval = getGrowthIntervalForState(state, config);
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
    schemaVersion: ENGINE_STATE_VERSION,
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

function cloneDecision(decision) {
  if (!decision) {
    return null;
  }
  return {
    ...decision,
    direction: decision.direction ? cloneDirection(decision.direction) : null,
    target: decision.target ? clonePoint(decision.target) : null,
    debug: decision.debug ? { ...decision.debug } : null,
  };
}

function cloneLastRound(lastRound) {
  return lastRound
    ? {
        ...lastRound,
      }
    : null;
}

function cloneSnakeState(snake) {
  return {
    id: snake.id,
    name: snake.name,
    palette: snake.palette,
    score: snake.score,
    storedLength: snake.storedLength,
    alive: snake.alive,
    body: snake.body.map(clonePoint),
    direction: cloneDirection(snake.direction),
    status: snake.status,
    mode: snake.mode,
    lastDecision: cloneDecision(snake.lastDecision),
    recentHeadKeys: [...snake.recentHeadKeys],
  };
}

function serializeState(state) {
  return {
    schemaVersion: ENGINE_STATE_VERSION,
    version: state.version,
    tickRate: state.tickRate,
    paused: state.paused,
    phase: state.phase,
    roundNumber: state.roundNumber,
    roundTick: state.roundTick,
    matchTick: state.matchTick,
    arenaSize: state.arenaSize,
    totalFoodEaten: state.totalFoodEaten,
    foodsSinceGrowth: state.foodsSinceGrowth,
    growths: state.growths,
    intermissionTicksRemaining: state.intermissionTicksRemaining,
    food: state.food ? clonePoint(state.food) : null,
    lastRound: cloneLastRound(state.lastRound),
    matchWinnerId: state.matchWinnerId,
    snakes: {
      red: cloneSnakeState(state.snakes.red),
      cyan: cloneSnakeState(state.snakes.cyan),
    },
  };
}

function hydrateState(persistedState, config) {
  const baseState = createInitialState(config);
  if (!persistedState || typeof persistedState !== "object") {
    return baseState;
  }

  const nextState = {
    ...baseState,
    ...persistedState,
    schemaVersion: ENGINE_STATE_VERSION,
    food: persistedState.food ? clonePoint(persistedState.food) : null,
    lastRound: cloneLastRound(persistedState.lastRound),
    snakes: {
      red: persistedState.snakes?.red
        ? cloneSnakeState(persistedState.snakes.red)
        : cloneSnakeState(baseState.snakes.red),
      cyan: persistedState.snakes?.cyan
        ? cloneSnakeState(persistedState.snakes.cyan)
        : cloneSnakeState(baseState.snakes.cyan),
    },
    events: [],
  };

  nextState.version = Math.max(0, Number(nextState.version) || 0);
  nextState.tickRate = clamp(
    Math.round(Number(nextState.tickRate) || config.tickRate),
    1,
    4096
  );
  nextState.roundNumber = Math.max(1, Number(nextState.roundNumber) || 1);
  nextState.roundTick = Math.max(0, Number(nextState.roundTick) || 0);
  nextState.matchTick = Math.max(0, Number(nextState.matchTick) || 0);
  nextState.arenaSize = Math.max(
    config.world.initialSize,
    Math.round(Number(nextState.arenaSize) || config.world.initialSize)
  );
  nextState.totalFoodEaten = Math.max(0, Number(nextState.totalFoodEaten) || 0);
  nextState.foodsSinceGrowth = Math.max(0, Number(nextState.foodsSinceGrowth) || 0);
  nextState.growths = Math.max(0, Number(nextState.growths) || 0);
  nextState.intermissionTicksRemaining = Math.max(
    0,
    Number(nextState.intermissionTicksRemaining) || 0
  );

  return nextState;
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
  const currentInterval = getGrowthIntervalForState(state, config);
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
      growthInterval: getGrowthIntervalForState(state, config),
      foodsUntilGrowth: getFoodsUntilGrowth(state, config),
      growths: state.growths,
      occupancy: getOccupancyRatio(state),
      pathPressure: getPathPressure(state),
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

function createEngine(overrides = {}) {
  const { persistedState = null, persistedRngState = null, ...configOverrides } = overrides;
  const config = createConfig(configOverrides);
  let rng = persistedRngState == null
    ? createRng(config.seed)
    : createRngFromState(persistedRngState);
  const state = persistedState
    ? hydrateState(persistedState, config)
    : createInitialState(config);

  if (!persistedState) {
    startRound(state, config, rng);
    state.version += 1;
  }

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
      state.snakes[eaterId].storedLength = Math.min(
        state.snakes[eaterId].storedLength + 1,
        config.world.maxStoredLength
      );
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

  function stepMany(count) {
    let steps = 0;
    const target = Math.max(0, Math.floor(Number(count) || 0));
    while (steps < target) {
      if (!step()) {
        break;
      }
      steps += 1;
    }
    return steps;
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

  function exportState() {
    return {
      schemaVersion: ENGINE_STATE_VERSION,
      rngState: rng.state(),
      state: serializeState(state),
    };
  }

  return {
    config,
    step,
    stepMany,
    resetMatch,
    setPaused,
    setTickRate,
    getSnapshot,
    consumeEvents,
    getMeta,
    debugMutate,
    exportState,
  };
}

// app/render/canvas-renderer.mjs
const DEFAULT_THEME = {
  boardFill: "#0d1422",
  boardBackdrop: "#060911",
  boardBorder: "rgba(255, 255, 255, 0.14)",
  boardGrid: "rgba(255, 255, 255, 0.045)",
  centerMark: "rgba(241, 207, 105, 0.24)",
  overlay: "rgba(0, 0, 0, 0.42)",
  overlayText: "#f4f0e6",
  overlayMuted: "#a6b0c4",
  food: "#f1cf69",
  foodGlow: "rgba(241, 207, 105, 0.5)",
  red: {
    body: "#ff6b63",
    head: "#ffd6d1",
    glow: "rgba(255, 107, 99, 0.3)",
  },
  cyan: {
    body: "#52d9cb",
    head: "#ddfffb",
    glow: "rgba(82, 217, 203, 0.3)",
  },
};

function fillRoundedRect(context, x, y, width, height, radius, fillStyle) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fillStyle = fillStyle;
  context.fill();
}

function createPalette(theme) {
  return {
    ...DEFAULT_THEME,
    ...theme,
    red: {
      ...DEFAULT_THEME.red,
      ...(theme.red ?? {}),
    },
    cyan: {
      ...DEFAULT_THEME.cyan,
      ...(theme.cyan ?? {}),
    },
  };
}

function getOverlayText(snapshot) {
  if (snapshot.phase === "match_over") {
    return snapshot.match.winnerId === "draw"
      ? "Match drawn"
      : snapshot.match.winnerId
      ? `${snapshot.snakes[snapshot.match.winnerId].name} wins`
      : "Match finished";
  }
  if (snapshot.paused) {
    return "Paused";
  }
  if (snapshot.phase === "round_intermission") {
    return "Next round";
  }
  return "";
}

function createCanvasRenderer(canvas, theme = {}) {
  const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
  const palette = createPalette(theme);

  function render(snapshot, viewState = {}) {
    const zoom = clamp(Number(viewState.zoom) || 1, 0.55, 2.2);
    const { width, height } = canvas;
    const padding = 28;
    const boardSize = snapshot.arena.size;
    const baseCellSize = Math.min(
      (width - padding * 2) / boardSize,
      (height - padding * 2) / boardSize
    );
    const cellSize = baseCellSize * zoom;
    const boardPixelSize = boardSize * cellSize;
    const originX = (width - boardPixelSize) / 2;
    const originY = (height - boardPixelSize) / 2;

    context.fillStyle = palette.boardBackdrop;
    context.fillRect(0, 0, width, height);

    fillRoundedRect(
      context,
      originX,
      originY,
      boardPixelSize,
      boardPixelSize,
      26,
      palette.boardFill
    );

    context.save();
    context.beginPath();
    context.roundRect(originX, originY, boardPixelSize, boardPixelSize, 26);
    context.clip();

    if (cellSize >= 9) {
      context.strokeStyle = palette.boardGrid;
      context.lineWidth = 1;
      context.beginPath();
      for (let index = 0; index <= boardSize; index += 1) {
        const offset = index * cellSize;
        context.moveTo(originX + offset, originY);
        context.lineTo(originX + offset, originY + boardPixelSize);
        context.moveTo(originX, originY + offset);
        context.lineTo(originX + boardPixelSize, originY + offset);
      }
      context.stroke();
    }

    const centerOffset = (boardSize / 2) * cellSize;
    context.fillStyle = palette.centerMark;
    context.fillRect(originX + centerOffset - 1, originY + centerOffset - 18, 2, 36);
    context.fillRect(originX + centerOffset - 18, originY + centerOffset - 1, 36, 2);

    if (snapshot.food) {
      const foodX = originX + snapshot.food.x * cellSize + cellSize / 2;
      const foodY = originY + snapshot.food.y * cellSize + cellSize / 2;
      context.save();
      context.shadowBlur = 16;
      context.shadowColor = palette.foodGlow;
      context.fillStyle = palette.food;
      context.beginPath();
      context.arc(foodX, foodY, Math.max(4, cellSize * 0.24), 0, Math.PI * 2);
      context.fill();
      context.restore();
    }

    for (const snakeId of ["red", "cyan"]) {
      const snake = snapshot.snakes[snakeId];
      const snakePalette = palette[snakeId];

      for (let index = snake.body.length - 1; index >= 0; index -= 1) {
        const segment = snake.body[index];
        const segmentX = originX + segment.x * cellSize + Math.max(2, cellSize * 0.08);
        const segmentY = originY + segment.y * cellSize + Math.max(2, cellSize * 0.08);
        const segmentSize = Math.max(4, cellSize - Math.max(4, cellSize * 0.16));
        const fill = index === 0 ? snakePalette.head : snakePalette.body;

        context.save();
        context.shadowBlur = index === 0 ? 18 : 10;
        context.shadowColor = snakePalette.glow;
        fillRoundedRect(
          context,
          segmentX,
          segmentY,
          segmentSize,
          segmentSize,
          Math.max(4, segmentSize * 0.18),
          fill
        );
        context.restore();
      }
    }

    context.restore();

    context.strokeStyle = palette.boardBorder;
    context.lineWidth = 1.5;
    context.beginPath();
    context.roundRect(originX, originY, boardPixelSize, boardPixelSize, 26);
    context.stroke();

    const overlayText = getOverlayText(snapshot);
    if (overlayText) {
      context.fillStyle = palette.overlay;
      context.fillRect(0, 0, width, height);
      context.fillStyle = palette.overlayText;
      context.font = "700 36px 'Space Grotesk', sans-serif";
      context.textAlign = "center";
      context.fillText(overlayText, width / 2, height / 2 - 8);
      context.fillStyle = palette.overlayMuted;
      context.font = "500 16px 'Space Grotesk', sans-serif";
      context.fillText(
        snapshot.phase === "round_intermission"
          ? `Round ${snapshot.roundNumber + 1} is loading`
          : "Simulation control is still available",
        width / 2,
        height / 2 + 24
      );
    }
  }

  return {
    render,
  };
}

// app/ui/ui-controller.mjs
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

function createUiController(elements, windowObject) {
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

// app/remote/create-remote-client.mjs
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

function shouldPreferRemoteMode(locationObject) {
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

function createRemoteClient({
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

// app/bootstrap.mjs
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
    renderer.render(snapshot, viewState);
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
      renderer.render(latestSnapshot, viewState);
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

async function bootstrap() {
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

  bootstrap();
})();
