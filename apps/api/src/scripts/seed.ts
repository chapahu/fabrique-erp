// =====================================================================
// SEED : remplit une base de DÉMONSTRATION (données fictives).
// - si la base est vide : charge db/seed.sql (sites, premiers articles...)
// - met à jour le catalogue : articles, prix, coûts, recettes, boutiques, clients B2B
// - crée ou met à jour les comptes de démo (un par rôle)
// Peut être relancé sans risque (aucun doublon). Commande : npm run db:seed
// À NE JAMAIS lancer en production.
// =====================================================================
import { readFile } from "node:fs/promises";
import type pg from "pg";
import { pool } from "../db";
import { hashPassword } from "../passwords";

const password = process.env.DEMO_PASSWORD;
if (!password) throw new Error("DEMO_PASSWORD manquant dans .env (voir .env.example)");

// ---------- Articles : [sku, nom, type, unité, durée de vie (j), stock mini, coût, prix boutique, prix B2B, famille]
type ItemRow = [string, string, string, string, number | null, number, number | null, number | null, number | null, string | null];
const items: ItemRow[] = [
  ["MP-FARINE-T55", "Farine de blé T55", "matiere_premiere", "kg", 180, 200, 0.85, null, null, null],
  ["MP-BEURRE", "Beurre doux AOP", "matiere_premiere", "kg", 60, 80, 7.2, null, null, null],
  ["MP-SUCRE-CASS", "Sucre cassonade", "matiere_premiere", "kg", 365, 120, 1.6, null, null, null],
  ["MP-OEUF", "Œufs entiers liquides", "matiere_premiere", "L", 21, 60, 3.1, null, null, null],
  ["MP-CHOCO-NOIR", "Pépites chocolat noir 58%", "matiere_premiere", "kg", 365, 80, 9.5, null, null, null],
  ["MP-CHOCO-LAIT", "Pépites chocolat au lait", "matiere_premiere", "kg", 365, 40, 8.9, null, null, null],
  ["MP-NOIX-PECAN", "Noix de pécan", "matiere_premiere", "kg", 270, 30, 16.0, null, null, null],
  ["MP-CARAMEL", "Caramel au beurre salé", "matiere_premiere", "kg", 180, 40, 8.4, null, null, null],
  ["MP-CITRON", "Zestes et jus de citron", "matiere_premiere", "kg", 30, 20, 5.5, null, null, null],
  ["MP-MIEL", "Miel de fleurs", "matiere_premiere", "kg", 730, 15, 9.0, null, null, null],
  ["MP-LEVURE", "Poudre à lever", "matiere_premiere", "kg", 365, 5, 4.0, null, null, null],
  ["EMB-SACHET", "Sachet individuel kraft", "emballage", "u", null, 3000, 0.06, null, null, null],
  ["EMB-BOITE-CAKE", "Boîte carton cake", "emballage", "u", null, 300, 0.35, null, null, null],
  ["PF-COOKIE-CHOCO", "Cookie chocolat noir 80 g", "produit_fini", "u", 21, 800, null, 3.2, 1.55, "cookie"],
  ["PF-COOKIE-PECAN", "Cookie chocolat pécan 80 g", "produit_fini", "u", 21, 400, null, 3.5, 1.75, "cookie"],
  ["PF-COOKIE-CARAMEL", "Cookie caramel beurre salé 80 g", "produit_fini", "u", 21, 400, null, 3.5, 1.7, "cookie"],
  ["PF-COOKIE-DOUBLE", "Cookie double chocolat 80 g", "produit_fini", "u", 21, 400, null, 3.4, 1.65, "cookie"],
  ["PF-MADELEINE", "Madeleine au miel 30 g", "produit_fini", "u", 15, 900, null, 1.2, 0.55, "madeleine"],
  ["PF-CAKE-CITRON", "Cake citron 400 g", "produit_fini", "u", 20, 80, null, 12.5, 7.2, "cake"],
];

