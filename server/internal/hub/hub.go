// Package hub runs the multiplayer session: one goroutine owns the world and
// the connected clients, so no state needs locks. Clients feed decoded
// messages in through channels; the hub applies digs immediately and
// broadcasts all player positions on a fixed 50 ms tick (~20/s).
//
// Everything is client-authoritative by design (prototype): positions and
// digs arrive as facts and are recorded and relayed without validation.
package hub

import (
	"encoding/json"
	"log"
	"math"
	"time"

	"github.com/witold-gawlowski/unbrughm/server/internal/world"
)

const tickInterval = 50 * time.Millisecond

// clientMsg is anything a client sends: pos (world-unit floats, but SIZE=1 so
// they coincide with cell coordinates) or dig (integer cell).
type clientMsg struct {
	Type string  `json:"type"`
	X    float64 `json:"x"`
	Z    float64 `json:"z"`
}

type playerState struct {
	ID int     `json:"id"`
	X  float64 `json:"x"`
	Z  float64 `json:"z"`
}

type inbound struct {
	client *Client
	msg    clientMsg
}

type Hub struct {
	world      *world.World
	clients    map[*Client]bool
	nextID     int
	register   chan *Client
	unregister chan *Client
	inbound    chan inbound
}

func New(w *world.World) *Hub {
	return &Hub{
		world:      w,
		clients:    make(map[*Client]bool),
		nextID:     1,
		register:   make(chan *Client),
		unregister: make(chan *Client),
		inbound:    make(chan inbound, 64),
	}
}

// Run is the hub's single event loop; start it once in its own goroutine.
func (h *Hub) Run() {
	ticker := time.NewTicker(tickInterval)
	defer ticker.Stop()
	for {
		select {
		case c := <-h.register:
			h.addClient(c)
		case c := <-h.unregister:
			if h.clients[c] {
				h.dropClient(c)
				h.broadcast(map[string]any{"type": "leave", "id": c.id})
			}
		case in := <-h.inbound:
			h.handle(in.client, in.msg)
		case <-ticker.C:
			h.broadcastPositions()
		}
	}
}

func (h *Hub) addClient(c *Client) {
	c.id = h.nextID
	h.nextID++

	occupied := make([]world.Cell, 0, len(h.clients))
	for other := range h.clients {
		occupied = append(occupied, world.Cell{
			X: int(math.Round(other.x)), Z: int(math.Round(other.z))})
	}
	spawn := h.world.Spawn(occupied)
	c.x, c.z = float64(spawn.X), float64(spawn.Z)

	others := make([]playerState, 0, len(h.clients))
	for other := range h.clients {
		others = append(others, playerState{ID: other.id, X: other.x, Z: other.z})
	}
	dug := h.world.DugCells()
	dugPairs := make([][2]int, len(dug))
	for i, cell := range dug {
		dugPairs[i] = [2]int{cell.X, cell.Z}
	}
	h.send(c, map[string]any{
		"type":    "welcome",
		"id":      c.id,
		"spawn":   map[string]int{"x": spawn.X, "z": spawn.Z},
		"dug":     dugPairs,
		"players": others,
	})

	h.broadcast(map[string]any{
		"type":   "join",
		"player": playerState{ID: c.id, X: c.x, Z: c.z},
	})
	h.clients[c] = true
	log.Printf("player %d joined at (%d, %d), %d online", c.id, spawn.X, spawn.Z, len(h.clients))
}

func (h *Hub) handle(c *Client, m clientMsg) {
	if !h.clients[c] {
		return // message raced with the client being dropped
	}
	switch m.Type {
	case "pos":
		c.x, c.z = m.X, m.Z
	case "dig":
		x, z := int(math.Round(m.X)), int(math.Round(m.Z))
		h.world.Dig(x, z)
		relay := mustMarshal(map[string]any{"type": "dig", "x": x, "z": z})
		for other := range h.clients {
			if other != c {
				h.sendRaw(other, relay)
			}
		}
	}
}

func (h *Hub) broadcastPositions() {
	if len(h.clients) == 0 {
		return
	}
	players := make([]playerState, 0, len(h.clients))
	for c := range h.clients {
		players = append(players, playerState{ID: c.id, X: c.x, Z: c.z})
	}
	h.broadcast(map[string]any{"type": "pos", "players": players})
}

func (h *Hub) broadcast(v any) {
	raw := mustMarshal(v)
	for c := range h.clients {
		h.sendRaw(c, raw)
	}
}

func (h *Hub) send(c *Client, v any) {
	h.sendRaw(c, mustMarshal(v))
}

// sendRaw hands the frame to the client's write pump without blocking the hub:
// a client whose buffer is full is too slow to keep, so drop it.
func (h *Hub) sendRaw(c *Client, raw []byte) {
	select {
	case c.send <- raw:
	default:
		if h.clients[c] {
			h.dropClient(c)
			h.broadcast(map[string]any{"type": "leave", "id": c.id})
		}
	}
}

func (h *Hub) dropClient(c *Client) {
	delete(h.clients, c)
	close(c.send)
	log.Printf("player %d left, %d online", c.id, len(h.clients))
}

func mustMarshal(v any) []byte {
	raw, err := json.Marshal(v)
	if err != nil {
		panic(err) // only fed values we construct; a failure is a bug
	}
	return raw
}
