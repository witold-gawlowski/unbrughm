# unbrughm server

Prototype multiplayer server for [unbrughm](..): holds the world state (dug
cells + player positions) in RAM and relays movement and digs between browser
clients over WebSocket + JSON. It also serves the client's static files (the
repo root), so it replaces `python -m http.server`.

This is the `server/` half of the unbrughm monorepo; the client lives at the
repo root.

## Run

Requires Go 1.22+. From this `server/` directory:

```
go run ./cmd/server
```

Then open <http://localhost:8000/> — one tab per player.

Flags:

- `-addr :8000` — listen address
- `-client ..` — client directory to serve at `/` (the repo root)
- `-map dungeon.txt` — ASCII dungeon map (same format as the client's original)

## Test

```
go test ./...
```

## Design

- `internal/world` — map parsing (mirrors the client's `map.js` rules), the
  dug-cell set, and spawn selection (nearest unoccupied dug cell to origin).
- `internal/hub` — one goroutine owns all mutable state (no locks). Clients
  are client-authoritative: positions stream in ~20/s and are re-broadcast in
  one batched message per 50 ms tick; digs are applied and relayed as facts,
  without validation.
- Protocol: JSON text frames on `/ws` — see the message structs in
  `internal/hub/hub.go` and the client's `src/net.js`.

Prototype scope only: no persistence, no anti-cheat, fresh player identity per
connection.
