// Package auth serves the account HTTP endpoints: POST /register and POST
// /login, both taking JSON {username, password}. Passwords are hashed with
// bcrypt; a successful call mints an opaque session token (stored via the
// store) that the client later presents on the /ws handshake.
package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/witold-gawlowski/unbrughm/server/internal/store"
)

// Store is the slice of persistence the auth handlers need. *store.Store
// satisfies it; a fake stands in for tests.
type Store interface {
	CreateAccount(ctx context.Context, username, passwordHash string) (int64, error)
	AccountByUsername(ctx context.Context, username string) (int64, string, error)
	CreateSession(ctx context.Context, accountID int64, token string, expiresAt time.Time) error
}

type Handlers struct {
	store      Store
	sessionTTL time.Duration
}

func New(s Store, sessionTTL time.Duration) *Handlers {
	return &Handlers{store: s, sessionTTL: sessionTTL}
}

// Register wires the auth routes onto mux.
func (h *Handlers) Register(mux *http.ServeMux) {
	mux.HandleFunc("/register", h.register)
	mux.HandleFunc("/login", h.login)
}

type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// register creates an account and logs it straight in (returns a token).
func (h *Handlers) register(w http.ResponseWriter, r *http.Request) {
	creds, ok := decode(w, r)
	if !ok {
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(creds.Password), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	id, err := h.store.CreateAccount(r.Context(), creds.Username, string(hash))
	if errors.Is(err, store.ErrUsernameTaken) {
		http.Error(w, "username already taken", http.StatusConflict)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	h.startSession(w, r, id, creds.Username)
}

// login verifies credentials and returns a token. Unknown user and wrong
// password both yield a uniform 401 so the response can't probe for usernames.
func (h *Handlers) login(w http.ResponseWriter, r *http.Request) {
	creds, ok := decode(w, r)
	if !ok {
		return
	}
	id, hash, err := h.store.AccountByUsername(r.Context(), creds.Username)
	if errors.Is(err, store.ErrNoAccount) {
		http.Error(w, "invalid username or password", http.StatusUnauthorized)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(creds.Password)) != nil {
		http.Error(w, "invalid username or password", http.StatusUnauthorized)
		return
	}
	h.startSession(w, r, id, creds.Username)
}

// startSession mints a token, persists it, and returns {token, username}.
func (h *Handlers) startSession(w http.ResponseWriter, r *http.Request, accountID int64, username string) {
	token, err := newToken()
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if err := h.store.CreateSession(r.Context(), accountID, token, time.Now().Add(h.sessionTTL)); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"token": token, "username": username})
}

// decode reads and validates the JSON credentials, writing the error response
// itself and reporting ok=false when the request is unusable.
func decode(w http.ResponseWriter, r *http.Request) (credentials, bool) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return credentials{}, false
	}
	var c credentials
	if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return credentials{}, false
	}
	if c.Username == "" || c.Password == "" {
		http.Error(w, "username and password required", http.StatusBadRequest)
		return credentials{}, false
	}
	return c, true
}

func newToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
