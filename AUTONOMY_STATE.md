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
| READY | Réclamation client `POST /v1/goals/{goalId}/claims` (F-SUP-001, D69) | store existant |
| BLOCKED | Mise en service des routes back-office | approbation d'ADR-0007, attestation matérielle, réseau isolé |
| BLOCKED | Lot 11 adaptateurs prestataires réels | identifiants d'environnement de test officiels (humain) |
| BLOCKED | Lot 13 Lending B | financeur agréé non désigné (D44) |
| BLOCKED | Taux de commission, délai de contestation | décision du fondateur (D46) |
| BLOCKED | Textes juridiques, version des conditions | D23 |
| BLOCKED | E2E back-office : build Next.js refusé (16.4.3 vulnérable, D64) | montée épinglée 16.4.5 à revoir par un humain |
| BLOCKED | App mobile Flutter | livrée par ChatGPT selon `PROMPT_CHATGPT_APP_MOBILE.md`, branchement ensuite |

## Décisions humaines attendues
Voir `docs/journal/FICHE_POINTS_OUVERTS_2026-11-11.md` (paramètres financiers, engagements client, authentification du personnel, accès externes).

## Décisions techniques importantes (rappel)
- Toute sortie de fonds : préparation → décision par une autre personne → instruction Ed25519 canonique → exécution enregistrée par une autre personne ; base garante (déclencheurs) ; écriture et état dans la même transaction.
- Montants et contreparties toujours recalculés par la base, jamais crus de l'appelant.
- Chaque règle de base est prouvée par mutation (script `scratchpad/mut.py`).

## Prochaine action concrète
D69 : `POST /v1/goals/{goalId}/claims` (F-SUP-001) — réclamation ouverte par le client sur son objectif (canal APP), numéro `R-…`, délai cible publié ; lire le schéma du contrat et `disputes/dispute.store.ts` (`recordComplaint`) ; tests HTTP d'abord (autre client : 404 ; quota à proposer).
