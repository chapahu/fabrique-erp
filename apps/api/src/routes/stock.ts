// Stock : consultation, réceptions fournisseurs, traçabilité des lots.
import { Router } from "express";
import { receptionInput } from "@fabrique/shared";
import { z } from "zod";
import { requirePermission } from "../auth";
import { pool, withTransaction } from "../db";
import { HttpError } from "../errors";

export const stockRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/stock?locationId=1
// Stock total par article et par emplacement, avec alerte sous le seuil mini.
// ---------------------------------------------------------------------------
const stockQuery = z.object({
  locationId: z.coerce.number().int().positive().optional(),
});

stockRouter.get("/stock", async (req, res) => {
  const { locationId } = stockQuery.parse(req.query);
  // $1 est un PARAMÈTRE : la valeur est envoyée séparément de la requête.
  // On ne colle JAMAIS une saisie utilisateur dans du SQL (risque d'injection SQL).
  const { rows } = await pool.query(
    `
    SELECT loc.id AS location_id, loc.name AS location,
           i.id AS item_id, i.sku, i.name AS item, i.type, i.unit,
           SUM(s.quantity) AS quantity,
           i.min_stock,
           SUM(s.quantity) < i.min_stock AS below_min,
           MIN(s.expires_on) AS next_expiry
    FROM v_stock s
    JOIN items i ON i.id = s.item_id
    JOIN locations loc ON loc.id = s.location_id
    WHERE ($1::int IS NULL OR s.location_id = $1)
    GROUP BY loc.id, i.id
    ORDER BY loc.id, i.type, i.name
    `,
    [locationId ?? null],
  );
  res.json(rows);
});

// ---------------------------------------------------------------------------
// GET /api/stock/lots?locationId=1&itemId=2 : le détail lot par lot
// ---------------------------------------------------------------------------
const lotsQuery = z.object({
  locationId: z.coerce.number().int().positive().optional(),
  itemId: z.coerce.number().int().positive().optional(),
});

stockRouter.get("/stock/lots", async (req, res) => {
  const { locationId, itemId } = lotsQuery.parse(req.query);
  const { rows } = await pool.query(
    `
    SELECT s.lot_id, s.lot_number, s.expires_on, s.quantity,
           i.name AS item, i.unit, loc.name AS location
    FROM v_stock s
    JOIN items i ON i.id = s.item_id
    JOIN locations loc ON loc.id = s.location_id
    WHERE ($1::int IS NULL OR s.location_id = $1)
      AND ($2::int IS NULL OR s.item_id = $2)
    ORDER BY s.expires_on NULLS LAST, s.lot_id
    `,
    [locationId ?? null, itemId ?? null],
  );
  res.json(rows);
});

// ---------------------------------------------------------------------------
// POST /api/receptions : un camion arrive, on réceptionne la marchandise.
// => crée un LOT + un MOUVEMENT d'entrée, dans une seule transaction.
// ---------------------------------------------------------------------------
// Le schéma Zod (partagé avec l'interface, voir packages/shared) décrit la forme exacte attendue.
// Tout le reste est refusé (400). Si expiresOn est absent, la DLC est calculée via la durée de vie.
stockRouter.post("/receptions", requirePermission("reception"), async (req, res) => {
  const body = receptionInput.parse(req.body);

  const result = await withTransaction(async (db) => {
    const item = await db.query("SELECT type, shelf_life_days FROM items WHERE id = $1", [body.itemId]);
    if (item.rowCount === 0) throw new HttpError(404, "Article introuvable");
    if (item.rows[0].type === "produit_fini") {
      throw new HttpError(409, "On ne réceptionne pas un produit fini : il sort d'un ordre de fabrication");
    }

    const lot = await db.query(
      `INSERT INTO lots (item_id, lot_number, supplier_id, expires_on)
       VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE + $5::int))
       RETURNING id, lot_number, expires_on`,
      [body.itemId, body.lotNumber, body.supplierId, body.expiresOn ?? null, item.rows[0].shelf_life_days],
    );

    const movement = await db.query(
      `INSERT INTO stock_movements (lot_id, location_id, quantity, type, note, user_id)
       VALUES ($1, $2, $3, 'reception', 'Réception fournisseur', $4)
       RETURNING id, created_at`,
      [lot.rows[0].id, body.locationId, body.quantity, req.user!.id],
    );

    return { lot: lot.rows[0], movement: movement.rows[0] };
  });

  res.status(201).json(result); // 201 = "Created"
});

