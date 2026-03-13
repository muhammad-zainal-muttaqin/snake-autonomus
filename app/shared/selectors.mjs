function pluralize(count, singular, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

export function formatTickRate(tickRate) {
  return `${Math.round(tickRate)} TPS`;
}

export function formatZoom(zoom) {
  return `${zoom.toFixed(2)}x`;
}

export function getArenaSizeLabel(snapshot) {
  const { size } = snapshot.arena;
  return `${size} x ${size}`;
}

export function getSnakeDetailLabel(snake) {
  return `Len ${snake.length} | ${snake.status}`;
}

export function getArenaGrowthLabel(snapshot) {
  if (
    Number.isFinite(snapshot.arena.maxSize) &&
    snapshot.arena.size >= snapshot.arena.maxSize
  ) {
    return "Growth capped";
  }
  const foods = snapshot.arena.foodsUntilGrowth;
  return `+1 in ${foods} ${pluralize(foods, "food")}`;
}

export function getRoundStatusLabel(snapshot) {
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

export function getAssistiveSummary(snapshot) {
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

export function getMajorNotice(event) {
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
