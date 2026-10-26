# Registre des risques

> Version 1.0 · 26 octobre 2026 · Méthode ISO 31000:2018. Cotation : Probabilité (P) et Impact (I) de 1 à 5 ; Criticité = P × I. Revue mensuelle par le fondateur.

| ID | Risque | Cat. | P | I | Crit. | Parades | Propriétaire | Statut |
|---|---|---|---|---|---|---|---|---|
| R-01 | Lancement complet avec capital limité : dispersion de l'équipe, du support et de la trésorerie | Stratégie | 4 | 5 | 20 | Porte de lancement unique ; peu de partenaires par univers et par ville ; acquisition concentrée sur la tête de pont | Fondateur | Ouvert |
| R-02 | Requalification de l'épargne-achat en collecte de dépôts | Réglementaire | 3 | 5 | 15 | Fonds chez établissement agréé ; avis juridique ; échange COBAC | Fondateur | Ouvert |
| R-03 | Absence de partenaire agréé (cantonnement ou financeur) | Partenariat | 3 | 5 | 15 | Démarches ouvertes en premier ; plusieurs candidats en parallèle | Fondateur | Ouvert |
| R-04 | Délais d'agrément d'établissement de paiement | Réglementaire | 4 | 3 | 12 | Opérer sous agrément du partenaire ; dossier propre en parallèle | Fondateur | Ouvert |
| R-05 | Altération ou erreur du grand livre | Technique | 2 | 5 | 10 | Ajout seul imposé par la base, chaînage, ancrage, vérificateur indépendant | Fondateur | Maîtrisé par conception |
| R-06 | Double crédit ou perte d'un versement (webhooks) | Technique | 3 | 4 | 12 | Idempotence, signature, confirmation API, rapprochement quotidien | Lot 11 | Ouvert |
| R-07 | Fraude marchand–client sur les remises | Fraude | 3 | 3 | 9 | Code à usage unique, règles de fraude, échantillonnage | Lot 16 | Ouvert |
| R-08 | Prise de contrôle de compte (SIM swap, vol de téléphone) | Sécurité | 3 | 4 | 12 | Liaison appareil + PIN, délai de sécurité, KYC renforcé à la récupération | Lot 06 | Ouvert |
| R-09 | Fraude foncière ou bail contesté (modèle C) | Juridique | 3 | 4 | 12 | Vérification du titre ou du bail, contrats types, maker-checker | Fondateur + juriste | Ouvert |
| R-10 | Impayés du modèle B | Crédit | 3 | 3 | 9 | Risque porté par le financeur ; plateforme sans garantie de paiement | Financeur | Transféré |
| R-11 | Économie unitaire négative (frais d'encaissement, commission trop basse) | Économique | 3 | 4 | 12 | Devis agrégateurs, versement minimal, partage des frais, abonnement Pro | Fondateur | Ouvert |
| R-12 | Hébergement non conforme (loi 2024/017) | Réglementaire | 3 | 4 | 12 | ADR-0004 tranché avant toute donnée réelle | Fondateur + DPO | Ouvert |
| R-13 | Fuite de données personnelles | Sécurité | 2 | 5 | 10 | Chiffrement par enveloppe, minimisation, accès journalisés, pentest | Lot 07, lot 24 | Ouvert |
| R-14 | Arrivée de MoloMolo Pay ou renforcement de Tontina Market | Concurrence | 3 | 3 | 9 | Yaoundé, modèles B et C, conformité publiée, vitesse sur le réseau | Fondateur | Ouvert |
| R-15 | Support débordé à l'ouverture | Opérations | 3 | 3 | 9 | Dimensionnement avant ouverture, procédures publiées | Fondateur | Ouvert |
| R-16 | Défaillance d'un agrégateur | Opérations | 2 | 4 | 8 | Interface abstraite, second agrégateur, dégradation contrôlée | Lot 11 | Ouvert |
| R-17 | Code d'agent IA qui affaiblit un invariant sans être détecté | Développement | 2 | 5 | 10 | Garde-fous GF-1…12, double approbation L3, tests d'attaque, vérificateur | Fondateur | Maîtrisé par conception |
| R-18 | Injection d'instructions dans le contexte des agents | Développement | 3 | 4 | 12 | Contenus lus = données, réseau fermé, CI non contournable | Fondateur | Ouvert |
| R-19 | Disponibilité du fondateur (projets parallèles, emploi) | Organisation | 4 | 4 | 16 | Arbitrage du temps, vérification des règles d'activité annexe, délégation des lots humains | Fondateur | Ouvert |
| R-20 | Marché tête de pont trop petit pour une levée de capital-risque | Stratégie | 4 | 3 | 12 | Choix explicite : régionale rentable ou ambition Afrique de l'Ouest | Fondateur | Ouvert |
