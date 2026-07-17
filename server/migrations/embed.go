// Package migrations bundles the goose SQL migrations into the binary so the
// server can apply them at startup (store.Open) without a separate CLI step.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
