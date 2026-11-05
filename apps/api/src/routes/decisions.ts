// =====================================================================
// MOTEUR DE DÉCISIONS : des recommandations calculées UNIQUEMENT à partir des données de l'ERP.
// Pas d'IA : des RÈGLES MÉTIER écrites en clair, comme le raisonnement d'un bon gestionnaire.
// Chaque recommandation affiche ses chiffres ("faits") : on peut toujours vérifier le calcul.
//
// 6 familles : achats, production, anti-gaspillage, boutiques, commercial, stratégie.
// Priorités : urgent (à faire aujourd'hui), important (cette semaine), info (à surveiller).
// =====================================================================
import { Router } from "express";
import { holtWinters } from "../analytics/holt-winters";
import { requirePermission } from "../auth";
import { pool } from "../db";
import { cached, forecastDemand, salesSeries } from "./analytics";

export const decisionsRouter = Router();

type Priority = "urgent" | "important" | "info";
type Category = "achats" | "production" | "gaspillage" | "boutiques" | "commercial" | "strategie";
type Decision = {
  id: string;
  category: Category;
  priority: Priority;
  title: string;
  detail: string;
  facts: { label: string; value: string }[];
  action?: { label: string; to: string };
  impact?: number; // montant en euros concerné, pour trier à priorité égale
};

// ---------- Paramètres des règles (modifiables) ----------
const COVER_TARGET_DAYS = 14; // on commande pour couvrir 14 jours de consommation
const LEAD_TIME: Record<string, number> = {
  // délai de livraison de chaque fournisseur, en jours
  "Minoterie du Poitou": 4,
  "Laiterie Normande": 2,
  "Cacao & Co": 5,
  "Emballages Verts": 7,
};
const DEFAULT_LEAD_TIME = 3;

