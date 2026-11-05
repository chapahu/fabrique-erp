// =====================================================================
// COPILOTE IA : poser une question en français, l'IA répond avec les vrais chiffres de l'ERP.
//
// Fonctionnement ("tool use") :
//  1. On envoie à Claude la question + une LISTE D'OUTILS (consulter le stock, la prévision...).
//  2. Claude choisit les outils dont il a besoin ; le SDK les exécute et lui renvoie les résultats.
//  3. Claude rédige la réponse.
//
// SÉCURITÉ : chaque outil appelle NOTRE PROPRE API avec le badge (cookie) de l'utilisateur.
// L'IA a donc exactement les mêmes droits que la personne connectée : une vendeuse ne peut pas
// obtenir les chiffres financiers via le copilote. L'IA n'écrit jamais de SQL et ne modifie rien.
// =====================================================================
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { roleLabels } from "@fabrique/shared";
import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../errors";

export const copilotRouter = Router();

const MODEL = "claude-opus-5-5";
const API_BASE = `http://localhost:${process.env.API_PORT ?? 3000}/api`;

// Le client Anthropic lit la clé dans la variable d'environnement ANTHROPIC_API_KEY (.env)
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

/** Les outils du copilote, liés au badge de l'utilisateur et à un journal des outils utilisés */
function buildTools(cookie: string, used: string[]) {
  /** Appelle notre API avec le badge de l'utilisateur ; renvoie du texte (JSON) lisible par l'IA */
  async function callApi(label: string, path: string) {
    used.push(label);
    const res = await fetch(`${API_BASE}${path}`, { headers: { cookie } });
    const data = await res.json().catch(() => null);
    if (res.status === 403) return JSON.stringify({ erreur: "Le rôle de l'utilisateur ne permet pas d'accéder à cette information." });
    if (!res.ok) return JSON.stringify({ erreur: data?.error ?? `Erreur ${res.status}` });
    return JSON.stringify(data);
  }
  const qs = (params: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") p.set(k, String(v));
    return p.toString();
  };

  return [
    betaZodTool({
      name: "catalogue",
      description:
        "Liste les sites (ateliers, boutiques) et les articles (matières, emballages, produits finis) avec leurs identifiants. " +
        "À appeler d'abord quand il faut un identifiant de produit ou de boutique pour un autre outil.",
      inputSchema: z.object({}),
      run: async () => {
        const [locations, items] = await Promise.all([callApi("Catalogue", "/locations"), fetchJson(`${API_BASE}/items`, cookie)]);
        return JSON.stringify({ emplacements: JSON.parse(locations), articles: items });
      },
    }),
    betaZodTool({
      name: "stock",
      description:
        "Stock actuel par article et par emplacement, avec le seuil minimum (below_min = sous le seuil) et la prochaine date limite. " +
        "Optionnel : filtrer sur un emplacement (location_id issu de l'outil catalogue).",
      inputSchema: z.object({ location_id: z.number().int().positive().optional() }),
      run: async ({ location_id }) => callApi("Stock", `/stock?${qs({ locationId: location_id })}`),
    }),
    betaZodTool({
      name: "indicateurs_ventes",
      description:
        "Indicateurs de direction sur une période (en jours) comparée à la période précédente : chiffre d'affaires, marge, volumes, part B2B, " +
        "valeur du stock, rendement de production, classement des boutiques, rentabilité par produit, meilleurs clients B2B. " +
        "Réservé à la direction.",
      inputSchema: z.object({ jours: z.number().int().min(7).max(365).describe("Durée de la période, ex. 30") }),
      run: async ({ jours }) => {
        const raw = JSON.parse(await callApi("Indicateurs de ventes", `/analytics/overview?days=${jours}`));
        if (raw.erreur) return JSON.stringify(raw);
        // On retire les séries jour par jour, trop longues et inutiles pour répondre en texte
        const { daily: _d, monthly, ...rest } = raw;
        return JSON.stringify({ ...rest, ca_12_derniers_mois: monthly.slice(-13) });
      },
    }),
    betaZodTool({
      name: "prevision_ventes",
      description:
        "Prévision Holt-Winters des ventes. granularite 'day' = 28 prochains jours, 'month' = 12 prochains mois. " +
        "mesure 'units' (quantités) ou 'revenue' (chiffre d'affaires). Optionnel : un produit et/ou une boutique (identifiants du catalogue). " +
        "Renvoie la prévision avec sa fourchette, la fiabilité mesurée (mape = erreur moyenne en %) et les effets saisonniers.",
      inputSchema: z.object({
        granularite: z.enum(["day", "month"]),
        mesure: z.enum(["units", "revenue"]),
        produit_id: z.number().int().positive().optional(),
        boutique_id: z.number().int().positive().optional(),
      }),
      run: async (i) => {
        const raw = JSON.parse(
          await callApi("Prévisions", `/analytics/forecast?${qs({ granularity: i.granularite, metric: i.mesure, itemId: i.produit_id, locationId: i.boutique_id })}`),
        );
        if (raw.erreur || raw.error) return JSON.stringify(raw);
        const { history, ...rest } = raw;
        return JSON.stringify({ ...rest, derniers_reels: history.slice(-14).map((h: { period: string; actual: number }) => ({ period: h.period, actual: h.actual })) });
      },
    }),
    betaZodTool({
      name: "plan_production",
      description:
        "Plan de production suggéré sur un horizon (jours) : pour chaque produit, ventes prévues, stock, fournées déjà lancées, " +
        "quantité à produire, nombre de fournées, couverture en jours ; puis les besoins en matières, ce qui manque et le budget d'achat.",
      inputSchema: z.object({ jours: z.number().int().min(3).max(28).describe("Horizon, ex. 7 ou 14") }),
      run: async ({ jours }) => callApi("Plan de production", `/planning/production?days=${jours}`),
    }),
    betaZodTool({
      name: "ordres_fabrication",
      description: "Liste des ordres de fabrication (OF), optionnellement filtrés par statut : planifie, en_cours, termine, annule.",
      inputSchema: z.object({ statut: z.enum(["planifie", "en_cours", "termine", "annule"]).optional() }),
      run: async ({ statut }) => {
        const raw = JSON.parse(await callApi("Ordres de fabrication", `/production-orders?${qs({ status: statut })}`));
        return JSON.stringify(Array.isArray(raw) ? raw.slice(0, 40) : raw);
      },
    }),
    betaZodTool({
      name: "tracer_lot",
      description:
        "Traçabilité d'un lot à partir de son numéro (ou d'une partie) : origine (fournisseur ou OF), matières utilisées (amont), " +
        "produits fabriqués avec (aval) et historique des mouvements avec leur auteur.",
      inputSchema: z.object({ numero: z.string().min(2).max(50) }),
      run: async ({ numero }) => {
        const found = await fetchJson(`${API_BASE}/lots?${qs({ search: numero })}`, cookie);
        if (!Array.isArray(found) || found.length === 0) return JSON.stringify({ erreur: `Aucun lot trouvé pour « ${numero} »` });
        const exact = found.find((l: { lot_number: string }) => l.lot_number.toLowerCase() === numero.toLowerCase()) ?? found[0];
        return callApi("Traçabilité", `/lots/${exact.id}/trace`);
      },
    }),
    betaZodTool({
      name: "explorer_donnees",
      description:
        "Recherche détaillée dans une table de l'ERP, avec filtres. Tables : ventes, clients, ordres-fabrication, recettes, mouvements, " +
        "lots, articles, emplacements, fournisseurs. Filtres possibles (clé -> valeur) selon la table, par exemple pour ventes : " +
        "channel (boutique|b2b), location (id), item (id), customer (id), source (historique|erp). Dates au format AAAA-MM-JJ. " +
        "Renvoie au plus 50 lignes et le nombre total. Préférer les autres outils pour les synthèses.",
      inputSchema: z.object({
        table: z.enum(["ventes", "clients", "ordres-fabrication", "recettes", "mouvements", "lots", "articles", "emplacements", "fournisseurs"]),
        recherche: z.string().max(100).optional(),
        filtres: z.record(z.string(), z.string()).optional(),
        du: z.string().optional(),
        au: z.string().optional(),
        tri: z.string().optional(),
        ordre: z.enum(["asc", "desc"]).optional(),
      }),
      run: async (i) => {
        const params: Record<string, string | undefined> = { q: i.recherche, from: i.du, to: i.au, sort: i.tri, dir: i.ordre, pageSize: "50" };
        for (const [k, v] of Object.entries(i.filtres ?? {})) params[`f_${k}`] = v;
        return callApi(`Données : ${i.table}`, `/data/${i.table}?${qs(params)}`);
      },
    }),
  ];
}

