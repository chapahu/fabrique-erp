// =====================================================================
// EXPLORATEUR DE DONNÉES : consulter toutes les tables, avec recherche, filtres, tri, pages, export.
//
// SÉCURITÉ : le navigateur n'envoie JAMAIS de SQL. Il envoie seulement des NOMS
// ("je veux les ventes, filtrées sur le canal b2b, triées par date").
// Le serveur ne connaît qu'une LISTE FERMÉE de jeux de données, de colonnes et de filtres (ci-dessous).
// Tout nom inconnu est refusé, et toutes les VALEURS passent en paramètres ($1, $2...) : pas d'injection SQL possible.
// =====================================================================
import type { Role } from "@fabrique/shared";
import { type Request, Router } from "express";
import { z } from "zod";
import { requirePermission } from "../auth";
import { pool } from "../db";
import { HttpError } from "../errors";

type ColumnType = "text" | "number" | "money" | "percent" | "date" | "datetime" | "enum" | "bool";
type Column = { key: string; label: string; type: ColumnType; sql: string; labels?: Record<string, string> };
type Filter = { key: string; label: string; sql: string; options: string }; // options : requête qui renvoie (value, label)
type Dataset = {
  key: string;
  label: string;
  group: string;
  description: string;
  from: string;
  columns: Column[];
  search: string[];
  filters: Filter[];
  date?: { sql: string; label: string };
  sort: { key: string; dir: "asc" | "desc" };
  roles?: Role[]; // si défini : réservé à ces rôles
};

const itemTypes = { matiere_premiere: "Matière première", emballage: "Emballage", produit_fini: "Produit fini" };
const locationTypes = { production: "Atelier", boutique: "Boutique", entrepot: "Entrepôt" };
const ofStatus = { planifie: "Planifié", en_cours: "En cours", termine: "Terminé", annule: "Annulé" };
const movementTypes = {
  reception: "Réception", consommation: "Consommation", production: "Production", vente: "Vente",
  transfert: "Transfert", perte: "Perte", ajustement: "Ajustement",
};
const channels = { boutique: "Boutique", b2b: "B2B" };
const sources = { historique: "Historique (reprise)", erp: "Saisi dans l'ERP" };
const segments = { restaurant: "Restaurant", hotel: "Hôtel", epicerie: "Épicerie fine", entreprise: "Entreprise", collectivite: "Collectivité" };
const roleNames = { admin: "Direction", production: "Atelier", achats: "Achats", boutique: "Boutique" };

/** Options d'un filtre à partir d'une liste fixe de libellés */
const staticOptions = (labels: Record<string, string>) =>
  `SELECT * FROM (VALUES ${Object.entries(labels).map(([v, l]) => `('${v}', '${l.replace(/'/g, "''")}')`).join(", ")}) AS o(value, label)`;
const locationOptions = (type?: string) =>
  `SELECT id::text AS value, name AS label FROM locations ${type ? `WHERE type = '${type}'` : ""} ORDER BY name`;
const itemOptions = (type?: string) =>
  `SELECT id::text AS value, name AS label FROM items ${type ? `WHERE type = '${type}'` : ""} ORDER BY name`;

