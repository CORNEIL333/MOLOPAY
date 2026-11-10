# Décisions en attente — sprint MVP

> Questions pour le fondateur. Pour chacune : option appliquée (la plus prudente et réversible) et procédure de retour arrière.

## 2026-10-26

### D1 · Go absent de la machine, bascule du vérificateur vers Rust
- **Constat :** `go version` → command not found ; aucun binaire dans `Program Files/Go`. Le téléchargement du toolchain officiel a échoué deux fois (curl exit 56 « schannel: server closed abruptly », fichier bloqué à 10 162 240 octets sur 79 010 309 ; PowerShell en délai dépassé). Rust 1.96.1 est installé et fonctionnel.
- **Option appliquée :** le vérificateur indépendant (lot 04) est écrit en **Rust** dans `tools/verifier/`, module séparé sans import TypeScript (commit `9dd0ee6`). ADR-0001 autorise Go ou Rust pour l'outil de vérification indépendant ; l'exigence d'indépendance (langage et module distincts) est conservée. Le lot reste intitulé « vérificateur indépendant ».
- **Retour arrière :** réécrire le module en Go si un toolchain est fourni ; aucune interface avec le reste du dépôt hors export JSON.
- **À trancher :** fournir Go (préféré par le prompt initial) ou valider définitivement Rust pour le sprint.

### D2 · Docker absent de la machine
- **Constat :** `docker` introuvable ; aucun Docker Desktop installé. `psql`, `initdb` et `pg_ctl` le sont aussi : aucun PostgreSQL local.
- **Option appliquée :** conformément au prompt § 6, lot 02 livré (migrations + code + tests) **sans exécuter `test:db`** ; les tests PostgreSQL restent à lancer dès que Docker ou un PostgreSQL 16 de test est disponible. Aucun faux PostgreSQL n'est utilisé (zéro simulation). Depuis la reprise, `pnpm test:db` accepte aussi `DATABASE_URL` vers une base existante (harnais `apps/api/test/db/harness.ts`, documenté dans le README) ; sans Docker ni `DATABASE_URL`, la commande sort en code 2 `DOCKER_UNAVAILABLE` et n'exécute aucun test base.
- **Retour arrière :** aucun changement système ; retirer `DATABASE_URL` de l'environnement pour revenir à Testcontainers.
- **À trancher :** fournir Docker, un PostgreSQL 16 local de test, ou exécuter `test:db` via `DATABASE_URL` sur une base jetable.

### D3 · `.env.local` absent
- **Constat :** aucun fichier `.env.local` ; pas d'identifiants d'environnements de test (SMS, agrégateur).
- **Option appliquée :** le lot 06 livre le domaine identité complet (OTP, PIN Argon2id, appareils, sessions, signatures de transaction, récupération) et ses tests ; **aucun adaptateur SMS n'est livré** et aucun faux prestataire n'est créé. La remise du code OTP à un opérateur réel reste branchée plus tard derrière une interface d'envoi.
- **Retour arrière :** déposer les identifiants de test dans `.env.local` (non versionné) puis brancher l'adaptateur SMS réel.

### D4 · Commits non signés
- **Constat :** aucune clé de signature configurée ; `commit.gpgsign` absent.
- **Option appliquée :** commits Conventional Commits non signés, consignés ici ; aucune clé n'est générée hors du dossier du projet.
- **Retour arrière :** configurer une clé de signature et re-signer l'historique de la branche.
- **À trancher :** fournir une politique de signature (clé SSH/GPG) pour le sprint.

### D5 · Clé Ed25519 de développement
- **Option appliquée :** les tests génèrent une clé Ed25519 réelle dans le répertoire temporaire du système (hors dépôt) ; aucune clé privée n'est écrite dans le dépôt. La clé HSM de production reste à fournir.
- **Retour arrière :** supprimer les fichiers temporaires générés par les tests.

