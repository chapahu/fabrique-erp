// =====================================================================
// PILOTAGE : indicateurs pour la direction, prévisions, plan de production suggéré
// =====================================================================
import { Router } from "express";
import { z } from "zod";
import { holtWinters } from "../analytics/holt-winters";
import { requirePermission } from "../auth";
import { pool } from "../db";

export const analyticsRouter = Router();

// Petit cache mémoire : les calculs de prévision prennent un peu de temps,
// inutile de les refaire à chaque affichage. On garde le résultat 10 minutes.
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, compute: () => Promise<T>, ttlMs = 10 * 60_000): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await compute();
  cache.set(key, { at: Date.now(), value });
  return value;
}

// ---------------------------------------------------------------------
// GET /api/analytics/overview?days=30 : le tableau de bord de la direction
// Chaque indicateur est comparé à la période précédente de même durée.
// ---------------------------------------------------------------------
const overviewQuery = z.object({ days: z.coerce.number().int().min(7).max(365).default(30) });

analyticsRouter.get("/analytics/overview", requirePermission("pilotage"), async (req, res) => {
  const { days } = overviewQuery.parse(req.query);

  // Ventes de la période et de la période précédente, avec le coût matière pour la marge
  const kpi = await pool.query(
    `WITH s AS (
       SELECT s.*, s.quantity * s.unit_price AS revenue,
              s.quantity * COALESCE(c.unit_cost, 0) AS cost,
              CASE WHEN s.sold_at >= current_date - $1::int THEN 'cur' ELSE 'prev' END AS period
       FROM sales s LEFT JOIN v_product_cost c ON c.item_id = s.item_id
       WHERE s.sold_at >= current_date - 2 * $1::int
     )
     SELECT period,
            SUM(revenue)::float AS revenue,
            SUM(cost)::float AS cost,
            SUM(quantity)::float AS units,
            SUM(revenue) FILTER (WHERE channel = 'b2b')::float AS b2b_revenue
     FROM s GROUP BY period`,
    [days],
  );
  const cur = kpi.rows.find((r) => r.period === "cur") ?? {};
  const prev = kpi.rows.find((r) => r.period === "prev") ?? {};

  const [daily, byShop, byProduct, monthly, customers, stock, production] = await Promise.all([
    // Chiffre d'affaires jour par jour, par canal (90 derniers jours)
    pool.query(
      `SELECT sold_at::date AS day,
              SUM(quantity * unit_price) FILTER (WHERE channel = 'boutique')::float AS boutique,
              SUM(quantity * unit_price) FILTER (WHERE channel = 'b2b')::float AS b2b
       FROM sales WHERE sold_at >= current_date - 90 AND sold_at < current_date
       GROUP BY 1 ORDER BY 1`,
    ),
    // Par boutique, avec l'évolution vs période précédente
    pool.query(
      `SELECT l.id, l.name, l.city, l.is_franchise,
              COALESCE(SUM(s.quantity * s.unit_price) FILTER (WHERE s.sold_at >= current_date - $1::int), 0)::float AS revenue,
              COALESCE(SUM(s.quantity * s.unit_price) FILTER (WHERE s.sold_at < current_date - $1::int), 0)::float AS prev_revenue
       FROM locations l
       LEFT JOIN sales s ON s.location_id = l.id AND s.channel = 'boutique' AND s.sold_at >= current_date - 2 * $1::int
       WHERE l.type = 'boutique'
       GROUP BY l.id ORDER BY revenue DESC`,
      [days],
    ),
    // Par produit : CA, volumes, marge unitaire
    pool.query(
      `SELECT i.id, i.name, i.category, i.sale_price::float, c.unit_cost::float,
              COALESCE(SUM(s.quantity), 0)::float AS units,
              COALESCE(SUM(s.quantity * s.unit_price), 0)::float AS revenue,
              COALESCE(SUM(s.quantity * (s.unit_price - c.unit_cost)), 0)::float AS margin
       FROM items i
       LEFT JOIN v_product_cost c ON c.item_id = i.id
       LEFT JOIN sales s ON s.item_id = i.id AND s.sold_at >= current_date - $1::int
       WHERE i.type = 'produit_fini'
       GROUP BY i.id, c.unit_cost ORDER BY revenue DESC`,
      [days],
    ),
    // CA mensuel sur 3 ans (pour comparer chaque mois à l'année précédente)
    pool.query(
      `SELECT to_char(date_trunc('month', sold_at), 'YYYY-MM') AS month, SUM(quantity * unit_price)::float AS revenue
       FROM sales WHERE sold_at < date_trunc('month', current_date)
       GROUP BY 1 ORDER BY 1`,
    ),
    // Meilleurs clients B2B
    pool.query(
      `SELECT c.name, c.segment, c.city, SUM(s.quantity * s.unit_price)::float AS revenue
       FROM sales s JOIN customers c ON c.id = s.customer_id
       WHERE s.sold_at >= current_date - $1::int
       GROUP BY c.id ORDER BY revenue DESC LIMIT 5`,
      [days],
    ),
    // Valeur du stock (au coût) et alertes
    pool.query(
      `WITH st AS (
         SELECT s.item_id, s.location_id, SUM(s.quantity) AS qty FROM v_stock s GROUP BY 1, 2
       )
       SELECT
         SUM(st.qty * COALESCE(i.unit_cost, c.unit_cost, 0))::float AS stock_value,
         COUNT(*) FILTER (WHERE i.type <> 'produit_fini' AND st.qty < i.min_stock)::int AS alerts
       FROM st JOIN items i ON i.id = st.item_id
       LEFT JOIN v_product_cost c ON c.item_id = i.id`,
    ),
    // Production : rendement (produit / planifié) sur la période
    pool.query(
      `SELECT COUNT(*)::int AS orders,
              COALESCE(SUM(produced_quantity), 0)::float AS produced,
              COALESCE(SUM(planned_quantity), 0)::float AS planned
       FROM production_orders WHERE status = 'termine' AND finished_at >= current_date - $1::int`,
      [days],
    ),
  ]);

  const revenue = cur.revenue ?? 0;
  res.json({
    days,
    kpis: {
      revenue,
      revenuePrev: prev.revenue ?? 0,
      margin: revenue - (cur.cost ?? 0),
      marginPrev: (prev.revenue ?? 0) - (prev.cost ?? 0),
      units: cur.units ?? 0,
      unitsPrev: prev.units ?? 0,
      b2bShare: revenue ? (cur.b2b_revenue ?? 0) / revenue : 0,
      stockValue: stock.rows[0]?.stock_value ?? 0,
      stockAlerts: stock.rows[0]?.alerts ?? 0,
      productionOrders: production.rows[0].orders,
      productionYield: production.rows[0].planned ? production.rows[0].produced / production.rows[0].planned : null,
    },
    daily: daily.rows,
    byShop: byShop.rows,
    byProduct: byProduct.rows,
    monthly: monthly.rows,
    topCustomers: customers.rows,
  });
});

