-- =====================================================================
-- Migration 003 : la dimension COMMERCIALE et FINANCIÈRE
-- - prix de vente et coûts d'achat des articles (pour calculer les marges)
-- - boutiques en propre / en franchise
-- - clients professionnels (B2B)
-- - table des ventes (boutique et B2B), y compris l'historique repris de l'ancien ERP
-- =====================================================================

-- Prix et coûts sur les articles
ALTER TABLE items
  ADD COLUMN unit_cost   NUMERIC(10,4),   -- coût d'achat par unité (kg, L, u) pour les matières
  ADD COLUMN sale_price  NUMERIC(10,2),   -- prix de vente boutique HT, pour les produits finis
  ADD COLUMN b2b_price   NUMERIC(10,2),   -- prix de vente aux professionnels HT
  ADD COLUMN category    TEXT;            -- famille : cookie, cake, madeleine...

-- Boutiques en propre ou en franchise
ALTER TABLE locations
  ADD COLUMN is_franchise BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN opened_on    DATE;

-- Clients professionnels (restaurants, hôtels, épiceries fines, entreprises)
CREATE TABLE customers (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL UNIQUE,
  segment             TEXT NOT NULL CHECK (segment IN ('restaurant', 'hotel', 'epicerie', 'entreprise', 'collectivite')),
  city                TEXT,
  email               TEXT,
  payment_terms_days  INTEGER NOT NULL DEFAULT 30,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Les ventes. Une ligne = un article vendu, à un prix, à un moment.
-- source = 'historique' : reprise des données de l'ancien logiciel (pas de mouvement de stock associé)
-- source = 'erp'        : vente saisie dans notre ERP (le stock a été décrémenté)
CREATE TABLE sales (
  id           BIGSERIAL PRIMARY KEY,
  sold_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  channel      TEXT NOT NULL CHECK (channel IN ('boutique', 'b2b')),
  location_id  INTEGER NOT NULL REFERENCES locations(id),   -- boutique, ou site qui a expédié (B2B)
  customer_id  INTEGER REFERENCES customers(id),             -- client B2B
  item_id      INTEGER NOT NULL REFERENCES items(id),
  quantity     NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit_price   NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  source       TEXT NOT NULL DEFAULT 'erp' CHECK (source IN ('historique', 'erp')),
  user_id      INTEGER REFERENCES users(id),
  CHECK (channel <> 'b2b' OR customer_id IS NOT NULL)
);

-- Index pour les tableaux de bord : on filtre presque toujours par date, produit ou lieu
CREATE INDEX idx_sales_sold_at  ON sales (sold_at);
CREATE INDEX idx_sales_item     ON sales (item_id, sold_at);
CREATE INDEX idx_sales_location ON sales (location_id, sold_at);
