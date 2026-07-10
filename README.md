# unbrughm

A minimal three.js scene: a square grid of cubes rendered in a 3/4 (isometric)
view, where the dungeon layout is designed with an ASCII map.

## Running

`index.html` loads the map with `fetch()`, which browsers block over `file://`.
So serve the folder over HTTP:

```
python -m http.server 8000
```

Then open <http://localhost:8000/>.

Any static server works (`npx serve`, VS Code Live Server, etc.).

## Designing the dungeon

The world is an infinite plane of solid cubes; the map carves holes into it.
Edit `dungeon.txt`:

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
- `dungeon.txt` — the ASCII dungeon map