// ---------------------------------------------------------------------
// Séries temporelles pour les prévisions
// ---------------------------------------------------------------------
type Granularity = "day" | "month";

/** Ventes jour par jour (ou mois par mois), sans trous. Les jours fermés (fériés) sont "lissés". */
async function salesSeries(granularity: Granularity, metric: "units" | "revenue", itemId?: number, locationId?: number) {
  const value = metric === "units" ? "SUM(s.quantity)" : "SUM(s.quantity * s.unit_price)";
  const filters = `($1::int IS NULL OR s.item_id = $1) AND ($2::int IS NULL OR s.location_id = $2)`;
  if (granularity === "day") {
    // generate_series crée tous les jours, même ceux sans vente : la série n'a pas de trou
    const { rows } = await pool.query(
      `SELECT d::date AS period, COALESCE((SELECT ${value} FROM sales s
                WHERE s.sold_at >= d AND s.sold_at < d + interval '1 day' AND ${filters}), 0)::float AS value
       FROM generate_series(current_date - 364, current_date - 1, interval '1 day') d
       ORDER BY d`,
      [itemId ?? null, locationId ?? null],
    );
    // Nettoyage : un jour fermé (0 vente) fausserait la prévision -> on le remplace par la moyenne
    // du même jour la semaine d'avant et la semaine d'après.
    const values = rows.map((r) => r.value as number);
    values.forEach((v, i) => {
      if (v === 0) {
        const around = [values[i - 7], values[i + 7]].filter((x) => x !== undefined && x > 0);
        if (around.length) values[i] = around.reduce((a, b) => a + b, 0) / around.length;
      }
    });
    return rows.map((r, i) => ({ period: r.period as string, value: values[i] }));
  }
  const { rows } = await pool.query(
    `SELECT to_char(m, 'YYYY-MM') AS period,
            COALESCE((SELECT ${value} FROM sales s
                      WHERE s.sold_at >= m AND s.sold_at < m + interval '1 month' AND ${filters}), 0)::float AS value
     FROM generate_series(date_trunc('month', current_date) - interval '36 months',
                          date_trunc('month', current_date) - interval '1 month', interval '1 month') m
     ORDER BY m`,
    [itemId ?? null, locationId ?? null],
  );
  // On ignore les premiers mois vides (produit lancé plus tard, boutique ouverte plus tard)
  const firstNonZero = rows.findIndex((r) => r.value > 0);
  return rows.slice(Math.max(0, firstNonZero));
}

