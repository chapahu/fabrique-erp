// Ordres de fabrication (OF) : planifier, lancer, terminer une production.
import { Router } from "express";
import { z } from "zod";
import { pool, withTransaction } from "../db";
import { HttpError } from "../errors";

export const productionRouter = Router();

const ofSelect = `
  SELECT po.id, po.number, po.status, po.planned_for, po.planned_quantity, po.produced_quantity,
         po.started_at, po.finished_at, r.name AS recipe, p.name AS product, p.unit,
         loc.name AS location
  FROM production_orders po
  JOIN recipes r ON r.id = po.recipe_id
  JOIN items p ON p.id = r.product_item_id
  JOIN locations loc ON loc.id = po.location_id
`;

// GET /api/production-orders?status=planifie
const listQuery = z.object({
  status: z.enum(["planifie", "en_cours", "termine", "annule"]).optional(),
});

productionRouter.get("/production-orders", async (req, res) => {
  const { status } = listQuery.parse(req.query);
  const { rows } = await pool.query(
    `${ofSelect} WHERE ($1::text IS NULL OR po.status = $1) ORDER BY po.planned_for DESC, po.id DESC`,
    [status ?? null],
  );
  res.json(rows);
});

// GET /api/production-orders/:id : l'OF + ses BESOINS en matières (calculés depuis la recette)
productionRouter.get("/production-orders/:id", async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const of = await pool.query(`${ofSelect} WHERE po.id = $1`, [id]);
  if (of.rowCount === 0) throw new HttpError(404, "Ordre de fabrication introuvable");

  // Besoin = quantité recette × (quantité planifiée / rendement de la recette)
  // Disponible = stock de cette matière sur le site de l'OF
  const needs = await pool.query(
    `SELECT i.id AS item_id, i.name AS item, i.unit,
            ROUND(rl.quantity * po.planned_quantity / r.yield_quantity, 3) AS needed,
            COALESCE((SELECT SUM(s.quantity) FROM v_stock s
                      WHERE s.item_id = i.id AND s.location_id = po.location_id), 0) AS available
     FROM production_orders po
     JOIN recipes r ON r.id = po.recipe_id
     JOIN recipe_lines rl ON rl.recipe_id = r.id
     JOIN items i ON i.id = rl.item_id
     WHERE po.id = $1
     ORDER BY i.name`,
    [id],
  );

  res.json({ ...of.rows[0], needs: needs.rows });
});

// POST /api/production-orders : planifier un OF
const createBody = z.object({
  recipeId: z.number().int().positive(),
  locationId: z.number().int().positive(),
  plannedQuantity: z.number().positive(),
  plannedFor: z.iso.date(),
});

productionRouter.post("/production-orders", async (req, res) => {
  const body = createBody.parse(req.body);
  const loc = await pool.query("SELECT type FROM locations WHERE id = $1", [body.locationId]);
  if (loc.rowCount === 0) throw new HttpError(404, "Emplacement introuvable");
  if (loc.rows[0].type !== "production") {
    throw new HttpError(409, "Un OF ne peut être lancé que sur un site de production");
  }

  // Numéro lisible : OF-2026-00001. On réserve d'abord l'id dans la séquence.
  const { rows } = await pool.query(
    `WITH next AS (SELECT nextval(pg_get_serial_sequence('production_orders', 'id')) AS id)
     INSERT INTO production_orders (id, number, recipe_id, location_id, planned_quantity, planned_for)
     SELECT next.id, 'OF-' || to_char($4::date, 'YYYY') || '-' || lpad(next.id::text, 5, '0'),
            $1, $2, $3, $4
     FROM next
     RETURNING id, number, status`,
    [body.recipeId, body.locationId, body.plannedQuantity, body.plannedFor],
  );
  res.status(201).json(rows[0]);
});

// POST /api/production-orders/:id/start : l'atelier démarre la production
productionRouter.post("/production-orders/:id/start", async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const { rows, rowCount } = await pool.query(
    `UPDATE production_orders SET status = 'en_cours', started_at = now()
     WHERE id = $1 AND status = 'planifie'
     RETURNING id, number, status, started_at`,
    [id],
  );
  if (rowCount === 0) throw new HttpError(409, "Seul un OF « planifié » peut être démarré");
  res.json(rows[0]);
});

