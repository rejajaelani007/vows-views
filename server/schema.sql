PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_expiry ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS qr_codes (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 100),
  code TEXT NOT NULL UNIQUE,
  total_limit INTEGER NOT NULL CHECK(total_limit BETWEEN 1 AND 1000000),
  per_session_limit INTEGER NOT NULL CHECK(per_session_limit BETWEEN 1 AND total_limit),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK(used_count BETWEEN 0 AND total_limit),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS guest_sessions (
  id TEXT PRIMARY KEY,
  qr_id TEXT NOT NULL REFERENCES qr_codes(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  csrf TEXT NOT NULL,
  photo_limit INTEGER NOT NULL CHECK(photo_limit > 0),
  photo_count INTEGER NOT NULL DEFAULT 0 CHECK(photo_count BETWEEN 0 AND photo_limit),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','expired')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_qr ON guest_sessions(qr_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON guest_sessions(expires_at,status);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  qr_id TEXT NOT NULL REFERENCES qr_codes(id) ON DELETE RESTRICT,
  session_id TEXT NOT NULL REFERENCES guest_sessions(id) ON DELETE RESTRICT,
  storage_name TEXT NOT NULL UNIQUE,
  thumb_name TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK(file_size > 0),
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  request_key TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '' CHECK(length(message) <= 500),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT,
  UNIQUE(session_id,request_key)
);
CREATE INDEX IF NOT EXISTS idx_photos_gallery ON photos(deleted_at,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_photos_qr ON photos(qr_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_session ON photos(session_id);
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  partner_one TEXT NOT NULL DEFAULT 'Amelia',
  partner_two TEXT NOT NULL DEFAULT 'Rafael',
  wedding_date TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL DEFAULT '',
  welcome_message TEXT NOT NULL DEFAULT 'Setiap senyum, setiap pelukan, setiap momen kecil. Abadikan kebahagiaan hari ini bersama kami.'
);
INSERT OR IGNORE INTO settings(id) VALUES(1);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  total_hits INTEGER NOT NULL,
  reset_time INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expiry ON rate_limits(reset_time);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  event_json TEXT NOT NULL DEFAULT '{}',
  filters_json TEXT,
  revision INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE TABLE IF NOT EXISTS project_images (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slot TEXT NOT NULL CHECK(slot IN ('hero','background','banner','decoration','logo','couple')),
  jpeg BLOB NOT NULL,
  PRIMARY KEY(project_id,slot)
);
