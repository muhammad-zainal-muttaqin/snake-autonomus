import { DIRECTIONS } from "../shared/config.mjs";
import {
  addPoint,
  centerCell,
  createSquareBounds,
  directionKey,
  isInsideBounds,
  keyOfCell,
  manhattanDistance,
  minEdgeDistance,
  oppositeDirection,
  sameCell,
} from "../shared/geometry.mjs";

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

export function chooseMove({ state, snakeId, config }) {
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
