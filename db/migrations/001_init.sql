-- =====================================================================
-- Migration 001 : socle de l'ERP
-- Périmètre : sites, articles, fournisseurs, lots, mouvements de stock,
--             recettes (nomenclatures) et ordres de fabrication.
-- Règle : une migration déjà appliquée ne se modifie JAMAIS.
--         Pour changer la structure, on écrit la migration 002, 003...
-- =====================================================================

-- ---------------------------------------------------------------------
-- Emplacements : sites de production, boutiques, entrepôts
-- ---------------------------------------------------------------------
CREATE TABLE locations (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,              -- ex. 'GEN', 'ARD', 'BTQ-MARAIS'
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('production', 'boutique', 'entrepot')),
  city        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Fournisseurs
-- ---------------------------------------------------------------------
CREATE TABLE suppliers (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  email       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Articles : tout ce qui se stocke (matières, emballages, produits finis)
-- ---------------------------------------------------------------------
CREATE TABLE items (
  id          SERIAL PRIMARY KEY,
  sku         TEXT NOT NULL UNIQUE,              -- référence interne, ex. 'MP-FARINE-T55'
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('matiere_premiere', 'emballage', 'produit_fini')),
  unit        TEXT NOT NULL CHECK (unit IN ('kg', 'L', 'u')),
  shelf_life_days INTEGER CHECK (shelf_life_days > 0),  -- durée de vie pour calculer la DLC/DDM
  min_stock   NUMERIC(12,3) NOT NULL DEFAULT 0,  -- seuil d'alerte de réapprovisionnement
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Recettes (nomenclatures / BOM) : "pour faire X unités de ce produit, il faut..."
-- ---------------------------------------------------------------------
CREATE TABLE recipes (
  id               SERIAL PRIMARY KEY,
  product_item_id  INTEGER NOT NULL REFERENCES items(id),
  name             TEXT NOT NULL,
  yield_quantity   NUMERIC(12,3) NOT NULL CHECK (yield_quantity > 0), -- quantité produite par "fournée"
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recipe_lines (
  id          SERIAL PRIMARY KEY,
  recipe_id   INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  item_id     INTEGER NOT NULL REFERENCES items(id),
  quantity    NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  UNIQUE (recipe_id, item_id)
);

-- ---------------------------------------------------------------------
-- Ordres de fabrication (OF)
-- ---------------------------------------------------------------------
CREATE TABLE production_orders (
  id                 SERIAL PRIMARY KEY,
  number             TEXT NOT NULL UNIQUE,       -- ex. 'OF-2026-00042'
  recipe_id          INTEGER NOT NULL REFERENCES recipes(id),
  location_id        INTEGER NOT NULL REFERENCES locations(id),
  planned_quantity   NUMERIC(12,3) NOT NULL CHECK (planned_quantity > 0),
  produced_quantity  NUMERIC(12,3),
  status             TEXT NOT NULL DEFAULT 'planifie'
                     CHECK (status IN ('planifie', 'en_cours', 'termine', 'annule')),
  planned_for        DATE NOT NULL,
  started_at         TIMESTAMPTZ,
  finished_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Lots : chaque arrivage ou chaque production reçoit un numéro de lot unique.
-- C'est la base de la TRAÇABILITÉ (obligatoire en agroalimentaire).
-- Un lot vient SOIT d'un fournisseur (réception) SOIT d'un OF (production).
-- ---------------------------------------------------------------------
CREATE TABLE lots (
  id                   SERIAL PRIMARY KEY,
  item_id              INTEGER NOT NULL REFERENCES items(id),
  lot_number           TEXT NOT NULL,
  supplier_id          INTEGER REFERENCES suppliers(id),
  production_order_id  INTEGER REFERENCES production_orders(id),
  expires_on           DATE,                    -- DLC / DDM
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id, lot_number),
  CHECK (num_nonnulls(supplier_id, production_order_id) <= 1)
);

-- ---------------------------------------------------------------------
-- Mouvements de stock : le "grand livre" du stock.
-- On ne stocke PAS une quantité qu'on écrase : on enregistre chaque entrée (+)
-- et chaque sortie (-). Le stock = la somme des mouvements.
-- => historique complet, audit possible, aucune quantité "perdue".
-- ---------------------------------------------------------------------
CREATE TABLE stock_movements (
  id                   BIGSERIAL PRIMARY KEY,
  lot_id               INTEGER NOT NULL REFERENCES lots(id),
  location_id          INTEGER NOT NULL REFERENCES locations(id),
  quantity             NUMERIC(12,3) NOT NULL CHECK (quantity <> 0), -- + entrée / - sortie
  type                 TEXT NOT NULL CHECK (type IN (
                         'reception',      -- arrivée fournisseur (+)
                         'consommation',   -- matière utilisée par un OF (-)
                         'production',     -- produit fini sorti d'un OF (+)
                         'vente',          -- vente boutique ou B2B (-)
                         'transfert',      -- entre deux sites (- d'un côté, + de l'autre)
                         'perte',          -- casse, péremption (-)
                         'ajustement'      -- correction d'inventaire (+/-)
                       )),
  production_order_id  INTEGER REFERENCES production_orders(id),
  note                 TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index : accélèrent les requêtes fréquentes (stock par lieu, historique d'un lot, consommations d'un OF)
CREATE INDEX idx_movements_lot       ON stock_movements (lot_id);
CREATE INDEX idx_movements_location  ON stock_movements (location_id);
CREATE INDEX idx_movements_of        ON stock_movements (production_order_id);
CREATE INDEX idx_lots_item           ON lots (item_id);

-- ---------------------------------------------------------------------
-- Vue : stock actuel par lot et par emplacement (calculé à partir des mouvements)
-- ---------------------------------------------------------------------
CREATE VIEW v_stock AS
SELECT
  m.location_id,
  l.item_id,
  m.lot_id,
  l.lot_number,
  l.expires_on,
  SUM(m.quantity) AS quantity
FROM stock_movements m
JOIN lots l ON l.id = m.lot_id
GROUP BY m.location_id, l.item_id, m.lot_id, l.lot_number, l.expires_on
HAVING SUM(m.quantity) <> 0;
