import { clamp } from "../shared/geometry.mjs";

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

export function createCanvasRenderer(canvas, theme = {}) {
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
