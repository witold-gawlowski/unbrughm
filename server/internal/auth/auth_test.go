package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/witold-gawlowski/unbrughm/server/internal/store"
)

// fakeStore is an in-memory stand-in for *store.Store, mirroring its unique
// username and not-found semantics.
type fakeStore struct {
	mu       sync.Mutex
	accounts map[string]fakeAccount // username -> account
	sessions map[string]int64       // token -> account id
	nextID   int64
}

type fakeAccount struct {
	id   int64
	hash string
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		accounts: map[string]fakeAccount{},
		sessions: map[string]int64{},
		nextID:   1,
	}
}

func (f *fakeStore) CreateAccount(_ context.Context, username, hash string) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.accounts[username]; ok {
		return 0, store.ErrUsernameTaken
	}
	id := f.nextID
	f.nextID++
	f.accounts[username] = fakeAccount{id: id, hash: hash}
	return id, nil
}

func (f *fakeStore) AccountByUsername(_ context.Context, username string) (int64, string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	a, ok := f.accounts[username]
	if !ok {
		return 0, "", store.ErrNoAccount
	}
	return a.id, a.hash, nil
}

func (f *fakeStore) CreateSession(_ context.Context, accountID int64, token string, _ time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sessions[token] = accountID
	return nil
}

func newServer(t *testing.T) (*httptest.Server, *fakeStore) {
	t.Helper()
	fs := newFakeStore()
	mux := http.NewServeMux()
	New(fs, time.Hour).Register(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv, fs
}

func post(t *testing.T, srv *httptest.Server, path, username, password string) *http.Response {
	t.Helper()
	body, _ := json.Marshal(credentials{Username: username, Password: password})
	res, err := http.Post(srv.URL+path, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("POST %s: %v", path, err)
	}
	return res
}

func tokenFrom(t *testing.T, res *http.Response) string {
	t.Helper()
	defer res.Body.Close()
	var out struct {
		Token    string `json:"token"`
		Username string `json:"username"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatalf("decoding token response: %v", err)
	}
	if out.Token == "" {
		t.Fatal("expected a non-empty token")
	}
	return out.Token
}

func TestRegisterThenLogin(t *testing.T) {
	srv, fs := newServer(t)

	res := post(t, srv, "/register", "alice", "s3cret")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("register status = %d, want 200", res.StatusCode)
	}
	regToken := tokenFrom(t, res)
	if _, ok := fs.sessions[regToken]; !ok {
		t.Fatal("register did not persist a session")
	}

	res = post(t, srv, "/login", "alice", "s3cret")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("login status = %d, want 200", res.StatusCode)
	}
	loginToken := tokenFrom(t, res)
	if loginToken == regToken {
		t.Fatal("login should mint a fresh token, not reuse the register one")
	}
}

func TestDuplicateUsername(t *testing.T) {
	srv, _ := newServer(t)
	post(t, srv, "/register", "bob", "pw").Body.Close()

	res := post(t, srv, "/register", "bob", "other")
	defer res.Body.Close()
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("duplicate register status = %d, want 409", res.StatusCode)
	}
}

func TestLoginWrongPassword(t *testing.T) {
	srv, _ := newServer(t)
	post(t, srv, "/register", "carol", "right").Body.Close()

	res := post(t, srv, "/login", "carol", "wrong")
	defer res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong-password status = %d, want 401", res.StatusCode)
	}
}

func TestLoginUnknownUser(t *testing.T) {
	srv, _ := newServer(t)
	res := post(t, srv, "/login", "nobody", "pw")
	defer res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unknown-user status = %d, want 401", res.StatusCode)
	}
}

func TestMissingFields(t *testing.T) {
	srv, _ := newServer(t)
	res := post(t, srv, "/register", "dave", "")
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("missing-password status = %d, want 400", res.StatusCode)
	}
}
