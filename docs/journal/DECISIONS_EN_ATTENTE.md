# Décisions en attente — sprint MVP

> Questions pour le fondateur. Pour chacune : option appliquée (la plus prudente et réversible) et procédure de retour arrière.

## 2026-10-26

### D1 · Go absent de la machine
- **Constat :** `go version` → command not found ; aucun binaire dans `Program Files/Go`.
- **Option appliquée :** installer un toolchain Go officiel portable **dans le dossier du projet** (`.toolchains/go`, ignoré par Git) si le réseau vers go.dev le permet ; sinon écrire le vérificateur et consigner qu'il n'a pas été compilé.
- **Retour arrière :** supprimer `.toolchains/`.
- **À trancher :** conserver ce mode d'installation pour le sprint, ou fournir Go via l'image de développement.

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
- **Option appliquée :** utilisation d'une TSA publique réelle sans compte (DigiCert `http://timestamp.digicert.com`, avec repli documenté sur FreeTSA) pour les tests d'intégration ; à remplacer par la TSA retenue en production.
- **Retour arrière :** changer l'URL dans la configuration ; aucune donnée n'est publiée (empreinte SHA-256 seule).
