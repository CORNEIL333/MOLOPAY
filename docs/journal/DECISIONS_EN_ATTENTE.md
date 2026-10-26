# Décisions en attente — sprint MVP

> Questions pour le fondateur. Pour chacune : option appliquée (la plus prudente et réversible) et procédure de retour arrière.

## 2026-10-26

### D1 · Go absent de la machine, bascule du vérificateur vers Rust
- **Constat :** `go version` → command not found ; aucun binaire dans `Program Files/Go`. Le téléchargement du toolchain officiel a échoué deux fois (curl exit 56 « schannel: server closed abruptly », fichier bloqué à 10 162 240 octets sur 79 010 309 ; PowerShell en délai dépassé). Rust 1.96.1 est installé et fonctionnel.
- **Option appliquée :** le vérificateur indépendant (lot 04) est écrit en **Rust** dans `tools/verifier/`, module séparé sans import TypeScript (commit `9dd0ee6`). ADR-0001 autorise Go ou Rust pour l'outil de vérification indépendant ; l'exigence d'indépendance (langage et module distincts) est conservée. Le lot reste intitulé « vérificateur indépendant ».
- **Retour arrière :** réécrire le module en Go si un toolchain est fourni ; aucune interface avec le reste du dépôt hors export JSON.
- **À trancher :** fournir Go (préféré par le prompt initial) ou valider définitivement Rust pour le sprint.

### D2 · Docker absent de la machine
- **Constat :** `docker` introuvable ; aucun Docker Desktop installé.
- **Option appliquée :** conformément au prompt § 6, lot 02 livré (migrations + code + tests) **sans exécuter `test:db`** ; les tests PostgreSQL restent à lancer dès que Docker ou un PostgreSQL 16 de test est disponible. Aucun faux PostgreSQL n'est utilisé (zéro simulation).
- **Retour arrière :** aucun changement système.
- **À trancher :** fournir Docker (ou un PostgreSQL 16 local de test) pour valider les contraintes SQL.

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
- **Constat :** les fixtures utilisent `GENESIS`, `PAYMENT_RECEIVED`, `SETTLEMENT_SENT`, `FEE_CHARGED`, `PAYMENT_REVERSED`, `ADJUSTMENT`, mais aucun document normatif ne liste les types autorisés ; le domaine du grand livre valide seulement « chaîne non vide ». Le vérificateur Rust applique donc la même règle (structure, équilibre et hash stricts, type non énuméré).
- **Option appliquée :** ne pas inventer de liste dans le vérificateur, qui refuserait un export légitime dès qu'un nouveau type est introduit. Aucun type inconnu ne peut toutefois passer sans hash cohérent et sans couverture Merkle.
- **Retour arrière :** ajouter une liste blanche dans `packages/chain` et son miroir Rust, puis un test « type inconnu avec hash recalculé ».
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
- **Option appliquée :** les transitions sont pures et testées ; la persistance doit verrouiller la ligne (`SELECT ... FOR UPDATE`) dans la même transaction que la mise à jour et ne jamais accepter des objets construits depuis une requête HTTP. Le niveau KYC n'est plus modifiable par `app_rw` (aucun grant) : seul le propriétaire du schéma l'élève, en attendant le lot KYC. **Risque résiduel assumé :** `had_balance` reste déclaré par l'appelant ; un bug ou une compromission de l'API pourrait supprimer le délai de 24 h. Le corriger demande de lire le solde du grand livre dans un trigger `SECURITY DEFINER`, ce qui couple identity au schéma ledger ; à faire au lot paiements.
- **Retour arrière :** déplacer les compteurs dans des fonctions SQL atomiques ou ajouter une colonne `version` avec mise à jour conditionnelle.
- **À trancher :** verrouillage pessimiste vs optimiste, et source de vérité du solde (grand livre).

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
