# unbrughm

A minimal three.js scene: a square grid of cubes rendered in a 3/4 (isometric)
view, where the dungeon layout is designed with an ASCII map.

## Running

The game is online-only: the client connects to the Go server in [`server/`](server/),
which serves these static files *and* runs the multiplayer session (world state,
movement, digs). From the repo root:

```
cd server && go run ./cmd/server
```

Then open <http://localhost:8000/> — one tab per player.

## Designing the dungeon

The world is an infinite plane of solid cubes; the map carves holes into it.
Edit `server/dungeon.txt` (the server parses it and sends the dug cells over the
wire):

- `#` &nbsp;→ solid rock cube (same as the surrounding infinite field)
- anything else (`.`, space) → a dug-out gap (a hole in the field)
- lines starting with `;` and blank lines are ignored
- rows can be ragged; the grid width is the longest row

The map is centered on the origin, and only the chunks needed to cover the
screen (a 5×5 block of 16×16 chunks) are loaded. Just refresh the browser
after editing.

## Tweaking

In `index.html`:

- `SIZE` — cube size / spacing
- material `color` / lights — appearance
- `camera.position` — view angle (equal x/y/z gives the classic 3/4 view)

## Files

- `index.html` — the scene (three.js from CDN, no build step)
- `src/` — the client modules (see `CLAUDE.md` for the architecture)
- `server/` — the Go multiplayer server; `server/dungeon.txt` is the ASCII map