// ---------------------------------------------------------------------
// La liste fermée des jeux de données
// ---------------------------------------------------------------------
const datasets: Dataset[] = [
  {
    key: "ventes", label: "Ventes", group: "Commerce",
    description: "Chaque article vendu, en boutique ou aux professionnels",
    from: `sales s JOIN items i ON i.id = s.item_id JOIN locations l ON l.id = s.location_id
           LEFT JOIN customers c ON c.id = s.customer_id`,
    columns: [
      { key: "sold_at", label: "Date", type: "datetime", sql: "s.sold_at" },
      { key: "channel", label: "Canal", type: "enum", sql: "s.channel", labels: channels },
      { key: "location", label: "Lieu", type: "text", sql: "l.name" },
      { key: "customer", label: "Client", type: "text", sql: "c.name" },
      { key: "item", label: "Produit", type: "text", sql: "i.name" },
      { key: "quantity", label: "Quantité", type: "number", sql: "s.quantity" },
      { key: "unit_price", label: "Prix unitaire", type: "money", sql: "s.unit_price" },
      { key: "total", label: "Montant", type: "money", sql: "s.quantity * s.unit_price" },
      { key: "source", label: "Origine", type: "enum", sql: "s.source", labels: sources },
    ],
    search: ["i.name", "l.name", "c.name"],
    filters: [
      { key: "channel", label: "Canal", sql: "s.channel", options: staticOptions(channels) },
      { key: "location", label: "Lieu", sql: "s.location_id::text", options: locationOptions() },
      { key: "item", label: "Produit", sql: "s.item_id::text", options: itemOptions("produit_fini") },
      { key: "customer", label: "Client", sql: "s.customer_id::text", options: "SELECT id::text AS value, name AS label FROM customers ORDER BY name" },
      { key: "source", label: "Origine", sql: "s.source", options: staticOptions(sources) },
    ],
    date: { sql: "s.sold_at", label: "Date de vente" },
    sort: { key: "sold_at", dir: "desc" },
  },
  {
    key: "clients", label: "Clients B2B", group: "Commerce",
    description: "Restaurants, hôtels, épiceries et entreprises clientes",
    from: "customers c",
    columns: [
      { key: "name", label: "Client", type: "text", sql: "c.name" },
      { key: "segment", label: "Segment", type: "enum", sql: "c.segment", labels: segments },
      { key: "city", label: "Ville", type: "text", sql: "c.city" },
      { key: "email", label: "E-mail", type: "text", sql: "c.email" },
      { key: "payment_terms_days", label: "Délai de paiement (j)", type: "number", sql: "c.payment_terms_days" },
      { key: "revenue_12m", label: "CA 12 mois", type: "money",
        sql: "(SELECT COALESCE(SUM(quantity * unit_price), 0) FROM sales WHERE customer_id = c.id AND sold_at >= current_date - 365)" },
    ],
    search: ["c.name", "c.city", "c.email"],
    filters: [
      { key: "segment", label: "Segment", sql: "c.segment", options: staticOptions(segments) },
      { key: "city", label: "Ville", sql: "c.city", options: "SELECT DISTINCT city AS value, city AS label FROM customers ORDER BY 1" },
    ],
    sort: { key: "revenue_12m", dir: "desc" },
  },
  {
    key: "ordres-fabrication", label: "Ordres de fabrication", group: "Production",
    description: "Toutes les fournées : planifiées, en cours, terminées",
    from: `production_orders po JOIN recipes r ON r.id = po.recipe_id JOIN items p ON p.id = r.product_item_id
           JOIN locations l ON l.id = po.location_id`,
    columns: [
      { key: "number", label: "N°", type: "text", sql: "po.number" },
      { key: "product", label: "Produit", type: "text", sql: "p.name" },
      { key: "location", label: "Site", type: "text", sql: "l.name" },
      { key: "status", label: "Statut", type: "enum", sql: "po.status", labels: ofStatus },
      { key: "planned_for", label: "Prévu le", type: "date", sql: "po.planned_for" },
      { key: "planned_quantity", label: "Planifié", type: "number", sql: "po.planned_quantity" },
      { key: "produced_quantity", label: "Produit", type: "number", sql: "po.produced_quantity" },
      { key: "yield", label: "Rendement", type: "percent", sql: "po.produced_quantity / NULLIF(po.planned_quantity, 0)" },
      { key: "finished_at", label: "Terminé le", type: "datetime", sql: "po.finished_at" },
    ],
    search: ["po.number", "p.name"],
    filters: [
      { key: "status", label: "Statut", sql: "po.status", options: staticOptions(ofStatus) },
      { key: "location", label: "Site", sql: "po.location_id::text", options: locationOptions("production") },
      { key: "product", label: "Produit", sql: "p.id::text", options: itemOptions("produit_fini") },
    ],
    date: { sql: "po.planned_for", label: "Date prévue" },
    sort: { key: "number", dir: "desc" },
  },
  {
    key: "recettes", label: "Recettes", group: "Production",
    description: "Nomenclatures : ingrédients et coût de revient par produit",
    from: `recipes r JOIN items p ON p.id = r.product_item_id LEFT JOIN v_product_cost c ON c.recipe_id = r.id`,
    columns: [
      { key: "name", label: "Recette", type: "text", sql: "r.name" },
      { key: "product", label: "Produit", type: "text", sql: "p.name" },
      { key: "yield", label: "Fournée", type: "number", sql: "r.yield_quantity" },
      { key: "unit_cost", label: "Coût matière / u", type: "money", sql: "c.unit_cost" },
      { key: "sale_price", label: "Prix boutique", type: "money", sql: "p.sale_price" },
      { key: "margin", label: "Marge", type: "percent", sql: "(p.sale_price - c.unit_cost) / NULLIF(p.sale_price, 0)" },
      { key: "ingredients", label: "Ingrédients", type: "text",
        sql: `(SELECT string_agg(i.name || ' ' || replace(trim_scale(rl.quantity)::text, '.', ',') || ' ' || i.unit, ' · ' ORDER BY i.name)
               FROM recipe_lines rl JOIN items i ON i.id = rl.item_id WHERE rl.recipe_id = r.id)` },
      { key: "active", label: "Active", type: "bool", sql: "r.active" },
    ],
    search: ["r.name", "p.name"],
    filters: [{ key: "category", label: "Famille", sql: "p.category", options: "SELECT DISTINCT category AS value, initcap(category) AS label FROM items WHERE category IS NOT NULL ORDER BY 1" }],
    sort: { key: "name", dir: "asc" },
  },
  {
    key: "mouvements", label: "Mouvements de stock", group: "Stock",
    description: "Le grand livre : chaque entrée et sortie, avec son auteur",
    from: `stock_movements m JOIN lots lo ON lo.id = m.lot_id JOIN items i ON i.id = lo.item_id
           JOIN locations l ON l.id = m.location_id LEFT JOIN production_orders po ON po.id = m.production_order_id
           LEFT JOIN users u ON u.id = m.user_id`,
    columns: [
      { key: "created_at", label: "Date", type: "datetime", sql: "m.created_at" },
      { key: "type", label: "Mouvement", type: "enum", sql: "m.type", labels: movementTypes },
      { key: "item", label: "Article", type: "text", sql: "i.name" },
      { key: "lot", label: "Lot", type: "text", sql: "lo.lot_number" },
      { key: "location", label: "Lieu", type: "text", sql: "l.name" },
      { key: "quantity", label: "Quantité", type: "number", sql: "m.quantity" },
      { key: "unit", label: "Unité", type: "text", sql: "i.unit" },
      { key: "of", label: "OF", type: "text", sql: "po.number" },
      { key: "user", label: "Par", type: "text", sql: "u.name" },
    ],
    search: ["i.name", "lo.lot_number", "l.name", "po.number"],
    filters: [
      { key: "type", label: "Mouvement", sql: "m.type", options: staticOptions(movementTypes) },
      { key: "location", label: "Lieu", sql: "m.location_id::text", options: locationOptions() },
      { key: "item", label: "Article", sql: "i.id::text", options: itemOptions() },
    ],
    date: { sql: "m.created_at", label: "Date du mouvement" },
    sort: { key: "created_at", dir: "desc" },
  },
  {
    key: "lots", label: "Lots", group: "Stock",
    description: "Chaque arrivage et chaque fournée, avec sa date limite et ce qu'il en reste",
    from: `lots lo JOIN items i ON i.id = lo.item_id LEFT JOIN suppliers s ON s.id = lo.supplier_id
           LEFT JOIN production_orders po ON po.id = lo.production_order_id`,
    columns: [
      { key: "lot_number", label: "Lot", type: "text", sql: "lo.lot_number" },
      { key: "item", label: "Article", type: "text", sql: "i.name" },
      { key: "item_type", label: "Type", type: "enum", sql: "i.type", labels: itemTypes },
      { key: "origin", label: "Origine", type: "text", sql: "COALESCE(s.name, 'Fabriqué : ' || po.number)" },
      { key: "expires_on", label: "DLC / DDM", type: "date", sql: "lo.expires_on" },
      { key: "remaining", label: "Reste", type: "number", sql: "(SELECT COALESCE(SUM(quantity), 0) FROM stock_movements WHERE lot_id = lo.id)" },
      { key: "unit", label: "Unité", type: "text", sql: "i.unit" },
      { key: "created_at", label: "Créé le", type: "datetime", sql: "lo.created_at" },
    ],
    search: ["lo.lot_number", "i.name", "s.name"],
    filters: [
      { key: "item_type", label: "Type", sql: "i.type", options: staticOptions(itemTypes) },
      { key: "item", label: "Article", sql: "i.id::text", options: itemOptions() },
      { key: "supplier", label: "Fournisseur", sql: "s.id::text", options: "SELECT id::text AS value, name AS label FROM suppliers ORDER BY name" },
    ],
    date: { sql: "lo.created_at", label: "Date de création" },
    sort: { key: "created_at", dir: "desc" },
  },
  {
    key: "articles", label: "Articles", group: "Référentiel",
    description: "Matières, emballages et produits finis, avec leurs prix et coûts",
    from: "items i LEFT JOIN v_product_cost c ON c.item_id = i.id",
    columns: [
      { key: "sku", label: "Référence", type: "text", sql: "i.sku" },
      { key: "name", label: "Article", type: "text", sql: "i.name" },
      { key: "type", label: "Type", type: "enum", sql: "i.type", labels: itemTypes },
      { key: "category", label: "Famille", type: "text", sql: "i.category" },
      { key: "unit", label: "Unité", type: "text", sql: "i.unit" },
      { key: "cost", label: "Coût / unité", type: "money", sql: "COALESCE(i.unit_cost, c.unit_cost)" },
      { key: "sale_price", label: "Prix boutique", type: "money", sql: "i.sale_price" },
      { key: "b2b_price", label: "Prix B2B", type: "money", sql: "i.b2b_price" },
      { key: "min_stock", label: "Stock mini", type: "number", sql: "i.min_stock" },
      { key: "shelf_life_days", label: "Durée de vie (j)", type: "number", sql: "i.shelf_life_days" },
    ],
    search: ["i.sku", "i.name"],
    filters: [{ key: "type", label: "Type", sql: "i.type", options: staticOptions(itemTypes) }],
    sort: { key: "name", dir: "asc" },
  },
  {
    key: "emplacements", label: "Ateliers et boutiques", group: "Référentiel",
    description: "Sites de production et points de vente",
    from: "locations l",
    columns: [
      { key: "code", label: "Code", type: "text", sql: "l.code" },
      { key: "name", label: "Nom", type: "text", sql: "l.name" },
      { key: "type", label: "Type", type: "enum", sql: "l.type", labels: locationTypes },
      { key: "city", label: "Ville", type: "text", sql: "l.city" },
      { key: "is_franchise", label: "Franchise", type: "bool", sql: "l.is_franchise" },
      { key: "opened_on", label: "Ouverture", type: "date", sql: "l.opened_on" },
    ],
    search: ["l.code", "l.name", "l.city"],
    filters: [{ key: "type", label: "Type", sql: "l.type", options: staticOptions(locationTypes) }],
    sort: { key: "name", dir: "asc" },
  },
  {
    key: "fournisseurs", label: "Fournisseurs", group: "Référentiel",
    description: "Qui nous livre les matières et emballages",
    from: "suppliers s",
    columns: [
      { key: "name", label: "Fournisseur", type: "text", sql: "s.name" },
      { key: "email", label: "E-mail", type: "text", sql: "s.email" },
      { key: "lots", label: "Livraisons reçues", type: "number", sql: "(SELECT count(*) FROM lots WHERE supplier_id = s.id)" },
    ],
    search: ["s.name", "s.email"],
    filters: [],
    sort: { key: "name", dir: "asc" },
  },
  {
    key: "utilisateurs", label: "Utilisateurs", group: "Référentiel",
    description: "Les comptes de l'ERP (sans jamais les mots de passe)",
    from: "users u LEFT JOIN locations l ON l.id = u.location_id",
    columns: [
      { key: "name", label: "Nom", type: "text", sql: "u.name" },
      { key: "email", label: "E-mail", type: "text", sql: "u.email" },
      { key: "role", label: "Rôle", type: "enum", sql: "u.role", labels: roleNames },
      { key: "location", label: "Boutique", type: "text", sql: "l.name" },
      { key: "active", label: "Actif", type: "bool", sql: "u.active" },
      { key: "created_at", label: "Créé le", type: "datetime", sql: "u.created_at" },
    ],
    search: ["u.name", "u.email"],
    filters: [{ key: "role", label: "Rôle", sql: "u.role", options: staticOptions(roleNames) }],
    sort: { key: "name", dir: "asc" },
    roles: ["admin"],
  },
];

