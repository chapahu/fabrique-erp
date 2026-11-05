// Données de référence : ce qui change rarement (sites, articles, fournisseurs, recettes).
import { Router } from "express";
import { pool } from "../db";

export const referentielRouter = Router();

referentielRouter.get("/locations", async (_req, res) => {
  const { rows } = await pool.query("SELECT id, code, name, type, city FROM locations ORDER BY id");
  res.json(rows);
});

referentielRouter.get("/suppliers", async (_req, res) => {
  const { rows } = await pool.query("SELECT id, name, email FROM suppliers ORDER BY name");
  res.json(rows);
});

referentielRouter.get("/items", async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT id, sku, name, type, unit, shelf_life_days, min_stock FROM items ORDER BY type, name",
  );
  res.json(rows);
});

referentielRouter.get("/recipes", async (_req, res) => {
  // json_agg : PostgreSQL assemble directement chaque recette avec ses ingrédients en JSON
  const { rows } = await pool.query(`
    SELECT r.id, r.name, r.yield_quantity, p.name AS product, p.unit AS product_unit,
           json_agg(json_build_object(
             'itemId', i.id, 'item', i.name, 'quantity', rl.quantity, 'unit', i.unit
           ) ORDER BY i.name) AS lines
    FROM recipes r
    JOIN items p ON p.id = r.product_item_id
    JOIN recipe_lines rl ON rl.recipe_id = r.id
    JOIN items i ON i.id = rl.item_id
    WHERE r.active
    GROUP BY r.id, p.name, p.unit
    ORDER BY r.name
  `);
  res.json(rows);
});
