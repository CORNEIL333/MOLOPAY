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

## 2 bis. Travailleur SMS (`pnpm notify:worker`, D121)

Processus distinct de l'API, sur le même serveur ou un autre, lancé après `pnpm db:migrate` (migration 0081 au moins).

- **Compte :** `molopay_notifier` (créé par `pnpm db:roles plan`), membre du seul rôle `notification_worker`. Il ne peut que prendre, confirmer ou replanifier une notification, et lire le numéro **chiffré** du destinataire pendant le bail SMS en cours.
- **Variables :**
  - `NOTIFIER_DATABASE_URL` : adresse **directe** (sans `-pooler`), `sslmode=verify-full` ;
  - Twilio, comme l'API (`TWILIO_*`, un seul expéditeur) ;
  - clés de protection du numéro, comme l'API (`PII_KMS_KEY_ARN`, `PHONE_INDEX_KEY_WRAPPED`) ;
  - `NOTIFIER_IDLE_MS` (facultatif : attente quand la file est vide, 1 000 à 60 000 ms, 5 000 par défaut).
- **Fermé sans configuration :** sans Twilio complet ou sans clés, le processus ne démarre pas (code 2, `{"status":"CLOSED","code":"SMS_UNCONFIGURED"}` ou `PII_KEYS_UNCONFIGURED`).
- **Comportement :**
  - seules les notifications **SMS** sont prises. Le SMS n'existe que pour les types ouverts par l'équipe (back-office, « canaux de notification ») ;
  - les rappels ne partent qu'entre **8 h et 20 h, heure de Douala** (décidé par la base) ;
  - échec Twilio : nouvel essai après 5 minutes, 5 tentatives au plus ; une notification épuisée est signalée par `pnpm ops:alerts` ;
  - distribution « au moins une fois » : si la confirmation échoue après un envoi accepté, le SMS peut repartir une fois.
- **Journal :** une ligne JSON par envoi (`SENT`), nouvel essai (`RETRY`) ou erreur (`ERROR`), sans numéro, texte ni identifiant de client.
- **Arrêt :** `SIGTERM` termine l'itération en cours puis ferme la connexion.
- **Push :** aucune notification push n'est envoyée tant que le prestataire n'est pas choisi (D122) ; elles restent en file.

## 3. Hors du dépôt (accès humains)

- Image ou machine virtuelle, réseau, certificats TLS publics, gestionnaire de secrets : ressources AWS à créer par une personne habilitée.
- La signature des instructions (versements) est fermée tant que `INSTRUCTION_SIGNING_KMS_KEY_ARN` est vide ; il n'y a pas de versement au lancement (décision du fondateur). Pour l'ouvrir, plus tard, le fondateur ou un opérateur habilité :
  1. crée dans AWS KMS (Francfort) une clé **asymétrique** `ECC_NIST_EDWARDS25519`, usage `SIGN_VERIFY`, distincte des clés de chiffrement ;
  2. n'accorde au rôle du serveur de l'API que `kms:GetPublicKey` et `kms:Sign` sur cette clé ;
  3. renseigne son ARN (ou un alias) dans `INSTRUCTION_SIGNING_KMS_KEY_ARN`. Au démarrage, l'API lit la clé publique et refuse de démarrer si la clé n'est pas une clé Ed25519 de signature (`SIGNING_KMS_KEY_INVALID`) ou si KMS ne répond pas (`SIGNING_KMS_UNREACHABLE`) ;
  4. remet la clé publique (`aws kms get-public-key`) à l'établissement de cantonnement par un canal authentifié, hors bande ;
  5. lance `pnpm test:kms` avec une clé de test (`INSTRUCTION_SIGNING_KMS_TEST_KEY_ARN`).

  En marche, une panne de KMS refuse l'instruction (503 `SIGNING_UNAVAILABLE`) sans rien écrire ; un nouvel essai est possible. Chaque signature est revérifiée avec la clé publique avant d'être enregistrée.
