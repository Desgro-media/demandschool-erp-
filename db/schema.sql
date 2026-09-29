CREATE TABLE IF NOT EXISTS users (
  id             BIGSERIAL PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,            -- stored lower-case
  password_hash  TEXT NOT NULL,                   -- scrypt, never the password
  kind           TEXT NOT NULL CHECK (kind IN ('staff','student')),
  ref_id         TEXT NOT NULL,                   -- EMP-101 / STU-01: record inside app_state
  bootstrap      TEXT,                            -- 'leadership' for the first admin only
  token_version  INT  NOT NULL DEFAULT 0,         -- bump to revoke every session
  disabled       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_kind_ref ON users (kind, ref_id);

CREATE TABLE IF NOT EXISTS app_state (
  key         TEXT PRIMARY KEY,                   -- one collection per row (students, invoices, ...)
  value       JSONB NOT NULL,
  version     INT  NOT NULL DEFAULT 1,            -- optimistic concurrency
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS login_attempts (
  key       TEXT PRIMARY KEY,                     -- "email|ip"
  fails     INT NOT NULL DEFAULT 0,
  first_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id      BIGSERIAL PRIMARY KEY,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id BIGINT,
  action  TEXT NOT NULL,
  detail  TEXT
);
