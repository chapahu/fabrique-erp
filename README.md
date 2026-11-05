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
| Simulateur d'activité (données vivantes) | ⏳ |
| Authentification et rôles | ⏳ |
| Achats, réceptions, facturation, portail B2B | 🔜 |
| Copilote IA | 🔜 |

## Stack

TypeScript · Node.js / Express · React / Vite · TanStack Query · Zod · Tailwind CSS ·
PostgreSQL · Docker · Git / GitHub

## Démarrer en local

Prérequis : [Node.js LTS](https://nodejs.org) et [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
cp .env.example .env       # puis adapter le mot de passe
docker compose up -d       # démarre PostgreSQL (schéma + données de démo au 1er lancement)
```

Lancer l'API (http://localhost:3000/api) :

```bash
npm install
npm run dev:api
```

Requêtes d'exemple : [apps/api/api.http](apps/api/api.http).

Lancer l'interface (http://localhost:5173), dans un second terminal :

```bash
npm run dev:web
```

Se connecter à la base pour explorer :

```bash
docker compose exec db psql -U erp -d fabrique_erp
```

## Structure

```
apps/api/        API REST : Node.js + Express + Zod + PostgreSQL
apps/web/        Interface : React + Vite + TanStack Query + Tailwind
packages/shared/ Schémas Zod partagés entre l'API et l'interface
db/migrations/   Évolutions de la structure de la base, numérotées et immuables
db/seed.sql      Données de démo (fictives)
docker-compose.yml
LEARNING.md      Journal d'apprentissage : chaque concept expliqué simplement
```
