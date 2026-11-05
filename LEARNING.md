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
