'use strict';

// Couche d'accès aux données : SQLite intégré à Node.js (node:sqlite), sans dépendance native.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  venue       TEXT    NOT NULL,
  city        TEXT    NOT NULL,
  starts_at   TEXT    NOT NULL,              -- ISO 8601
  capacity    INTEGER NOT NULL CHECK (capacity > 0),
  price_eur   REAL    NOT NULL DEFAULT 0 CHECK (price_eur >= 0),
  cover_url   TEXT    NOT NULL DEFAULT '',
  published   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Partenaires (influenceurs, comptes Instagram / TikTok) : chacun a un code de parrainage
CREATE TABLE IF NOT EXISTS partners (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  platform   TEXT NOT NULL CHECK (platform IN ('instagram','tiktok','youtube','autre')),
  code       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS registrations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  first_name    TEXT    NOT NULL,
  last_name     TEXT    NOT NULL,
  email         TEXT    NOT NULL COLLATE NOCASE,
  phone         TEXT    NOT NULL DEFAULT '',
  source        TEXT    NOT NULL DEFAULT 'autre',
  partner_id    INTEGER REFERENCES partners(id) ON DELETE SET NULL,
  status        TEXT    NOT NULL CHECK (status IN ('confirmed','waitlist','cancelled')),
  ticket_code   TEXT    NOT NULL UNIQUE,
  checked_in_at TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Une personne ne peut avoir qu'une inscription active par événement
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_registration
  ON registrations(event_id, email) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS ix_registrations_event ON registrations(event_id, status);
`;

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

/** Exécute fn dans une transaction (rollback automatique en cas d'erreur). */
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
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
