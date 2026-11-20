# Registre des traitements de données personnelles

> Version 1.2 · 20 novembre 2026 (T-16 ajouté : CRM) · Version 1.1 · 19 novembre 2026 (T-11 à T-15 ajoutés d'après le code) · Cadre : loi n° 2024/017 du 23 décembre 2024 (en vigueur depuis le 23 juin 2026). **Projet à valider par le DPO et le juriste** (bases légales, durées, formalités préalables).

| # | Traitement | Finalité | Personnes | Données | Base légale (à confirmer) | Destinataires | Durée de conservation (à confirmer) | Localisation |
|---|---|---|---|---|---|---|---|---|
| T-01 | Gestion des comptes clients | Fournir le service | Clients | Téléphone, nom, appareil, PIN (empreinte) | Exécution du contrat | Équipe interne habilitée | Durée de la relation + délai légal | ADR-0004 |
| T-02 | KYC et LBC/FT | Obligations légales | Clients, partenaires, représentants | Pièce d'identité, selfie, adresse, origine des fonds, résultats de filtrage | Obligation légale | Partenaires assujettis, ANIF via l'assujetti | ≥ 10 ans après fin de relation (à confirmer) | ADR-0004 |
| T-03 | Objectifs, versements, règlements | Exécution des accords | Clients, partenaires, bénéficiaires | Montants, dates, références | Exécution du contrat ; obligation comptable | Établissement de cantonnement, partenaires | Délai comptable et LBC/FT | ADR-0004 |
| T-04 | Dossiers de crédit B | Transmission au financeur | Clients | Identité, historique d'épargne, revenus déclarés | **Consentement explicite** + exécution du contrat | Financeur | Selon convention et obligations du financeur | ADR-0004 |
| T-05 | Lutte contre la fraude | Protéger clients et plateforme | Clients, partenaires | Événements, appareils, signaux | Intérêt légitime / obligation légale | Équipe Risque | 5 ans (à confirmer) | ADR-0004 |
| T-06 | Support et réclamations | Traiter les demandes | Clients, partenaires | Échanges, pièces jointes | Exécution du contrat | Support | 3 ans après clôture (à confirmer) | ADR-0004 |
| T-07 | Notifications | Informer | Clients, partenaires | Téléphone, contenu des messages | Exécution du contrat | Prestataire SMS (sous-traitant) | 12 mois (journaux) | ADR-0004 |
| T-08 | Contributions diaspora | Financer l'objectif d'un proche | Payeurs, clients | Identité du payeur, montants, pays | Exécution du contrat ; obligation légale | Canal de transfert agréé | Délai LBC/FT | ADR-0004 |
| T-09 | Journal d'audit et de sécurité | Sécurité, preuve | Utilisateurs internes, partenaires, clients | Actions, horodatages, identifiants | Obligation légale / intérêt légitime | Audit, régulateurs sur demande | ≥ 10 ans (à confirmer) | ADR-0004 |
| T-10 | Statistiques et pilotage | Améliorer le service | Tous | Données agrégées ou pseudonymisées | Intérêt légitime | Direction | 5 ans | ADR-0004 |
| T-11 | Filtrage sanctions (liste consolidée ONU) | Obligation LBC/FT : ne pas servir une personne ou entité listée (REG-LBC-002, D66) | Clients, partenaires | Nom légal normalisé, version de liste, références rapprochées, examen motivé (décision, auteur, date) | Obligation légale | Conformité ; ANIF via l'assujetti en cas de correspondance | Durée LBC/FT (≥ 10 ans, à confirmer) ; tables en ajout seul | ADR-0004 |
| T-12 | Nom légal déclaré par le client (niveau KYC 1) | Ouvrir le niveau 1 (REG-LBC-001, F-ACC-003, D68) | Clients | Nom légal (versions successives), date de déclaration | Obligation légale | Conformité | Durée de la relation + délai LBC/FT ; stocké en clair (SEC-CRY-002 non implémenté, voir inventaire cryptographique) | ADR-0004 |
| T-13 | Comptes du personnel et des partenaires | Authentifier et tracer les actions (SEC-AUTH-004/006, D62, D63) | Personnel interne, gérants et vendeurs des partenaires | Identifiant de connexion, rôles, clés publiques WebAuthn, sessions (empreintes), défis | Intérêt légitime / obligation légale (traçabilité) | Équipe interne habilitée | Durée de la fonction + délai d'audit (à confirmer) ; tables en ajout seul | ADR-0004 |
| T-14 | Géolocalisation de la remise au comptoir | Preuve de remise de l'article au client (D45) | Vendeurs des partenaires | Latitude, longitude, vendeur, horodatage de la remise | Exécution du contrat / intérêt légitime (preuve) | Opérations, Litiges | Délai de prescription des litiges (à confirmer) | ADR-0004 |
| T-15 | Consultations de données sensibles par le personnel | Prouver et contrôler l'accès (F-BO-001/002, D74) | Clients, partenaires (données consultées) ; personnel (auteur) | Auteur, action, motif saisi, cible, horodatage (journal d'audit chaîné) | Obligation légale / intérêt légitime | Audit, régulateurs sur demande | ≥ 10 ans (à confirmer), comme T-09 | ADR-0004 |
| T-16 | CRM : fiche client 360°, interactions et tâches de suivi (Q5, F-SUP-001) | Traiter les demandes de support et garder la trace des échanges | Clients (donnée consultée, téléphone masqué) ; personnel (auteur, destinataire) | Résumé et issue de l'échange, canal, sens, horodatages, titre, détails, priorité, échéance de tâche, identifiants d'auteur et de destinataire ; motif de consultation journalisé en T-15 | Exécution du contrat / intérêt légitime | Support, Risque ; Audit | 3 ans après clôture (à confirmer) ; tables `crm.*` en ajout seul | ADR-0004 |

## Mesures transverses

- Analyse d'impact (DPIA) préalable pour T-02 (biométrie), T-04 (partage avec le financeur) et T-05 (profilage).
- Sous-traitants liés par contrat (agrégateur, SMS, hébergeur) avec clauses de sécurité et de localisation.
- Procédure d'exercice des droits (F-ACC-005), dans les limites des obligations de conservation LBC/FT.
- Notification des violations selon SEC-INC-002.