export const dataRouter = Router();
dataRouter.use("/data", requirePermission("data"));

const visibleTo = (req: Request) => datasets.filter((d) => !d.roles || d.roles.includes(req.user!.role));

function findDataset(req: Request) {
  const d = visibleTo(req).find((x) => x.key === req.params.key);
  if (!d) throw new HttpError(404, "Jeu de données inconnu ou non autorisé");
  return d;
}

// GET /api/data : la liste des catégories, avec leurs colonnes, filtres (et options) et nombre de lignes
dataRouter.get("/data", async (req, res) => {
  const list = await Promise.all(
    visibleTo(req).map(async (d) => {
      const [count, ...options] = await Promise.all([
        pool.query(`SELECT count(*)::int AS n FROM ${d.from}`),
        ...d.filters.map((f) => pool.query(f.options)),
      ]);
      return {
        key: d.key, label: d.label, group: d.group, description: d.description, count: count.rows[0].n,
        columns: d.columns.map(({ key, label, type, labels }) => ({ key, label, type, labels })),
        filters: d.filters.map((f, i) => ({ key: f.key, label: f.label, options: options[i].rows })),
        date: d.date?.label ?? null,
        sort: d.sort,
      };
    }),
  );
  res.json(list);
});

// Paramètres acceptés : tout est validé, et seuls des NOMS connus sont utilisés pour construire la requête
const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  sort: z.string().max(50).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
});

