# Procédure de transfert de la base (Neon → AWS RDS/Aurora)

> ADR-0004 (25 novembre 2026). Outil : `tools/transfer-database.ts` (`pnpm db:transfer`). Répétée sur données de synthèse par `apps/api/test/db/transfer-database.db.test.ts` à chaque régression.

## Principe

Copie complète et cohérente (`pg_dump --format=custom --serializable-deferrable`). Les données sont chargées **avant** les déclencheurs et contraintes (section post-data de `pg_dump`) : nos protections (ajout seul, horodatages posés par la base, quotas) ne réécrivent ni ne refusent rien au chargement, puis sont recréées à l'identique, y compris `ENABLE ALWAYS`. La restauration se fait en **une seule transaction**, droits **conservés** (jamais `--no-privileges`).

## Étapes

1. **Préparer la cible** : base AWS vide, PostgreSQL de même version majeure ou supérieure ; rôle propriétaire avec `CREATEROLE` (les rôles applicatifs `NOLOGIN` sont créés par l'outil s'ils manquent) ; réseau ouvert de la machine de transfert vers les deux bases ; binaires PostgreSQL ≥ version source.
2. **Fenêtre de maintenance** : arrêter l'API et les travailleurs (aucune écriture pendant la copie) ; annoncer l'interruption.
3. **Transférer et vérifier** :
   `TRANSFER_SOURCE_URL=… TRANSFER_TARGET_URL=… [TRANSFER_PG_BIN=…] pnpm db:transfer`
   Code 0 : `VERIFIED` (contenu de chaque table, déclencheurs et leur état, droits des rôles applicatifs identiques ; grand livre équilibré et sans trou). Code 1 : `MISMATCH` (liste des écarts, sans aucune donnée de ligne) — **ne pas basculer**. Code 2 : erreur (cible non vide, outil absent…).
4. **Vérificateur indépendant** : exporter le grand livre de la cible et lancer `pnpm verify:ledger` avec la clé publique hors bande.
5. **Basculer** : changer `DATABASE_URL` de l'API vers la cible ; redémarrer ; contrôles de santé ; garder la source en lecture seule 35 jours (retour arrière).
6. **Consigner** : rapport JSON, empreinte, heure, opérateurs (deux personnes) dans le journal d'exploitation.

## Points d'attention

- Les identifiants de connexion ne sont jamais écrits dans le dépôt ni dans les journaux.
- Neon ne donne pas de superutilisateur : la chaîne complète des migrations a été vérifiée sous un rôle sans superutilisateur (CREATEROLE, CREATEDB).
- Réplication logique (bascule sans fenêtre) : possible depuis Neon, mais **les déclencheurs `ENABLE ALWAYS` s'exécutent aussi pendant l'application de la réplication** et réécriraient les horodatages ; à n'envisager qu'avec une procédure dédiée et répétée.
