# Plan de lots — réalisation par agents IA

> Version 1.0 · 26 octobre 2026 · Chaque lot est dimensionné pour un agent et une PR (ou une courte série de PR). Un lot ne démarre que si ses dépendances sont **fusionnées**. Le niveau de risque suit `COLLABORATION_ET_GARDE_FOUS.md` § 3.
> **Tout est livré avant la porte de lancement** ; l'ordre ci-dessous est un ordre de construction, pas un report.

## 0. Vue d'ensemble

```
Lot 00 Outillage ─┬─► Lot 01 Money ─► Lot 02 Ledger ─► Lot 03 Chaînage/Merkle ─► Lot 04 Vérificateur
                  │                       │
                  ├─► Lot 05 Audit ◄──────┘
                  ├─► Lot 06 Identity ─► Lot 07 KYC
                  ├─► Lot 08 Admin (paramètres, maker-checker)
                  └─► Lot 09 Catalog ─► Lot 10 Agreements A/C ─► Lot 11 Payments ─► Lot 12 Settlement
                                                │                      │
                                                └─► Lot 13 Lending B ◄─┘
Lot 14 Reconciliation · Lot 15 Disputes · Lot 16 Risk · Lot 17 Notifications · Lot 18 USSD
Lot 19 Mobile · Lot 20 Portail partenaire · Lot 21 Back-office · Lot 22 Diaspora · Lot 23 Exports
Lot 24 Durcissement & charge · Lot 25 Préparation recette & pentest
```

## 1. Lots

