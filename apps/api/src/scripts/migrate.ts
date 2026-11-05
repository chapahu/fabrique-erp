// =====================================================================
// OUTIL DE MIGRATIONS : applique dans l'ordre les fichiers db/migrations/*.sql
// qui n'ont pas encore été appliqués à cette base.
//
// Il note chaque migration appliquée dans la table schema_migrations.
// => on peut le lancer autant de fois qu'on veut : il ne refait jamais une migration.
// => la même commande met à jour ta base locale ET, plus tard, la base en ligne.
// Commande : npm run db:migrate
// =====================================================================
import { readdir, readFile } from "node:fs/promises";
import { pool } from "../db";

const dir = new URL("../../../../db/migrations/", import.meta.url);

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  // Cas particulier : une base créée avant cet outil (001 appliquée par Docker au 1er démarrage).
  // Si les tables existent déjà mais que rien n'est noté, on note 001 comme "déjà faite".
  const noted = await pool.query("SELECT count(*)::int AS n FROM schema_migrations");
  const legacy = await pool.query("SELECT to_regclass('public.locations') IS NOT NULL AS exists");
  if (noted.rows[0].n === 0 && legacy.rows[0].exists) {
    await pool.query("INSERT INTO schema_migrations (name) VALUES ('001_init.sql')");
    console.log("ℹ️  Base existante détectée : 001_init.sql notée comme déjà appliquée");
  }

  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const done = new Set((await pool.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));

  let applied = 0;
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(new URL(file, dir), "utf8");
    const client = await pool.connect();
    try {
      // Chaque migration dans une transaction : si elle échoue au milieu, rien n'est modifié
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`✅ ${file} appliquée`);
      applied++;
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(`❌ ${file} a échoué, rien n'a été modifié :`, (error as Error).message);
      process.exitCode = 1;
      break;
    } finally {
      client.release();
    }
  }
  if (applied === 0 && !process.exitCode) console.log("👍 Base déjà à jour, aucune migration à appliquer");
  await pool.end();
}

main();