// ---------- Petits outils de mise en forme ----------
const DAY = 86_400_000;
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
/** "AAAA-MM-JJ" en heure LOCALE. (toISOString() passe en heure universelle : minuit à Paris = la veille à 23 h → mauvais jour !) */
const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromIso = (s: string) => new Date(`${s}T00:00:00`);
const fmtDay = (d: Date) => d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const fmtNum = (n: number, digits = 0) => n.toLocaleString("fr-FR", { maximumFractionDigits: digits });
const fmtEur = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const fmtPct = (r: number) => `${r > 0 ? "+" : ""}${(r * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
/** Arrondit une quantité à commander à un conditionnement réaliste */
const roundOrder = (qty: number, unit: string) => (unit === "u" ? Math.ceil(qty / 500) * 500 : Math.ceil(qty / 10) * 10);

// =====================================================================
// 1. ACHATS : quoi commander, combien, avant quand, chez qui
//    consommation prévue = ventes prévues de chaque produit × quantité de matière dans sa recette
//    couverture = stock des ateliers ÷ consommation par jour
//    date limite de commande = aujourd'hui + couverture − délai de livraison du fournisseur
// =====================================================================
async function purchasing() {
  const recipes = (
    await pool.query(
      `SELECT r.product_item_id AS product_id, r.yield_quantity::float AS yield, rl.item_id, rl.quantity::float AS qty
       FROM recipes r JOIN recipe_lines rl ON rl.recipe_id = r.id WHERE r.active`,
    )
  ).rows;
  const productIds = [...new Set(recipes.map((r) => r.product_id as number))];
  const demand = Object.fromEntries(await Promise.all(productIds.map(async (id) => [id, await forecastDemand(id, COVER_TARGET_DAYS)])));

  // Consommation prévue de chaque matière sur 14 jours
  const usage = new Map<number, number>();
  for (const r of recipes) usage.set(r.item_id, (usage.get(r.item_id) ?? 0) + ((demand[r.product_id] ?? 0) * r.qty) / r.yield);

  const materials = (
    await pool.query(
      `SELECT i.id, i.name, i.unit, COALESCE(i.unit_cost, 0)::float AS cost, i.min_stock::float AS min_stock,
              COALESCE((SELECT SUM(s.quantity) FROM v_stock s JOIN locations l ON l.id = s.location_id
                        WHERE s.item_id = i.id AND l.type = 'production'), 0)::float AS stock,
              (SELECT su.name FROM lots lo JOIN suppliers su ON su.id = lo.supplier_id
               WHERE lo.item_id = i.id ORDER BY lo.created_at DESC LIMIT 1) AS supplier
       FROM items i WHERE i.type <> 'produit_fini' ORDER BY i.name`,
    )
  ).rows;

  const plan = materials
    .filter((m) => (usage.get(m.id) ?? 0) > 0)
    .map((m) => {
      const daily = (usage.get(m.id) ?? 0) / COVER_TARGET_DAYS;
      const lead = LEAD_TIME[m.supplier] ?? DEFAULT_LEAD_TIME;
      const coverDays = m.stock / daily;
      const orderInDays = Math.floor(coverDays - lead);
      const needed = daily * (lead + COVER_TARGET_DAYS) + m.min_stock - m.stock;
      const quantity = needed > 0 ? roundOrder(needed, m.unit) : 0;
      return {
        itemId: m.id, item: m.name, unit: m.unit, supplier: m.supplier ?? "à définir", leadTime: lead,
        stock: Math.round(m.stock * 10) / 10, dailyUsage: Math.round(daily * 100) / 100,
        coverDays: Math.round(coverDays * 10) / 10,
        orderBy: isoLocal(addDays(today(), Math.max(0, orderInDays))),
        orderInDays, quantity, cost: Math.round(quantity * m.cost),
      };
    })
    .sort((a, b) => a.orderInDays - b.orderInDays);

  const decisions: Decision[] = plan
    .filter((p) => p.orderInDays <= 7 && p.quantity > 0)
    .map((p) => ({
      id: `achat-${p.itemId}`,
      category: "achats",
      priority: p.orderInDays <= 0 ? "urgent" : p.orderInDays <= 3 ? "important" : "info",
      title:
        p.orderInDays <= 0
          ? `Commander ${fmtNum(p.quantity)} ${p.unit} de ${p.item} aujourd'hui`
          : `Commander ${fmtNum(p.quantity)} ${p.unit} de ${p.item} ${p.orderInDays === 1 ? "demain" : `d'ici ${fmtDay(fromIso(p.orderBy))}`}`,
      detail:
        `Le stock des ateliers couvre ${fmtNum(p.coverDays, 1)} jour(s) de production prévue, et ${p.supplier} livre en ${p.leadTime} jours. ` +
        (p.orderInDays <= 0 ? "Sans commande aujourd'hui, la production risque de s'arrêter." : "Commander à cette date évite la rupture."),
      facts: [
        { label: "Stock ateliers", value: `${fmtNum(p.stock, 1)} ${p.unit}` },
        { label: "Consommation prévue", value: `${fmtNum(p.dailyUsage, 1)} ${p.unit}/jour` },
        { label: "Fournisseur", value: `${p.supplier} (${p.leadTime} j)` },
        { label: "Budget", value: fmtEur(p.cost) },
      ],
      action: { label: "Enregistrer la réception", to: "/receptions" },
      impact: p.cost,
    }));

  return { plan, decisions };
}

