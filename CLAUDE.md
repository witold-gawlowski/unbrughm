# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Don't try to keep established code as is. If you see that adding new functionality doesn't fit well with existing code, propose refactorings, however fundamental they might be.

## What this is

A three.js prototype for an MMO set on an infinite underground plane, in the style of Dungeon Keeper: each player controls a creature that digs through solid rock, carving out shared tunnels. See `specs/` for the vision — the code currently implements only the client-side terrain renderer; there is **no server or multiplayer yet** (`specs/step-1.md` describes the next milestone: a local server driving multiple browser clients with point-and-click movement).

## Running

`src/map.js` loads the map with `fetch()`, which browsers block over `file://`. Serve the folder over HTTP:

```
python -m http.server 8000
```

Then open <http://localhost:8000/>. Any static server works (`npx serve`, VS Code Live Server). No build step — three.js is loaded from a CDN via the import map in `index.html`. Refresh the browser after editing.

## Architecture

The renderer draws an **infinite plane of solid rock that the map carves holes into** — the inverse of a typical "place tiles on empty ground" model. Understanding this inversion is key: outside the ASCII map bounds, and at any `#` cell, the world is solid; only non-`#` cells inside the map are dug-out gaps.

Wiring lives in `src/main.js`, which composes five independent modules and runs the render loop. Each module is a factory returning a small interface; they share tunables from `config.js` and communicate only through the objects `main.js` passes between them:

- **`map.js`** — parses `dungeon.txt` into `isSolid(wx, wz)`, the single source of truth for world geometry, plus the map's cell `bounds`. World cells are integer coordinates centered on the map's origin.
- **`view.js`** — scene, orthographic camera, lights. A fixed isometric camera holds a constant offset from a movable ground `target`; the 3/4 view comes from the equal-axis `VIEW_OFFSET`.
- **`chunks.js`** — the performance core. Cubes are never one mesh each; every `CHUNK_SIZE`×`CHUNK_SIZE` tile is merged into one geometry (one draw call per chunk). Each frame `ensureCoverage()` projects the viewport corners onto the ground plane to find visible chunks (plus a `BUFFER_CHUNKS` ring), queues missing ones nearest-first, and unloads/disposes chunks that scrolled away; `processBuildQueue()` builds at most `BUILD_BUDGET` per frame so panning never stalls.
- **`darkness.js`** — pixel-precise fade of rock into darkness away from the tunnels. Computes the distance field with a two-pass exact Euclidean distance transform seeded straight from `isSolid` (one lookup per cell), baked into a camera-following texture window in budgeted tiles (`FADE_BAKE_BUDGET` per frame via `processBakeQueue()`, mirroring chunk streaming). Patches the terrain materials (`onBeforeCompile`) to sample it per fragment and dim the diffuse color; interior surfaces sample distance 0 and stay lit.
- **`controls.js`** — right-mouse-drag panning by keeping the grabbed ground point under the cursor (moves `target`, not the camera directly).

The recurring primitive across `chunks.js` and `controls.js` is **unprojecting a screen point onto the `y = 0` ground plane** (`unproject` then slide along the view direction until `y = 0`). This is the bridge between screen space and world space.

## Designing the dungeon

Edit `dungeon.txt`: `#` = solid rock, anything else (`.`, space) = a dug-out gap. Lines starting with `;` and blank lines are ignored; rows may be ragged (grid width = longest row). The map is centered on the origin.

## Tunables

All in `config.js`: `SIZE` (cube size/spacing), `CHUNK_SIZE`, `BUFFER_CHUNKS`, `BUILD_BUDGET`, `VIEW_DISTANCE` (zoom), `BACKGROUND`, and the darkness fade (`FADE_RADIUS`, `MIN_BRIGHTNESS`, `FADE_RESOLUTION`, `FADE_BAKE_BUDGET`). Material color and lights are in `view.js` / `chunks.js`.
