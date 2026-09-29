// Database schema, embedded in code (not read from a .sql file at runtime) so it can never be missing
// from a serverless bundle. Every statement is idempotent. You can also paste these into the Neon SQL editor.
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id             BIGSERIAL PRIMARY KEY,
    email          TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    kind           TEXT NOT NULL CHECK (kind IN ('staff','student')),
    ref_id         TEXT NOT NULL,
    bootstrap      TEXT,
    token_version  INT  NOT NULL DEFAULT 0,
    disabled       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_kind_ref ON users (kind, ref_id)`,
  `CREATE TABLE IF NOT EXISTS app_state (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    version     INT  NOT NULL DEFAULT 1,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  BIGINT REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
    key       TEXT PRIMARY KEY,
    fails     INT NOT NULL DEFAULT 0,
    first_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id      BIGSERIAL PRIMARY KEY,
    at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id BIGINT,
    action  TEXT NOT NULL,
    detail  TEXT
  )`,
];