// =====================================================================
// 2. PRODUCTION : quelles fournées lancer, lesquelles sont en retard, quels surstocks
// =====================================================================
async function production(): Promise<Decision[]> {
  const products = (
    await pool.query(
      `SELECT i.id, i.name, i.min_stock::float AS min_stock, r.yield_quantity::float AS batch, c.unit_cost::float AS unit_cost,
              COALESCE((SELECT SUM(quantity) FROM v_stock WHERE item_id = i.id), 0)::float AS stock,
              COALESCE((SELECT SUM(planned_quantity) FROM production_orders po
                        WHERE po.recipe_id = r.id AND po.status IN ('planifie', 'en_cours')), 0)::float AS in_progress
       FROM items i JOIN recipes r ON r.product_item_id = i.id AND r.active
       LEFT JOIN v_product_cost c ON c.item_id = i.id
       WHERE i.type = 'produit_fini'`,
    )
  ).rows;

  const out: Decision[] = [];
  for (const p of products) {
    const demand = await forecastDemand(p.id, COVER_TARGET_DAYS);
    const daily = demand / COVER_TARGET_DAYS;
    if (daily <= 0) continue;
    const cover = (p.stock + p.in_progress) / daily;
    const need = demand + p.min_stock - p.stock - p.in_progress;
    const batches = Math.ceil(Math.max(0, need) / p.batch);
    const facts = [
      { label: "Stock total", value: `${fmtNum(p.stock)} u` },
      { label: "Déjà lancé", value: `${fmtNum(p.in_progress)} u` },
      { label: "Ventes prévues", value: `${fmtNum(daily)} u/jour` },
      { label: "Couverture", value: `${fmtNum(cover, 1)} jours` },
    ];
    if (cover < 7 && batches > 0) {
      out.push({
        id: `prod-${p.id}`, category: "production", priority: cover < 3 ? "urgent" : "important",
        title: `Lancer ${batches} fournée${batches > 1 ? "s" : ""} de ${p.name}`,
        detail: `Le stock et les fournées en cours ne couvrent que ${fmtNum(cover, 1)} jour(s) de ventes prévues. ` +
          `${batches} fournée(s) de ${fmtNum(p.batch)} couvrent les ${COVER_TARGET_DAYS} prochains jours avec le stock de sécurité.`,
        facts, action: { label: "Ouvrir la planification", to: "/planification" },
        impact: batches * p.batch * (p.unit_cost ?? 0),
      });
    } else if (cover > 45) {
      out.push({
        id: `surstock-${p.id}`, category: "production", priority: "info",
        title: `Surstock de ${p.name} : ralentir la production`,
        detail: `Le stock représente ${fmtNum(cover)} jours de ventes, alors que le produit se garde peu de temps. ` +
          "Suspendre les prochaines fournées et écouler le stock (boutiques, B2B).",
        facts, action: { label: "Voir le stock", to: "/stock" },
        impact: p.stock * (p.unit_cost ?? 0),
      });
    }
  }

  const late = (
    await pool.query(
      `SELECT po.id, po.number, po.status, po.planned_for, po.started_at, p.name AS product, l.name AS location, po.planned_quantity::float AS qty
       FROM production_orders po JOIN recipes r ON r.id = po.recipe_id JOIN items p ON p.id = r.product_item_id
       JOIN locations l ON l.id = po.location_id
       WHERE (po.status = 'planifie' AND po.planned_for < current_date)
          OR (po.status = 'en_cours' AND po.started_at < now() - interval '1 day')
       ORDER BY po.planned_for`,
    )
  ).rows;
  for (const o of late) {
    out.push({
      id: `retard-${o.id}`, category: "production", priority: "important",
      title: o.status === "planifie" ? `${o.number} en retard : à démarrer` : `${o.number} en cours depuis plus de 24 h : à clôturer`,
      detail: `${fmtNum(o.qty)} × ${o.product} à ${o.location}, prévu le ${new Date(`${o.planned_for}T00:00:00`).toLocaleDateString("fr-FR")}.`,
      facts: [{ label: "Statut", value: o.status === "planifie" ? "Planifié" : "En cours" }],
      action: { label: "Ouvrir la production", to: "/production" },
    });
  }
  return out;
}