async function fetchJson(url: string, cookie: string) {
  const res = await fetch(url, { headers: { cookie } });
  return res.json().catch(() => null);
}

// ---------------------------------------------------------------------
// POST /api/copilot : { messages: [{ role: "user" | "assistant", content: "..." }] }
// La conversation entière est renvoyée à chaque fois (l'API de Claude ne garde pas de mémoire).
// ---------------------------------------------------------------------
const body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4000) }))
    .min(1)
    .max(20)
    .refine((m) => m.at(-1)?.role === "user", "Le dernier message doit être une question"),
});

copilotRouter.get("/copilot/status", (_req, res) => {
  res.json({ enabled: client !== null, model: MODEL });
});

copilotRouter.post("/copilot", async (req, res) => {
  if (!client) {
    throw new HttpError(503, "Copilote non configuré : ajoute ta clé ANTHROPIC_API_KEY dans le fichier .env puis redémarre l'API");
  }
  const { messages } = body.parse(req.body);
  const user = req.user!;
  const used: string[] = [];
  const today = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const system = [
    "Tu es le copilote de l'ERP d'une biscuiterie (projet de démonstration, données fictives) : 2 ateliers de production",
    "(Gennevilliers, Ardin), 7 boutiques et des clients professionnels (B2B). Produits : cookies, madeleines, cakes.",
    `Tu aides ${user.name}, rôle « ${roleLabels[user.role]} ». Nous sommes le ${today}.`,
    "",
    "Règles :",
    "- Réponds en français, de façon claire et concise, pour quelqu'un de non technique.",
    "- Appuie-toi UNIQUEMENT sur les données renvoyées par les outils. N'invente jamais un chiffre.",
    "- Donne les chiffres avec leur unité (€, kg, unités, %) et la période concernée.",
    "- Si un outil répond que le rôle n'y a pas accès, explique-le simplement sans contourner.",
    "- Termine par une recommandation concrète quand c'est utile (que faire, quoi surveiller).",
    "- Mise en forme : paragraphes courts, listes à puces avec « - », gras avec **…**. Pas de tableaux.",
  ].join("\n");

  try {
    const finalMessage = await client.beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium" }, // effort de réflexion : "medium" suffit pour des questions de gestion
      // Si le modèle refuse une question par excès de prudence, la même question est reposée à un modèle de secours
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      tools: buildTools(req.headers.cookie ?? "", used),
      messages,
      max_iterations: 8,
    });

    if (finalMessage.stop_reason === "refusal") {
      return res.json({ answer: "Je ne peux pas répondre à cette demande.", tools: used, refused: true });
    }
    const answer = finalMessage.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    res.json({ answer: answer || "Je n'ai pas trouvé de réponse.", tools: [...new Set(used)], usage: finalMessage.usage });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new HttpError(503, "Clé ANTHROPIC_API_KEY invalide");
    if (error instanceof Anthropic.RateLimitError) throw new HttpError(429, "Trop de questions en même temps, réessaie dans un instant");
    if (error instanceof Anthropic.APIError) throw new HttpError(502, `Le service d'IA a répondu une erreur (${error.status})`);
    throw error;
  }
});
