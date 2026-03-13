export const DIRECTIONS = Object.freeze([
  Object.freeze({ x: 1, y: 0, name: "right" }),
  Object.freeze({ x: -1, y: 0, name: "left" }),
  Object.freeze({ x: 0, y: 1, name: "down" }),
  Object.freeze({ x: 0, y: -1, name: "up" }),
]);

export const SNAKE_META = Object.freeze({
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

export const DEFAULT_CONFIG = Object.freeze({
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

export function createConfig(overrides = {}) {
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
