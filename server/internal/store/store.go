// Package store is the Postgres persistence layer: accounts and their login
// sessions. It owns a pgx connection pool for runtime queries and applies the
// embedded goose migrations once at Open. Everything here does blocking I/O, so
// callers must stay out of the hub's tick goroutine (see hub.ServeWs).
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver "pgx", for goose
	"github.com/pressly/goose/v3"

	"github.com/witold-gawlowski/unbrughm/server/migrations"
)

// Sentinel errors let handlers map failures to HTTP status codes without
// inspecting driver-specific error types.
var (
	ErrUsernameTaken = errors.New("username already taken")
	ErrNoAccount     = errors.New("account not found")
	ErrNoSession     = errors.New("session not found or expired")
)

type Store struct {
	pool *pgxpool.Pool
}

// Open connects to Postgres, verifies the connection, and applies any pending
// migrations. The returned Store must be Closed by the caller.
func Open(ctx context.Context, dsn string) (*Store, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("connecting to postgres: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("pinging postgres: %w", err)
	}
	if err := migrate(dsn); err != nil {
		pool.Close()
		return nil, err
	}
	return &Store{pool: pool}, nil
}

// migrate runs goose against a short-lived database/sql connection (goose speaks
// database/sql, not pgxpool); the pool is used for everything else.
func migrate(dsn string) error {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return fmt.Errorf("opening migration connection: %w", err)
	}
	defer db.Close()

	goose.SetBaseFS(migrations.FS)
	if err := goose.SetDialect("postgres"); err != nil {
		return fmt.Errorf("setting goose dialect: %w", err)
	}
	if err := goose.Up(db, "."); err != nil {
		return fmt.Errorf("running migrations: %w", err)
	}
	return nil
}

func (s *Store) Close() { s.pool.Close() }

// CreateAccount inserts a new account and returns its id. A duplicate username
// surfaces as ErrUsernameTaken.
func (s *Store) CreateAccount(ctx context.Context, username, passwordHash string) (int64, error) {
	var id int64
	err := s.pool.QueryRow(ctx,
		`INSERT INTO accounts (username, password_hash) VALUES ($1, $2) RETURNING id`,
		username, passwordHash).Scan(&id)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" { // unique_violation
			return 0, ErrUsernameTaken
		}
		return 0, fmt.Errorf("creating account: %w", err)
	}
	return id, nil
}

// AccountByUsername returns the account id and stored password hash, or
// ErrNoAccount if none exists.
func (s *Store) AccountByUsername(ctx context.Context, username string) (int64, string, error) {
	var id int64
	var hash string
	err := s.pool.QueryRow(ctx,
		`SELECT id, password_hash FROM accounts WHERE username = $1`,
		username).Scan(&id, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, "", ErrNoAccount
	}
	if err != nil {
		return 0, "", fmt.Errorf("looking up account: %w", err)
	}
	return id, hash, nil
}

// CreateSession records a freshly minted token for an account.
func (s *Store) CreateSession(ctx context.Context, accountID int64, token string, expiresAt time.Time) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO sessions (token, account_id, expires_at) VALUES ($1, $2, $3)`,
		token, accountID, expiresAt)
	if err != nil {
		return fmt.Errorf("creating session: %w", err)
	}
	return nil
}

// SessionAccount resolves an unexpired token to its account id and username, or
// ErrNoSession if the token is unknown, empty, or expired.
func (s *Store) SessionAccount(ctx context.Context, token string) (int64, string, error) {
	if token == "" {
		return 0, "", ErrNoSession
	}
	var id int64
	var username string
	err := s.pool.QueryRow(ctx,
		`SELECT a.id, a.username
		   FROM sessions s
		   JOIN accounts a ON a.id = s.account_id
		  WHERE s.token = $1 AND s.expires_at > now()`,
		token).Scan(&id, &username)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, "", ErrNoSession
	}
	if err != nil {
		return 0, "", fmt.Errorf("looking up session: %w", err)
	}
	return id, username, nil
}