// ---------------------------------------------------------------------------
// POST /api/production-orders/:id/complete : CLÔTURER un OF.
// C'est le cœur de l'ERP de production. En une seule transaction :
//  1. pour chaque ingrédient de la recette, consommer le stock du site
//     en prenant d'abord les lots qui périment le plus tôt (règle FEFO) ;
//  2. refuser si une matière manque (et tout annuler) ;
//  3. créer le lot de produits finis, avec sa date de péremption ;
//  4. enregistrer l'entrée en stock et passer l'OF en "terminé".
// Chaque consommation est liée à l'OF : c'est ce qui rend la traçabilité possible.
// ---------------------------------------------------------------------------
const completeBody = z.object({
  // Quantité réellement produite (casse possible). Par défaut : la quantité planifiée.
  producedQuantity: z.number().positive().optional(),
});

productionRouter.post("/production-orders/:id/complete", async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const body = completeBody.parse(req.body ?? {});

  const result = await withTransaction(async (db) => {
    // FOR UPDATE verrouille la ligne : deux personnes ne peuvent pas clôturer le même OF en même temps
    const ofRes = await db.query(
      `SELECT po.*, r.product_item_id, r.yield_quantity, p.shelf_life_days
       FROM production_orders po
       JOIN recipes r ON r.id = po.recipe_id
       JOIN items p ON p.id = r.product_item_id
       WHERE po.id = $1
       FOR UPDATE OF po`,
      [id],
    );
    if (ofRes.rowCount === 0) throw new HttpError(404, "Ordre de fabrication introuvable");
    const of = ofRes.rows[0];
    if (!["planifie", "en_cours"].includes(of.status)) {
      throw new HttpError(409, `Impossible de clôturer un OF au statut « ${of.status} »`);
    }

    // Verrou sur le site : deux OF du même site ne consomment pas le même stock en parallèle
    await db.query("SELECT pg_advisory_xact_lock($1)", [of.location_id]);

    const lines = await db.query(
      `SELECT rl.item_id, i.name, i.unit,
              ROUND(rl.quantity * $2::numeric / $3::numeric, 3) AS needed
       FROM recipe_lines rl JOIN items i ON i.id = rl.item_id
       WHERE rl.recipe_id = $1`,
      [of.recipe_id, of.planned_quantity, of.yield_quantity],
    );

    const shortages: { item: string; needed: number; available: number; unit: string }[] = [];
    const consumptions: { lot: string; item: string; quantity: number; unit: string }[] = [];

    for (const line of lines.rows) {
      // Lots disponibles sur le site, du plus proche de la péremption au plus lointain (FEFO)
      const lots = await db.query(
        `SELECT lot_id, lot_number, quantity FROM v_stock
         WHERE item_id = $1 AND location_id = $2 AND quantity > 0
         ORDER BY expires_on NULLS LAST, lot_id`,
        [line.item_id, of.location_id],
      );
      const available = lots.rows.reduce((sum, l) => sum + l.quantity, 0);
      if (available < line.needed) {
        shortages.push({ item: line.name, needed: line.needed, available, unit: line.unit });
        continue;
      }

      let remaining = line.needed;
      for (const lot of lots.rows) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, lot.quantity);
        await db.query(
          `INSERT INTO stock_movements (lot_id, location_id, quantity, type, production_order_id)
           VALUES ($1, $2, $3, 'consommation', $4)`,
          [lot.lot_id, of.location_id, -take, of.id],
        );
        consumptions.push({ lot: lot.lot_number, item: line.name, quantity: take, unit: line.unit });
        remaining = Math.round((remaining - take) * 1000) / 1000; // évite les erreurs d'arrondi
      }
    }

    // Une matière manque : on lève une erreur -> ROLLBACK, aucune consommation n'est gardée
    if (shortages.length > 0) {
      throw new HttpError(409, "Stock insuffisant pour clôturer l'OF", { manquants: shortages });
    }

    const produced = body.producedQuantity ?? of.planned_quantity;
    const lot = await db.query(
      `INSERT INTO lots (item_id, lot_number, production_order_id, expires_on)
       VALUES ($1, $2, $3, CURRENT_DATE + $4::int)
       RETURNING id, lot_number, expires_on`,
      [of.product_item_id, of.number, of.id, of.shelf_life_days],
    );
    await db.query(
      `INSERT INTO stock_movements (lot_id, location_id, quantity, type, production_order_id)
       VALUES ($1, $2, $3, 'production', $4)`,
      [lot.rows[0].id, of.location_id, produced, of.id],
    );
    await db.query(
      `UPDATE production_orders
       SET status = 'termine', produced_quantity = $2,
           started_at = COALESCE(started_at, now()), finished_at = now()
       WHERE id = $1`,
      [of.id, produced],
    );

    return { number: of.number, produced, finishedLot: lot.rows[0], consumptions };
  });

  res.json(result);
});
