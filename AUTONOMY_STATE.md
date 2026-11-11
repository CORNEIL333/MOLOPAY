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
| BLOCKED | Routes HTTP back-office (remboursements, virements, règlements) | aucune authentification du personnel (lot 21, réseau isolé, MFA) : décision d'architecture à prendre ; préparer le contrat seulement |
| BLOCKED | Lot 11 adaptateurs prestataires réels | identifiants d'environnement de test officiels (humain) |
| BLOCKED | Lot 13 Lending B | financeur agréé non désigné (D44) |
| BLOCKED | Taux de commission, délai de contestation | décision du fondateur (D46) |
| BLOCKED | Textes juridiques, version des conditions | D23 |
| BLOCKED | App mobile Flutter | livrée par ChatGPT selon `PROMPT_CHATGPT_APP_MOBILE.md`, branchement ensuite |

## Décisions techniques importantes (rappel)
- Toute sortie de fonds : préparation → décision par une autre personne → instruction Ed25519 canonique → exécution enregistrée par une autre personne ; base garante (déclencheurs) ; écriture et état dans la même transaction.
- Montants et contreparties toujours recalculés par la base, jamais crus de l'appelant.
- Chaque règle de base est prouvée par mutation (script `scratchpad/mut.py`).

## Prochaine action concrète
F-PLN-003 : reçu au client et au bénéficiaire après règlement C (inventaire de 0037 reçus de paiement) ; sinon lot 25 (jeu de données de recette généré, sans donnée réelle).
