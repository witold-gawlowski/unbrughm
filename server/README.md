# unbrughm server

Prototype multiplayer server for [unbrughm](..): holds the world state (dug
cells + player positions) in RAM and relays movement and digs between browser
clients over WebSocket + JSON. It also serves the client's static files (the
repo root), so it replaces `python -m http.server`.

Player **accounts** are persisted in Postgres (username + bcrypt password hash +
login sessions); the live game state stays in RAM. Only logged-in connections
may join `/ws`.

This is the `server/` half of the unbrughm monorepo; the client lives at the
repo root.

## Run

Requires Go 1.22+ and Docker (for Postgres). Per issue #20, only the database
runs in a container — the game server runs natively.

1. Start Postgres (from the **repo root**, where `docker-compose.yml` lives):

   ```
   docker compose up -d
   ```

2. Start the server (from this `server/` directory). Migrations are applied
   automatically on startup:

   ```
   go run ./cmd/server
   ```

Then open <http://localhost:8000/> — one tab per player. Each tab shows a
login/register form; register an account, and the game boots once you're in.

Flags:

- `-addr :8000` — listen address
- `-client ..` — client directory to serve at `/` (the repo root)
- `-map dungeon.txt` — ASCII dungeon map (same format as the client's original)

Environment:

- `DATABASE_URL` — Postgres connection string. Defaults to the docker-compose
  service: `postgres://unbrughm:unbrughm@localhost:5432/unbrughm?sslmode=disable`.
- `SESSION_TTL` — login session lifetime as a Go duration (default `24h`).

### Accounts API

- `POST /register` — JSON `{username, password}` → `{token, username}` (409 if
  the username is taken). Creates the account and logs it straight in.
- `POST /login` — JSON `{username, password}` → `{token, username}` (401 on bad
  credentials).

The client passes the returned token to `/ws` as `?token=…`; the server resolves
it to an account before upgrading the WebSocket.

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
  without validation. `ServeWs` authenticates the session token (blocking DB
  lookup) *before* handing the client to the tick goroutine.
- `internal/store` — Postgres persistence (pgx pool) for accounts and sessions;
  applies the embedded goose migrations in `migrations/` at startup.
- `internal/auth` — the `/register` and `/login` HTTP handlers (bcrypt hashing,
  opaque session tokens).
- Protocol: JSON text frames on `/ws` — see the message structs in
  `internal/hub/hub.go` and the client's `src/net.js`.

Prototype scope: accounts are persisted, but game/world state is not — it lives
in RAM and resets when the server restarts. Still client-authoritative, no
anti-cheat.
