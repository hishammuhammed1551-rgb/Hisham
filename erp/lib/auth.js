'use strict';

const crypto = require('node:crypto');

const SESSION_DAYS = 7;
const KEY_LEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// A hash of a random password, compared against when the email is unknown,
// so a login attempt takes the same time whether or not the account exists.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, expires);
  return { token, maxAge: SESSION_DAYS * 86400 };
}

function getSessionUser(db, token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND u.active = 1
  `).get(sha256(token));
  if (!row) return null;
  if (row.expires_at < new Date().toISOString()) {
    destroySession(db, token);
    return null;
  }
  delete row.expires_at;
  return row;
}

function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

function purgeExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
}

/** Simple in-memory limiter: max `limit` failures per key within `windowMs`. */
class LoginLimiter {
  constructor(limit = 8, windowMs = 15 * 60_000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.failures = new Map();
  }
  blocked(key) {
    const entry = this.failures.get(key);
    if (!entry) return false;
    if (Date.now() - entry.first > this.windowMs) {
      this.failures.delete(key);
      return false;
    }
    return entry.count >= this.limit;
  }
  fail(key) {
    const entry = this.failures.get(key);
    if (!entry || Date.now() - entry.first > this.windowMs) {
      this.failures.set(key, { count: 1, first: Date.now() });
    } else {
      entry.count += 1;
    }
  }
  reset(key) {
    this.failures.delete(key);
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  DUMMY_HASH,
  createSession,
  getSessionUser,
  destroySession,
  purgeExpiredSessions,
  LoginLimiter,
};