// =====================================================================
// 3. ANTI-GASPILLAGE : lots qui périment bientôt (ou déjà périmés)
// =====================================================================
async function waste(): Promise<Decision[]> {
  const rows = (
    await pool.query(
      `SELECT i.id AS item_id, i.name AS item, i.type, i.unit, l.id AS location_id, l.name AS location, l.type AS location_type,
              SUM(s.quantity)::float AS qty, MIN(s.expires_on) AS expires_on,
              COALESCE(i.unit_cost, c.unit_cost, 0)::float AS cost
       FROM v_stock s JOIN items i ON i.id = s.item_id JOIN locations l ON l.id = s.location_id
       LEFT JOIN v_product_cost c ON c.item_id = i.id
       WHERE s.quantity > 0 AND s.expires_on IS NOT NULL
         AND s.expires_on <= current_date + CASE WHEN i.type = 'produit_fini' THEN 5 ELSE 10 END
       GROUP BY i.id, l.id, c.unit_cost
       ORDER BY MIN(s.expires_on)`,
    )
  ).rows;

  return rows.map((r) => {
    const daysLeft = Math.round((new Date(`${r.expires_on}T00:00:00`).getTime() - today().getTime()) / DAY);
    const value = r.qty * r.cost;
    const expired = daysLeft < 0;
    let advice: string;
    if (expired) advice = "Retirer immédiatement de la vente et déclarer la perte (obligation sanitaire).";
    else if (r.type !== "produit_fini") advice = "Utiliser ces lots en priorité dans les prochaines fournées (la règle FEFO le fait automatiquement à la clôture des OF).";
    else if (r.location_type === "production") advice = "Envoyer en priorité en boutique ou proposer à un client B2B (déstockage à prix réduit).";
    else advice = "Mettre en avant en boutique : offre « 2 achetés + 1 offert » ou prix réduit en fin de journée.";
    return {
      id: `dlc-${r.item_id}-${r.location_id}`,
      category: "gaspillage" as const,
      priority: (expired || daysLeft <= 1 ? "urgent" : daysLeft <= 3 ? "important" : "info") as Priority,
      title: expired
        ? `${r.item} périmé à ${r.location}`
        : `${fmtNum(r.qty, 1)} ${r.unit} de ${r.item} périment ${daysLeft === 0 ? "aujourd'hui" : `dans ${daysLeft} jour${daysLeft > 1 ? "s" : ""}`}`,
      detail: advice,
      facts: [
        { label: "Lieu", value: r.location },
        { label: "Date limite", value: new Date(`${r.expires_on}T00:00:00`).toLocaleDateString("fr-FR") },
        { label: "Valeur au coût", value: fmtEur(value) },
      ],
      action: { label: "Voir les lots", to: "/stock" },
      impact: value,
    };
  });
}

// =====================================================================
// 4. BOUTIQUES : quelles boutiques réapprovisionner, avec quoi, depuis quel atelier
//    couverture boutique = stock en boutique ÷ ventes moyennes par jour (14 derniers jours)
// =====================================================================
async function shops(): Promise<Decision[]> {
  const rows = (
    await pool.query(
      `WITH sold AS (
         SELECT location_id, item_id, SUM(quantity)::float / 14 AS daily
         FROM sales WHERE channel = 'boutique' AND sold_at >= current_date - 14
         GROUP BY 1, 2
       )
       SELECT l.id AS shop_id, l.name AS shop, i.id AS item_id, i.name AS item, sold.daily,
              COALESCE((SELECT SUM(quantity) FROM v_stock WHERE item_id = i.id AND location_id = l.id), 0)::float AS stock,
              (SELECT pl.name FROM v_stock s JOIN locations pl ON pl.id = s.location_id
               WHERE s.item_id = i.id AND pl.type = 'production' GROUP BY pl.name ORDER BY SUM(s.quantity) DESC LIMIT 1) AS source,
              COALESCE((SELECT SUM(s.quantity) FROM v_stock s JOIN locations pl ON pl.id = s.location_id
                        WHERE s.item_id = i.id AND pl.type = 'production'), 0)::float AS source_stock
       FROM sold JOIN locations l ON l.id = sold.location_id JOIN items i ON i.id = sold.item_id
       WHERE sold.daily > 0`,
    )
  ).rows;

  const byShop = new Map<string, typeof rows>();
  for (const r of rows) {
    const cover = r.stock / r.daily;
    if (cover >= 2) continue; // moins de 2 jours de stock : à réapprovisionner
    byShop.set(r.shop, [...(byShop.get(r.shop) ?? []), { ...r, cover, toSend: Math.ceil((r.daily * 7 - r.stock) / 10) * 10 }]);
  }

  return [...byShop.entries()].map(([shop, items]) => {
    const rupture = items.filter((i) => i.cover < 0.5);
    const lines = items.sort((a, b) => b.toSend - a.toSend);
    return {
      id: `boutique-${items[0].shop_id}`,
      category: "boutiques" as const,
      priority: (rupture.length > 0 ? "urgent" : "important") as Priority,
      title: `Réapprovisionner ${shop}${rupture.length ? ` (${rupture.length} produit${rupture.length > 1 ? "s" : ""} en rupture)` : ""}`,
      detail:
        "Stock inférieur à 2 jours de ventes. À envoyer pour tenir 7 jours : " +
        lines.map((l) => `${fmtNum(l.toSend)} ${l.item.replace(/ \d+ g$/, "")}`).join(", ") +
        (lines[0].source ? `, depuis ${lines[0].source}.` : "."),
      facts: lines.slice(0, 4).map((l) => ({ label: l.item.replace(/ \d+ g$/, ""), value: `${fmtNum(l.stock)} en stock · ${fmtNum(l.daily)}/jour` })),
      action: { label: "Voir le stock", to: "/stock" },
      impact: lines.reduce((s, l) => s + l.toSend, 0),
    };
  });
}

