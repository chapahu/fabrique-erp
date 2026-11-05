-- =====================================================================
-- Seed : données de départ (fictives) pour travailler en local.
-- Différence avec une migration : une migration change la STRUCTURE,
-- le seed remplit des DONNÉES de démo. En production on ne lance pas de seed.
-- =====================================================================

INSERT INTO locations (code, name, type, city) VALUES
  ('GEN',        'Atelier Gennevilliers (maison mère)', 'production', 'Gennevilliers'),
  ('ARD',        'Biscuiterie Ardin',                   'production', 'Ardin'),
  ('BTQ-MARAIS', 'Boutique Marais',                     'boutique',   'Paris'),
  ('BTQ-LYON',   'Boutique Lyon Presqu''île',           'boutique',   'Lyon');

INSERT INTO suppliers (name, email) VALUES
  ('Minoterie du Poitou',  'commandes@minoterie-poitou.example'),
  ('Laiterie Normande',    'pro@laiterie-normande.example'),
  ('Cacao & Co',           'b2b@cacao-co.example'),
  ('Emballages Verts',     'contact@emballages-verts.example');

INSERT INTO items (sku, name, type, unit, shelf_life_days, min_stock) VALUES
  ('MP-FARINE-T55',  'Farine de blé T55',          'matiere_premiere', 'kg', 180, 200),
  ('MP-BEURRE',      'Beurre doux AOP',            'matiere_premiere', 'kg',  60,  50),
  ('MP-SUCRE-CASS',  'Sucre cassonade',            'matiere_premiere', 'kg', 365, 100),
  ('MP-OEUF',        'Œufs entiers liquides',      'matiere_premiere', 'L',   21,  30),
  ('MP-CHOCO-NOIR',  'Pépites chocolat noir 58%',  'matiere_premiere', 'kg', 365,  80),
  ('MP-NOIX-PECAN',  'Noix de pécan',              'matiere_premiere', 'kg', 270,  20),
  ('EMB-SACHET',     'Sachet individuel kraft',    'emballage',        'u',  NULL, 2000),
  ('PF-COOKIE-CHOCO','Cookie chocolat noir 80 g',  'produit_fini',     'u',   21, 500),
  ('PF-COOKIE-PECAN','Cookie chocolat pécan 80 g', 'produit_fini',     'u',   21, 300);

-- Recette : 1 fournée = 500 cookies chocolat (quantités indicatives)
INSERT INTO recipes (product_item_id, name, yield_quantity)
SELECT id, 'Cookie chocolat noir - v1', 500 FROM items WHERE sku = 'PF-COOKIE-CHOCO';

INSERT INTO recipe_lines (recipe_id, item_id, quantity)
SELECT r.id, i.id, x.qty
FROM recipes r
JOIN (VALUES
  ('MP-FARINE-T55', 14.0),
  ('MP-BEURRE',     10.0),
  ('MP-SUCRE-CASS',  9.0),
  ('MP-OEUF',        4.0),
  ('MP-CHOCO-NOIR',  8.0),
  ('EMB-SACHET',   500.0)
) AS x(sku, qty) ON true
JOIN items i ON i.sku = x.sku
WHERE r.name = 'Cookie chocolat noir - v1';

-- Un premier arrivage de farine à Gennevilliers, pour avoir du stock
INSERT INTO lots (item_id, lot_number, supplier_id, expires_on)
SELECT i.id, 'FAR-2026-0001', s.id, CURRENT_DATE + 180
FROM items i, suppliers s
WHERE i.sku = 'MP-FARINE-T55' AND s.name = 'Minoterie du Poitou';

INSERT INTO stock_movements (lot_id, location_id, quantity, type, note)
SELECT l.id, loc.id, 500, 'reception', 'Stock initial (seed)'
FROM lots l, locations loc
WHERE l.lot_number = 'FAR-2026-0001' AND loc.code = 'GEN';
