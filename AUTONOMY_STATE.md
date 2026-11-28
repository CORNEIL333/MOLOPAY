# AUTONOMY_STATE — état de reprise de l'agent

> Fichier de reprise demandé par le fondateur (directive « autonomie continue multi-lots », 11 novembre 2026).
> Il ne remplace ni `AGENTS.md` (règles), ni `docs/journal/ETAT.md` (état détaillé), ni `docs/journal/DECISIONS_EN_ATTENTE.md` (décisions D1…).
> Branche de travail : `sprint/integration-t01urw` (jamais `main`, aucune fusion par l'agent).

## Objectif général
Plateforme camerounaise d'achat planifié (modèles A, B, C) : API NestJS + PostgreSQL au grand livre en ajout seul, chaîné et vérifié ; client web/mobile ; aucune simulation de prestataire.

## Reprise après interruption
1. Lire `AGENTS.md`, ce fichier, puis `docs/journal/ETAT.md` (en-tête).
2. `git log --oneline -5` et `git status` pour l'état réel.
3. Base de test jetable : `scratchpad/pg-up.sh` (grappe `/var/tmp/molopay-pg`, port 55432) ; `DATABASE_URL=postgres://molopay@127.0.0.1:55432/molopay_test pnpm vitest run --config vitest.db.config.ts`.
4. Reprendre « Prochaine action » ci-dessous.

## Backlog opérationnel

| Statut | Travail | Notes |
|---|---|---|
| DONE | Lots 00–06, 08 (code), 09 partiel, 10 A/C, 11 tranche sans prestataire | voir `ETAT.md` |
| DONE | Lot 12 : remise, règlement marchand, instruction signée, exécution (D45, D46) | 0039–0042 |
| DONE | Lot 12 : règlement C au bénéficiaire avec pièce (D48) | 0043/0044 |
| DONE | Lot 12 : remboursement après annulation (D49) | 0045/0046, 11 mutants tués |
| DONE | Lot 12 : virement au bénéficiaire C, alerte 24 h commune (D50) | 0047, 15 mutants tués |
| DONE | D32 objectifs HTTP, plans et devis, notifications outbox (D47) | |
| DONE | Routes client C : dépôt de pièce, règlement au bénéficiaire sous PIN | contrat 0.4.0, 11 tests HTTP |
| DONE | Trop-perçu restitué, nouvelle tentative de remboursement (D51) | 0048, 9 mutants tués |
| DONE | Notifications des fonds sortis au client (D52) | SETTLEMENT_CONFIRMED, pas de nouveau type |
| DONE | Lot 16 Risk tranches 1–2 : règles explicables, alertes, décision tracée (D53) | 0049, 17 mutants tués |
| BLOCKED | Lot 16 : comptes multiples par appareil ; changement de numéro suivi de retrait | attestation d'appareil (lot 19) ; historique des numéros absent |
| DONE | Lot 14 : classement des écarts en maker-checker, escalade 48 h (D54) | 0050, 8 mutants tués |
| BLOCKED | Lot 14 : rapprochement à trois voies (INT-REC-001) | relevés réels agrégateur et établissement (accès humain) |
| DONE | Lot 14 : suspens 2900 soldé ou justifié en fin de mois (D55) | 0051, 7 mutants tués |
| DONE | Lot 15 : clôture des réclamations, délai de réponse, rôles du litige, écart D46 (D56) | 0052, 7 mutants tués |
| DONE | Notification de la clôture d'une réclamation (D56) | DISPUTE_UPDATED |
| DONE | Réservation du stock à l'activation (F-CAT-005, D57) | 0053, 7/8 mutants (1 équivalent) |
| BLOCKED | F-CAT-005 : réapprovisionnement, remplacement ou remboursement en cas de rupture | engagement commercial à décider |
| DONE | Catalogue public : disponible affiché (D57) | contrôleur dans workflows |
| DONE | Historique de l'accord : clôture des réclamations (F-SUP-003) | |
| DONE | Reçu de règlement C consultable par le client (D58) | contrat 0.5.0 |
| BLOCKED | Reçu et notifications aux partenaires/bénéficiaires | canal partenaire : portail en lecture disponible ; envoi actif (courriel/SMS) à décider |
| BLOCKED | F-PRT-002 écriture du catalogue par le partenaire | décision du fondateur (D63) |
| IN_PROGRESS | Lot 20 : comptes partenaires WebAuthn (D63) | tranches 1–5 faites (0057, 0058, connexion WebAuthn, remise au comptoir, gestion des vendeurs, commandes, règlements au gérant, export CSV, offres en lecture, contrat 0.19.0, fermé par défaut ; portail web : connexion, enrôlement, comptoir, commandes, règlements, vendeurs, offres, navigation ; contrat 0.20.0) ; reste : création du gérant au back-office (décision périmètre), build (D64) |
| DONE | Client web : parcours bénéficiaire C (pièce, PIN, reçu) | 6 tests composants, build OK |
| DONE | Test de la chaîne complète des migrations 0001→0053 | I-2 vérifié sur tous les schémas en ajout seul |
| DONE | Export du grand livre + vérificateur Rust sur flux réels (D59) | altération détectée |
| DONE | Lot 25 : jeu de recette généré par les flux réels (`pnpm recette:generate`) | vérifié par `verify:ledger` |
| DONE | Quotas des routes C (D60) | 0054 |
| DONE | Quotas des routes d'objectifs (D61) | 0055 |
| DONE | Lot 24 : cache, garde Origin et Idempotency-Key vérifiés sur toutes les routes | défaut corrigé sur le devis |
| BLOCKED | Lot 23 : envoi des têtes aux témoins réels | conventions, canal authentifié, clé HSM |
| IN_PROGRESS | Lot 21 : authentification du personnel WebAuthn (ADR-0007 proposé, D62) | tranches 1–14 faites (serveur complet ; web : enrôlement, connexion par clé, file, actions, administration ; bout en bout réel) ; fermé par défaut, à valider par le fondateur |
| DONE | Lot 21 : tableau de bord agrégé F-BO-003 (D65) | API, contrat 0.21.0, écran `/tableau-de-bord` |
| IN_PROGRESS | Lot 07 : filtrage ONU (REG-LBC-002, D66) | tranches 1–2 : 0059, liste réelle, import, filtrage, examen, routes back-office, écran `/conformite`, contrat 0.22.0 ; reste : import en exploitation et validation conditionnée (⚖ D66) |
| DONE | Lot 07 : niveau KYC 1 (nom déclaré + filtrage ONU, D68) | 0060, route client, écran `/compte/identite`, contrat 0.23.0 ; quota à valider |
| BLOCKED | Lot 07 : PPE, listes nationales, niveaux 2–3 (pièce + vivacité : prestataire) | source PPE et listes CEMAC à décider (D66) ; prestataire de vivacité (zéro simulation) |
| DONE | Historique des versements d'un objectif (F-PAY-006, D69) | contrat 0.24.0 |
| DONE | Réclamation client `POST /v1/goals/{goalId}/claims` (F-SUP-001, D70) | 0061, contrat 0.25.0, écran sur la page d'objectif |
| DONE | Quotas nom légal et réclamations (D72) | 0062, contrat 0.26.0 |
| DONE | Rapprochements sanctions en attente dans la file + ouverture d'un filtrage existant (D75) | contrat 0.29.0 |
| DONE | Détail d'une réclamation au back-office (D73) | contrat 0.27.0, écran `/reclamations` |
| DONE | Revue indépendante du 19 novembre : B-1 réponse neutre du nom légal (D77) ; I-1 invisibles et homoglyphes ; I-2/I-5 filtrage recalculé par la base, liste officielle (0063) ; I-3 périmètre `SCREEN_PARTNER` ; I-4 écartement client à deux personnes (0064, D78) | contrats 0.30.0 et 0.31.0 ; mutants tous tués |
| DONE | Mineurs de la revue : `&#0;` et taille UTF-8 de la liste ONU ; instantané unique réel (REPEATABLE READ) pour les versements, commentaires rectifiés ailleurs | |
| DONE | SEC-API-005 : CSP à nonce pour back-office et portail partenaire ; REG-DPD-001 : registre T-11 à T-15 ; NF-UX-002 portail ; NF-UX-005 ; SEC-CRY-005/006 | |
| DONE | Mineurs restants : codes métier exacts dans les tests de refus, jeton transplanté, défi inconnu indiscernable, détail uniforme des refus d'authentification ; D79 consigné | |
| DONE | C2 : profil `GET /v1/me`, renouvellement de session, inscription par OTP (envoi SMS fermé sans prestataire), connexion appareil + PIN (D71 selon SEC-AUTH-001) | 0066, contrat 0.34.0 ; reste : adaptateur SMS (prestataire), nouvel appareil et récupération |
| DONE | C4 blocage support (0068), C5 fil de notifications (0069), C6 écrans back-office manquants, C7 gel des flux sortants à deux personnes (0070, D84) | contrats 0.36.0 à 0.39.0 |
| DONE | C8 REG-LBC-004 ; NF-SAFE-002 plafond d'objectifs actifs (0071, D86) ; C9 gel automatique sur divergence du vérificateur (0072, D87) ; C10 TECH_ADMIN ≤ 2 (0073) ; C11 conditions réacceptées (0074, D88) ; traçabilité NF-MNT-004, NF-COMP-002 et citations | contrats 0.40.0 et 0.41.0 |
| DONE | Lots G2–G6 repris de Gemini (24 nov., instruction du fondateur) : client web, portail partenaire et mobile intégrés ; web : conditions, clé de navigateur (D89) ; mobile : connexion par défi, Flutter 3.47.9 épinglé (`scratchpad/flutter-sdk`), D90 | mobile : 39 tests ; web : 284 |
| DONE | 24–25 nov. : C12 Twilio, C13 inscription en agence (0075), hébergement tranché (ADR-0004 : Neon + AWS Francfort, AWS KMS), C15 `pnpm db:transfer`, C14 tranche 1 (noyau de chiffrement + AWS KMS) | contrats 0.42.0 |
| DONE | 25 nov. : C14 tranche 2 (0076, plus aucun numéro en clair en base) ; revue croisée de la PR #10 de Qoder (CRM) publiée | |
| DONE | 28 nov. : D5 signataire des instructions derrière une interface asynchrone : AWS KMS (ECC_NIST_EDWARDS25519) en production, fermé sans `INSTRUCTION_SIGNING_KMS_KEY_ARN` ; format et vérification inchangés ; liste blanche des documents (aucune donnée personnelle) | 16 tests, 31 mutants tués, 3 équivalents ; `pnpm test:kms` (clé de test humaine) |
| DONE | 28 nov. : D121 tranché par le fondateur (push au lancement, SMS par type activé par l'équipe, 8 h–20 h, langue de l'app) ; tranche 1 : langue déclarée et bascule SMS (0080, contrat 0.46.0) | 28 mutants tués, 5 équivalents ; restent travailleur SMS (tranche 2) et push (D122) |
| BLOCKED | Mise en service des routes back-office | approbation d'ADR-0007, attestation matérielle, réseau isolé |
| BLOCKED | Lot 11 adaptateurs prestataires réels | identifiants d'environnement de test officiels (humain) |
| BLOCKED | Lot 13 Lending B | financeur agréé non désigné (D44) |
| BLOCKED | Taux de commission, délai de contestation | décision du fondateur (D46) |
| BLOCKED | Textes juridiques, version des conditions | D23 |
| BLOCKED | E2E back-office : build Next.js refusé (16.4.3 vulnérable, D64) | montée épinglée 16.4.5 à revoir par un humain |
| TODO | App mobile Flutter et version bureau | **réattribuée à Gemini** (19 novembre, lots G2–G3 de `docs/journal/ATTRIBUTIONS.md`) ; `PROMPT_CHATGPT_APP_MOBILE.md` remplacé |

## Décisions humaines attendues
Voir `docs/journal/FICHE_DECISIONS_2026-11-17.md` (D63–D78, questions fermées) et `docs/journal/FICHE_POINTS_OUVERTS_2026-11-11.md` (paramètres financiers, engagements client, authentification du personnel, accès externes).

## Décisions techniques importantes (rappel)
- Toute sortie de fonds : préparation → décision par une autre personne → instruction Ed25519 canonique → exécution enregistrée par une autre personne ; base garante (déclencheurs) ; écriture et état dans la même transaction.
- Montants et contreparties toujours recalculés par la base, jamais crus de l'appelant.
- Chaque règle de base est prouvée par mutation (script `scratchpad/mut.py`).

## Prochaine action concrète
1. **PR #10 (CRM, Qoder)** : revue publiée le 25 nov. ; attendre ses correctifs (lire `phone_masked`, tests sur fixture protégée). À l'intégration, côté Claude : 4 routes CRM au contrat, action `MANAGE_CRM` + audit `CRM_*` (D109), `crm` dans les listes `SCHEMAS` des suites récentes, test `migrations-chain` adapté aux plages réservées (D113, à faire valider par le fondateur).
2. Lots G repris de Gemini : mobile complet pour tout ce qui ne signe pas (SEC-MOB-005 C16, règlement C C17 faits le 25 nov.) ; écran « mise à jour requise » C18 fait ; restent le lien boutique à la publication, le dépôt de pièce sur mobile (D115), et tout ce qui signe (activation, annulation, renouvellement de session : D90) ; code de remise : D69.
3. Production sans décision (27 nov.) : P1 configuration complète + `pnpm config:check`, P2 artefact `pnpm build:api` testé au lancement, P3 en-têtes de sécurité, P4 confirmation d’envoi des notifications (0078), P5 contrôles de plateforme, P6 garde de session sur chaque route, P7 alertes de supervision (0079, `pnpm ops:alerts`) ; procédure `PROCEDURE_DEPLOIEMENT_API.md`. Restent : Dockerfile (à tester sur une machine avec Docker), travailleur de notifications (D121). Signataire KMS livré le 28 nov. (fermé tant que le fondateur ne crée pas la clé).
3. Lots Neon N1–N5 livrés le 26 nov. (`db:migrate`, TLS verify-full, `db:roles`, `db:backup`/`db:restore-backup`, `PROCEDURE_NEON.md`) ; restent des accès humains (projet Neon, DPA, KMS, S3) et D117–D118.
3. F-ACC-007 tranche 1 faite (C19, 0077) ; tranche 2 (restitution aux ayants droit) attend D116.
4. Décisions ouvertes : D85–D91, D113, D114, D115, D116, D117, D118, autorisation de transfert (loi 2024/017), région AWS confirmée (Francfort retenue avec Neon).
Flutter : `export PATH=<scratchpad>/flutter-sdk/flutter/bin:$PATH PUB_CACHE=<scratchpad>/pub-cache`.
