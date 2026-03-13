# Repository Guidelines

## Project Structure & Module Organization

This repository is a framework-free browser app with modular source code and a generated browser bundle.

- `index.html`: UI shell, control rail, scoreboard, and canvas mount point.
- `styles.css`: layout, visual theme, and responsive styling.
- `app/bootstrap.mjs`: browser bootstrap, scheduler, and wiring.
- `app/engine/create-engine.mjs`: simulation engine, round flow, scoring, growth, and reset logic.
- `app/ai/choose-move.mjs`: snake AI and tactical food-contest lookahead.
- `app/render/canvas-renderer.mjs`: canvas rendering only.
- `app/ui/ui-controller.mjs`: HUD sync, controls, and accessibility text.
- `app/remote/create-remote-client.mjs`: browser remote-mode transport for Cloudflare.
- `app/shared/*.mjs`: shared config, geometry helpers, RNG, and selectors.
- `script.js`: generated browser bundle built from `app/`; do not treat this as the primary source file.
- `public/`: synced static assets for Workers Static Assets.
- `scripts/benchmark-simulation.js`: headless benchmark harness that imports the same engine used by the browser runtime.
- `scripts/build-browser-bundle.js`: regenerates `script.js` from the `app/` modules.
- `worker/index.mjs`: Worker entrypoint and Durable Object implementation.
- `wrangler.jsonc`: Cloudflare deployment configuration.

Put new runtime logic in the relevant `app/` module. Rebuild `script.js` after source changes.

## Build, Test, and Development Commands

- `python -m http.server 8000`
  Runs a local static server for browser testing.
- `node scripts\build-browser-bundle.js`
  Regenerates `script.js` from the modular source in `app/` and syncs static assets to `public/`.
- `node --check script.js`
  Validates JavaScript syntax for the generated browser bundle.
- `node --check scripts\benchmark-simulation.js`
  Validates syntax for the benchmark harness.
- `node scripts\benchmark-simulation.js 1024 4000`
  Runs the default headless benchmark at `1024 TPS` for `4000` ticks.
- `node scripts\benchmark-simulation.js 2048 4000`
  Runs a higher-speed headless benchmark.
- `node scripts\benchmark-simulation.js 64 5 food-clash`
  Runs the targeted contested-food AI regression scenario.
- `node --check worker\index.mjs`
  Validates syntax for the Cloudflare Worker entrypoint.

## Coding Style & Naming Conventions

Use 2-space indentation in HTML, CSS, and JavaScript. Prefer plain modern JavaScript with small functions and explicit names.

- `camelCase` for variables and functions
- `UPPER_SNAKE_CASE` for tuning constants
- small single-purpose helpers for hot paths

Keep the architecture simple. Do not add frameworks, transpilers, or browser bundlers.

## Editing Rules

- Edit source modules in `app/` for runtime behavior changes.
- Rebuild `script.js` with `node scripts\build-browser-bundle.js` after changing `app/`.
- Do not hand-edit `script.js` unless you are intentionally fixing the generated output path itself.
- If you change gameplay rules, also update the visible rules/help copy in `index.html`.
- If you change runtime structure or workflow, update `README.md` and this file too.

## Testing Guidelines

There is no formal test framework yet. Use syntax checks plus the benchmark harness before finishing changes.

Minimum verification for runtime changes:

1. `node scripts\build-browser-bundle.js`
2. `node --check script.js`
3. `node --check scripts\benchmark-simulation.js`
4. `node --check worker\index.mjs`
5. `node scripts\benchmark-simulation.js 1024 4000`

Additional verification when relevant:

- AI changes: `node scripts\benchmark-simulation.js 64 5 food-clash`
- high-speed scheduling changes: `node scripts\benchmark-simulation.js 2048 4000`

If you change AI, scaling, or scheduling, include the benchmark result in your notes.

## Commit & Pull Request Guidelines

This folder is currently not a Git repository, so no local commit history is available. Use Conventional Commit style when versioning is added, for example:

- `feat: add tactical contested-food lookahead`
- `fix: regenerate browser bundle after engine refactor`
- `tune: adjust logarithmic arena growth ramp`

For pull requests, include:

- a short summary of behavior changes
- any benchmark numbers before vs. after
- screenshots for UI-visible changes
- notes about scaling, TPS, or AI tradeoffs

## Performance Notes

Preserve the current architecture:

- event-driven rendering
- simulation loop separated from paint loop
- bounded simulation work per pass
- minimal DOM writes
- context-gated tactical AI

Avoid changes that reintroduce constant redraw loops or expensive per-tick allocations without measurement.
