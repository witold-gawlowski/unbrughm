// The unbrughm prototype server: serves the browser client's static files and
// runs the multiplayer hub on /ws. Replaces `python -m http.server` as the way
// to run the game.
package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/witold-gawlowski/unbrughm/server/internal/hub"
	"github.com/witold-gawlowski/unbrughm/server/internal/world"
)

func main() {
	addr := flag.String("addr", ":8000", "listen address")
	client := flag.String("client", "..", "path to the client directory to serve")
	mapFile := flag.String("map", "dungeon.txt", "path to the ASCII dungeon map")
	saveFile := flag.String("save", "world.save", "path to persist the dug world; loaded on start, written on shutdown")
	flag.Parse()

	// The save file is the source of truth once it exists: it captures every dug
	// cell, so we restore from it and ignore the ASCII map. Delete it to re-seed
	// the world from dungeon.txt (e.g. after editing the map).
	w, restored, err := world.Load(*saveFile)
	if err != nil {
		log.Fatalf("loading saved world: %v", err)
	}
	if restored {
		log.Printf("restored world from %s", *saveFile)
	} else {
		raw, err := os.ReadFile(*mapFile)
		if err != nil {
			log.Fatalf("reading map: %v", err)
		}
		w = world.Parse(string(raw))
		log.Printf("seeded world from %s", *mapFile)
	}

	h := hub.New(w)
	go h.Run()

	http.Handle("/", http.FileServer(http.Dir(*client)))
	http.HandleFunc("/ws", h.ServeWs)

	go func() {
		log.Printf("serving %s on %s (game at http://localhost%s/)", *client, *addr, *addr)
		log.Fatal(http.ListenAndServe(*addr, nil))
	}()

	// Persist the world on a graceful shutdown (Ctrl+C / SIGTERM).
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	log.Printf("shutting down, saving world to %s", *saveFile)
	if err := h.Save(*saveFile); err != nil {
		log.Fatalf("saving world: %v", err)
	}
	log.Print("world saved")
}
