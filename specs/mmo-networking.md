# MMO Networking

Technical decisions for the MMO's networking layer.

## Stack

- Go
- TCP only (no UDP for now)
- Single server, single IP:port handles all players — one socket per player, all sharing the same port

## Protocol

Custom binary messages over TCP. Two serde enums serialized with bincode, framed with `LengthDelimitedCodec`:

- `ClientMessage { Auth, Move(Pos), Action, Ping }`
- `ServerMessage { NewChunk, ChunkUpdate, PlayerPositions, WorldEvent, Pong }`

All traffic (chunks, world updates, other players' positions, player actions) flows over the one persistent connection, distinguished by enum variant. No app-level acks — TCP guarantees delivery.

## Chunk flow

Client doesn't request chunks; it streams its position, and the server decides which chunks to push. Player positions are sent as their own frequent, small message type per tick; chunk data is occasional and bulky.

## Server architecture

- Accept loop spawns tasks per player; socket is `split()` into read/write halves.
- Read tasks deserialize `ClientMessage` and funnel `(PlayerId, msg)` into one shared mpsc → game loop (this is where multi-producer matters).
- Game loop: single task, fixed tick (10–30/s): drain inputs, simulate, then push per-player updates using interest management (only nearby entities/chunks).
- Writing: per-player mpsc + write task (here effectively just an async queue — single producer) so a slow client can't stall the tick. Simplification agreed for the prototype: the game loop may own write halves directly in a `HashMap<PlayerId, WriteHalf>` and skip the write channels until slow clients are a real problem. 
- Separate the connection layer from the simulation.
A gateway process owns the sockets; the world/game process owns the simulation. If the world process crashes and restarts, the gateway holds the player sessions and they see a 3-second freeze instead of a disconnect. This is the biggest structural win.
- Memory is the source of truth, the DB is the checkpoint.
Never read/write the database inside the tick loop. Keep world state in RAM, flush snapshots on a timer (every 30–60s) and immediately on "money events" (trade, loot, purchase, level-up). Crash = lose at most one interval, never lose an item.
- Assume the process will die and make restart cheap.
Run under systemd or Docker with a restart policy. On boot, the world process loads the last snapshot and comes back. Measure your cold-start time and make it seconds, not minutes.

## Frontend
three js