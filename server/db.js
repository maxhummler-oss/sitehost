const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || '/data';
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'db.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    custom_domain TEXT UNIQUE,
    proxy_enabled INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sites_user ON sites(user_id);
  CREATE INDEX IF NOT EXISTS idx_sites_domain ON sites(custom_domain);
`);

function hasUsers() {
  const row = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  return row.c > 0;
}

function createUser(username, passwordHash) {
  const stmt = db.prepare(
    'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)'
  );
  const info = stmt.run(username, passwordHash, Date.now());
  return info.lastInsertRowid;
}

function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function getUserById(id) {
  return db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(id);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expires = now + 1000 * 60 * 60 * 24 * 14; // 14 Tage
  db.prepare(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(token, userId, now, expires);
  return { token, expiresAt: expires };
}

function getSession(token) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return row;
}

function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function cleanupSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

function listSites(userId) {
  return db
    .prepare('SELECT * FROM sites WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId);
}

function getSite(id, userId) {
  return db
    .prepare('SELECT * FROM sites WHERE id = ? AND user_id = ?')
    .get(id, userId);
}

function getSiteBySlug(slug) {
  return db.prepare('SELECT * FROM sites WHERE slug = ?').get(slug);
}

function createSite(userId, name, slug) {
  const id = crypto.randomBytes(8).toString('hex');
  const now = Date.now();
  db.prepare(
    `INSERT INTO sites (id, user_id, name, slug, proxy_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`
  ).run(id, userId, name, slug, now, now);
  return id;
}

function updateSite(id, userId, fields) {
  const allowed = ['name', 'custom_domain', 'proxy_enabled'];
  const sets = [];
  const values = [];
  for (const key of allowed) {
    if (key in fields) {
      sets.push(`${key} = ?`);
      values.push(fields[key]);
    }
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(Date.now());
  values.push(id, userId);
  db.prepare(
    `UPDATE sites SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`
  ).run(...values);
}

function deleteSite(id, userId) {
  db.prepare('DELETE FROM sites WHERE id = ? AND user_id = ?').run(id, userId);
}

function touchSite(id) {
  db.prepare('UPDATE sites SET updated_at = ? WHERE id = ?').run(Date.now(), id);
}

function getAllProxiedSites() {
  return db
    .prepare('SELECT * FROM sites WHERE proxy_enabled = 1 AND custom_domain IS NOT NULL')
    .all();
}

module.exports = {
  DATA_DIR,
  db,
  hasUsers,
  createUser,
  getUserByUsername,
  getUserById,
  createSession,
  getSession,
  deleteSession,
  cleanupSessions,
  listSites,
  getSite,
  getSiteBySlug,
  createSite,
  updateSite,
  deleteSite,
  touchSite,
  getAllProxiedSites,
};