function buildQuery(d: Dataset, req: Request) {
  const q = listQuery.parse(req.query);
  const params: unknown[] = [];
  const where: string[] = [];
  const param = (v: unknown) => `$${params.push(v)}`;

  if (q.q) {
    const p = param(`%${q.q}%`);
    where.push(`(${d.search.map((s) => `${s} ILIKE ${p}`).join(" OR ")})`);
  }
  for (const f of d.filters) {
    const value = req.query[`f_${f.key}`];
    if (typeof value === "string" && value !== "") where.push(`${f.sql} = ${param(value)}`);
  }
  if (d.date && q.from) where.push(`${d.date.sql} >= ${param(q.from)}::date`);
  if (d.date && q.to) where.push(`${d.date.sql} < ${param(q.to)}::date + 1`);

  const sortCol = d.columns.find((c) => c.key === q.sort) ?? d.columns.find((c) => c.key === d.sort.key)!;
  const dir = q.sort ? (q.dir ?? "asc") : d.sort.dir;
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const select = d.columns.map((c) => `${c.sql} AS "${c.key}"`).join(", ");
  return {
    q, params, whereSql,
    rowsSql: `SELECT ${select} FROM ${d.from} ${whereSql} ORDER BY ${sortCol.sql} ${dir.toUpperCase()} NULLS LAST`,
    countSql: `SELECT count(*)::int AS n FROM ${d.from} ${whereSql}`,
  };
}

