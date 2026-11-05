import pg from "pg";

// Les colonnes NUMERIC arrivent par défaut en texte ("500.000") pour ne jamais perdre de précision.
// Nos quantités tiennent largement dans un nombre JavaScript : on les convertit automatiquement.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));

// Une colonne DATE (sans heure) est par défaut convertie en Date JavaScript à minuit HEURE LOCALE,
// ce qui la décale d'un jour une fois affichée en UTC ("2026-11-06" -> "2026-11-05T23:00Z").
// On la garde telle quelle : "2026-11-06". Bug classique des fuseaux horaires !
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL manquant : as-tu créé le fichier .env à la racine ?");
}

// Un "pool" garde quelques connexions ouvertes et les réutilise :
// ouvrir une connexion à chaque requête serait lent.
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Exécute plusieurs requêtes dans une TRANSACTION : soit tout réussit (COMMIT),
 * soit rien n'est enregistré (ROLLBACK). Indispensable dès qu'une action métier
 * touche plusieurs tables (ex. créer un lot ET son mouvement de stock).
 */
export async function withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release(); // rend la connexion au pool
  }
}
