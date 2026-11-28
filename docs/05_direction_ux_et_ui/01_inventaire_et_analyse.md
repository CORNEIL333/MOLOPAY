# Inventaire et analyse des interfaces existantes

> Version 1.0 · 20 novembre 2026 · Comptage automatique sur l'ensemble des branches d'agents (`agent/gemini/*`, `agent/qoder/*`, `sprint/integration*`), sans doublon. La branche `master` ne contient que la documentation. Les chiffres peuvent varier d'une ou deux unités selon la branche retenue pour la fusion.

## 1. Inventaire

### 1.1 Écrans

| Application | Écrans | Détail |
|---|---|---|
| Web client (Next.js) | 12 | accueil, connexion, inscription, compte, compte/données, compte/identité, compte/notifications, objectifs, objectifs/nouveau, objectifs/[id], offres/[id] |
| Portail partenaire (Next.js) | 7 | accueil/connexion, commandes, comptoir, enrôlement, offres, règlements, vendeurs |
| Back-office (Next.js) | 8 | accueil/connexion, administration, clients/blocage, conformité, enrôlement, file, réclamations, tableau de bord |
| App mobile (Flutter) | 13 | accueil, connexion, inscription, catalogue, détail d'offre, objectifs, détail d'objectif, nouvelle dépense prévue, notifications, profil, sécurité du compte, droits sur les données, nom légal |
| **Total réel** | **39** | |
| Maquette `mobile-showcase` | 56 | écrans de démonstration décrits en données, non branchés à l'API |

### 1.2 Composants

| Emplacement | Nombre |
|---|---|
| `packages/ui` (partagé web) | 9 : Button, TextField, TextArea, Badge, ProgressBar, GoalCard, AmountXaf, EmptyState, ErrorState |
| Composants web client | 25 |
| Composants portail partenaire | 8 |
| Composants back-office | 10 |
| Composants de page et de mise en page (pages, layouts) | 46 |
| **Total composants React** | **98** |
| Widgets Flutter, app mobile | 26 (13 écrans + 13 widgets) |
| Widgets Flutter, maquette | 10 |

Côté serveur : 13 modules NestJS (identity, kyc, catalog, agreements, payments, ledger, settlement, disputes, risk, reconciliation, notifications, audit, admin). Le module `lending` (modèle B) n'existe pas encore. On compte aussi 303 types et interfaces TypeScript hors tests.

### 1.3 Deux identités divergentes dans le code

| Emplacement | Palette actuelle |
|---|---|
| `packages/ui/src/tokens.ts`, `styles.css` (web) | vert `#0b6b53`, or `#e4a11b`, fond crème |
| `apps/mobile/lib/ui/design.dart`, `apps/mobile-showcase` | orange `#F16B27`, brun `#34271F` |

Elles sont **toutes deux remplacées** par l'identité validée (`02_identite_visuelle.md`).

## 2. Les écrans suffisent-ils ? Non, pas pour le lancement

`CDC_01` exige toutes les fonctions au lancement. Les parcours de base existent (inscription OTP, PIN, catalogue, simulateur, objectifs, comptoir, file back-office), mais plusieurs exigences critiques n'ont aucun écran. Il manque **environ 25 écrans**.

| Interface | Manques | Exigences |
|---|---|---|
| Client | **Faire un versement** (MoMo, OM, carte, PIN, reçu) : aucun appel ne crée de paiement aujourd'hui | F-PAY-001, F-PAY-006 (critique) |
| Client | **Code de remise** affiché à 100 % | F-SAV-004 (critique) |
| Client | **Modèle B** complet : dossier, TEG, échéancier, acceptation, remboursement anticipé ; module `lending` absent | F-FIN-001…006 (critique) |
| Client | **Diaspora** : contribution d'un proche et acceptation | F-DIA-001/002 |
| Client | Élévation KYC (pièces), nouvelle version des CGU, historique chronologique d'un accord | F-ACC-003/004, F-SUP-003 |
| Client mobile | Parité avec le web : réclamation, bénéficiaire (C), annulation, verrouillage | Lot 19 |
| USSD | **Aucun canal** : inscription, solde, versement, blocage, rappel | F-USSD-001/002 (critique) |
| Partenaire | Points de remise et horaires, abonnements et facturation, export CSV, dépôt d'espèces | F-PRT-002/004/005, F-PAY-005 |
| Back-office | Validation des partenaires, vérification bénéficiaires/baux/titres, fiche client avec consultation motivée, décès, audit et contre-passations, rapports régulateur, gestion B | F-PRT-001, F-PLN-002, F-BO-002/004, F-ACC-007, F-REP-* |

Les maquettes de ce dossier couvrent déjà une partie de ces manques : versement, code de remise, comparaison épargne/crédit, comptoir, file à double contrôle, fiche client, réclamations, PWA hors ligne (voir `04_catalogue_des_ecrans.md`).

## 3. Les composants suffisent-ils ? La base est saine mais trop mince

`packages/ui` ne compte que 9 composants. Il en faut **environ 15 de plus** :

- **Saisie** : champ PIN/OTP, liste déroulante, cases et boutons radio, envoi de fichier (pièces KYC, bail), date, glisser pour confirmer.
- **Affichage** : tableau triable avec pagination et export, onglets, fil d'étapes, chronologie, reçu, jauge, carte de projet par univers, pastille de statut.
- **Retour** : fenêtre de confirmation (double contrôle, actions financières), notification temporaire, squelette de chargement, feuille qui monte du bas.

Duplications à résorber : `csp.ts`, `base64url.ts`, `ports.ts` copiés dans les trois apps web ; `design.dart` copié entre `mobile` et `mobile-showcase`, sans paquet Flutter partagé.

## 4. Priorités recommandées

1. Faire un versement et code de remise (le modèle A fonctionne alors de bout en bout).
2. Validation des partenaires et des bénéficiaires dans le back-office.
3. Design system codé et composants manquants (Select, PIN, confirmation, tableau, fichier).
4. USSD, puis modèle B, puis diaspora.
5. Rapports, abonnements, décès, audit.
