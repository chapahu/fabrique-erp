// =====================================================================
// SEED : remplit une base de démonstration.
// - si la base est vide : charge db/seed.sql (sites, articles, recette...)
// - crée ou met à jour les comptes de démo (un par rôle)
// Peut être relancé sans risque. Commande : npm run db:seed
// À NE JAMAIS lancer en production.
// =====================================================================
import { readFile } from "node:fs/promises";
import { pool } from "../db";
import { hashPassword } from "../passwords";

const password = process.env.DEMO_PASSWORD;
if (!password) throw new Error("DEMO_PASSWORD manquant dans .env (voir .env.example)");

const demoUsers = [
  { email: "direction@fabrique.test", name: "Alex (Direction)", role: "admin", location: null },
  { email: "atelier@fabrique.test", name: "Sam (Chef d'atelier)", role: "production", location: null },
  { email: "achats@fabrique.test", name: "Camille (Achats)", role: "achats", location: null },
  { email: "marais@fabrique.test", name: "Léa (Boutique Marais)", role: "boutique", location: "BTQ-MARAIS" },
  { email: "lyon@fabrique.test", name: "Hugo (Boutique Lyon)", role: "boutique", location: "BTQ-LYON" },
  { email: "simulateur@fabrique.test", name: "Simulateur", role: "admin", location: null },
];

async function main() {
  const empty = await pool.query("SELECT count(*)::int AS n FROM locations");
  if (empty.rows[0].n === 0) {
    await pool.query(await readFile(new URL("../../../../db/seed.sql", import.meta.url), "utf8"));
    console.log("✅ Données de démo chargées (db/seed.sql)");
  }

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
  console.log(`✅ ${demoUsers.length} comptes de démo prêts (mot de passe : DEMO_PASSWORD du fichier .env)`);
  await pool.end();
}

main();