// =====================================================================
// 5. COMMERCIAL (direction) : clients B2B à relancer ou en baisse, produits à pousser
// =====================================================================
async function commercial(): Promise<Decision[]> {
  const out: Decision[] = [];
  const customers = (
    await pool.query(
      `SELECT c.id, c.name, c.city,
              MAX(s.sold_at)::date AS last_order,
              COUNT(DISTINCT s.sold_at::date) FILTER (WHERE s.sold_at >= current_date - 90) AS orders_90,
              COALESCE(SUM(s.quantity * s.unit_price) FILTER (WHERE s.sold_at >= current_date - 60), 0)::float AS rev_60,
              COALESCE(SUM(s.quantity * s.unit_price) FILTER (WHERE s.sold_at >= current_date - 120 AND s.sold_at < current_date - 60), 0)::float AS rev_prev_60
       FROM customers c LEFT JOIN sales s ON s.customer_id = c.id AND s.sold_at >= current_date - 120
       GROUP BY c.id`,
    )
  ).rows;
  for (const c of customers) {
    const silentDays = c.last_order ? Math.round((today().getTime() - new Date(`${c.last_order}T00:00:00`).getTime()) / DAY) : 999;
    const change = c.rev_prev_60 ? (c.rev_60 - c.rev_prev_60) / c.rev_prev_60 : 0;
    if (silentDays > 14 && c.orders_90 >= 4) {
      out.push({
        id: `relance-${c.id}`, category: "commercial", priority: "important",
        title: `Relancer ${c.name} : aucune commande depuis ${silentDays} jours`,
        detail: `Client habituellement régulier (${c.orders_90} commandes en 90 jours). Un appel permet de vérifier s'il y a un problème ou un concurrent.`,
        facts: [{ label: "Ville", value: c.city }, { label: "Dernière commande", value: new Date(`${c.last_order}T00:00:00`).toLocaleDateString("fr-FR") }],
        action: { label: "Voir ses ventes", to: "/donnees?table=clients" }, impact: c.rev_prev_60,
      });
    } else if (change < -0.15 && c.rev_prev_60 > 1000) {
      out.push({
        id: `baisse-${c.id}`, category: "commercial", priority: "info",
        title: `${c.name} commande moins : ${fmtPct(change)} sur 60 jours`,
        detail: "Baisse marquée des commandes. Proposer un rendez-vous, une nouveauté ou une offre de volume.",
        facts: [{ label: "60 derniers jours", value: fmtEur(c.rev_60) }, { label: "60 jours précédents", value: fmtEur(c.rev_prev_60) }],
        action: { label: "Voir les clients", to: "/donnees?table=clients" }, impact: c.rev_prev_60 - c.rev_60,
      });
    }
  }

  // Produits : croissance sur 90 jours vs les mêmes 90 jours l'an dernier, et marge
  const products = (
    await pool.query(
      `SELECT i.id, i.name, i.sale_price::float AS price, c.unit_cost::float AS cost,
              COALESCE(SUM(s.quantity * s.unit_price) FILTER (WHERE s.sold_at >= current_date - 90), 0)::float AS rev,
              COALESCE(SUM(s.quantity * s.unit_price) FILTER (WHERE s.sold_at >= current_date - 455 AND s.sold_at < current_date - 365), 0)::float AS rev_ly
       FROM items i LEFT JOIN v_product_cost c ON c.item_id = i.id
       LEFT JOIN sales s ON s.item_id = i.id AND s.sold_at >= current_date - 455
       WHERE i.type = 'produit_fini' GROUP BY i.id, c.unit_cost`,
    )
  ).rows.map((p) => ({ ...p, growth: p.rev_ly ? (p.rev - p.rev_ly) / p.rev_ly : null, margin: p.price ? (p.price - p.cost) / p.price : 0 }));

  const growers = products.filter((p) => p.growth !== null).sort((a, b) => b.growth! - a.growth!);
  const star = growers[0];
  if (star && star.growth! > 0.15) {
    out.push({
      id: `pousser-${star.id}`, category: "commercial", priority: "info",
      title: `Pousser ${star.name} : ${fmtPct(star.growth!)} sur un an`,
      detail: "Meilleure progression du catalogue. Le mettre en avant en boutique et le proposer en priorité aux clients B2B.",
      facts: [{ label: "CA 90 jours", value: fmtEur(star.rev) }, { label: "Marge matière", value: `${fmtNum(star.margin * 100)} %` }],
      action: { label: "Voir la prévision", to: "/previsions" }, impact: star.rev,
    });
  }
  return out;
}

