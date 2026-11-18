'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  kind        TEXT    NOT NULL DEFAULT 'company' CHECK (kind IN ('company', 'individual')),
  status      TEXT    NOT NULL DEFAULT 'lead'    CHECK (status IN ('lead', 'active', 'inactive')),
  trn         TEXT,
  email       TEXT,
  phone       TEXT,
  address     TEXT,
  city        TEXT,
  country     TEXT    DEFAULT 'United Arab Emirates',
  source      TEXT,
  services    TEXT,
  notes       TEXT,
  owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  job_title   TEXT,
  email       TEXT,
  phone       TEXT,
  is_primary  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('note', 'call', 'meeting', 'email', 'follow_up')),
  body        TEXT    NOT NULL,
  due_at      TEXT,
  done        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customers_status   ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_owner    ON customers(owner_id);
CREATE INDEX IF NOT EXISTS idx_contacts_customer  ON contacts(customer_id);
CREATE INDEX IF NOT EXISTS idx_activities_customer ON activities(customer_id);
CREATE INDEX IF NOT EXISTS idx_activities_due     ON activities(due_at) WHERE kind = 'follow_up' AND done = 0;
`;

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

/** Run fn inside a transaction; rolls back if it throws. */
function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDatabase, transaction };
