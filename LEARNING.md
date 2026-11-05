# Journal d'apprentissage

Chaque concept rencontré en construisant l'ERP, expliqué simplement, avec le lien vers le code.

---

## Jour 1 — Les fondations

### Qu'est-ce qu'un ERP ?
*Enterprise Resource Planning* : **un seul logiciel et une seule base de données** pour toute
l'entreprise (achats, stock, production, ventes, facturation...). Sans ERP, chaque service a son
fichier Excel et les chiffres ne concordent jamais. Avec un ERP, quand l'atelier consomme 14 kg de
farine, le stock, les achats et la compta voient la même information au même moment.

### Git et GitHub
- **Git** : enregistre l'historique de chaque modification du code (un *commit* = une photo du projet).
  On peut revenir en arrière, comprendre qui a changé quoi et pourquoi.
- **GitHub** : héberge ce dépôt Git en ligne. Ça sert de sauvegarde, de collaboration et de vitrine.
- **`.gitignore`** : la liste de ce qui ne doit jamais être versionné (`node_modules`, et surtout `.env`).

#### Le commit, concrètement
Un **commit** = un **point de sauvegarde** du projet, comme une sauvegarde de jeu vidéo,
accompagné d'un message qui explique ce qui a changé et pourquoi.

Le cycle en 3 temps :
1. **Modifier** des fichiers (Git voit qu'ils ont changé : `git status`).
2. **Préparer** (`git add`) : choisir quels changements iront dans la prochaine sauvegarde.
   C'est la *staging area*, comme mettre des objets dans un carton avant de le fermer.
3. **Enregistrer** (`git commit -m "message"`) : fermer le carton, l'étiqueter et le ranger dans l'historique.

Pourquoi c'est vital dans un ERP utilisé par une usine :
- si une modification casse quelque chose, on revient au commit précédent en une commande ;
- `git log` montre qui a changé quoi, quand et pourquoi (indispensable pour reprendre le code de quelqu'un) ;
- un commit = un changement cohérent et petit, ce qui le rend facile à relire (*code review*).

Chaque commit porte un **auteur** (nom + e-mail, réglés une fois avec `git config`).
On utilise l'e-mail anonyme fourni par GitHub (`…@users.noreply.github.com`) pour ne pas exposer son vrai e-mail sur un dépôt public.

**Commit ≠ envoi sur GitHub** : le commit reste sur ton PC. C'est `git push` qui l'envoie sur GitHub.

#### `.gitattributes` et fins de ligne
Windows et Linux ne marquent pas la fin d'une ligne de la même façon (CRLF contre LF).
Nos fichiers sont lus par des conteneurs Linux, donc on impose LF partout pour éviter des bugs invisibles.

### Variables d'environnement (`.env`)
La configuration qui change selon l'endroit où tourne l'appli (local / production) et les **secrets**
(mots de passe, clés d'API) ne sont jamais écrits dans le code. Ils sont mis dans `.env`, qui n'est pas versionné.
`.env.example` documente les variables attendues, sans les vraies valeurs.

### Docker
Un **conteneur** est une boîte isolée qui contient un logiciel et tout ce dont il a besoin.
`docker compose up -d` démarre PostgreSQL à l'identique sur n'importe quelle machine, y compris
le futur serveur de production. Fini le « ça marche sur mon PC ».
- **Image** : le modèle (`postgres:17`). **Conteneur** : une instance qui tourne.
- **Volume** : un espace disque qui survit au conteneur. Sans lui, on perd les données en supprimant le conteneur.

### Base de données relationnelle (PostgreSQL)
Les données sont rangées en **tables** (lignes × colonnes) reliées entre elles.
- **Clé primaire** (`id`) : identifiant unique de chaque ligne.
- **Clé étrangère** (`REFERENCES`) : lien vers une autre table. La base **refuse** un mouvement de stock
  pointant vers un lot qui n'existe pas. C'est l'intégrité référentielle.
- **Contraintes** (`NOT NULL`, `UNIQUE`, `CHECK`) : les règles métier sont garanties par la base elle-même,
  même si le code a un bug.
- **Index** : comme l'index d'un livre, il accélère les recherches sur une colonne.
- **Vue** (`v_stock`) : une requête enregistrée qu'on interroge comme une table.

Voir [db/migrations/001_init.sql](db/migrations/001_init.sql).

### Migrations vs seed
- **Migration** : un fichier qui change la **structure** (créer une table, ajouter une colonne).
  Numérotées, appliquées dans l'ordre, **jamais modifiées une fois appliquées**. On en ajoute une nouvelle.
  C'est ce qui permet de faire évoluer un ERP en production sans perdre de données.
- **Seed** : des **données** de démo pour travailler en local. Jamais lancé en production.

### Choix de modélisation : le stock comme « grand livre »
On ne stocke pas « farine = 500 kg » dans une colonne qu'on écrase. On enregistre chaque
**mouvement** (+500 réception, −14 consommation OF-42...). Le stock = la somme des mouvements.
Ce choix donne un historique complet et une traçabilité gratuite, et permet de recalculer
le stock à n'importe quelle date. C'est le même principe qu'un relevé bancaire.

### Lots et traçabilité
Chaque arrivage et chaque production reçoit un **numéro de lot**. En agroalimentaire, c'est obligatoire.
Si un fournisseur signale un lot de beurre contaminé, il faut retrouver en quelques minutes :
- **Traçabilité descendante** : lot de beurre → OF qui l'ont consommé → lots de cookies produits → boutiques et clients livrés.
- **Traçabilité ascendante** : lot de cookies → OF → lots de matières utilisés.

Dans notre schéma, le lien passe par `stock_movements.production_order_id` (consommations) et
`lots.production_order_id` (lot produit).

### Recette / nomenclature (BOM)
*Bill of Materials* : la liste des composants et quantités pour fabriquer un produit.
« 500 cookies = 14 kg farine + 10 kg beurre + ... ». Un **ordre de fabrication (OF)** dit :
« produire 1 000 cookies avec la recette v1 à Gennevilliers le 12/11 ». L'ERP en déduit les besoins en matières.

---

## Jour 1 (suite) — L'API

### C'est quoi une API ?
Le **serveur** de l'ERP, le « guichet » entre l'interface et la base de données.
L'interface (ou une caisse, ou un autre logiciel) envoie une **requête HTTP** ; l'API vérifie,
applique les règles métier, interroge la base et renvoie une **réponse en JSON**.
On ne laisse jamais l'interface parler directement à la base : l'API est le seul point de contrôle.

### REST : une URL = une ressource, un verbe = une action
| Verbe | Sens | Exemple |
|---|---|---|
| `GET` | lire | `GET /api/stock?locationId=1` |
| `POST` | créer / déclencher | `POST /api/receptions`, `POST /api/production-orders/1/complete` |
| `PUT`/`PATCH` | modifier | (à venir) |
| `DELETE` | supprimer | (rare dans un ERP : on annule plutôt qu'on efface) |

**Codes de réponse** : `200` OK · `201` créé · `400` données invalides · `404` introuvable ·
`409` conflit métier (stock insuffisant, lot déjà existant) · `500` bug serveur.

### Node.js, npm, workspaces
- **Node.js** exécute du JavaScript hors du navigateur. **npm** installe les bibliothèques (`package.json` les liste).
- **dependencies** = nécessaires pour faire tourner l'appli (express, pg, zod) ;
  **devDependencies** = seulement pour développer (typescript, tsx).
- **Workspaces** : un seul dépôt contient plusieurs applis (`apps/api`, bientôt `apps/web`). C'est un *monorepo*.

### TypeScript
Du JavaScript avec des **types** : on déclare qu'une quantité est un `number`, et l'éditeur
signale l'erreur *avant* l'exécution si on y met du texte. `npm run typecheck` vérifie tout le projet.
`tsx` exécute directement le TypeScript et redémarre l'API à chaque modification (`watch`).

### Express : routes, middlewares, gestion d'erreurs
- Une **route** = une URL + un verbe + une fonction. Voir [apps/api/src/routes](apps/api/src/routes).
- Un **middleware** = une étape par laquelle passe chaque requête (`express.json()` lit le corps JSON).
- Un **gestionnaire d'erreurs central** ([errors.ts](apps/api/src/errors.ts)) transforme chaque erreur en réponse
  propre, au lieu de répéter des `try/catch` partout.

### Zod : ne jamais faire confiance à ce qui arrive
Un **schéma** décrit la forme exacte attendue (`quantity` doit être un nombre > 0...).
Tout ce qui ne correspond pas est refusé avec un message précis par champ.
Une quantité négative ou du texte à la place d'un nombre ne doit jamais atteindre la base.

### Requêtes paramétrées et injection SQL
On écrit `WHERE id = $1` et on passe la valeur à part. **Jamais** `"WHERE id = " + saisie`,
sinon un utilisateur malveillant peut injecter du SQL (`1; DROP TABLE lots`). C'est la faille n°1 des applis web.

### Transactions : tout ou rien
Clôturer un OF = 6 consommations + 1 lot + 1 entrée de stock + 1 changement de statut.
Si une matière manque au milieu, il ne faut **rien** garder. `BEGIN ... COMMIT` / `ROLLBACK`
garantit que la base n'est jamais dans un état à moitié fait. Voir `withTransaction` dans [db.ts](apps/api/src/db.ts).

### Verrous et concurrence
Deux chefs d'atelier cliquent « clôturer » en même temps : sans précaution, le même stock serait consommé deux fois.
`SELECT ... FOR UPDATE` verrouille l'OF ; `pg_advisory_xact_lock` verrouille le stock du site le temps de la transaction.

### FEFO (First Expired, First Out)
On consomme d'abord les lots qui **périment le plus tôt**, pour limiter le gaspillage.
C'est la règle standard en agroalimentaire (≠ FIFO, premier entré premier sorti).

### Bug classique rencontré : les fuseaux horaires
Une date « 2026-11-06 » ressortait « 2026-11-05T23:00Z » : la bibliothèque la convertissait à minuit
heure de Paris, puis l'affichait en UTC. Correction : garder les colonnes `DATE` en texte.
Leçon : une **date** (jour du calendrier) et un **instant** (horodatage) sont deux choses différentes.

### Tester l'API
[apps/api/api.http](apps/api/api.http) : des requêtes prêtes à envoyer depuis VS Code (extension REST Client).
Scénario validé : données invalides → 400 · OF sans stock → 409 avec la liste des manquants ·
réceptions → OF clôturé → stock à jour → traçabilité amont et aval du lot de beurre.