### D6 · Autorité d'horodatage RFC 3161
- **Constat (2026-10-26) :** la TSA publique DigiCert répond en HTTPS ? Non : l'endpoint documenté `http://timestamp.digicert.com` répond en HTTP 200 `application/timestamp-reply` et délivre un jeton signé ; aucune donnée sensible n'est transmise (empreinte SHA-256 d'une tête publique).
- **Option appliquée :** `DEFAULT_TSA_URL = http://timestamp.digicert.com` pour le test d'intégration `pnpm test:tsa`, avec `TSA_URL` surchargeable. Le jeton réel est vérifié : signature CMS (y compris `SignerInfo` en `rsaEncryption` + SHA-256), `messageDigest`, `messageImprint`, nonce, `genTime`, EKU horodatage `1.3.6.1.5.5.7.3.8`, chaîne de certificats jusqu'aux racines Mozilla fournies par Node.
- **Retour arrière :** changer `TSA_URL` ou `DEFAULT_TSA_URL` ; aucun état publié, aucune donnée personnelle ni montant dans l'empreinte.
- **À trancher :** TSA retenue en production (contrat, politique, HTTPS obligatoire ou non, conservation des jetons et de leurs preuves de receipt).

### D7 · Image PostgreSQL des tests base
- **Constat :** Docker absent localement (D2). Pour que la CI et le futur poste de test soient reproductibles, l'image est épinglée par tag et digest : `postgres:16.15-alpine@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab`.
- **Option appliquée :** digest du manifeste multi-architecture vérifié sur le registre officiel Docker Hub le 2026-10-26 ; aucune autre image n'est utilisée.
- **Retour arrière :** changer la constante `POSTGRES_IMAGE` du test ; aucun impact hors tests.
- **À trancher :** politique de mise à jour des digests d'images (revue mensuelle ou Renovate).

### D8 · INT-LED-008 (état métier et écriture dans la même transaction)
- **Constat :** le lot 02 livre le grand livre seul ; aucune table d'état métier (paiement, accord) n'existe encore. L'invariant « pas d'état sans écriture, pas d'écriture sans état » ne peut pas être prouvé sans cette table, et aucun faux module ne sera créé (zéro simulation).
- **Option appliquée :** INT-LED-008 reste ouvert ; il sera couvert par le lot paiements (11) avec une transaction réelle état + écriture, et un test d'attaque provoquant l'échec de l'écriture pour vérifier le rollback de l'état.
- **Retour arrière :** aucun code à retirer.
- **À trancher :** confirmer que la couverture d'INT-LED-008 au lot 11 est acceptable pour la revue L3 du lot 02.

### D9 · Vérificateur indépendant livré dans le monorepo, extraction à planifier
- **Constat :** CDC_04 (INT-VER-001) et ADR-0001 exigent un outil dans « un autre dépôt » ; le prompt maître autorise explicitement `tools/verifier/` et demande de consigner l'extraction comme décision en attente.
- **Option appliquée :** lot 04 livré dans `tools/verifier/` (crate Rust autonome, aucun import TS, `Cargo.lock` versionné) pour rester dans le dossier projet et ne pas créer de dépôt externe sans accord. L'indépendance de langage et de code est réelle ; seule la séparation de dépôt reste à faire.
- **Retour arrière :** extraire `tools/verifier/` vers un dépôt dédié puis le référencer en sous-module ou via un artefact signé ; aucun changement d'interface (export JSON + clé publique hors bande).
- **À trancher :** dépôt cible, droits d'accès et procédure de publication du binaire vérificateur.

### D10 · Lecture HTTP du journal d'audit différée au RBAC (lot 08)
- **Constat :** SEC-AUTHZ-001 exige un contrôle d'accès serveur sur chaque requête ; aucun mécanisme d'authentification ni de RBAC n'existe encore. Exposer `/audit/events` maintenant rendrait les journaux de sécurité consultables sans autorisation.
- **Option appliquée :** la couche de lecture est livrée et testée (requêtes SQL entièrement paramétrées, pagination et filtres validés), mais aucun contrôleur HTTP n'est monté. L'exposition se fera quand un guard d'authentification existera (lot 06), avec les décisions RBAC du lot 08.
- **Retour arrière :** monter `AuditController` et son module dans `AppModule` dès que le guard existe ; aucun changement de données.
- **À trancher :** rôles autorisés à consulter l'audit (auditeur, conformité, administrateur) et politique de conservation/rétention de 10 ans (SEC-LOG-001).

### D11 · Vocabulaire des types d'écriture non figé par le CDC
- **Constat :** les fixtures utilisent `GENESIS`, `PAYMENT_RECEIVED`, `SETTLEMENT_SENT`, `FEE_CHARGED`, `PAYMENT_REVERSED`, `ADJUSTMENT`, mais aucun document normatif ne liste les types autorisés.
- **Option appliquée (mise à jour du 2026-10-26) :** le vérificateur Rust applique désormais une **liste blanche fermée** de huit types (`ADJUSTMENT`, `FEE_CHARGED`, `GENESIS`, `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_REVERSED`, `REVERSAL`, `SETTLEMENT_SENT`) ; un type inconnu est refusé `ENTRY_INVALID` même si son hash est recalculé. Le miroir dans `packages/chain` n'est pas ajouté : le test adversarial doit pouvoir produire un type inconnu au hash valide, ce qui exigerait un chemin de test distinct. Aucun nouveau type ne peut être écrit en production sans mettre à jour cette liste et son test.
- **Retour arrière :** retirer la liste blanche du vérificateur (déconseillé) ; ou étendre la liste dans le même commit qu'un nouveau type réel.
- **À trancher :** figer la liste des types d'opération dans le CDC, avec leur règle de contre-passation.

### D12 · Horodatage d'audit et intégrité du hash côté application
- **Constat :** `audit.event.recorded_at` reçoit l'horodatage fourni par l'application (nécessaire pour que le hash soit reproductible hors base), et la base ne peut pas recalculer `event_hash` sans canonicalisation JCS. La base garantit la continuité de séquence et de `prev_hash`, l'ajout seul et le refus des clés sensibles ; le contenu est vérifié par `verifyAuditChain` et par un test de bout en bout.
- **Option appliquée :** l'horloge serveur applicative est la source de vérité tant qu'aucun acteur externe ne peut fournir `ts` (aucun endpoint HTTP d'audit n'est monté). Un test base relit deux événements écrits via `appendAuditEvent` et rejoue la chaîne complète.
- **Retour arrière :** passer à `recorded_at DEFAULT now()` et inclure l'horodatage base dans le contenu canonique lors de la prochaine migration.
- **À trancher :** source d'horodatage opposable (horloge base, TSA) et conservation des preuves de recalcul.

### D13 · Domaine admin non exposé et schéma de charge utile non formalisé
- **Constat :** le lot 08 livre le domaine RBAC/maker-checker et les migrations, mais aucun contrôleur HTTP : sans authentification réelle (lot 06), exposer les actions back-office serait fail-open. Les charges utiles `SETTLEMENT`/`LEDGER_REVERSAL` ne sont pas encore schématisées par le CDC ; le domaine exige `amount_xaf` pour les approbations plafonnées et lie `city_id`/`partner_id` au contexte lorsqu'ils sont présents, mais ne peut pas exiger des champs non spécifiés.
- **Option appliquée :** aucun endpoint admin monté ; le contexte d'autorisation ne peut pas diverger d'un montant déclaré, et la ville/partenaire déclarés sont liés au contexte. Les charges utiles restent des objets JSON canonisés et scellés par SHA-256.
- **Retour arrière :** monter les contrôleurs derrière un guard d'authentification et ajouter des schémas de charge utile par type.
- **À trancher :** schémas de charge utile par type de demande et mécanisme d'authentification des agents (OIDC interne, MFA, sessions).

### D14 · Identité livrée sans couche de persistance ni HTTP
- **Constat :** le lot 06 livre le domaine pur et les migrations, mais aucun repository ni contrôleur HTTP. Les décisions de sécurité qui dépendent de l'état persisté (preuve OTP rejouée, compteurs OTP/PIN concurrents, appareil/PIN réellement chargés) ne peuvent pas être prouvées par le seul domaine.
- **Option appliquée :** le domaine exige que l'appelant fournisse des objets déjà chargés (`Account`, `Device`, `PinState`) et revérifie l'empreinte SHA-256 de la clé d'appareil ; les preuves OTP portent un MAC HMAC-SHA-256 poivré. La couche de persistance devra lire l'appareil, le PIN et les compteurs sous verrou (`SELECT ... FOR UPDATE`) et refuser un défi OTP déjà consommé. Aucun endpoint n'est monté sans guard d'authentification. La base ne peut pas recalculer le MAC OTP : elle garantit seulement la cohérence (défi non créé consommé, consommation unique, expiration ≤ 15 min) ; la preuve cryptographique reste dans le domaine.
- **Retour arrière :** ajouter un repository transactionnel et un guard, puis des tests base concurrents ; aucun changement de schéma.
- **À trancher :** stratégie de concurrence (verrou de ligne vs colonne de version) et propriétaire du chargement des objets d'identité.

### D15 · Récupération de compte limitée au KYC renforcé
- **Constat :** SEC-AUTH-007 exige un KYC renforcé et un délai de 24 h pour les comptes avec solde ; aucune attestation d'appareil de confiance n'existe encore. Une récupération `TRUSTED_DEVICE` sans preuve d'appareil serait un contournement.
- **Option appliquée :** seul `KYC_STRONG` est accepté par le domaine et par la contrainte SQL. La fin de récupération passe par la fonction atomique `identity.complete_recovery(p_recovery, p_challenge)`, qui vérifie KYC, délai, OTP RECOVERY consommé récent, change le numéro puis révoque appareils et sessions. Elle n'accepte **aucun horodatage appelant** : délai, fenêtre OTP de dix minutes et écritures utilisent `now()`. Le trigger `recovery_anchor` force `requested_at`, `available_at` (24 h si solde), `status='PENDING'` et `completed_at=NULL`. Le rôle `app_rw` n'a ni `UPDATE(phone)`, ni `UPDATE(kyc_level)`, ni `UPDATE` direct sur `identity.recovery`.
- **Retour arrière :** ajouter une méthode `TRUSTED_DEVICE` avec signature d'attestation vérifiée et migration additive.
- **À trancher :** mécanisme d'attestation d'appareil (Play Integrity/App Attest) et conditions d'acceptation.

### D16 · Atomicité OTP/PIN et confiance dans les objets chargés
- **Constat :** les compteurs OTP et PIN sont des entiers lus puis réécrits par le domaine ; deux requêtes concurrentes peuvent perdre un incrément si la persistance ne verrouille pas. De même, le domaine ne peut pas prouver qu'un `Account`, `Device` ou `PinState` vient de la base.
- **Option appliquée (mise à jour du 2026-10-26) :** `identity/auth.store.ts` exécute le compteur OTP et la rotation du refresh en une seule requête `UPDATE … WHERE … RETURNING` (décrément et consommation dans la même instruction ; ancien refresh consommé une fois ; compte et appareil vérifiés par `EXISTS`). Le solde de récupération n'est plus fourni par l'appelant : `ClientBalance` (constructeur privé) est dérivé de `ledger.account_balance` (compte 2100, nature LIABILITY) par `readClientLedgerTotals`, et `requestRecovery` refuse un objet forgé. Le niveau KYC n'est pas modifiable par `app_rw`. **Risques résiduels :** les compteurs PIN restent lus puis réécrits par le domaine ; les requêtes SQL des stores n'ont **jamais été exécutées** faute de PostgreSQL (D2), même si huit tests base supplémentaires sont écrits ; `has_balance` reste matérialisé en base au moment de la demande, sans relecture du grand livre à la confirmation.
- **Retour arrière :** revenir à des lectures/écritures séparées dans `auth.store.ts` ; le domaine et ses tests restent inchangés.
- **À trancher :** verrouillage des compteurs PIN, et fraîcheur du solde entre la demande et la confirmation de récupération.

### D17 · Fonctions de récupération `SECURITY DEFINER`
- **Constat :** `identity.complete_recovery` et `identity.cancel_recovery` doivent modifier des colonnes non accordées à `app_rw`. `SECURITY DEFINER` exécute avec les droits du rôle qui a appliqué la migration.
- **Option appliquée :** exécution révoquée à `PUBLIC`, accordée uniquement à `app_rw` ; `search_path` figé à `pg_catalog` ; noms de tables qualifiés ; signatures `complete_recovery(uuid, uuid)` et `cancel_recovery(uuid)`, sans horodatage appelant. `cancel_recovery` fait un `UPDATE ... WHERE status='PENDING'` et vérifie `ROW_COUNT` (pas de course test-puis-écriture). La migration doit donc être appliquée par un rôle propriétaire de schéma, distinct du rôle applicatif.
- **Retour arrière :** révoquer les exécutions et revenir à des mises à jour directes avec des grants colonne.
- **À trancher :** rôle de migration en production (propriétaire dédié, coffre de credentials) et revue des fonctions `SECURITY DEFINER`.

### D18 · Horodatage maker-checker ancré en base, durée de validité déclarée
- **Constat :** `prepared_at` et `decided_at` étaient fournis par l'application. Un décideur pouvait antidater sa décision pour approuver une demande déjà expirée, et un préparateur pouvait dater une demande dans le futur. Les tests ne prouvaient qu'une cohérence déclarative, pas l'écoulement réel du temps.
- **Option appliquée :** migration `0006_admin_clock.sql`. `admin.anchor_request_clock` remplace `prepared_at` par `clock_timestamp()` et conserve la durée `expires_at - prepared_at` déclarée, désormais bornée à 7 jours comme le domaine (le bris de glace reste à 2 h) ; `assert_decision` remplace `decided_at` par `clock_timestamp()` avant tout contrôle. `clock_timestamp()` est requis : `now()` renvoie l'heure de début de transaction, qu'un appelant peut étirer avant l'INSERT. La liste des clés interdites du journal d'audit est aussi complétée (`clientpin`, `pincode`, `cvvcode`, `authtoken`, `newpassword`, `pin_hash`, `code_hash`, `token_hash`, `api_key`, `private_key`, `otp_mac`…) dans `0005_audit_metadata.sql` et dans le domaine, car la normalisation transformait `client_pin` en `clientpin`. Les clés hors `[A-Za-z0-9_.-]` sont refusées pour que la normalisation SQL et TypeScript reste identique (51 clés en miroir exact).
- **Retour arrière :** supprimer le trigger `approval_request_clock` et restaurer la version 0003 de `assert_decision` ; pour l'audit, revenir à la liste de 0002 (déconseillé).
- **À trancher :** politique de durée par type de demande au-delà du plafond uniforme de 7 jours, et ancrage de `setting_version.created_at`, qui reste déclaré par l'appelant mais ne conditionne aucune autorisation.

### D19 · Horloge murale pour le délai et la preuve OTP de récupération
- **Constat :** le trigger `recovery_anchor` et `complete_recovery` comparaient le délai de 24 h et la fenêtre OTP de dix minutes à `now()`, l'heure de début de transaction. Une transaction ouverte puis étirée avant l'INSERT pouvait raccourcir le délai effectif, et une preuve OTP vieillie pendant une transaction longue restait acceptée.
- **Option appliquée :** migration `0007_identity_clock.sql`. `anchor_recovery_request` et `complete_recovery` utilisent `clock_timestamp()` (horloge murale serveur), sans accepter d'heure appelante ; les contrôles KYC, statut, numéro et attribution restent inchangés, et les privilèges de la fonction sont réappliqués. Un test base discrimine l'ancien comportement : `pg_sleep(0.2)` avant l'INSERT, puis vérification que `requested_at` suit l'horloge murale et que `available_at - requested_at` vaut exactement 24 h.
- **Retour arrière :** restaurer la version 0004 des deux fonctions (déconseillé).
- **À trancher :** aucune décision ouverte ; le rôle de migration reste celui défini en D17.

### D20 · Références d'audit en liste blanche par action
- **Constat :** la normalisation de l'audit refusait des clés par liste noire et acceptait des métadonnées imbriquées ; une clé sensible non répertoriée passait.
- **Option appliquée :** registre fermé `action → clés autorisées` (7 actions génériques, 16 actions identité, 28 actions admin reconnues par motif fermé), valeurs scalaires uniquement ; action inconnue refusée `AUDIT_INVALID_EVENT`, clé non déclarée ou non scalaire refusée `AUDIT_REFS_FORBIDDEN`. Toute nouvelle action d'audit exige une entrée explicite et un test.
- **Retour arrière :** revenir à la validation générique de `normalizeContent` (déconseillé).
- **À trancher :** propriétaire du registre (sécurité ou module émetteur) et procédure de revue lors de l'ajout d'une action.

### D21 · Vocabulaire du catalogue et activation des plans
- **Constat :** le CDC impose quatre univers et deux villes mais ne fournit aucun identifiant canonique ; il exige qu'un partenaire ne puisse pas créer de conditions de crédit sans préciser la forme de la requête.
- **Option appliquée :** identifiants fermés `ESSENTIALS|TECHNOLOGY|HOUSING|MOBILITY` et `yaounde|douala` (ce dernier aligné sur `cityId` du back-office). L'activation d'un plan accepte uniquement `planId`, `offerId`, `model` ; toute autre clé (taux, durée, frais) est refusée `CATALOG_FIELD_FORBIDDEN`. Un plan doit être approuvé par la plateforme et, pour `FINANCED_PURCHASE`, porter une référence d'approbation du financeur. Aucune migration et aucun câblage HTTP/audit : la journalisation de la tentative refusée exige un type d'événement catalogue qui n'existe pas encore.
- **Retour arrière :** changer les constantes et le registre d'actions dans `catalog/domain.ts` ; aucun schéma touché.
- **À trancher :** identifiants définitifs des univers/villes, et type d'événement d'audit pour les refus d'activation (lot 09 avec persistance).

### D22 · `DATABASE_URL` pour les tests base : garde de base jetable
- **Constat :** les suites PostgreSQL détruisent les schémas du domaine ; accepter une URL arbitraire pourrait effacer une base partagée.
- **Option appliquée :** `DATABASE_URL` n'est acceptée que si l'hôte est local (`localhost`, `127.0.0.1`, `::1`) ; une base distante exige `ALLOW_REMOTE_TEST_DB=1`. Aucun conteneur n'est lancé ni arrêté dans ce mode. Le README racine documente les deux modes.
- **Retour arrière :** supprimer le support `DATABASE_URL` et revenir à Testcontainers seul.
- **À trancher :** maintien de l'option distante pour une CI sans Docker, et politique de nom de base (`*_test` obligatoire).

### D23 · Version provisoire des conditions d’offre
- **Constat :** la création d’un projet exige `acceptTermsVersion`, mais aucun texte juridique approuvé n’est fourni. La constante `2026-10-26-v1` est donc un identifiant technique provisoire, pas une approbation juridique.
- **Option appliquée :** le parcours web local transmet cet identifiant explicite après une case d’acceptation ; aucune disponibilité en production n’est déclarée et aucune règle juridique supplémentaire n’est inventée.
- **Retour arrière :** remplacer la constante par la version du texte approuvé avant toute ouverture réelle ; le serveur reste responsable d’accepter ou refuser cette version.
- **À trancher :** texte, version et date d’effet des conditions applicables à chaque offre.

### D24 · PostgreSQL local indisponible (reprise Claude Code)
- **Constat :** ni Docker ni PostgreSQL sur le poste. `scoop install postgresql` (18.6) a échoué deux fois (délai dépassé) et cinq téléchargements `curl` avec reprise ont été coupés (`Recv failure: Connection was reset`) alors que l'hôte répond `200`. Budget de trois tentatives dépassé : arrêt.
- **Option appliquée :** aucune base distante ni simulateur (`pg-mem` écarté : zéro simulation). Les tests base restent écrits et non exécutés : **99** (87 + 12 catalogue).
- **Retour arrière :** sans objet.
- **À trancher :** installer Docker Desktop ou PostgreSQL 16 sur une connexion stable, puis `DATABASE_URL=postgres://…@127.0.0.1/… pnpm test:db`. Noter que Scoop fournit 18.6 alors que la CI fige `postgres:16.15`.
- **Mise à jour 2026-10-29 · résolu pour `test:db` :** PostgreSQL 16.15 installé par le fondateur (`winget`, service Windows protégé par mot de passe, non utilisé). Pour ne manipuler aucun secret, les tests tournent sur une **grappe jetable** créée avec les binaires officiels (`initdb --auth=trust`, écoute `localhost` seule, port 54329, dossier temporaire de session) : `DATABASE_URL=postgres://postgres@localhost:54329/achat_test`. Résultat : **110/110 verts**. Aucune contrainte SQL modifiée ; 5 jeux de données de test corrigés (motif de rejet manquant, blocage/révocation sans date ni motif, session avec refresh antérieur à l’accès, `TRUNCATE` arrêté par la clé étrangère avant le trigger → testé avec `CASCADE`, référence `session` interdite pour `LOGOUT_SEEN`).
- **Outillage :** `pnpm` 12.6.0 est cassé sur ce poste (shim pointant vers un fichier absent) ; les commandes du § 5 ont été lancées via `node_modules/.bin`. `pnpm security:scan` n'a donc couvert que les secrets : la SCA (`pnpm audit`) n'a pas pu tourner.

### D25 · Dossier partenaire modifié après validation
- **Constat :** F-PRT-001 exige une validation maker-checker mais ne dit pas ce qui se passe si le dossier (notamment `settlement_account_ref`) change ensuite.
- **Option appliquée (la plus prudente) :** l'approbation porte l'empreinte JCS/SHA-256 du dossier ; toute nouvelle version repasse le partenaire `PENDING`, donc invisible du catalogue, jusqu'à une nouvelle approbation. L'empreinte est calculée par l'application ; la base vérifie qu'elle égale celle de la décision approuvée et le store revérifie l'empreinte stockée à la lecture.
- **Retour arrière :** limiter la revalidation aux seuls champs sensibles (règlement, représentant) par une nouvelle migration.
- **À trancher :** liste des champs dont la modification exige une revalidation ; formats officiels RCCM/NIU (non inventés : seuls longueur et jeu de caractères sont contrôlés).

### D26 · Circuit d'approbation des plans de paiement (lot 09)
- **Constat :** F-CAT-002 exige des plans « approuvés par la plateforme et, pour B, par le financeur », mais aucune source ne fixe le type de demande maker-checker (`APPROVAL_KINDS` n'a pas de `PAYMENT_PLAN`), ni le contenu d'un plan (durée, rythme, frais), ni le format de la référence d'approbation du financeur.
- **Option appliquée :** persistance des plans **non implémentée**. Le domaine (`activatePartnerPlan`) et sa journalisation (`activatePartnerPlanAudited`, `CATALOG_ACTION`) sont prêts ; un plan reste une donnée fournie par l'appelant serveur.
- **Retour arrière :** sans objet.
- **À trancher :** réutiliser `FINANCIAL_SETTING` ou ajouter un type `PAYMENT_PLAN` (ADR, touche `admin`), champs d'un plan, et forme de la preuve d'approbation du financeur (I-10).

### D27 · Accords A/C : points non tranchés par les sources (lot 10)
- **Conflit signalé (non arbitré) :** `CDC_05` § 5.2 n'autorise l'annulation client que depuis `ACTIVE`, alors que `CDC_01` F-PLN-004 dit « annuler avant règlement » (donc aussi depuis `FUNDED` pour C) et F-SAV-005 « annuler un objectif non verrouillé » sans restreindre l'état.
- **Option appliquée (la plus stricte, réversible) :** la liste blanche suit `CDC_05` à la lettre ; `FUNDED → CANCELLED_BY_CUSTOMER` est refusé (`UNAUTHORIZED_TRANSITION`). Ajouter la transition plus tard est une extension, pas un affaiblissement.
- **Verrou (F-SAV-003) :** l'annulation client d'un objectif verrouillé est toujours refusée (`AGREEMENT_LOCKED`) ; les cas prévus (décès, défaillance marchand, force majeure) passent par `FROZEN → REFUNDED`, opération qui sera soumise au maker-checker. Le verrou n'est jamais levé par le client.
- **Barème de restitution :** seul le barème par défaut publié (100 %, sans frais) est accepté (`FULL_NO_FEE`) ; aucun autre barème n'est inventé.
- **Plan :** les champs de `CDC_05` § 4 (`rhythm`, `min_amount`, `max_duration`) sont utilisés ; un plan porte un seul rythme et le client choisit son rythme en choisissant le plan. Unité de `max_duration` non précisée : **jours** retenus. Le circuit d'approbation reste D26.
- **À trancher :** transitions d'annulation depuis `FUNDED` ; unité de durée ; liste des barèmes autorisés.

### D28 · Format de la signature d'appareil des accords (lot 10)
- **Constat :** INT-NR-001 et SEC-AUTH-002 exigent une signature par la clé de l'appareil (Ed25519, module identity) pour l'acceptation et l'annulation, sans fixer le message signé.
- **Option appliquée :** message = JCS de `{domain: "agreement-transition-v1", agreement_id, terms_hash, from, to, seq}` ; le rang `seq` empêche de rejouer une signature sur un autre événement ; la base exige `device_id` + `signature` exactement pour `DRAFT → ACTIVE` et `ACTIVE → CANCELLED_BY_CUSTOMER` (migration 0012) et les refuse ailleurs. La vérification Ed25519 est faite par l'application (PostgreSQL n'a pas Ed25519) ; signature et empreinte sont conservées pour le vérificateur.
- **Reste à câbler :** la preuve de saisie du PIN (SEC-AUTH-002 « après saisie du PIN ») et la lecture de l'appareil depuis identity se feront dans le contrôleur HTTP (agreements ne peut pas importer identity).
- **À trancher :** valider ce format avant que l'app mobile ne l'implémente (lot 19).

### D29 · Bénéficiaires du modèle C (lot 10)
- **Constat :** CDC_05 § 4 décrit `Partner.type (merchant, beneficiary)` et le glossaire définit le bénéficiaire comme un partenaire ; SEC-AUTHZ-003 soumet partenaires et bénéficiaires au maker-checker. Aucune source ne dit quelles pièces d'identité exiger d'un bénéficiaire personne physique (un bailleur particulier n'a pas de RCCM).
- **Option appliquée (la plus stricte) :** un bénéficiaire suit exactement l'onboarding partenaire (mêmes champs obligatoires, dont RCCM et NIU), avec `partner_type = BENEFICIARY` et une catégorie parmi celles de F-PLN-001 (`LANDLORD`, `AGENCY`, `SCHOOL`, `MATERIALS_SELLER`, `LAND_SELLER`), dans l'empreinte approuvée (migration 0013). Un bailleur particulier sans RCCM ne peut donc pas encore être enregistré. Seuls les marchands publient des offres ; la base refuse un objectif C vers un partenaire qui n'est pas un bénéficiaire validé.
- **Hors périmètre de cette tranche :** F-PLN-002 (bail ou titre foncier vérifié par la conformité avant tout règlement) sera branché sur le règlement (lot 12) : le règlement C devra exiger cette vérification maker-checker.
- **À trancher :** pièces exigées d'un bénéficiaire personne physique ; liste définitive des catégories.

### D30 · CI GitHub indisponible (compte bloqué pour facturation)
- **Constat (2026-10-31) :** les jobs de `.github/workflows/ci.yml` ne démarrent pas (« account is locked due to a billing issue ») ; le fondateur n'a pas de budget pour le débloquer.
- **Option appliquée :** `tools/ci-local.ts` (`pnpm ci:local`, ou `node_modules/.bin/tsx tools/ci-local.ts`) rejoue les mêmes étapes que la CI sur le poste, tests base compris contre une base locale jetable (`DATABASE_URL`). Aucune étape n'est sautée ; tout échec rend le code de sortie non nul. Le workflow GitHub est inchangé et reprendra seul au déblocage.
- **Limite :** la SCA échoue tant que `pnpm` est cassé sur le poste (D24) ; c'est un échec d'outillage, pas un résultat d'audit. Réparation possible : `npm install -g pnpm@12.6.0`.
- **Premier passage :** 11 étapes sur 12 OK (dont 159 tests base), SCA en échec (pnpm).

### D31 · Défaillance marchand (F-SAV-006, lot 10)
- **Constat :** F-SAV-006 exige de proposer un article équivalent ou le remboursement intégral et de tracer l'incident au registre des partenaires, sans dire qui déclare la défaillance, si elle se lève, ni qui paie l'écart de prix d'un article équivalent.
- **Option appliquée (effet uniquement restrictif) :** registre `catalog.partner_incident` en ajout seul (une défaillance par marchand, horodatage serveur, motif obligatoire). Dès l'enregistrement : offres retirées du catalogue public, publication refusée (`CATALOG_PARTNER_IN_DEFAULT`), nouvel accord A et activation d'un brouillon refusés en base. Les accords touchés (DRAFT, ACTIVE, FUNDED, DISPUTED, FROZEN) sont listés avec les deux remèdes ; ils peuvent être gelés (`ACTIVE → FROZEN`). Pas de maker-checker à la déclaration : elle ne fait que bloquer. **Aucune levée** n'est possible : lever le blocage serait l'opération sensible.
- **Reste (lot 12) :** exécution des remèdes (remboursement via le grand livre, remplacement par un article équivalent sans surcoût pour le client), journalisation d'audit de la déclaration.
- **À trancher :** rôle habilité à déclarer ; procédure de levée (maker-checker ?) ; prise en charge de l'écart de prix d'un article équivalent.
- **Décision du fondateur (2026-10-31) : proposition acceptée.** Mise en œuvre (migration 0015) :
  - déclaration par une seule personne (`DECLARE_MERCHANT_DEFAULT` : PARTNER_NETWORK, OPERATIONS, RISK, COMPLIANCE ; motif obligatoire, périmètre partenaire), journalisée (`MERCHANT_DEFAULT_DECLARED`) ;
  - gel automatique des accords A `ACTIVE` dans la même transaction (tout ou rien) ; les accords gelés sont renvoyés pour notification (lot 17) ;
  - levée uniquement par une nouvelle version du dossier, créée après l'incident et validée en maker-checker ; l'incident reste au registre ; accords gelés non réactivés ; versions d'offre et brouillons antérieurs à l'incident restent bloqués jusqu'à republication ; récidive possible après levée ;
  - écart de prix d'un article équivalent : à la charge de la plateforme puis recouvré auprès du marchand (clause contractuelle à valider par le juriste) ; restitution au client si l'équivalent est moins cher ; choix du client signé. Mise en œuvre au lot 12.

### D32 · Routes HTTP des accords : contrat OpenAPI en conflit avec CDC_05 (lot 10)
- **Conflit signalé (non arbitré) :**
  - `packages/contracts/openapi.json`, schéma `Goal.status` : `ACTIVE | LOCKED | COMPLETED | CANCELLED | FROZEN`.
  - `CDC_05` § 5.2 : `DRAFT → ACTIVE → FUNDED → HANDED_OVER | PAID_TO_BENEFICIARY → CLOSED`, `CANCELLED_BY_CUSTOMER`, `REFUNDED`, `DISPUTED`, `FROZEN`, et « `LOCKED` est un attribut, pas un état ».
  - `GoalRequest` (`offerId`, `quoteId`, `acceptTermsVersion`) crée un objectif directement, sans signature d'appareil ni PIN, alors que INT-NR-001 et SEC-AUTH-002 les exigent ; `QuoteRequest.durationMonths` (1–36) alors que le domaine a retenu des jours faute de source (D27).
- **Manques constatés :** aucune couche HTTP authentifiée (seul `/health` existe) : pas de pool PostgreSQL dans Nest, pas de garde de session (`cookieAuth` / `client_session`), pas de store de tentatives PIN (verrouillage atomique).
- **Recommandation :** (1) aligner le contrat sur CDC_05 (statuts du § 5.2 + booléen `locked`) ; (2) création en deux temps : `POST /v1/goals` crée un brouillon à partir du devis, puis `POST /v1/goals/{goalId}/activation` avec signature d'appareil + PIN ; idem `/cancellation` ; `/lock` ; (3) durée en **mois** comme le devis (tranche D27) ; (4) construire d'abord le socle HTTP (pool, garde de session, store PIN, erreurs RFC 9457, Idempotency-Key, contrôle d'origine) avant les routes.
- **En attendant :** aucune route d'accord n'est exposée.

### D33 · Rappels : réservation conservatrice et configuration (lot 17)
- Contexte : F-NOT-003 impose horaires et fréquence ; aucun prestataire ni travailleur de livraison disponible.
- Option appliquée : quota global par destinataire (tous projets/canaux), consommé à la réservation, y compris si un envoi ultérieur échoue. Clé UUID idempotente ; changer de canal sur une clé est refusé. Pas de politique par défaut. Configuration accessible au propriétaire de migration uniquement, aucun endpoint administratif ajouté.
- Limites : ce mécanisme ne constitue ni une outbox ni une preuve de livraison ; le futur dispatch doit revérifier la plage horaire et coordonner réservation, tentatives et idempotence du prestataire. Aucun destinataire réel, texte libre, numéro ou jeton stocké. Le lien du destinataire au compte authentifié doit être imposé dans le futur câblage serveur.
- À trancher : valeurs des horaires et plafonds, circuit administratif de configuration, politique de reprise/expiration des réservations et conservation. Une réservation existante ne doit pas autoriser seule un envoi différé.
- Réversibilité : ne pas câbler le store ; modifier la politique par le circuit humain approuvé. Aucune donnée financière touchée, aucune suppression de migration proposée.

### D34 · Consommation de notifications : reprise bornée, sans livraison (lot 17)
- Contexte : NF-REL-005 impose reprise et suivi des échecs ; aucun adaptateur officiel ni contrat d'acquittement disponible dans le module.
- Option prudente : aucun réglage de consommation par défaut, rôle travailleur séparé et non connecté ; bail exclusif avec identité de tentative renouvelée, délai de reprise et plafond explicites. Le plafond est mémorisé lors de la première prise : modifier max_attempts ne change pas les enveloppes déjà prises. Les enveloppes épuisées sont conservées, dénombrables, sans circuit automatique de remise en file. Aucun champ d'erreur libre ou contenu fournisseur stocké.
- Liste blanche de prise : PAYMENT_CONFIRMED, GOAL_FUNDED, HANDOVER_READY, SETTLEMENT_CONFIRMED, DISPUTE_UPDATED. PAYMENT_REMINDER reste différé tant que la coordination à l'instant d'envoi de D33 n'est pas construite, même si une réservation existe déjà.
- À décider : durées et plafond opérationnels, circuit de configuration et reprise manuelle, conservation, supervision effective et contrat d'idempotence/acquittement du prestataire officiel. Les bornes techniques de configuration ne sont pas des valeurs recommandées.
- Limites : pas d'envoi, de clôture de succès ni de preuve de réception. Le futur travailleur doit commiter la prise avant tout effet externe et conserver la clé logique de notification auprès du prestataire ; un bail ne garantit pas l'absence d'envoi en double si un appel externe survit à son expiration.
- Réversibilité : laisser la configuration vide et le rôle sans connexion ; aucun travailleur ou endpoint démarré par cette tranche. Aucune donnée financière touchée.
- Suite diagnostic local : `pnpm notifications:check --max-pending N --max-deferred-reminders N` exige ses deux seuils. Épuisement toujours signalé, dépassement strict des seuils (égalité acceptée). Rôle observateur limité aux compteurs ; outil limité à la base molopay_test en boucle locale. Aucun ordonnanceur ni canal de transmission installé : le diagnostic ponctuel ne vaut pas supervision active. Seuils opérationnels, détection par âge et destinataire d'alerte restent à décider ; aucun envoi externe autorisé par cette commande.

### D35 · Sécurité du compte : blocage APP et déblocage humain (lots 06/19)
- Périmètre : consulter ses appareils et sessions, fermer les autres sessions, se déconnecter et bloquer son propre compte depuis une session valide. Le canal est APP : appareil enregistré ne signifie pas appareil attesté. Aucune attestation, récupération ou ré-enrôlement de confiance revendiqué.
- Option prudente : blocage, révocation des appareils et sessions, audit et clé d'idempotence dans une même transaction. Le rôle applicatif perd le droit de modifier directement les champs de blocage ; aucune fonction ni route de déblocage n'est ajoutée.
- À décider avant exploitation : procédure humaine de déblocage après vérification renforcée, ré-enrôlement, et autorisations des canaux support/USSD. Les contrôles de débit globaux restent à compléter au lot de durcissement ; cette tranche n'autorise aucun lancement public.
- Limites : les routes nécessitent une session déjà valide. OTP/SMS et ouverture de nouvelle session ne sont pas implémentés par cette tranche. Après logout/blocage, un nouveau passage dans le garde refuse le cookie invalidé ; seuls des rejouages déjà authentifiés avant le commit peuvent récupérer le succès mémorisé.
- Réversibilité : ne pas exposer les nouvelles routes avant revue humaine ; aucune réactivation automatique et aucune modification financière. F-ACC-006 reste partiel (APP uniquement, sans support/USSD ni ré-enrôlement).
### D36 · F-ACC-005 : réception des demandes, traitement à compléter
- Option appliquée : registre de réception immuable, quatre types fermés, historique privé paginé et reçu ; aucun texte libre, document, export incomplet ou effacement automatique. RECEIVED signifie seulement enregistré, pas pris en charge ni exécuté.
- À décider/livrer : circuit humain habilité, échanges sécurisés pour préciser rectification/opposition, vérification d'identité adaptée, export complet en moins de 30 jours, règles de conservation et suite des événements de traitement. Cette réception seule ne satisfait pas F-ACC-005.
- Aucun changement aux textes juridiques provisoires D23, aucune promesse de service opérationnel, aucune donnée financière modifiée. Pas d'exposition publique avant revue humaine et durcissement du débit.

### D37 · Échec préexistant de rotation de session (6 novembre)
- Preuve : première grappe PostgreSQL jetable 2dhkFP, identity.db.test.ts « fait tourner le refresh une seule fois » échoue avec 23514 / session_access_window ; 304 autres tests passent, quatre nouvelles routes échouent comme attendu avant code (404).
- Cause lue : access_issued_at et access_expires_at calculés avec deux clock_timestamp() distincts ; quelques microsecondes peuvent dépasser la limite de quinze minutes.
- Option prudente : test de durée exacte, puis instant SQL unique matérialisé pour la rotation ; aucune relaxation de contrainte ni modification des tests existants. Revue indépendante requise avec cette tranche.

### D38 · Quotas des routes compte : valeurs et périmètre restant (SEC-API-003)
- Option appliquée : aucune valeur d'exploitation inventée. Sans politique, les quatre routes répondent 503 ; seuls les tests posent des seuils. Une politique ne se modifie pas : une nouvelle version ouvre de nouveaux budgets.
- Limites : compte et appareil seulement ; IP, numéro et partenaire non couverts. Les compteurs ne sont pas purgés (une ligne par action, version, dimension et sujet). Toute la consommation passe par le verrou du compte : le coût sous charge n'est pas mesuré.
- À décider : fenêtres et plafonds par action, circuit d'insertion d'une politique, purge des compteurs, limites IP/numéro/partenaire.
- Réversibilité : retirer le décorateur `CustomerQuota` d'une route ; aucune donnée financière touchée.

### D39 · Paiements, tranche 1 : points non tranchés par les sources (lot 11)
- **Constat :** l'agrégateur n'est pas choisi ; aucune documentation officielle, aucun environnement de test ni identifiant n'est disponible. Les adaptateurs réels sont donc impossibles sans violer « zéro simulation » ou « pas de secret ».
- **Option appliquée (la plus prudente, réversible) :** migration 0026 et module `payments` sans prestataire : tentatives immuables (accord ACTIVE exigé, clé d'idempotence unique, horloge serveur), journal d'états en liste blanche (CDC_05 § 5.1), anti-rejeu des webhooks par nonce et fenêtre ± 5 min imposés en base, vérification HMAC-SHA256 en temps constant côté domaine, port `PaymentProvider` sans implémentation. `CONFIRMED`, `REFUND_PENDING` et `REFUNDED` sont **refusés en base** (`PAYMENT_LEDGER_LINK_REQUIRED`) tant que la confirmation n'est pas liée à une écriture du grand livre (I-6).
- **Lecture inter-modules :** la base de `payments` lit `agreements.agreement_state` pour refuser un paiement sur un accord non ACTIVE (contrôle restrictif). Le code TypeScript de `payments` n'importe pas `agreements` (frontières CDC_05 § 3 respectées).
- **À trancher :**
  1. agrégateur retenu (et donc format du message signé, en-têtes, nonce, liste d'IP) ;
  2. plan de comptes de la confirmation (débit / crédit, compte cantonné, I-8) pour la tranche 2 ;
  3. trop-perçu : refuser une tentative qui dépasse le reste dû, ou l'accepter et rembourser ;
  4. espèces (F-PAY-005) : partenaires habilités, reçu signé, rapprochement sous 24 h ;
  5. numérotation des reçus (F-PAY-006) ;
  6. durée de conservation des nonces (aujourd'hui conservés sans purge).
- **Mise à jour (tranche 2, 10 novembre) :**
  - Point 2 **réglé par les sources** : CDC_04 § 2.2 fixe l'écriture d'un versement (débit 1200, crédit 2100 du client). Appliqué par la migration 0027 ; la base vérifie comptes, sens et montant.
  - Point 3, option prudente appliquée : une tentative supérieure au reste dû (cible − versements confirmés) est refusée (`PAYMENT_EXCEEDS_REMAINING`). Deux tentatives concurrentes encore en attente peuvent toutefois dépasser la cible : le trop-perçu sera remboursé (lot 12). Retour arrière : remplacer `payments.anchor_attempt`.
  - Point 4 : la confirmation des espèces est refusée (`PAYMENT_INVALID_REQUEST`) jusqu'à décision.
  - **Limite connue :** la base de `payments` impose « pas de contribution sans écriture conforme » et « pas de CONFIRMED sans contribution », mais pas « pas d'écriture PAYMENT_CONFIRMED sans contribution » : ce dernier contrôle exigerait un déclencheur sur les tables du grand livre, que `payments` ne doit pas modifier. Le store l'assure ; à couvrir par le rapprochement (lot 14) ou une règle du module ledger.
  - **Reste hors périmètre :** passage de l'accord à `FUNDED` à 100 % (lot 10/12), écriture 1100/1200 à réception des fonds sur le compte cantonné (lot 14), reçus numérotés (F-PAY-006).

### D40 · Rapprochement, tranche 1 : contrôle de cantonnement (lot 14)
- **Appliqué (INT-REC-002/004, sources suffisantes) :** migration 0030 ; la finance saisit le solde du relevé du compte cantonné et les règlements sortants en transit ; la base dérive du grand livre les fonds de tiers (Σ 2100 + 2200 + 2300) et les encaissements en transit (1200), calcule l'écart et ouvre un incident si l'écart ≠ 0 FCFA. Incidents non classés de plus de 48 h listés pour escalade.
- **À trancher :** source et format des relevés (établissement de cantonnement, agrégateur) pour automatiser INT-REC-001 ; qui saisit et qui approuve le relevé (maker-checker ?) ; circuit de classement des écarts et des écritures de régularisation (INT-REC-003) ; destinataire des escalades (INT-REC-004) ; compte des règlements en transit (absent du plan minimal CDC_04 § 2.1, saisi à la main en attendant).
- **Limite :** aucun compte 2200/2300 n'existe encore (lots 12/13) : leur inclusion dans la somme n'est vérifiée que par lecture du code.

### D41 · Réclamations et litiges, tranche 1 (lot 15)
- **Appliqué (F-SUP-001/002/003) :** migration 0032 et module `disputes`. Réclamation numérotée au hasard (`R-` + 10 caractères Crockford, jamais séquentiel, AGENTS § 8), canal en liste blanche (application, rappel USSD, téléphone), heure de réception serveur. Litige ouvert sur une réclamation liée à un accord : l'accord passe à DISPUTED dans la même transaction (versements et annulation alors refusés) ; levée par une autre personne que l'ouverture (I-7), accord ramené à son état d'origine dans la même transaction. Historique chronologique d'un accord (statuts, tentatives, versements, réclamations, litiges), réservé au client de l'accord.
- **Option prudente :** aucun texte libre ni pièce jointe dans une réclamation (données personnelles, D36) ; issue « remboursement » d'un litige non disponible (lot 12) ; un accord DISPUTED sans litige est détecté (`disputes.disputed_without_dispute`), pas bloqué, car `disputes` ne modifie pas les tables d'`agreements`.
- **À trancher :** délai de réponse publié (F-SUP-001, REG-CON-003) ; contenu d'une réclamation (catégories, texte, pièces, conservation) ; rôles habilités à ouvrir et lever un litige (matrice admin, lot 08) ; échanges avec le support dans l'historique ; procédure de médiation et voies de recours publiées (REG-CON-003).

### D42 · Comptes comptables des partenaires (lot 12)
- **Constat :** `ledger.account.owner_id` est un UUID ; les partenaires ont un identifiant texte.
- **Décision (2026-11-10, délégation) :** identifiant comptable UUID v7 immuable attribué à la première validation du partenaire, en ajout seul. Détail : compte rendu § D42.

### D43 · Plafonds KYC par niveau (REG-LBC-001, lot 07)
- **Décision (2026-11-10, délégation) :** valeurs de départ paramétrées (N1 200 000 FCFA détenus / 500 000 par mois ; N2 2 000 000 / 2 000 000 ; N3 10 000 000 / 10 000 000 ; au-delà examen COMPLIANCE). ⚖ À faire valider par l'établissement de cantonnement. Détail : compte rendu § D43.

### D44 · Financeur du modèle B (lot 13)
- **Décision (2026-11-10, délégation) :** B reste fermé sans convention signée ; critères de sélection fixés. ⚖ Choix et signature réservés au fondateur. Détail : compte rendu § D44.

## 2026-11-10 · Décisions prises par délégation du fondateur

> Le fondateur a délégué la décision des points ouverts. Aucune ne touche un invariant (§ 7) ni un interdit (§ 8). Justifications, recherches et sources : `docs/journal/COMPTE_RENDU_DECISIONS_2026-11-10.md`. « ⚖ » = à confirmer par un tiers (juriste, agrégateur, établissement, financeur).

- **D1** Rust validé. **D4** signature SSH dès qu'une clé est fournie. **D6** TSA sous contrat en production ⚖. **D7** revue mensuelle des digests. **D9** extraction du vérificateur avant la recette. **D10** audit lisible par AUDIT et COMPLIANCE, conservation 10 ans. **D11** types d'écriture figés par ADR au lot 12. **D13** OIDC + MFA pour les agents internes. **D21** identifiants confirmés. **D22** nom de base `_test` obligatoire.
- **D23, D25** textes juridiques ⚖ juriste ; revalidation d'un partenaire si règlement, représentant, identifiants légaux ou type changent.
- **D26** type `PAYMENT_PLAN` ; FINANCE prépare, COMPLIANCE approuve ; plan = modèle, rythme, minimum, durée 1–36 mois ; aucun frais ; B fermé jusqu'au lot 13.
- **D27** CDC_05 prévaut (annulation depuis ACTIVE) ; durée en mois ; barème unique 100 % sans frais ; PR de doc proposée pour `FUNDED → CANCELLED_BY_CUSTOMER` (C).
- **D29** personne physique : pièce officielle + preuve du droit sur le bien + règlement à son nom ; NIU facultatif ⚖.
- **D30** CI locale obligatoire jusqu'au déblocage GitHub.
- **D32** contrat aligné sur CDC_05, création en deux temps (brouillon, activation signée + PIN), `durationMonths`.
- **D33/D34** 8 h–20 h Douala ; 1 rappel/jour/projet, 3/semaine/client ; réservation 24 h ; 5 tentatives ; conservation 90 jours.
- **D35** déblocage en maker-checker SUPPORT_N2 / COMPLIANCE après vérification renforcée. **D36** réponse sous 30 jours ⚖ loi 2024/017.
- **D38** quotas v1 : SECURITY_READ 60/h ; REVOKE_OTHERS 5/h ; DATA_RIGHTS_READ 30/h ; DATA_RIGHTS_SUBMIT 5/24 h (compte et appareil).
- **D39** NotchPay et CinetPay présélectionnés ⚖ KYB ; anti-rejeu adapté (signature + déduplication par transaction + confirmation API obligatoire) ; espèces reportées ; reçus numérotés par client + empreinte d'écriture ; nonces 90 jours.
- **D40** relevés camt.053 ou CSV signé ⚖ ; relevé saisi en maker-checker ; écarts classés FINANCE/COMPLIANCE ; escalade direction + établissement.
- **D41** R-2020/06 : réponse sous 15 jours visés, 45 jours max ; catégories fermées + texte limité ; SUPPORT_N2 ouvre, OPERATIONS/COMPLIANCE lève ; médiateur CNEF ; conservation 5 ans ⚖.
- **D42, D43, D44** : voir ci-dessus.