// GET /api/data/:key?q=&f_channel=b2b&from=&to=&sort=&dir=&page= : une page de résultats
dataRouter.get("/data/:key", async (req, res) => {
  const d = findDataset(req);
  const { q, params, rowsSql, countSql } = buildQuery(d, req);
  const [rows, count] = await Promise.all([
    pool.query(`${rowsSql} LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`, params),
    pool.query(countSql, params),
  ]);
  res.json({ rows: rows.rows, total: count.rows[0].n, page: q.page, pageSize: q.pageSize });
});

// GET /api/data/:key/export.csv : le résultat filtré complet, à ouvrir dans Excel
dataRouter.get("/data/:key/export.csv", async (req, res) => {
  const d = findDataset(req);
  const { params, rowsSql } = buildQuery(d, req);
  const { rows } = await pool.query(`${rowsSql} LIMIT 100000`, params);
  // Format "à la française" pour Excel : séparateur ; et virgule décimale
  const cell = (v: unknown, c: Column) => {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return c.type === "date" ? v.toISOString().slice(0, 10) : v.toISOString().replace("T", " ").slice(0, 19);
    if (c.type === "enum" && c.labels) v = c.labels[String(v)] ?? v;
    if (c.type === "bool") v = v ? "oui" : "non";
    if (typeof v === "number") return String(v).replace(".", ",");
    const s = String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [d.columns.map((c) => c.label).join(";"), ...rows.map((r) => d.columns.map((c) => cell(r[c.key], c)).join(";"))];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${d.key}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send("﻿" + lines.join("\r\n")); // ﻿ : indique à Excel que le fichier est en UTF-8 (accents)
});
