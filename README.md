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

## PostgreSQL local jetable sans Docker

Avec les binaires officiels PostgreSQL installés, lancer :

```powershell
node node_modules/tsx/dist/cli.mjs tools/local-postgres.ts db
```

Équivalent lorsque pnpm fonctionne : `pnpm test:db:local`.
Le script utilise par défaut `C:/Program Files/PostgreSQL/16/bin` ; définir
`POSTGRES_BIN` pour une autre installation officielle. Il crée une nouvelle
grappe dans le dossier temporaire, choisit un port disponible sur `127.0.0.1`,
crée `molopay_test`, exécute les tests puis arrête le serveur, même en cas
d'échec. L'authentification `trust` est réservée à cette grappe de test locale :
ne pas lancer cet outil sur une machine partagée avec des utilisateurs non fiables.
Les paramètres PostgreSQL et l'URL de connexion hérités ne sont pas réutilisés.
Le dossier temporaire est conservé pour diagnostic ; son chemin est affiché.
Le code de sortie des tests est propagé. Aucun service PostgreSQL existant
n'est utilisé et aucun téléchargement n'est effectué par ce script.

Le mode `ci` remplace `db` pour lancer la CI locale existante dans cette grappe.
Il conserve toutes ses étapes, y compris la SCA qui exige un pnpm opérationnel.

## Diagnostic local de la file de notifications

Sur une grappe **jetable locale déjà démarrée**, base `molopay_test`, migrations
0018 à 0021 appliquées et politique de consommation explicitement configurée :

```powershell
pnpm notifications:check --max-pending 0 --max-deferred-reminders 0
```

Ces zéros illustrent un diagnostic strict de test ; ce ne sont pas des seuils
opérationnels recommandés. Les deux seuils sont obligatoires, sans valeur par
défaut. Le dépassement est strict ; toute tentative épuisée est signalée.
`DATABASE_URL` doit désigner cette seule base locale ; aucune `.env` n'est lue.
Les options PostgreSQL héritées sont retirées dans le processus de diagnostic.
Le rôle `notification_observer` ne peut exécuter que le décompte agrégé : aucun
accès aux destinataires ni aux fonctions de prise/reprise.

La sortie JSON contient cinq compteurs décimaux et des motifs fermés. Codes de
sortie : **0** état normal, **1** situation à traiter, **2** contrôle impossible
(arguments, destination, configuration ou lecture). Une erreur ne vaut jamais
une file vide. Aucun message, ordonnanceur ou canal d'alerte n'est installé :
il s'agit d'un diagnostic ponctuel, sans mesure d'ancienneté ni preuve d'envoi.

## Catalogue public

Après application des migrations catalogue jusqu'à 0022, l'API expose
`GET /v1/offers` et `GET /v1/offers/{offerId}` sans session. La liste accepte
les filtres `universe`, `city`, `model`, `partnerId` et `maxPriceXaf` ; ce dernier
est une chaîne décimale entière XAF. Les champs inconnus ou répétés sont refusés.

Seules les offres courantes publiées d'un partenaire actuellement validé et non
défaillant, avec une présentation de la même version, sont visibles. Un titre
doit être enregistré explicitement via le store serveur dans la transaction
de création de version ; aucun titre historique n'est créé automatiquement.
Les lectures HTTP utilisent `app_ro`. Une offre invisible et une offre absente
renvoient le même 404. Aucun endpoint de devis ou d'écriture d'offre n'est ajouté.

Le catalogue du client web propose ces cinq filtres dans un formulaire GET.
Les partenaires sont proposés par nom à partir des offres publiques réelles.
Les filtres invalides sont signalés ; les prix restent des chaînes entières
jusqu'à leur validation par l'API.

## Sécurité du compte client

L'espace `/compte/donnees`, accessible depuis `/compte`, permet de déposer une
demande d'accès, rectification, opposition ou effacement et de consulter ses
reçus en français/anglais. Après migration 0024 : `POST /v1/me/data-rights`
exige une session, une origine autorisée et une clé d'idempotence ;
`GET /v1/me/data-rights` retourne uniquement l'historique du compte connecté,
par pages de 50. Un reçu `RECEIVED` confirme l'enregistrement seulement.
Le registre est en ajout seul, horodaté en base, sans données libres ni pièces
jointes ; demande, audit et idempotence sont transactionnels. La session est
revérifiée sous verrou, y compris pour un rejeu. Aucun effacement, export ni
traitement humain n'est exécuté par ces routes ; F-ACC-005 reste partiel (D36).
Les échanges complémentaires sécurisés, l'export complet dans le délai requis
et les règles de conservation restent à construire et approuver.

Après les migrations identité/audit, 0017 et 0023, l'espace `/compte` consomme
les sessions existantes de l'API. Le menu « Mon compte » y mène directement.

- `GET /v1/me/security` : appareils et sessions renouvelables du compte connecté,
  sans téléphone, clés, empreintes ou jetons ; réponse privée non stockable.
- `POST /v1/me/security/revoke-other-sessions` : ferme les autres sessions et
  conserve la session courante.
- `POST /v1/auth/signouts` : ferme la session courante, expire son cookie et
  répond 204 sans corps.
- `POST /v1/me/security/block` avec `{"reason":"LOST_OR_STOLEN"}` : bloque le
  compte par le canal APP et révoque ses appareils et sessions.

Les commandes exigent une session valide, une origine autorisée et une clé
d'idempotence. L'audit, la mutation et la clé sont transactionnels. Une requête
authentifiée avant une déconnexion peut rejouer le succès mémorisé ; un nouveau
passage dans le garde après révocation refuse le cookie. Le rôle applicatif ne
peut pas débloquer directement un compte. L'interface demande confirmation et
n'exécute aucune commande hors ligne.

Ce parcours ne fournit ni ouverture de session, ni OTP/SMS, ni déblocage,
attestation ou ré-enrôlement. La procédure de récupération humaine reste à
valider avant exploitation (D35). Aucun service externe n'est simulé.

## Vérificateur indépendant

Le vérificateur Rust vit dans `tools/verifier` ; voir son
[`README.md`](tools/verifier/README.md).