| Lot | Contenu | Exigences | Dépend de | Niveau | Critère de sortie |
|---|---|---|---|---|---|
| **00 · Outillage** | Monorepo, pnpm, lint, frontières de modules, CI, scans sécurité, SBOM, Testcontainers, gabarits PR, CODEOWNERS | SEC-SDLC-001…004, NF-MNT-001 | ADR-0001 accepté | L3 | Toutes les commandes du § 5 d'`AGENTS.md` existent et tournent en CI |
| **01 · Money** | Type `Money` XAF `bigint`, répartition en versements, arrondis, tests de propriété | NF-FUN-001/002 | 00 | L3 | 10⁶ cas de propriété verts ; aucun flottant détecté |
| **02 · Ledger** | Plan de comptes, écritures, lignes, contraintes SQL (ajout seul, équilibre différé, séquence), soldes dérivés, contre-passation | INT-LED-001…008 | 01 | L3 | Suite d'attaque grand livre verte ; tests de mutation ≥ 80 % |
| **03 · Chaînage et Merkle** | `prev_hash`/`entry_hash` (JCS + SHA-256), lots, arbres RFC 6962, tête signée Ed25519 (clé de développement réelle, hors dépôt), horodatage RFC 3161 auprès d'une autorité réelle, preuves d'inclusion et de cohérence | INT-HASH-*, INT-ANC-001…005 | 02 | L3 | Altération détectée ; preuves vérifiées par un test indépendant |
| **04 · Vérificateur indépendant** | Dépôt séparé (Go/Rust) : recalcul équilibre, chaîne, Merkle, signatures depuis un export | INT-VER-001…003 | 03 | L3 | Détecte 100 % des altérations injectées dans le jeu de test |
| **05 · Audit** | Journal d'audit chaîné, motifs de consultation, API de lecture pour l'audit | SEC-LOG-001, F-BO-004 | 02 | L2 | Toute action back-office produit un événement chaîné |
| **06 · Identity** | Inscription OTP, PIN (Argon2id), appareils, signature de transaction, sessions, récupération | F-ACC-001/002/006, SEC-AUTH-* | 00, 05 | L2 | Suites d'attaque identité vertes |
| **07 · KYC** | Niveaux, plafonds, pièces chiffrées, filtrage sanctions/PPE sur les listes officielles réelles (ONU, nationales), DPIA notée | F-ACC-003, REG-LBC-001/002 | 06 | L2 | Plafonds appliqués côté serveur |
| **08 · Admin** | Rôles internes, RBAC/ABAC, paramètres versionnés, moteur maker-checker générique, bris de glace | F-BO-001, SEC-AUTHZ-001…005 | 05 | L3 | Matrice rôle × action testée exhaustivement |
| **09 · Catalog** | Partenaires, onboarding maker-checker, offres, plans approuvés, stock, univers, villes | F-CAT-*, F-PRT-001/002 | 08 | L1–L2 | Partenaire ne peut créer de plan de crédit |
| **10 · Agreements A et C** | Objectifs, accords signés, prix figé, verrouillage, annulation, gel, bénéficiaires vérifiés | F-SAV-*, F-PLN-* | 02, 06, 09 | L3 | Machines à états testées à 100 % des transitions |
| **11 · Payments** | Interface `PaymentProvider`, adaptateurs réels des API officielles (agrégateur retenu ; MTN MoMo et Orange Money), testés contre leurs environnements de test officiels, tentatives, webhooks signés, confirmation API, idempotence, espèces | F-PAY-*, SEC-API-002, INT-IDEM-* | 02, 10 | L3 | Suite d'attaque paiements verte (rejeu, désordre, falsification) |
| **12 · Settlement** | Codes de remise, remises, règlements nets, remboursements, instructions signées, délai de contestation | F-SET-*, INT-NR-002 | 08, 10, 11 | L3 | Maker-checker infalsifiable ; double remise impossible |
| **13 · Lending B** | Dossiers financeur, consentement, décisions, TEG, échéancier, collecte pour le financeur, charte de recouvrement | F-FIN-*, REG-CON-001 | 10, 11, 12 | L3 | Aucune remise sans décision authentifiée |
| **14 · Reconciliation** | Rapprochement 3 voies, invariant de cantonnement, écarts, suspens | INT-REC-* | 11, 12 | L3 | Écart injecté détecté et classé |
| **15 · Disputes et support** | Réclamations, litiges bloquants, historique | F-SUP-* | 10, 12 | L2 | Litige suspend règlement |
| **16 · Risk** | Règles de fraude explicables, alertes, dossiers | SEC-FRD-* | 11, 12 | L2 | Scénarios de fraude de `CDC_07` détectés |
| **17 · Notifications** | SMS/push, gabarits FR/EN, plages horaires, masquage | F-NOT-* | 10, 11 | L1 | Aucune donnée sensible dans les messages |
| **18 · USSD** | Menus, sessions, reprise, idempotence | F-USSD-* | 06, 10, 11 | L2 | Coupure à chaque étape sans effet double |
| **19 · App mobile** | Parcours client A/B/C, PIN, appareil, attestation, épinglage, hors ligne lecture, accessibilité | F-*, SEC-MOB-*, NF-UX-* | 06, 10–13 | L2 | Contrôles MASVS-L2+R passés |
| **20 · Portail partenaire** | Catalogue, personnel, remises, règlements, abonnements, exports | F-PRT-* | 09, 12 | L2 | Isolation inter-partenaires testée |
| **21 · Back-office** | Tableaux de bord, dossiers, maker-checker, audit, réseau isolé | F-BO-* | 08, 12–16 | L3 | Aucun chemin de modification du grand livre |
| **22 · Diaspora** | Contribution à l'objectif d'un proche, acceptation, canal agréé réel (API du partenaire de transfert) | F-DIA-* | 10, 11 | L2 | Contrôles LBC/FT bloquants |
| **23 · Exports et ancrage partenaires** | Exports signés, envoi réel des têtes aux témoins par canal authentifié, accusés signés | F-REP-*, INT-ANC-004 | 03, 14 | L3 | Un témoin réel (ou, avant signature des conventions, un témoin interne indépendant hors infrastructure de production) reçoit et vérifie les têtes |
| **24 · Durcissement et charge** | Tests de charge, chaos, revue ASVS L3/L2, en-têtes, limitation de débit | NF-PERF-*, NF-REL-*, SEC-API-* | Tous | L2 | Cibles × 3 tenues ; liste ASVS renseignée |
| **25 · Préparation recette** | Jeux de données de test générés (aucune donnée personnelle réelle), scripts de recette, dossier pour le pentest, runbooks | CDC_07, CDC_08 | Tous | L1 | Dossier de recette prêt pour les humains |

## 2. Lots humains en parallèle (non délégables aux agents)

| Lot | Contenu | Responsable |
|---|---|---|
| H1 | Avis juridique, contrats types, formalités données personnelles | Fondateur + juriste |
| H2 | Conventions établissement de cantonnement et financeur | Fondateur |
| H3 | Contrat agrégateur ; identifiants des environnements de test officiels remis aux agents dès la première semaine ; production réservée aux humains | Fondateur |
| H4 | Recrutement des partenaires des 4 univers, 2 villes | Fondateur + agents terrain |
| H5 | Recherche primaire (30 entretiens, 10 prochains clients) | Fondateur |
| H6 | Test d'intrusion indépendant, exercice de crise | Fondateur + prestataire |
| H7 | Hébergement, KMS/HSM, comptes cloud, secrets de production | Fondateur |

## 3. Démarrage d'un lot (message type à l'agent)

```markdown
Lot <NN> — <titre>.
Lis AGENTS.md, COLLABORATION_ET_GARDE_FOUS.md, puis les exigences : <IDs>.
Commence par l'inventaire de l'existant, puis rédige le plan dans une PR brouillon.
Niveau de risque : <L>. <Si L2/L3 : attends mon approbation du plan avant de coder.>
Périmètre de fichiers autorisé : <chemins>.
```
