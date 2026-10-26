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
- **Option appliquée :** lot 06 (Identity) n'est pas commencé faute d'adaptateur SMS réel testable ; aucun faux prestataire ne sera créé.
- **Retour arrière :** déposer les identifiants de test dans `.env.local` (non versionné).

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
