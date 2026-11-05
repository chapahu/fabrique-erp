-- =====================================================================
-- Migration 002 : utilisateurs, sessions (les "badges") et auteur des mouvements
-- =====================================================================

-- Les personnes qui utilisent l'ERP
CREATE TABLE users (
  id             SERIAL PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('admin', 'production', 'achats', 'boutique')),
  location_id    INTEGER REFERENCES locations(id),  -- la boutique d'un vendeur
  password_hash  TEXT NOT NULL,   -- JAMAIS le mot de passe lui-même : seulement son empreinte
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- un vendeur est forcément rattaché à une boutique
  CHECK (role <> 'boutique' OR location_id IS NOT NULL)
);

-- Les sessions : un "badge" temporaire remis à la connexion.
-- On stocke l'EMPREINTE du badge, pas le badge : même si la base fuitait, on ne pourrait pas s'en servir.
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions (user_id);

-- Qui a fait quoi : chaque mouvement de stock garde son auteur (piste d'audit).
-- Colonne facultative : les mouvements créés avant cette migration n'ont pas d'auteur connu.
ALTER TABLE stock_movements ADD COLUMN user_id INTEGER REFERENCES users(id);
