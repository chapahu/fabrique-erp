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

---

## Jour 1 (suite) — L'interface web

### Front-end et back-end
- **Back-end** (l'API) : tourne sur le serveur, détient les règles et la base.
- **Front-end** (l'interface) : tourne dans le **navigateur** de l'utilisateur, affiche et envoie des requêtes à l'API.
Ce sont deux programmes séparés qui communiquent en HTTP/JSON. On peut donc un jour ajouter une appli mobile
ou une caisse qui utilisent la même API.

### React : l'interface en composants
L'écran est découpé en **composants** (des fonctions qui renvoient du HTML) : `Card`, `Badge`, `Table`, des pages...
On les réutilise partout ([apps/web/src/ui.tsx](apps/web/src/ui.tsx)), donc l'ERP a un aspect cohérent et le code n'est pas répété.
- **JSX** : du HTML écrit directement dans le TypeScript (`<Card title="Stock">...</Card>`).
- **props** : les paramètres d'un composant (`title`).
- **state** (`useState`) : une donnée qui appartient à l'écran (le site sélectionné, le contenu d'un formulaire).
  Quand elle change, React redessine automatiquement ce qui en dépend.

### Vite : l'outil de développement
Il sert l'appli en local (http://localhost:5173), recharge instantanément à chaque modification,
et fabrique la version optimisée pour la production (`npm run build`).
Son **proxy** transmet les appels `/api` à l'API (port 3000) : pour le navigateur, c'est un seul site.

### TanStack Query : les données du serveur
C'est la brique la plus utile du front d'un ERP. Pour chaque donnée (`useStock`, `useProductionOrders`...), elle gère :
- le **chargement** et les **erreurs** (`isPending`, `isError`) ;
- le **cache** : deux pages qui affichent le stock partagent la même donnée (même `queryKey`) ;
- le **rafraîchissement automatique** toutes les 5 s : quand l'atelier clôture un OF, le tableau de bord se met à jour
  tout seul. C'est ce qui rendra les données « vivantes » avec le simulateur ;
- l'**invalidation** après une écriture (`useMutation` + `invalidateQueries`) : après une réception, le stock est rechargé.
Tous les appels sont regroupés dans [apps/web/src/api.ts](apps/web/src/api.ts) : les pages n'appellent jamais `fetch` elles-mêmes.

### Tailwind CSS : le style par classes
Au lieu d'écrire un fichier CSS à part, on compose des classes utilitaires directement dans le HTML :
`rounded-xl border bg-white p-5 shadow-sm` = coins arrondis, bordure, fond blanc, marge intérieure, ombre.
On avance vite, et le style reste cohérent (mêmes espacements et mêmes couleurs partout).

### React Router : plusieurs pages, une seule appli
`/`, `/stock`, `/production`, `/receptions`, `/tracabilite` : l'appli change de page sans recharger le navigateur.
Le lot tracé est dans l'URL (`/tracabilite?lot=9`) : on peut **partager le lien** avec la qualité.

### Paquet partagé : une seule source de vérité
[packages/shared](packages/shared/src/index.ts) contient les schémas Zod utilisés **des deux côtés** :
- dans le formulaire : message immédiat (« Recette requis ») sans attendre le serveur → confort ;
- dans l'API : revérification systématique, car un client peut être contourné → **sécurité**.
Une règle (ex. « quantité > 0 ») ne s'écrit qu'une fois, donc le front et le back ne peuvent pas diverger.

### Ce que j'ai vérifié dans le navigateur
Formulaire vide → erreurs par champ · OF planifié → besoins affichés face au stock disponible ·
clôture → stocks mis à jour à l'écran · traçabilité amont du lot de cookies jusqu'aux 6 lots de matières.
Défaut repéré et corrigé : après clôture, une matière devenue « insuffisante » s'affichait en rouge alors que l'OF était déjà terminé.

---

## Le simulateur : faire vivre l'ERP tout seul

### L'idée en une phrase
Un **faux employé automatique** : un petit programme qui, toutes les 4 secondes, fait une action réaliste
dans l'ERP. Pour une démo, l'ERP a l'air d'être utilisé par une vraie biscuiterie.

### Ce qu'il fait
| Icône | Action | Qui le ferait en vrai |
|---|---|---|
| 🚚 | Livrer une matière qui passe sous son seuil | Le responsable des achats |
| 📝 ▶️ 🍪 | Planifier, démarrer, terminer une fournée | Le chef d'atelier |
| 📦 | Envoyer des cookies de l'atelier vers une boutique | Le logisticien |
| 🛍️ | Vendre 1 à 12 cookies en boutique | Un client |

### Pourquoi il passe par le serveur (l'API)
Il aurait pu écrire directement dans la réserve (la base de données), mais il passe **par le guichet**,
exactement comme l'interface. Résultat : toutes les règles s'appliquent à lui aussi.
Il ne peut pas vendre un cookie qui n'existe pas, ni fabriquer sans farine. Quand l'API refuse, il l'affiche (⛔)
et réessaie plus tard. C'est aussi un **test permanent** de l'API : s'il y avait un bug, il le trouverait vite.

### Les deux nouvelles demandes ajoutées au serveur
- **Transfert** (`/api/transfers`) : des cookies quittent l'atelier et arrivent en boutique.
  Le **numéro de lot voyage avec la marchandise** : on sait quel lot est dans quelle boutique.
- **Vente** (`/api/sales`) : un client achète en boutique. Interdit ailleurs qu'en boutique.
Les deux prennent d'abord les lots qui périment le plus tôt (FEFO). Ce code est écrit **une seule fois**
([apps/api/src/stock-ops.ts](apps/api/src/stock-ops.ts)) et réutilisé : moins de code, moins de bugs.

### Le fil d'activité
Sur le tableau de bord, la carte « Activité en direct » montre les derniers mouvements (rafraîchie toutes les 2 s).
C'est l'écran parfait pour une démo : on voit la biscuiterie travailler.

### Comment le lancer
Trois programmes tournent en même temps, chacun dans son propre terminal :
```
npm run dev:api     ← le serveur
npm run dev:web     ← l'interface
npm run simulate    ← le faux employé (Ctrl+C pour l'arrêter)
```

### Erreur rencontrée
J'avais appelé un type `Location`. Or ce nom existe déjà dans les outils du navigateur que TypeScript charge par défaut.
Comme le simulateur ne tourne pas dans un navigateur, on a retiré ces outils de sa configuration (`"lib": ["ES2023"]`).
Leçon : TypeScript sert justement à attraper ce genre de confusion **avant** de lancer le programme.

---

## Connexion et rôles : qui es-tu, et as-tu le droit ?

### L'image : des badges d'accès
1. **Se connecter** = donner son e-mail et son mot de passe à l'accueil.
2. Le serveur remet un **badge temporaire** (valable 8 h). Le navigateur le garde dans un **cookie**
   (un petit fichier que le navigateur renvoie automatiquement au serveur à chaque demande).
3. À chaque demande, le serveur regarde le badge : **qui est-ce ?** (authentification)
   puis **son métier lui permet-il cette action ?** (autorisation).

Deux réponses de refus différentes :
- **401** = « je ne sais pas qui tu es » (pas de badge, ou badge expiré) → page de connexion ;
- **403** = « je sais qui tu es, mais tu n'as pas le droit » (une vendeuse qui veut fabriquer).

### Les rôles
| Rôle | Réceptionner | Fabriquer | Envoyer en boutique | Vendre |
|---|---|---|---|---|
| Direction | ✅ | ✅ | ✅ | ✅ |
| Atelier | ✅ | ✅ | ✅ | ❌ |
| Achats | ✅ | ❌ | ❌ | ❌ |
| Boutique | ❌ | ❌ | ❌ | ✅ **dans sa boutique seulement** |
Tout le monde peut **consulter**. Ce tableau est écrit **une seule fois** dans [packages/shared](packages/shared/src/index.ts).

### Cacher le bouton ≠ interdire l'action
- L'interface **cache** les boutons interdits : c'est du **confort**, pour ne pas proposer quelque chose d'impossible.
- Le serveur **refuse** les actions interdites : c'est la **sécurité**. Quelqu'un de malin peut toujours
  envoyer une demande sans passer par les boutons. Si seul le bouton était caché, il pourrait quand même agir.
On a testé chaque rôle directement contre le serveur, sans l'interface : tous les refus fonctionnent.

### Les mots de passe ne sont jamais stockés
On garde seulement une **empreinte** (hash), calculée avec un algorithme volontairement lent (`scrypt`).
Avec l'empreinte, on peut vérifier un mot de passe, mais pas le retrouver. Si la base était volée,
les mots de passe resteraient secrets. Même chose pour les badges : la base ne garde que leur empreinte.
Petit détail de sécurité : on répond « e-mail ou mot de passe incorrect » sans dire lequel des deux,
pour ne pas aider quelqu'un qui chercherait quels e-mails existent.

### Qui a fait quoi (piste d'audit)
Chaque mouvement de stock garde maintenant son **auteur**. On le voit dans le fil d'activité
(« par Léa ») et dans l'historique de traçabilité. Indispensable dans une entreprise :
en cas d'erreur, on sait à qui demander.

### Les migrations, en vrai
Pour ajouter les utilisateurs, il fallait **ajouter des tables à une base qui contient déjà des données**.
On ne recrée pas tout : on écrit un nouveau fichier, [002_users.sql](db/migrations/002_users.sql),
et l'**outil de migrations** (`npm run db:migrate`) :
- regarde dans la table `schema_migrations` lesquelles sont déjà faites ;
- applique uniquement les nouvelles, dans l'ordre, chacune en « tout ou rien » ;
- ne fait rien si on le relance (testé : « Base déjà à jour »).
C'est exactement ainsi qu'on fera évoluer la base en ligne, sans perdre les données de la biscuiterie.

### Les comptes de démo
`npm run db:seed` crée un compte par rôle (direction, atelier, achats, marais, lyon, simulateur).
Leur mot de passe est la valeur `DEMO_PASSWORD` du fichier `.env`. Le simulateur se connecte avec son propre compte.

### Le mode démo : choisir son rôle en un clic
Pour tester, taper un e-mail et un mot de passe à chaque fois est pénible. Avec `DEMO_MODE=true` dans `.env`,
la page de connexion affiche **une carte par rôle**. On clique, et on est connecté. « ↩ Changer de rôle » ramène aux cartes.
- C'est un **interrupteur** : éteint (`false`), les cartes disparaissent et le serveur répond 404 à cette porte.
  La vraie connexion par mot de passe reste disponible (repliée sous les cartes).
- On n'allume ce mode **qu'avec des données fictives**. Dans une vraie entreprise, il serait éteint.
- Le serveur ne lit `.env` **qu'au démarrage** : après l'avoir modifié, il faut le relancer.

### Bug rencontré : l'écran ne changeait pas après la connexion
Le serveur répondait « connecté » (200 OK), mais l'écran restait sur la page de connexion.
Cause : après la connexion, on vidait **toute** la mémoire des données (`clear()`), y compris la fiche « qui suis-je ? »
à laquelle l'écran était abonné. L'écran restait branché sur l'ancienne fiche, qui disait « pas connecté ».
Correction : on vide tout **sauf** cette fiche, et on la met à jour. Leçon : on a trouvé le problème en regardant
les **requêtes réseau** (le serveur disait OK) : le souci était donc côté interface, pas côté serveur.
