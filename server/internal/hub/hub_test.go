package hub

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/witold-gawlowski/unbrughm/server/internal/world"
)

// Save routes through the hub goroutine (which owns the world) and writes a
// file the world package can reload.
func TestSaveThroughRunLoop(t *testing.T) {
	h := New(world.Parse("#.#\n...\n#.#\n"))
	go h.Run()

	path := filepath.Join(t.TempDir(), "world.save")
	if err := h.Save(path); err != nil {
		t.Fatalf("Save: %v", err)
	}
	w, ok, err := world.Load(path)
	if err != nil || !ok {
		t.Fatalf("reload saved world: ok=%v err=%v", ok, err)
	}
	if len(w.DugCells()) != 5 {
		t.Errorf("reloaded %d dug cells, want 5", len(w.DugCells()))
	}
}

// Integration test: two real WebSocket clients against a running hub, covering
// welcome, join, dig relay routing, and leave.
func TestTwoClientSession(t *testing.T) {
	// A dug plus shape: origin plus its four orthogonal neighbors.
	h := New(world.Parse("#.#\n...\n#.#\n"))
	go h.Run()
	srv := httptest.NewServer(http.HandlerFunc(h.ServeWs))
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http")

	c1 := dial(t, url)
	defer c1.Close()
	w1 := readUntil(t, c1, "welcome")
	if w1["id"].(float64) != 1 {
		t.Fatalf("first player id = %v, want 1", w1["id"])
	}
	spawn1 := w1["spawn"].(map[string]any)
	if spawn1["x"].(float64) != 0 || spawn1["z"].(float64) != 0 {
		t.Fatalf("first spawn = %v, want origin", spawn1)
	}
	if n := len(w1["dug"].([]any)); n != 5 {
		t.Fatalf("dug cells = %d, want 5", n)
	}
	if n := len(w1["players"].([]any)); n != 0 {
		t.Fatalf("first player sees %d others, want 0", n)
	}

	c2 := dial(t, url)
	defer c2.Close()
	w2 := readUntil(t, c2, "welcome")
	spawn2 := w2["spawn"].(map[string]any)
	if spawn2["x"] == spawn1["x"] && spawn2["z"] == spawn1["z"] {
		t.Fatal("second spawn must differ from an occupied first spawn")
	}
	if n := len(w2["players"].([]any)); n != 1 {
		t.Fatalf("second player sees %d others, want 1", n)
	}
	join := readUntil(t, c1, "join")
	if join["player"].(map[string]any)["id"].(float64) != 2 {
		t.Fatalf("join relayed to first client = %v, want player 2", join)
	}

	// A dig from client 2 reaches client 1...
	if err := c2.WriteJSON(map[string]any{"type": "dig", "x": 2, "z": 0}); err != nil {
		t.Fatal(err)
	}
	dig := readUntil(t, c1, "dig")
	if dig["x"].(float64) != 2 || dig["z"].(float64) != 0 {
		t.Fatalf("relayed dig = %v, want (2,0)", dig)
	}
	// ...but is not echoed back to client 2: the next several frames (a
	// ~200 ms window of 50 ms ticks) must all be pos ticks, streaming both
	// players. (A read deadline can't be used to probe for the echo — gorilla
	// treats any read error, timeouts included, as fatal for the connection.)
	c2.SetReadDeadline(time.Now().Add(2 * time.Second))
	for i := 0; i < 4; i++ {
		var msg map[string]any
		if err := c2.ReadJSON(&msg); err != nil {
			t.Fatalf("reading tick %d: %v", i, err)
		}
		if msg["type"] != "pos" {
			t.Fatalf("unexpected frame for dig sender: %v", msg)
		}
		if n := len(msg["players"].([]any)); n != 2 {
			t.Fatalf("pos tick has %d players, want 2", n)
		}
	}
	c2.SetReadDeadline(time.Time{})

	c1.Close()
	leave := readUntil(t, c2, "leave")
	if leave["id"].(float64) != 1 {
		t.Fatalf("leave = %v, want id 1", leave)
	}
}

func dial(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial %s: %v", url, err)
	}
	return conn
}

// readUntil skips unrelated frames (mostly pos ticks) until one of the wanted
// type arrives.
func readUntil(t *testing.T, conn *websocket.Conn, msgType string) map[string]any {
	t.Helper()
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	defer conn.SetReadDeadline(time.Time{})
	for {
		var msg map[string]any
		if err := conn.ReadJSON(&msg); err != nil {
			t.Fatalf("waiting for %q: %v", msgType, err)
		}
		if msg["type"] == msgType {
			return msg
		}
	}
}
