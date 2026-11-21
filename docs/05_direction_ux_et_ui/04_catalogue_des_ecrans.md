# Catalogue des écrans maquettés

> Version 1.0 · 20 novembre 2026 · 23 écrans et un site complet. « Interactif » signifie que la maquette réagit aux actions (utile pour les tests utilisateurs).

## App mobile — `maquettes/identite-app-mobile.html`

| Écran | Contenu | Exigences | Interactif |
|---|---|---|---|
| Accueil | Total épargné, projets empilés par univers, navigation flottante | NF-UX-003 | |
| Objectif | Écran à la couleur de l'univers, jauge, reste à verser, rythme, date estimée | F-SAV-001, F-SUP-003 | |
| Verser | Écran sombre, pavé numérique, montants rapides, glisser pour confirmer, reçu numéroté | F-PAY-001, F-PAY-006, NF-UX-005 | Oui |
| Nouvel objectif | 3 étapes, choix du rythme, coût total et sortie avant engagement | F-SAV-001, F-CAT-004 | |
| Code de remise | Ticket à usage unique, boutique, horaires, pièce à présenter, validité | F-SAV-004 | |
| Catalogue | Ville, recherche, univers, mise en avant, offres avec coût par jour | F-CAT-001, F-CAT-004 | Oui (filtres) |
| Filtres | Ville, budget, façon de payer, marque | F-CAT-004 | |
| Fiche produit | Partenaire vérifié, prix, bascule épargne/financement, garantie, stock | F-CAT-004, F-FIN-003 | Oui |
| Boutique partenaire | Identité vérifiée, offres, points de remise, horaires | F-PRT-001/002 | |
| Comparer | Épargne et crédit côte à côte, coût total et TEG | F-FIN-003, REG-CON | |

## Écrans web — `maquettes/ecrans-web.html`

| Application | Écran | Contenu | Exigences | Interactif |
|---|---|---|---|---|
| Portail partenaire | Tableau de bord du gérant | Remises, objectifs clients (anonymes jusqu'à 100 %), règlement, stock, export CSV | F-PRT-004 | |
| Portail partenaire | Comptoir du vendeur | Saisie ou scan du code, contrôles, numéro de série, confirmation | F-SET-001 | Oui |
| Client web (PWA) | Mes objectifs (ordinateur) | Projets, versements avec reçus, diaspora, installation | F-PAY-006, F-DIA-001 | |
| Client web (PWA) | Installation et hors ligne (téléphone) | Ajout à l'écran d'accueil ; consultation hors ligne datée | NF-UX-004 | |
| Back-office | Vue d'ensemble | Fonds cantonnés et grand livre, versements, règlements, litiges, univers, villes | F-BO-003, INT-REC | |
| Back-office | File de travail | Double contrôle : règlements, remboursements, baux, fraude, rapprochement, décès | F-SET-003, F-ACC-007 | |
| CRM | Fiche client 360° | Consultation journalisée, objectifs, chronologie, réclamation, notes | F-BO-004, F-SUP-003 | |
| CRM | Réclamations et campagnes | Colonnes avec délai restant ; campagnes conformes à la charte | F-SUP-001/002, F-NOT-003 | |

## Site public — `maquettes/site-public.html`

| Section | Contenu | Exigences | Interactif |
|---|---|---|---|
| Héros | Simulateur en phrase : produit, montant, rythme → date d'obtention | F-PUB-003 | Oui |
| Catalogue | 12 offres, recherche, univers, ville, coût par jour | F-PUB-001, F-PUB-009 | Oui |
| Fiche produit | Épargne, crédit ou dépense planifiée ; curseur de rythme ; coût total | F-PUB-003/004 | Oui |
| Inscription | Numéro de téléphone au moment de réserver (démonstration) | F-PUB-005 | Oui |
| Confiance | Circuit de l'argent et 4 promesses | F-PUB-006 | |
| Diaspora, partenaires, FAQ, appel final | Conversion des différents publics | F-PUB-007 | |

## Parcours inclusifs — `maquettes/parcours-inclusifs.html`

| Écran | Contenu | Exigences | Interactif |
|---|---|---|---|
| Verser en 4 représentations | Chiffres, « 25 mille », billets, voix ; pastilles ; alerte au-delà de 10 fois le versement habituel | F-PAY-001, NF-UX-001 | Oui (montant, voix) |
| Relecture avant PIN | Montant, projet et reste lus à voix haute ; mode assisté | NF-UX-005 | Oui (voix) |
| Simulateur USSD | Langue, menu en 5 options, payer, solde avec anneau texte, rappel, blocage en une étape, reprise après coupure, reçu SMS | F-USSD-001/002, F-PAY-006 | Oui |
| Inscription | L'objectif avant la paperasse, paliers P0/P1/P2 | F-ACC-001/003 | |
| CGU en couches | 5 points, audio, FR/EN, consentements non précochés | F-ACC-004, REG-DPD | Oui |
| Pièce d'identité | Demandée avant le premier retrait, capture guidée, envoi différé, alternative en boutique | F-ACC-003 | |
| Diaspora : contribuer | Coût total EUR → FCFA avant engagement | F-DIA-001/002 | Oui (montant) |
| Diaspora : suivi | Chronologie honnête, accord du proche, preuve par le fournisseur | F-DIA-001 | |
| Pack d'entrée logement | Caution, avance, commission ventilées ; confirmation en 3 temps | F-PLN-001/002/003 | |
| Bailleur sur téléphone basique | Confirmation par SMS avec code | F-PLN-003 | |
| Frais de scolarité | Matricule, nom de l'élève affiché, grille par tranche | F-PLN-001 | |

## Encore à maquetter

Parcours complet du modèle B, acceptation d'une contribution diaspora côté proche, validation des partenaires et vérification des baux en back-office, rapports régulateur, abonnements partenaires.