// ---------- Recettes : nom, produit, rendement d'une fournée, ingrédients [sku, quantité]
const recipes: { name: string; product: string; yield: number; lines: [string, number][] }[] = [
  {
    name: "Cookie chocolat noir - v1", product: "PF-COOKIE-CHOCO", yield: 500,
    lines: [["MP-FARINE-T55", 14], ["MP-BEURRE", 10], ["MP-SUCRE-CASS", 9], ["MP-OEUF", 4], ["MP-CHOCO-NOIR", 8], ["EMB-SACHET", 500]],
  },
  {
    name: "Cookie chocolat pécan - v1", product: "PF-COOKIE-PECAN", yield: 500,
    lines: [["MP-FARINE-T55", 14], ["MP-BEURRE", 10], ["MP-SUCRE-CASS", 9], ["MP-OEUF", 4], ["MP-CHOCO-NOIR", 5], ["MP-NOIX-PECAN", 5], ["EMB-SACHET", 500]],
  },
  {
    name: "Cookie caramel beurre salé - v1", product: "PF-COOKIE-CARAMEL", yield: 500,
    lines: [["MP-FARINE-T55", 14], ["MP-BEURRE", 10], ["MP-SUCRE-CASS", 7], ["MP-OEUF", 4], ["MP-CARAMEL", 7], ["MP-CHOCO-LAIT", 3], ["EMB-SACHET", 500]],
  },
  {
    name: "Cookie double chocolat - v1", product: "PF-COOKIE-DOUBLE", yield: 500,
    lines: [["MP-FARINE-T55", 13], ["MP-BEURRE", 10], ["MP-SUCRE-CASS", 9], ["MP-OEUF", 4], ["MP-CHOCO-NOIR", 6], ["MP-CHOCO-LAIT", 4], ["EMB-SACHET", 500]],
  },
  {
    name: "Madeleine au miel - v1", product: "PF-MADELEINE", yield: 1000,
    lines: [["MP-FARINE-T55", 9], ["MP-BEURRE", 9], ["MP-SUCRE-CASS", 7], ["MP-OEUF", 9], ["MP-MIEL", 2], ["MP-LEVURE", 0.3], ["EMB-SACHET", 1000]],
  },
  {
    name: "Cake citron - v1", product: "PF-CAKE-CITRON", yield: 100,
    lines: [["MP-FARINE-T55", 12], ["MP-BEURRE", 10], ["MP-SUCRE-CASS", 11], ["MP-OEUF", 10], ["MP-CITRON", 3], ["MP-LEVURE", 0.4], ["EMB-BOITE-CAKE", 100]],
  },
];

// ---------- Boutiques : [code, nom, ville, franchise ?, ouverture]
const shops: [string, string, string, boolean, string][] = [
  ["BTQ-MARAIS", "Boutique Marais", "Paris", false, "2016-03-01"],
  ["BTQ-STGERMAIN", "Boutique Saint-Germain", "Paris", false, "2019-05-15"],
  ["BTQ-MONTMARTRE", "Boutique Montmartre", "Paris", false, "2021-09-01"],
  ["BTQ-LYON", "Boutique Lyon Presqu'île", "Lyon", false, "2020-02-01"],
  ["BTQ-BORDEAUX", "Boutique Bordeaux", "Bordeaux", true, "2022-04-01"],
  ["BTQ-LILLE", "Boutique Lille", "Lille", true, "2023-10-01"],
  ["BTQ-NIORT", "Boutique Niort", "Niort", false, "2024-03-15"],
];

// ---------- Clients B2B (fictifs) : [nom, segment, ville, délai de paiement]
const customers: [string, string, string, number][] = [
  ["Brasserie du Canal", "restaurant", "Paris", 30],
  ["Hôtel des Arts", "hotel", "Paris", 45],
  ["Épicerie Fine Lumière", "epicerie", "Lyon", 30],
  ["Café Comptoir 92", "restaurant", "Gennevilliers", 30],
  ["Traiteur Saveurs & Co", "entreprise", "Nanterre", 45],
  ["Restaurant Le Poitevin", "restaurant", "Niort", 30],
  ["Hôtel Atlantique", "hotel", "La Rochelle", 45],
  ["Cantine Startup Station", "entreprise", "Paris", 30],
  ["Restauration municipale Gennevilliers", "collectivite", "Gennevilliers", 60],
  ["Coffee Lab Bordeaux", "restaurant", "Bordeaux", 30],
];