// =====================================================================
// 6. STRATÉGIE (direction) : tendance des boutiques, pic saisonnier à venir, produit à revoir
// =====================================================================
async function strategy(): Promise<Decision[]> {
  const out: Decision[] = [];

  // Boutiques : 30 derniers jours vs les mêmes 30 jours l'an dernier (on compare à saison égale)
  const shopsTrend = (
    await pool.query(
      `SELECT l.id, l.name, l.is_franchise, l.opened_on,
              COALESCE(SUM(s.quantity * s.unit_price) FILTER (WHERE s.sold_at >= current_date - 30), 0)::float AS rev,
              COALESCE(SUM(s.quantity * s.unit_price) FILTER (WHERE s.sold_at >= current_date - 395 AND s.sold_at < current_date - 365), 0)::float AS rev_ly
       FROM locations l LEFT JOIN sales s ON s.location_id = l.id AND s.channel = 'boutique' AND s.sold_at >= current_date - 395
       WHERE l.type = 'boutique' GROUP BY l.id`,
    )
  ).rows.filter((s) => s.rev_ly > 0).map((s) => ({ ...s, growth: (s.rev - s.rev_ly) / s.rev_ly }));
  const network = shopsTrend.reduce((a, s) => a + s.rev, 0) / Math.max(1, shopsTrend.reduce((a, s) => a + s.rev_ly, 0)) - 1;
  for (const s of shopsTrend) {
    if (s.growth < network - 0.05) {
      out.push({
        id: `recul-${s.id}`, category: "strategie", priority: s.growth < 0 ? "important" : "info",
        title: `${s.name} progresse moins vite que le réseau (${fmtPct(s.growth)} contre ${fmtPct(network)})`,
        detail: "À analyser : emplacement, équipe, concurrence locale, assortiment. Comparer avec les boutiques les plus dynamiques.",
        facts: [{ label: "CA 30 jours", value: fmtEur(s.rev) }, { label: "Il y a un an", value: fmtEur(s.rev_ly) }, { label: "Type", value: s.is_franchise ? "Franchise" : "En propre" }],
        action: { label: "Voir la vue direction", to: "/" }, impact: s.rev_ly - s.rev,
      });
    } else if (s.growth > network + 0.1) {
      out.push({
        id: `croissance-${s.id}`, category: "strategie", priority: "info",
        title: `${s.name} surperforme (${fmtPct(s.growth)} sur un an)`,
        detail: "Comprendre ce qui marche ici (équipe, animation, emplacement) pour le reproduire ailleurs ; vérifier que le stock suit la demande.",
        facts: [{ label: "CA 30 jours", value: fmtEur(s.rev) }, { label: "Réseau", value: fmtPct(network) }],
        action: { label: "Voir la vue direction", to: "/" }, impact: s.rev,
      });
    }
  }

  // Pic ou creux saisonnier dans les 3 prochains mois (prévision Holt-Winters mensuelle du CA)
  const seasonal = await cached("decisions:monthly", async () => {
    const series = await salesSeries("month", "revenue");
    const hw = holtWinters(series.map((p) => p.value), 12, 3);
    const avg = series.slice(-12).reduce((a, p) => a + p.value, 0) / 12;
    const last = new Date(`${series.at(-1)!.period}-01T00:00:00`);
    return hw.forecast.map((f, i) => {
      const d = new Date(last); d.setMonth(d.getMonth() + i + 1);
      return { month: d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }), value: f.value, ratio: f.value / avg };
    });
  });
  const peak = [...seasonal].sort((a, b) => b.ratio - a.ratio)[0];
  if (peak && peak.ratio > 1.2) {
    out.push({
      id: "pic-saison", category: "strategie", priority: "important",
      title: `Anticiper le pic de ${peak.month} : ${fmtEur(peak.value)} de CA prévu (${fmtPct(peak.ratio - 1)} vs un mois moyen)`,
      detail: "Sécuriser dès maintenant les matières à long délai (chocolat, emballages), planifier les équipes et les renforts, " +
        "augmenter progressivement la production et le stock des boutiques.",
      facts: seasonal.map((s) => ({ label: s.month, value: fmtEur(s.value) })),
      action: { label: "Voir les prévisions", to: "/previsions" }, impact: peak.value,
    });
  }
  const trough = [...seasonal].sort((a, b) => a.ratio - b.ratio)[0];
  if (trough && trough.ratio < 0.85) {
    out.push({
      id: "creux-saison", category: "strategie", priority: "info",
      title: `Creux attendu en ${trough.month} (${fmtPct(trough.ratio - 1)})`,
      detail: "Bon moment pour les congés, la maintenance des fours, les tests R&D et les animations commerciales.",
      facts: [{ label: "CA prévu", value: fmtEur(trough.value) }],
      action: { label: "Voir les prévisions", to: "/previsions" },
    });
  }

  // Produit à la marge la plus faible
  const margins = (
    await pool.query(
      `SELECT i.name, i.sale_price::float AS price, c.unit_cost::float AS cost
       FROM items i JOIN v_product_cost c ON c.item_id = i.id WHERE i.type = 'produit_fini' AND i.sale_price > 0`,
    )
  ).rows.map((p) => ({ ...p, margin: (p.price - p.cost) / p.price })).sort((a, b) => a.margin - b.margin);
  const weakest = margins[0];
  if (weakest) {
    out.push({
      id: "marge-faible", category: "strategie", priority: "info",
      title: `Marge la plus faible : ${weakest.name} (${fmtNum(weakest.margin * 100)} %)`,
      detail: "Vérifier le prix de vente et les ingrédients les plus coûteux de la recette (piste R&D : grammage, fournisseur, emballage).",
      facts: [{ label: "Coût matière", value: weakest.cost.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) }, { label: "Prix boutique", value: weakest.price.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) }],
      action: { label: "Voir les recettes", to: "/donnees?table=recettes" },
    });
  }
  return out;
}

