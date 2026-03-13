# Snake 1v1 Autonomous Arena

Browser-based autonomous snake duel with a shared arena, persistent match progression, and a performance-oriented simulation stack that can be stress-tested at up to `2048 TPS`.

## What This Project Is

Two AI snakes compete on the same board:

- they chase food
- they avoid traps and dead ends
- they contest food tactically instead of blindly trading head-on
- they keep playing across rounds until you manually restart the match

The app stays intentionally lightweight:

- no framework
- no backend
- no browser bundler
- static HTML/CSS shell
- modular source code under `app/`
- generated browser bundle in `script.js` for `file://` and static hosting use
- Cloudflare Worker + Durable Object path for one persistent global arena

## Current Gameplay Rules

- rounds continue forever until `Restart match`
- wins persist across rounds
- snake length persists across rounds
- food increases a snake's stored length permanently for the current match
- head-on collisions eliminate both snakes unless one snake is longer
- arena growth is logarithmic from the initial `16x16` board
- growth progress persists across rounds and resets only on full match restart

## Project Layout

```text
.
|-- index.html
|-- styles.css
|-- script.js
|-- README.md
|-- AGENTS.md
|-- scaling-fix.png
|-- app/
|   |-- bootstrap.mjs
|   |-- ai/
|   |   `-- choose-move.mjs
|   |-- engine/
|   |   `-- create-engine.mjs
|   |-- render/
|   |   `-- canvas-renderer.mjs
|   |-- shared/
|   |   |-- config.mjs
|   |   |-- geometry.mjs
|   |   |-- rng.mjs
|   |   `-- selectors.mjs
|   |-- remote/
|   |   `-- create-remote-client.mjs
|   `-- ui/
|       `-- ui-controller.mjs
|-- public/
|   |-- index.html
|   |-- styles.css
|   `-- script.js
`-- scripts/
    |-- benchmark-simulation.js
    |-- build-browser-bundle.js
    |-- optimize-iterations.js
    `-- perf-iterations.json
|-- worker/
|   `-- index.mjs
|-- wrangler.jsonc
`-- package.json
```

## Architecture

### Source of truth

The modular source lives under `app/`.

- `app/engine/create-engine.mjs`: simulation rules, round flow, scoring, growth, and match state
- `app/ai/choose-move.mjs`: snake decision logic, including contested-food tactical lookahead
- `app/render/canvas-renderer.mjs`: canvas drawing only
- `app/ui/ui-controller.mjs`: DOM bindings, HUD sync, notices, and controls
- `app/remote/create-remote-client.mjs`: browser remote-mode transport for the Cloudflare arena
- `app/shared/*.mjs`: config, geometry helpers, RNG, and display selectors
- `app/bootstrap.mjs`: browser runtime bootstrap and scheduler wiring

### Browser runtime

`script.js` is a generated browser bundle, not the authoring source.

It exists so the app can still be opened directly from disk or served as plain static files without relying on browser ESM support under `file://`.

If you change anything under `app/`, rebuild `script.js`:

```powershell
node scripts\build-browser-bundle.js
```

That command also syncs `index.html`, `styles.css`, and the generated bundle into `public/` for Cloudflare static asset serving.

Do not treat `script.js` as the primary edit target unless you are fixing the bundle output itself.

### Cloudflare runtime

The repository now includes a Cloudflare deployment path:

- `worker/index.mjs`: Worker entrypoint plus the global Durable Object arena
- `wrangler.jsonc`: Worker, static asset, Durable Object, and env configuration
- `public/`: synced static assets served by Workers Static Assets

### Simulation model

The engine and the benchmark harness share the same core logic.

That means:

- browser runtime and benchmark use the same rules
- AI changes can be verified headlessly
- growth, scoring, and collision fixes do not need separate browser-only rewrites

## Run Locally

### Option 1: Open directly

You can open `index.html` directly in a browser because `script.js` is a plain generated bundle.

### Option 2: Local static server

```powershell
python -m http.server 8000
```

Open:

```text
http://localhost:8000
```

## Development Workflow

### 1. Edit source modules

Make runtime changes in `app/`, not in the generated bundle.

Common files:

- AI: `app/ai/choose-move.mjs`
- engine: `app/engine/create-engine.mjs`
- UI logic: `app/ui/ui-controller.mjs`
- tuning constants: `app/shared/config.mjs`

### 2. Rebuild browser bundle

```powershell
node scripts\build-browser-bundle.js
```

This regenerates `script.js`.

### 3. Validate

```powershell
node --check script.js
node --check scripts\benchmark-simulation.js
node scripts\benchmark-simulation.js 1024 4000
```

If you changed performance-related logic, also test higher speed:

```powershell
node scripts\benchmark-simulation.js 2048 4000
```

If you changed contested-food AI, run the targeted scenario too:

```powershell
node scripts\benchmark-simulation.js 64 5 food-clash
```

### 4. Run Cloudflare locally

```powershell
npm install
npm run build
npm run dev:cf
```

## Benchmark Scenarios

`scripts/benchmark-simulation.js` currently supports:

- `default`
- `edge-loop`
- `food-clash`

Examples:

```powershell
node scripts\benchmark-simulation.js 1024 4000
node scripts\benchmark-simulation.js 2048 4000
node scripts\benchmark-simulation.js 64 5 food-clash
```

Useful output fields:

- `effectiveTicksPerSecond`
- `roundsCompleted`
- `maxWidth`
- `occupancy`
- `pathPressure`
- `foodCount`
- `redStatus`
- `cyanStatus`

## Performance Notes

The current runtime is built around:

- event-driven rendering
- simulation loop separated from paint loop
- bounded simulation work per pass
- minimal DOM writes
- tactical AI only when the board state justifies it

Avoid changes that reintroduce:

- unconditional redraw loops
- repeated large per-tick allocations
- DOM churn for unchanged HUD values
- expensive AI search on every tick regardless of context

## Current Tuning Highlights

Important defaults live in `app/shared/config.mjs`.

Notable ones:

- default browser tick rate: `64`
- UI speed slider max: `2048`
- logarithmic arena growth ramp: `2`
- adaptive growth controller: enabled
- persistent length across rounds: enabled
- tactical food-contest lookahead: enabled

## Maintenance Notes

- If you update the runtime structure, update both `README.md` and `AGENTS.md`.
- If you change gameplay rules, also update the rules copy in `index.html`.
- If you change `app/` source, rebuild `script.js` before finishing.
