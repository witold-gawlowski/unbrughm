// The unbrughm prototype server: serves the browser client's static files,
// exposes the account endpoints (/register, /login), and runs the multiplayer
// hub on /ws. Accounts live in Postgres (run it via docker-compose); the game
// server itself stays a native process. Replaces `python -m http.server`.
package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/witold-gawlowski/unbrughm/server/internal/auth"
	"github.com/witold-gawlowski/unbrughm/server/internal/hub"
	"github.com/witold-gawlowski/unbrughm/server/internal/store"
	"github.com/witold-gawlowski/unbrughm/server/internal/world"
)

const defaultDSN = "postgres://unbrughm:unbrughm@localhost:5432/unbrughm?sslmode=disable"

func main() {
	addr := flag.String("addr", ":8000", "listen address")
	client := flag.String("client", "..", "path to the client directory to serve")
	mapFile := flag.String("map", "dungeon.txt", "path to the ASCII dungeon map")
	saveFile := flag.String("save", "world.save", "path to persist the dug world; loaded on start, written on shutdown")
	flag.Parse()

	dsn := envOr("DATABASE_URL", defaultDSN)
	sessionTTL := envDuration("SESSION_TTL", 24*time.Hour)

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

	st, err := store.Open(context.Background(), dsn)
	if err != nil {
		log.Fatalf("opening store: %v", err)
	}
	defer st.Close()
	log.Printf("connected to postgres, migrations applied")

	h := hub.New(w, st)
	go h.Run()

	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.Dir(*client)))
	mux.HandleFunc("/ws", h.ServeWs)
	auth.New(st, sessionTTL).Register(mux)

	go func() {
		log.Printf("serving %s on %s (game at http://localhost%s/)", *client, *addr, *addr)
		log.Fatal(http.ListenAndServe(*addr, mux))
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

// envOr returns the environment variable named key, or fallback if it is unset
// or empty.
func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// envDuration parses key as a Go duration (e.g. "24h", "30m"), falling back on
// unset or invalid values.
func envDuration(key string, fallback time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		log.Printf("invalid %s=%q, using %s", key, v, fallback)
		return fallback
	}
	return d
}