const demoUsers = [
  { email: "direction@fabrique.test", name: "Alex (Direction)", role: "admin", location: null },
  { email: "atelier@fabrique.test", name: "Sam (Chef d'atelier)", role: "production", location: null },
  { email: "achats@fabrique.test", name: "Camille (Achats)", role: "achats", location: null },
  { email: "marais@fabrique.test", name: "Léa (Boutique Marais)", role: "boutique", location: "BTQ-MARAIS" },
  { email: "lyon@fabrique.test", name: "Hugo (Boutique Lyon)", role: "boutique", location: "BTQ-LYON" },
  { email: "simulateur@fabrique.test", name: "Simulateur", role: "admin", location: null },
];

async function seedCatalog(db: pg.PoolClient) {
  for (const [sku, name, type, unit, life, min, cost, price, b2b, category] of items) {
    await db.query(
      `INSERT INTO items (sku, name, type, unit, shelf_life_days, min_stock, unit_cost, sale_price, b2b_price, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (sku) DO UPDATE SET name = EXCLUDED.name, min_stock = EXCLUDED.min_stock,
         unit_cost = EXCLUDED.unit_cost, sale_price = EXCLUDED.sale_price,
         b2b_price = EXCLUDED.b2b_price, category = EXCLUDED.category`,
      [sku, name, type, unit, life, min, cost, price, b2b, category],
    );
  }
  for (const r of recipes) {
    const existing = await db.query("SELECT id FROM recipes WHERE name = $1", [r.name]);
    const recipeId =
      existing.rows[0]?.id ??
      (
        await db.query(
          `INSERT INTO recipes (product_item_id, name, yield_quantity)
           SELECT id, $2, $3 FROM items WHERE sku = $1 RETURNING id`,
          [r.product, r.name, r.yield],
        )
      ).rows[0].id;
    for (const [sku, qty] of r.lines) {
      await db.query(
        `INSERT INTO recipe_lines (recipe_id, item_id, quantity)
         SELECT $1, id, $3 FROM items WHERE sku = $2
         ON CONFLICT (recipe_id, item_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
        [recipeId, sku, qty],
      );
    }
  }
  for (const [code, name, city, franchise, opened] of shops) {
    await db.query(
      `INSERT INTO locations (code, name, type, city, is_franchise, opened_on)
       VALUES ($1, $2, 'boutique', $3, $4, $5)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, city = EXCLUDED.city,
         is_franchise = EXCLUDED.is_franchise, opened_on = EXCLUDED.opened_on`,
      [code, name, city, franchise, opened],
    );
  }
  await db.query("UPDATE locations SET opened_on = '2012-06-01' WHERE code = 'GEN' AND opened_on IS NULL");
  await db.query("UPDATE locations SET opened_on = '2023-11-01' WHERE code = 'ARD' AND opened_on IS NULL");
  for (const [name, segment, city, terms] of customers) {
    const email = `commandes@${name.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")}.example`;
    await db.query(
      `INSERT INTO customers (name, segment, city, email, payment_terms_days) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (name) DO UPDATE SET segment = EXCLUDED.segment, city = EXCLUDED.city`,
      [name, segment, city, email, terms],
    );
  }
}

async function main() {
  const empty = await pool.query("SELECT count(*)::int AS n FROM locations");
  if (empty.rows[0].n === 0) {
    await pool.query(await readFile(new URL("../../../../db/seed.sql", import.meta.url), "utf8"));
    console.log("✅ Données de départ chargées (db/seed.sql)");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await seedCatalog(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  console.log(`✅ Catalogue : ${items.length} articles, ${recipes.length} recettes, ${shops.length} boutiques, ${customers.length} clients B2B`);

  for (const u of demoUsers) {
    await pool.query(
      `INSERT INTO users (email, name, role, location_id, password_hash)
       VALUES ($1, $2, $3, (SELECT id FROM locations WHERE code = $4), $5)
       ON CONFLICT (email) DO UPDATE
         SET name = EXCLUDED.name, role = EXCLUDED.role,
             location_id = EXCLUDED.location_id, password_hash = EXCLUDED.password_hash`,
      [u.email, u.name, u.role, u.location, await hashPassword(password!)],
    );
  }
  console.log(`✅ ${demoUsers.length} comptes de démo prêts`);
  await pool.end();
}

main();
