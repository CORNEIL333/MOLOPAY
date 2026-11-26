# Procédure — mise en place de la base Neon (MVP, ADR-0004)

> Lots N1–N5. Chaque étape cite la commande du dépôt qui la réalise ou la vérifie. Aucune étape ne demande d'écrire un secret dans un fichier, un ticket ou un message : les mots de passe sont saisis directement dans l'outil qui les utilise (console Neon, `\password` de psql, gestionnaire de secrets des serveurs AWS).
>
> **Préalables non techniques, bloquants pour des données réelles :** contrat de sous-traitance (DPA) de Neon signé ; autorisation de transfert hors du Cameroun (loi 2024/017, juriste/DPO). Tant qu'ils manquent, la base ne reçoit que des données synthétiques (ADR-0004).
>
> Points marqués **(à vérifier)** : comportement de Neon décrit d'après sa documentation, à confirmer à la création du projet.

## 1. Création du projet (fondateur ou opérateur habilité)

1. Offre payante, calcul **toujours actif** (pas de mise en veille).
2. Région **AWS Europe (Frankfurt) — `aws-eu-central-1`** : définitive à la création.
3. Version de PostgreSQL : **16** (celle de nos tests). Toute autre version exige d'abord de rejouer `pnpm test:db` sur cette version.
4. Branche principale protégée ; restauration à un instant donné activée, avec la plus longue rétention que permet l'offre.
5. Si l'offre le permet, restreindre les adresses IP autorisées aux serveurs AWS Francfort **(à vérifier)**.
6. Noter le rôle propriétaire créé par Neon. Il n'est pas superutilisateur, mais a `CREATEROLE` et `CREATEDB`. Il sert **uniquement** aux migrations et aux comptes, jamais à l'API.

## 2. Adresse de connexion (N2)

Toujours de la forme :

```
postgresql://<rôle>@<point d'accès>.eu-central-1.aws.neon.tech/<base>?sslmode=verify-full
```

(`&channel_binding=require` est accepté). L'API, `db:migrate`, `db:roles`, `db:transfer` et le contrôle nocturne **refusent** toute autre forme (`DATABASE_TLS_REQUIRED`) : chiffrement et certificat vérifiés, nom d'hôte compris. Ne jamais ajouter `sslrootcert`, `sslaccept` ni `uselibpqcompat`.

Le mot de passe n'est jamais écrit dans l'adresse d'un fichier versionné. Il est fourni par le gestionnaire de secrets de l'environnement d'exécution (`PGPASSWORD` ou adresse complète injectée).

## 3. Schéma (N1)

Avec l'adresse du **propriétaire** dans `MIGRATION_DATABASE_URL` :

1. `pnpm db:migrate --dry-run` : liste les migrations à appliquer. Une base neuve doit les annoncer toutes, de `0001` à la dernière.
2. `pnpm db:migrate` : applique et inscrit chaque migration (empreinte SHA-256) dans `ops.schema_migration`.
3. Relancer `pnpm db:migrate --dry-run`, qui doit répondre `UP_TO_DATE`.

Codes de refus :

| Code | Signification | Que faire |
|---|---|---|
| `MIGRATION_CHECKSUM_MISMATCH` | Une migration déjà appliquée a été modifiée dans le dépôt | Ne jamais forcer : remettre le fichier d'origine et écrire une nouvelle migration |
| `MIGRATION_UNKNOWN_APPLIED` | Une migration appliquée a disparu ou a été renommée | Idem |
| `MIGRATION_BASELINE_REQUIRED` | La base contient déjà nos schémas sans historique | S'arrêter et escalader |
| `MIGRATION_FAILED` | La migration a été annulée entièrement, rien n'en reste | Corriger par une nouvelle migration |

## 4. Comptes de connexion (N3)

1. Exécuter le plan en tant que propriétaire, sans mot de passe :

   ```
   pnpm -s db:roles plan | psql "$MIGRATION_DATABASE_URL"
   ```

   Le plan crée un compte par composant, membre de son seul rôle fonctionnel, **sans héritage** (rejouable) :

   | Compte | Rôles |
   |---|---|
   | `molopay_api` | `app_ro`, `app_rw` |
   | `molopay_notifier` | `notification_worker` |
   | `molopay_monitor` | `notification_observer` |
   | `molopay_nightly` | `integrity_reporter` |
   | `molopay_kyc_import` | `kyc_list_importer` |

2. Dans `psql`, connecté en propriétaire, saisir chaque mot de passe de façon interactive (`\password molopay_api`, etc.), puis le ranger directement dans le gestionnaire de secrets de l'environnement concerné.
3. Ne **pas** créer ces comptes depuis la console ou l'API de Neon. D'après la documentation de Neon, un rôle créé ainsi devient membre de `neon_superuser` **(à vérifier)**, ce qui est trop large. Le contrôle ci-dessous le signalerait (« appartenance en trop »).
4. `ROLES_DATABASE_URL=<adresse du propriétaire> pnpm db:roles check` doit répondre `{"status":"OK","violations":[]}`. Tout écart arrête la mise en service : attribut puissant, héritage, appartenance en trop ou manquante, droit direct, objet possédé.
5. Configuration de l'API :
   - `DATABASE_URL` : adresse de `molopay_api` ;
   - `DATABASE_ROLE=app_rw` : l'API prend ses rôles transaction par transaction ; sans ce réglage, le compte n'a aucun droit ;
   - `NODE_ENV=production`.

## 5. Sauvegardes (N4, en cours)

- Restauration à un instant donné : celle de Neon (étape 1.4).
- Notre propre copie quotidienne, chiffrée par nos clés (AWS KMS), dans une seconde région AWS : outil à venir (lot N4). C'est aussi la porte de sortie.

## 6. Contrôles réguliers

- `pnpm db:roles check` après tout changement de comptes, et au moins chaque mois.
- `pnpm db:migrate --dry-run` avant chaque déploiement.
- Contrôle nocturne (`pnpm verify:nightly`) avec `molopay_nightly`.

## 7. Bascule future vers AWS (RDS/Aurora)

Voir `PROCEDURE_TRANSFERT_BASE.md` (`pnpm db:transfer`). L'historique `ops.schema_migration` est transféré avec le reste. Après la bascule, `pnpm db:migrate --dry-run` doit répondre `UP_TO_DATE` sur la cible.