// ---------------------------------------------------------------------------
// GET /api/lots?search=BEU : retrouver un lot par son numéro (ou le nom de l'article)
// ---------------------------------------------------------------------------
const lotSearchQuery = z.object({ search: z.string().trim().max(50).default("") });

stockRouter.get("/lots", async (req, res) => {
  const { search } = lotSearchQuery.parse(req.query);
  // ILIKE = recherche insensible à la casse ; % = "n'importe quels caractères"
  const { rows } = await pool.query(
    `SELECT l.id, l.lot_number, l.expires_on, i.name AS item, i.type,
            COALESCE((SELECT SUM(quantity) FROM stock_movements WHERE lot_id = l.id), 0) AS quantity,
            i.unit
     FROM lots l JOIN items i ON i.id = l.item_id
     WHERE l.lot_number ILIKE '%' || $1 || '%' OR i.name ILIKE '%' || $1 || '%'
     ORDER BY l.created_at DESC
     LIMIT 50`,
    [search],
  );
  res.json(rows);
});

// ---------------------------------------------------------------------------
// GET /api/lots/:id/trace : TRAÇABILITÉ d'un lot
// - origine     : fournisseur ou ordre de fabrication
// - amont       : si produit par un OF, quels lots de matières ont été utilisés
// - aval        : quels OF ont consommé ce lot, et quels lots ils ont produits
// - historique  : tous les mouvements de ce lot
// ---------------------------------------------------------------------------
stockRouter.get("/lots/:id/trace", async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);

  const lot = await pool.query(
    `SELECT l.id, l.lot_number, l.expires_on, i.name AS item, i.unit,
            s.name AS supplier, po.number AS production_order
     FROM lots l
     JOIN items i ON i.id = l.item_id
     LEFT JOIN suppliers s ON s.id = l.supplier_id
     LEFT JOIN production_orders po ON po.id = l.production_order_id
     WHERE l.id = $1`,
    [id],
  );
  if (lot.rowCount === 0) throw new HttpError(404, "Lot introuvable");

  const [upstream, downstream, history] = await Promise.all([
    // Amont : lots consommés par l'OF qui a fabriqué ce lot
    pool.query(
      `SELECT ml.id AS lot_id, ml.lot_number, i.name AS item, -m.quantity AS quantity_used, i.unit
       FROM lots l
       JOIN stock_movements m ON m.production_order_id = l.production_order_id AND m.type = 'consommation'
       JOIN lots ml ON ml.id = m.lot_id
       JOIN items i ON i.id = ml.item_id
       WHERE l.id = $1`,
      [id],
    ),
    // Aval : OF ayant consommé ce lot -> lots produits par ces OF
    pool.query(
      `SELECT po.number AS production_order, pl.id AS lot_id, pl.lot_number, i.name AS item,
              -m.quantity AS quantity_used
       FROM stock_movements m
       JOIN production_orders po ON po.id = m.production_order_id
       JOIN lots pl ON pl.production_order_id = po.id
       JOIN items i ON i.id = pl.item_id
       WHERE m.lot_id = $1 AND m.type = 'consommation'`,
      [id],
    ),
    pool.query(
      `SELECT m.created_at, m.type, m.quantity, loc.name AS location, po.number AS production_order, m.note,
              u.name AS user_name
       FROM stock_movements m
       JOIN locations loc ON loc.id = m.location_id
       LEFT JOIN users u ON u.id = m.user_id
       LEFT JOIN production_orders po ON po.id = m.production_order_id
       WHERE m.lot_id = $1
       ORDER BY m.created_at, m.id`,
      [id],
    ),
  ]);

  res.json({
    lot: lot.rows[0],
    upstream: upstream.rows,
    downstream: downstream.rows,
    history: history.rows,
  });
});
