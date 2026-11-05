// Transferts entre sites et ventes en boutique, + fil d'activité récente.
import { saleInput, transferInput } from "@fabrique/shared";
import { Router } from "express";
import { z } from "zod";
import { requirePermission } from "../auth";
import { pool, withTransaction } from "../db";
import { HttpError } from "../errors";
import { takeFromStock } from "../stock-ops";

export const commerceRouter = Router();

// POST /api/transfers : envoyer du stock d'un emplacement à un autre (ex. atelier -> boutique)
// Le LOT voyage avec la marchandise : la traçabilité suit jusqu'en boutique.
commerceRouter.post("/transfers", requirePermission("transfer"), async (req, res) => {
  const body = transferInput.parse(req.body);
  const userId = req.user!.id;

  const result = await withTransaction(async (db) => {
    const dest = await db.query("SELECT name FROM locations WHERE id = $1", [body.toLocationId]);
    if (dest.rowCount === 0) throw new HttpError(404, "Emplacement d'arrivée introuvable");

    // 1. sortie au départ (lots FEFO)
    const taken = await takeFromStock(db, {
      itemId: body.itemId,
      locationId: body.fromLocationId,
      quantity: body.quantity,
      type: "transfert",
      userId,
      note: `Vers ${dest.rows[0].name}`,
    });
    // 2. entrée à l'arrivée, avec les MÊMES lots
    for (const t of taken) {
      await db.query(
        `INSERT INTO stock_movements (lot_id, location_id, quantity, type, note, user_id)
         VALUES ($1, $2, $3, 'transfert', 'Réception transfert', $4)`,
        [t.lotId, body.toLocationId, t.quantity, userId],
      );
    }
    return { lots: taken };
  });

  res.status(201).json(result);
});

// POST /api/sales : vente en boutique
commerceRouter.post("/sales", requirePermission("sale"), async (req, res) => {
  const body = saleInput.parse(req.body);
  const user = req.user!;
  // Un vendeur ne vend que dans SA boutique
  if (user.role === "boutique" && user.location_id !== body.locationId) {
    throw new HttpError(403, "Tu ne peux vendre que dans ta propre boutique");
  }

  const result = await withTransaction(async (db) => {
    const loc = await db.query("SELECT type FROM locations WHERE id = $1", [body.locationId]);
    if (loc.rowCount === 0) throw new HttpError(404, "Boutique introuvable");
    if (loc.rows[0].type !== "boutique") throw new HttpError(409, "Les ventes se font uniquement en boutique");

    const taken = await takeFromStock(db, { ...body, type: "vente", userId: user.id });
    return { lots: taken };
  });

  res.status(201).json(result);
});

// GET /api/activity?limit=15 : les derniers mouvements de stock, pour le "fil d'activité"
const activityQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(15) });

commerceRouter.get("/activity", async (req, res) => {
  const { limit } = activityQuery.parse(req.query);
  const { rows } = await pool.query(
    `SELECT m.id, m.created_at, m.type, m.quantity, i.name AS item, i.unit,
            loc.name AS location, l.lot_number, po.number AS production_order, u.name AS user_name
     FROM stock_movements m
     LEFT JOIN users u ON u.id = m.user_id
     JOIN lots l ON l.id = m.lot_id
     JOIN items i ON i.id = l.item_id
     JOIN locations loc ON loc.id = m.location_id
     LEFT JOIN production_orders po ON po.id = m.production_order_id
     ORDER BY m.id DESC
     LIMIT $1`,
    [limit],
  );
  res.json(rows);
});