function nextPeriods(last: string, granularity: Granularity, count: number) {
  const out: string[] = [];
  const d = new Date(granularity === "day" ? `${last}T00:00:00Z` : `${last}-01T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    if (granularity === "day") d.setUTCDate(d.getUTCDate() + 1);
    else d.setUTCMonth(d.getUTCMonth() + 1);
    out.push(granularity === "day" ? d.toISOString().slice(0, 10) : d.toISOString().slice(0, 7));
  }
  return out;
}

// ---------------------------------------------------------------------
// GET /api/analytics/forecast : prévision Holt-Winters
//   granularity=day   -> 28 prochains jours, saisonnalité hebdomadaire (m = 7)
//   granularity=month -> 12 prochains mois, saisonnalité annuelle (m = 12)
// ---------------------------------------------------------------------
const forecastQuery = z.object({
  granularity: z.enum(["day", "month"]).default("day"),
  metric: z.enum(["units", "revenue"]).default("units"),
  itemId: z.coerce.number().int().positive().optional(),
  locationId: z.coerce.number().int().positive().optional(),
});

analyticsRouter.get("/analytics/forecast", requirePermission("planning"), async (req, res) => {
  const q = forecastQuery.parse(req.query);
  const key = `forecast:${JSON.stringify(q)}`;
  const result = await cached(key, async () => {
    const series = await salesSeries(q.granularity, q.metric, q.itemId, q.locationId);
    const m = q.granularity === "day" ? 7 : 12;
    const horizon = q.granularity === "day" ? 28 : 12;
    if (series.length < 2 * m) {
      return { error: "Pas assez d'historique pour prévoir (il faut au moins 2 saisons)", history: series };
    }
    const hw = holtWinters(series.map((p) => p.value), m, horizon);
    const dates = nextPeriods(series.at(-1)!.period, q.granularity, horizon);
    const shown = q.granularity === "day" ? 120 : series.length; // on affiche 4 mois d'historique journalier
    // Le coefficient saisonnier n°i correspond à la i-ème période de la série (modulo m) :
    // on lui donne un nom lisible ("samedi", "décembre") à partir de la date correspondante.
    const dayNames = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
    const monthNames = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
    const seasonality = hw.seasonalFactors.map((factor, i) => {
      const d = new Date(q.granularity === "day" ? `${series[i].period}T00:00:00Z` : `${series[i].period}-01T00:00:00Z`);
      const order = q.granularity === "day" ? (d.getUTCDay() + 6) % 7 : d.getUTCMonth(); // lundi = 0
      return { label: q.granularity === "day" ? dayNames[d.getUTCDay()] : monthNames[d.getUTCMonth()], order, factor };
    }).sort((a, b) => a.order - b.order);
    return {
      granularity: q.granularity,
      metric: q.metric,
      params: hw.params,
      mape: hw.mape,
      seasonality,
      history: series.slice(-shown).map((p, i) => ({
        period: p.period,
        actual: Math.round(p.value),
        fitted: hw.fitted[series.length - shown + i],
      })),
      forecast: hw.forecast.map((f, i) => ({ period: dates[i], ...f })),
      total: Math.round(hw.forecast.reduce((s, f) => s + f.value, 0)),
    };
  });
  res.json(result);
});

// ---------------------------------------------------------------------
// GET /api/planning/production?days=14 : PLAN DE PRODUCTION SUGGÉRÉ (calcul des besoins)
// Pour chaque produit : besoin = demande prévue + stock de sécurité - stock actuel - OF déjà lancés
// Puis : matières nécessaires pour ces fournées, comparées au stock des ateliers.
// ---------------------------------------------------------------------
const planningQuery = z.object({ days: z.coerce.number().int().min(3).max(28).default(14) });

analyticsRouter.get("/planning/production", requirePermission("planning"), async (req, res) => {
  const { days } = planningQuery.parse(req.query);
  // Le stock et les OF sont lus EN DIRECT ; seule la prévision (calcul plus long) est gardée en mémoire.
  const result = await (async () => {
    const products = (
      await pool.query(
        `SELECT i.id, i.name, i.min_stock::float, r.id AS recipe_id, r.yield_quantity::float AS batch,
                COALESCE((SELECT SUM(quantity) FROM v_stock WHERE item_id = i.id), 0)::float AS stock,
                COALESCE((SELECT SUM(planned_quantity) FROM production_orders po
                          WHERE po.recipe_id = r.id AND po.status IN ('planifie', 'en_cours')), 0)::float AS in_progress
         FROM items i JOIN recipes r ON r.product_item_id = i.id AND r.active
         WHERE i.type = 'produit_fini' ORDER BY i.name`,
      )
    ).rows;

    const plan = [];
    for (const p of products) {
      const demand = await cached(`demand:${p.id}:${days}`, async () => {
        const series = await salesSeries("day", "units", p.id);
        const forecast = series.length >= 14 ? holtWinters(series.map((s) => s.value), 7, days).forecast : [];
        return Math.round(forecast.reduce((s, f) => s + f.value, 0));
      });
      const need = Math.max(0, demand + p.min_stock - p.stock - p.in_progress);
      const batches = Math.ceil(need / p.batch);
      plan.push({
        itemId: p.id, product: p.name, recipeId: p.recipe_id, demand, stock: p.stock, inProgress: p.in_progress,
        safetyStock: p.min_stock, need, batchSize: p.batch, batches, suggested: batches * p.batch,
        coverageDays: demand ? Math.round(((p.stock + p.in_progress) / demand) * days * 10) / 10 : null,
      });
    }

    // Besoins en matières pour réaliser les fournées suggérées
    const materials = (
      await pool.query(
        `SELECT i.id, i.name, i.unit, i.unit_cost::float,
                SUM(rl.quantity * (x.batches)::numeric)::float AS needed,
                COALESCE((SELECT SUM(s.quantity) FROM v_stock s JOIN locations l ON l.id = s.location_id
                          WHERE s.item_id = i.id AND l.type = 'production'), 0)::float AS stock
         FROM unnest($1::int[], $2::int[]) AS x(recipe_id, batches)
         JOIN recipe_lines rl ON rl.recipe_id = x.recipe_id
         JOIN items i ON i.id = rl.item_id
         GROUP BY i.id ORDER BY i.name`,
        [plan.map((p) => p.recipeId), plan.map((p) => p.batches)],
      )
    ).rows.map((m) => ({ ...m, missing: Math.max(0, m.needed - m.stock), purchaseCost: Math.max(0, m.needed - m.stock) * (m.unit_cost ?? 0) }));

    return { days, generatedAt: new Date().toISOString(), plan, materials };
  })();
  res.json(result);
});
