export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function createSquareBounds(size) {
  return {
    minX: 0,
    maxX: size - 1,
    minY: 0,
    maxY: size - 1,
  };
}

export function getBoundsSize(bounds) {
  return bounds.maxX - bounds.minX + 1;
}

export function centerCell(bounds) {
  return {
    x: Math.floor((bounds.minX + bounds.maxX) / 2),
    y: Math.floor((bounds.minY + bounds.maxY) / 2),
  };
}

export function keyOfCell(cell) {
  return `${cell.x},${cell.y}`;
}

export function sameCell(a, b) {
  return Boolean(a && b) && a.x === b.x && a.y === b.y;
}

export function addPoint(point, vector) {
  return {
    x: point.x + vector.x,
    y: point.y + vector.y,
  };
}

export function manhattanDistance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function isInsideBounds(cell, bounds) {
  return (
    cell.x >= bounds.minX &&
    cell.x <= bounds.maxX &&
    cell.y >= bounds.minY &&
    cell.y <= bounds.maxY
  );
}

export function minEdgeDistance(cell, bounds) {
  return Math.min(
    cell.x - bounds.minX,
    bounds.maxX - cell.x,
    cell.y - bounds.minY,
    bounds.maxY - cell.y
  );
}

export function oppositeDirection(a, b) {
  return Boolean(a && b) && a.x === -b.x && a.y === -b.y;
}

export function directionKey(direction) {
  return `${direction.x},${direction.y}`;
}
