-- +goose Up
-- citext gives case-insensitive usernames (and later emails) without per-query LOWER().
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE accounts (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username      citext UNIQUE NOT NULL,
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Opaque session tokens minted at login; the /ws handshake looks them up here.
CREATE TABLE sessions (
    token      text PRIMARY KEY,
    account_id bigint NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

-- +goose Down
DROP TABLE sessions;
DROP TABLE accounts;
