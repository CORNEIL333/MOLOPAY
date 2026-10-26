# Molopay — plateforme d’achat planifié

Monorepo de la plateforme (API cœur NestJS, vérificateur indépendant, paquets
partagés). Les règles de travail, les invariants et les commandes contractuelles
sont définis dans [`AGENTS.md`](AGENTS.md) — à lire avant toute contribution.

## Prérequis

- Node.js 24 et pnpm (dépendances épinglées : `pnpm install --frozen-lockfile`)
- PostgreSQL 16+ pour les tests d’intégration, soit via **Docker**
  (Testcontainers), soit via une **base existante** (voir ci-dessous)

## Commandes

Les commandes contractuelles sont listées dans `AGENTS.md` § 5 :

```sh
pnpm lint        # lint + frontières de modules
pnpm typecheck   # types stricts
pnpm test        # unitaires + propriétés
pnpm test:db     # intégration PostgreSQL
pnpm test:attack # suites d’attaque
```

## Tests d’intégration PostgreSQL (`pnpm test:db`)

`pnpm test:db` exécute les suites `apps/api/test/db/*.db.test.ts`. Elles
**détruisent et recréent les schémas applicatifs** de la base ciblée à chaque
exécution. Ne les pointez jamais vers une base contenant des données à conserver.

### Option 1 — Docker (par défaut)

Sans variable `DATABASE_URL`, le harnais démarre un conteneur PostgreSQL 16.15
épinglé par digest (`apps/api/test/db/harness.ts`) via Testcontainers, puis
l’arrête en fin de suite. Docker doit être joignable ; sinon la commande
s’arrête avec `DOCKER_UNAVAILABLE` et **aucun test base n’a été exécuté**.

### Option 2 — base PostgreSQL existante

Fournissez `DATABASE_URL` pour réutiliser une base déjà démarrée (Docker lancé
à la main, service local, etc.) :

```sh
DATABASE_URL='postgresql://app_test:motdepasse_local@localhost:5432/achat_test' pnpm test:db
```

Règles de sécurité du harnais :

- l’URL doit être PostgreSQL (`postgres:` ou `postgresql:`) ;
- l’hôte doit être local (`localhost`, `127.0.0.1`, `::1`) ;
- une base distante est refusée (`TEST_DB_REMOTE_FORBIDDEN`) sauf confirmation
  explicite qu’elle est jetable via `ALLOW_REMOTE_TEST_DB=1` ;
- `pnpm test:db` ne démarre alors aucun conteneur et ne libère pas la base.

Aucun identifiant réel ne doit figurer dans le dépôt : passez `DATABASE_URL`
par l’environnement du shell ou un fichier local non versionné.

## Vérificateur indépendant

Le vérificateur Rust vit dans `tools/verifier` ; voir son
[`README.md`](tools/verifier/README.md).
