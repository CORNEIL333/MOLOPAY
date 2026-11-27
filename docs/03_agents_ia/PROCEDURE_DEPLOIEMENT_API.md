# Procédure — construire et déployer l'API (MVP, AWS Francfort + Neon)

> Lots P1–P2. Chaque étape cite la commande du dépôt qui la réalise ou la vérifie. Aucun secret dans un fichier, une commande ou un journal : les valeurs viennent du gestionnaire de secrets de l'environnement d'exécution.

## 1. Construire (machine de construction)

1. `pnpm install --frozen-lockfile` — dépendances épinglées.
2. Régression complète : `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:attack`, `pnpm test:db`, `pnpm security:scan`. Rien n'est déployé si une seule commande échoue.
3. `pnpm build:api` — produit `apps/api/dist/main.cjs`, un seul fichier JavaScript, sans carte des sources. Le code de l'API et des paquets `@achat/*` y est regroupé ; les dépendances publiées restent externes.
4. Paquet de déploiement : `pnpm deploy --filter @achat/api --prod <répertoire>`. Il installe les seules dépendances de production de l'API, à leurs versions du fichier de verrouillage, modules natifs compris (Argon2). Y ajouter `apps/api/dist/main.cjs` et le répertoire `db/migrations`.

## 2. Déployer (serveur AWS Francfort)

Ordre **obligatoire** :

1. `pnpm config:check` dans l'environnement de la nouvelle version. Il doit répondre `"status":"OK"`. Il liste chaque capacité, configurée ou fermée, sans aucune valeur. Une capacité fermée répondra 503 : vérifier que c'est voulu (au lancement : SMS tant que Twilio n'est pas configuré, instructions signées toujours).
2. `pnpm db:migrate --dry-run` puis `pnpm db:migrate`, avec l'adresse du **propriétaire** (procédure Neon, § 3).
3. Démarrer la nouvelle version : `NODE_ENV=production node main.cjs`, sous le compte `molopay_api` et avec `DATABASE_ROLE=app_rw`. Au démarrage, l'API refuse de servir, avec le code 1 et un seul code d'erreur affiché, jamais la valeur :
   - base sans `sslmode=verify-full` : `DATABASE_TLS_REQUIRED` ;
   - schéma différent du code : `SCHEMA_VERSION_MISMATCH` ;
   - configuration présente mais invalide : `CONFIG_INVALID` ;
   - configuration absente : `CONFIG_MISSING`.
4. Vérifier `GET /health` (200), puis arrêter l'ancienne version. Sur SIGTERM, l'API ferme l'application puis ses connexions et sort avec le code 0 ; le gestionnaire de conteneurs doit lui laisser au moins 10 secondes.

## 3. Hors du dépôt (accès humains)

- Image ou machine virtuelle, réseau, certificats TLS publics, gestionnaire de secrets : ressources AWS à créer par une personne habilitée.
- La signature des instructions (versements) reste fermée jusqu'au signataire AWS KMS (D5) ; il n'y a pas de versement au lancement.
