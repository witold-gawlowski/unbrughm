// The unbrughm prototype server: serves the browser client's static files and
// runs the multiplayer hub on /ws. Replaces `python -m http.server` as the way
// to run the game.
package main

import (
	"flag"
	"log"
	"net/http"
	"os"

	"github.com/witold-gawlowski/unbrughm/server/internal/hub"
	"github.com/witold-gawlowski/unbrughm/server/internal/world"
)

func main() {
	addr := flag.String("addr", ":8000", "listen address")
	client := flag.String("client", "..", "path to the client directory to serve")
	mapFile := flag.String("map", "dungeon.txt", "path to the ASCII dungeon map")
	flag.Parse()

	raw, err := os.ReadFile(*mapFile)
	if err != nil {
		log.Fatalf("reading map: %v", err)
	}
	w := world.Parse(string(raw))

	h := hub.New(w)
	go h.Run()

	http.Handle("/", http.FileServer(http.Dir(*client)))
	http.HandleFunc("/ws", h.ServeWs)

	log.Printf("serving %s on %s (game at http://localhost%s/)", *client, *addr, *addr)
	log.Fatal(http.ListenAndServe(*addr, nil))
}