// ---------------------------------------------------------------------
// GET /api/decisions : toutes les recommandations, triées par urgence
// ---------------------------------------------------------------------
const order: Record<Priority, number> = { urgent: 0, important: 1, info: 2 };

decisionsRouter.get("/decisions", requirePermission("planning"), async (req, res) => {
  const isDirection = req.user!.role === "admin";
  const [buy, prod, wst, shp, com, strat] = await Promise.all([
    purchasing(), production(), waste(), shops(),
    isDirection ? commercial() : Promise.resolve([]), // chiffres commerciaux : direction uniquement
    isDirection ? strategy() : Promise.resolve([]),
  ]);
  const decisions = [...buy.decisions, ...prod, ...wst, ...shp, ...com, ...strat].sort(
    (a, b) => order[a.priority] - order[b.priority] || (b.impact ?? 0) - (a.impact ?? 0),
  );
  const budget7 = buy.plan.filter((p) => p.orderInDays <= 7).reduce((s, p) => s + p.cost, 0);
  res.json({
    generatedAt: new Date().toISOString(),
    summary: {
      urgent: decisions.filter((d) => d.priority === "urgent").length,
      important: decisions.filter((d) => d.priority === "important").length,
      info: decisions.filter((d) => d.priority === "info").length,
      purchaseBudget7d: budget7,
    },
    decisions,
    purchasePlan: buy.plan,
  });
});
