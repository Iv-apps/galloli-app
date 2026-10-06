-- Schema para Cloudflare D1
-- Ejecutar con: wrangler d1 execute galloli --file=workers/schema.sql

-- Tabla de negocios
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER,
  settings TEXT DEFAULT '{}',
  subscription_tier TEXT DEFAULT 'free',
  max_users INTEGER DEFAULT 10,
  is_active INTEGER DEFAULT 1
);

-- Tabla de usuarios
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  telegram_id TEXT UNIQUE,
  telegram_username TEXT,
  email TEXT UNIQUE,
  password_hash TEXT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  permissions TEXT DEFAULT '{}',
  pin_hash TEXT,
  created_at INTEGER NOT NULL,
  last_seen INTEGER,
  is_active INTEGER DEFAULT 1,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

-- Tabla de sesiones
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  device_info TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_activity INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Tabla de datos sincronizados
CREATE TABLE IF NOT EXISTS sync_data (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  data_type TEXT NOT NULL,
  data TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_by TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER DEFAULT 0,
  deleted_at INTEGER,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Tabla de cambios
CREATE TABLE IF NOT EXISTS changes (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  data_type TEXT NOT NULL,
  data_id TEXT NOT NULL,
  action TEXT NOT NULL,
  changes TEXT,
  timestamp INTEGER NOT NULL,
  synced INTEGER DEFAULT 0,
  device_id TEXT,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Tabla de códigos de invitación
CREATE TABLE IF NOT EXISTS invitation_codes (
  code TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  role TEXT NOT NULL,
  max_uses INTEGER DEFAULT 1,
  uses INTEGER DEFAULT 0,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  is_active INTEGER DEFAULT 1,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_users_business ON users(business_id, is_active);
CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_id) WHERE telegram_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_sync_data_business ON sync_data(business_id, data_type, deleted);
CREATE INDEX IF NOT EXISTS idx_sync_data_updated ON sync_data(business_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_changes_business ON changes(business_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_changes_sync ON changes(business_id, synced, timestamp);

-- Tabla de códigos de verificación temporales (Telegram)
CREATE TABLE IF NOT EXISTS verification_codes (
  telegram_id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_verification_expires ON verification_codes(expires_at);

-- Tabla de suscripciones push (Web Push VAPID)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  is_active INTEGER DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_push_subs_business ON push_subscriptions(business_id, is_active);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id, is_active);

-- Tabla de recuperación de contraseña (tokens de reset)
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pwreset_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_pwreset_token ON password_resets(token_hash);
