# Fabrique ERP — mini ERP pour une biscuiterie

Projet d'apprentissage : un ERP sur mesure pour une entreprise de fabrication de cookies
(2 sites de production, boutiques en propre, clients B2B), construit avec **Claude Code**
et la stack d'un vrai ERP métier.

## Périmètre

| Module | Statut |
|---|---|
| Sites, articles, fournisseurs | ✅ schéma |
| Lots et traçabilité amont/aval | ✅ schéma |
| Stock multi-sites (grand livre des mouvements) | ✅ schéma |
| Recettes (nomenclatures) et ordres de fabrication | ✅ schéma |
| API REST (stock, réceptions, OF avec consommation FEFO, traçabilité) | ✅ |
| Interface web (tableau de bord, stock, production, réceptions, traçabilité) | ✅ |
| Simulateur d'activité : livraisons, production, transferts, ventes boutiques | ✅ |
| Connexion, rôles (direction, atelier, achats, boutique) et auteur de chaque mouvement | ✅ |
| Migrations versionnées (`npm run db:migrate`) | ✅ |
| Vue direction : CA, marges, boutiques, produits, clients B2B | ✅ |
| Prévisions des ventes (Holt-Winters, backtest, fourchette) | ✅ |
| Planification : plan de production suggéré et besoins matières (CBN) | ✅ |
| Reprise de 3 ans d'historique de ventes (`npm run db:history`) | ✅ |
| Caisse, commandes et factures B2B, bons de commande fournisseurs | 🔜 |
| R&D, qualité, portail client B2B, administration | 🔜 |
| Copilote IA | 🔜 |

## Stack

TypeScript · Node.js / Express · React / Vite · TanStack Query · Zod · Tailwind CSS · Recharts ·
PostgreSQL · Docker · Git / GitHub

## Démarrer en local

Prérequis : [Node.js LTS](https://nodejs.org) et [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
cp .env.example .env       # puis adapter le mot de passe de la base
npm install
npm run setup              # PostgreSQL + migrations + données et comptes de démo + 3 ans d'historique
```

Lancer l'API (http://localhost:3000/api) :

```bash
npm run dev:api
```

Requêtes d'exemple : [apps/api/api.http](apps/api/api.http).

Lancer l'interface (http://localhost:5173), dans un second terminal :

```bash
npm run dev:web
```

Se connecter : avec `DEMO_MODE=true` (dans `.env`), il suffit de **cliquer sur un rôle**
(Direction, Atelier, Achats, Boutique Marais, Boutique Lyon). Sinon, connexion classique avec un compte de démo
(`direction@`, `atelier@`, `achats@`, `marais@`, `lyon@fabrique.test`) et le mot de passe `DEMO_PASSWORD` du `.env`.

Faire vivre l'ERP (dans un troisième terminal) :

```bash
npm run simulate
```

Lancer les tests automatiques :

```bash
npm test
```

Se connecter à la base pour explorer :

```bash
docker compose exec db psql -U erp -d fabrique_erp
```

## Structure

```
apps/api/        API REST : Node.js + Express + Zod + PostgreSQL
apps/web/        Interface : React + Vite + TanStack Query + Tailwind
apps/simulator/  Faux employé qui génère de l'activité via l'API
packages/shared/ Schémas Zod partagés entre l'API et l'interface
db/migrations/   Évolutions de la structure de la base, numérotées et immuables
db/seed.sql      Données de démo (fictives)
docker-compose.yml
LEARNING.md      Journal d'apprentissage : chaque concept expliqué simplement
```
