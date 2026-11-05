-- =====================================================================
-- Migration 004 : coût matière de chaque produit fini, calculé depuis sa recette
-- Exemple : 500 cookies = 14 kg farine × 0,85 € + 10 kg beurre × 7,20 € + ...
--           => coût d'un cookie = total / 500
-- Une VUE est recalculée à chaque lecture : si le prix du beurre change, le coût suit tout seul.
-- =====================================================================
CREATE VIEW v_product_cost AS
SELECT
  r.product_item_id AS item_id,
  r.id              AS recipe_id,
  r.yield_quantity,
  ROUND(SUM(rl.quantity * COALESCE(i.unit_cost, 0)) / r.yield_quantity, 4) AS unit_cost
FROM recipes r
JOIN recipe_lines rl ON rl.recipe_id = r.id
JOIN items i ON i.id = rl.item_id
WHERE r.active
GROUP BY r.product_item_id, r.id, r.yield_quantity;
