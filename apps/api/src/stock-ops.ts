// Opération de stock réutilisable : SORTIR une quantité d'un article d'un emplacement,
// en prenant d'abord les lots qui périment le plus tôt (FEFO).
// Utilisée par les ventes et les transferts. À appeler DANS une transaction.
import type pg from "pg";
import { HttpError } from "./errors";

type MovementType = "vente" | "transfert" | "perte";

export async function takeFromStock(
  db: pg.PoolClient,
  params: { itemId: number; locationId: number; quantity: number; type: MovementType; note?: string },
) {
  // Verrou sur l'emplacement : deux ventes simultanées ne peuvent pas prendre le même dernier cookie
  await db.query("SELECT pg_advisory_xact_lock($1)", [params.locationId]);

  const lots = await db.query(
    `SELECT lot_id, lot_number, quantity FROM v_stock
     WHERE item_id = $1 AND location_id = $2 AND quantity > 0
     ORDER BY expires_on NULLS LAST, lot_id`,
    [params.itemId, params.locationId],
  );
  const available = lots.rows.reduce((sum, l) => sum + l.quantity, 0);
  if (available < params.quantity) {
    throw new HttpError(409, "Stock insuffisant", { demande: params.quantity, disponible: available });
  }

  const taken: { lotId: number; lotNumber: string; quantity: number }[] = [];
  let remaining = params.quantity;
  for (const lot of lots.rows) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.quantity);
    await db.query(
      `INSERT INTO stock_movements (lot_id, location_id, quantity, type, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [lot.lot_id, params.locationId, -take, params.type, params.note ?? null],
    );
    taken.push({ lotId: lot.lot_id, lotNumber: lot.lot_number, quantity: take });
    remaining = Math.round((remaining - take) * 1000) / 1000;
  }
  return taken;
}
