# Inventaire des routes de l’API (recette, tests d’intrusion)

> **Généré** par `pnpm routes:inventory` depuis le code et le contrat OpenAPI ; ne pas modifier à la main.
> Un test unitaire échoue si ce document ne correspond plus au code.

- **Espace** : `public` (sans session), `client` (cookie `client_session`), `personnel` (cookie `staff_session`, WebAuthn, ADR-0007 proposé), `partenaire` (cookie `partner_session`, WebAuthn, D63).
- **Origin** : toute méthode non sûre exige un en-tête `Origin` en liste blanche (garde globale).
- **Fermée sans** : configuration absente ⇒ la route répond 503 (fermée par défaut).
- **84 routes.**

| Méthode | Chemin | Espace | Cache-Control | Origin | Idempotency-Key | Quota | Fermée sans | Résumé |
|---|---|---|---|---|---|---|---|---|
| `GET` | `/health` | public | (défaut) | non | non | — | — | État de disponibilité de l'API |
| `GET` | `/health/ready` | public | (défaut) | non | non | — | — | (absente du contrat) |
| `POST` | `/v1/auth/device-challenges` | public | no-store | oui | oui | — | poivre PIN | Défi de connexion d'un appareil enregistré (D71) |
| `POST` | `/v1/auth/otp-challenges` | public | no-store | oui | oui | — | poivre PIN | Envoyer un code d'inscription par SMS (F-ACC-001) |
| `POST` | `/v1/auth/session-refreshes` | public | no-store | oui | oui | — | — | Renouveler la session client : défi REFRESH signé par l'appareil + jeton de rafraîchissement à usage unique (SEC-AUTH-005) |
| `POST` | `/v1/auth/sessions` | public | no-store | oui | oui | — | poivre PIN | Se connecter : défi signé par l'appareil, puis PIN (SEC-AUTH-001, D71) |
| `POST` | `/v1/auth/signouts` | client | private, no-store | oui | oui | — | — | Fermer la session courante |
| `POST` | `/v1/auth/signups` | public | no-store | oui | oui | — | poivre PIN | Créer son compte avec le code reçu : appareil, PIN, conditions, première session (F-ACC-001/002/004) |
| `POST` | `/v1/backoffice/admin/approvals` | personnel | private, no-store | oui | oui | — | partie de confiance du personnel | Préparer une demande maker-checker (rôles, paramètre financier) |
| `POST` | `/v1/backoffice/admin/approvals/{requestId}/decision` | personnel | private, no-store | oui | oui | — | partie de confiance du personnel | Décider une demande, par une autre personne (I-7) |
| `POST` | `/v1/backoffice/admin/settings` | personnel | private, no-store | oui | oui | — | partie de confiance du personnel | Publier un paramètre financier approuvé (par son préparateur) |
| `POST` | `/v1/backoffice/admin/staff` | personnel | private, no-store | oui | oui | — | partie de confiance du personnel | Créer un compte du personnel depuis une demande approuvée |
| `POST` | `/v1/backoffice/admin/staff/{staffId}/disable` | personnel | private, no-store | oui | oui | — | partie de confiance du personnel | Désactiver un agent (motif obligatoire) |
| `POST` | `/v1/backoffice/admin/staff/{staffId}/enrollments` | personnel | private, no-store | oui | oui | — | partie de confiance du personnel | Émettre un défi d’enrôlement et son jeton (rendu une seule fois) |
| `POST` | `/v1/backoffice/admin/staff/{staffId}/roles` | personnel | private, no-store | oui | oui | — | partie de confiance du personnel | Attribuer des rôles depuis une demande approuvée |
| `POST` | `/v1/backoffice/beneficiary-payouts` | personnel | private, no-store | oui | oui | — | clé de signature des instructions, partie de confiance du personnel | Préparer un virement au bénéficiaire C (D50) |
| `POST` | `/v1/backoffice/beneficiary-payouts/{payoutId}/decision` | personnel | private, no-store | oui | oui | — | clé de signature des instructions, partie de confiance du personnel | Décision sur un virement, par une autre personne (I-7) |
| `POST` | `/v1/backoffice/beneficiary-payouts/{payoutId}/execution` | personnel | private, no-store | oui | oui | — | clé de signature des instructions, partie de confiance du personnel | Exécution du virement rapportée par l’établissement |
| `POST` | `/v1/backoffice/beneficiary-payouts/{payoutId}/instruction` | personnel | private, no-store | oui | oui | — | clé de signature des instructions, partie de confiance du personnel | Instruction signée du virement |
| `GET` | `/v1/backoffice/complaints/{complaintId}` | personnel | private, no-store | non | non | — | partie de confiance du personnel | Détail d’une réclamation, consultation motivée (F-SUP-001, F-BO-004, D73) |
| `POST` | `/v1/backoffice/complaints/{complaintId}/closure` | personnel | private, no-store | oui | oui | — | partie de confiance du personnel | Clore une réclamation (D56) |
| `POST` | `/v1/backoffice/complaints/{complaintId}/disputes` | personnel | private, no-store | oui | oui | — | partie de confiance du personnel | Ouvrir un litige sur une réclamation (D56) |
| `GET` | `/v1/backoffice/dashboard` | personnel | private, no-store | non | non | — | partie de confiance du personnel | Tableau de bord agrégé, consultation motivée et journalisée (F-BO-003, D65) |
| `POST` | `/v1/backoffice/disputes/{disputeId}/resolution` | personnel | private, no-store | oui | oui | — | partie de confiance du personnel | Lever un litige, par une autre personne (D56) |
| `GET` | `/v1/backoffice/goals/{goalId}/history` | personnel | private, no-store | non | non | — | partie de confiance du personnel | Historique d’un objectif pour le support (F-SUP-003, consultation motivée et journalisée) |
| `GET` | `/v1/backoffice/partners/{partnerId}/screening` | personnel | private, no-store | non | non | — | partie de confiance du personnel | État de filtrage d'un partenaire (D66) |
| `POST` | `/v1/backoffice/partners/{partnerId}/screenings` | personnel | private, no-store | oui | oui | — | partie de confiance du personnel | Filtrer un partenaire contre la liste ONU (REG-LBC-002, D66) |
| `GET` | `/v1/backoffice/queue` | personnel | private, no-store | non | non | — | partie de confiance du personnel | File de travail du back-office (consultation motivée, journalisée) |
| `POST` | `/v1/backoffice/reconciliation/classifications/{proposalId}/decision` | personnel | private, no-store | oui | oui | — | partie de confiance du personnel | Valider ou refuser une classe, par une autre personne (D54) |
| `POST` | `/v1/backoffice/reconciliation/incidents/{incidentId}/classifications` | personnel | private, no-store | oui | oui | — | partie de confiance du personnel | Proposer la classe d’un écart (D54) |
| `POST` | `/v1/backoffice/reconciliation/suspense/{entryId}/approval` | personnel | private, no-store | oui | oui | — | partie de confiance du personnel | Valider une justification, par une autre personne (D55) |
| `POST` | `/v1/backoffice/reconciliation/suspense/{entryId}/justification` | personnel | private, no-store | oui | oui | — | partie de confiance du personnel | Justifier une écriture du suspens 2900 (D55) |
| `POST` | `/v1/backoffice/refunds` | personnel | private, no-store | oui | oui | — | clé de signature des instructions, partie de confiance du personnel | Préparer un remboursement (D49, D51) |
| `POST` | `/v1/backoffice/refunds/{refundId}/decision` | personnel | private, no-store | oui | oui | — | clé de signature des instructions, partie de confiance du personnel | Décision sur un remboursement préparé, par une autre personne (D49, I-7) |
| `POST` | `/v1/backoffice/refunds/{refundId}/execution` | personnel | private, no-store | oui | oui | — | clé de signature des instructions, partie de confiance du personnel | Exécution rapportée par l’établissement (autre personne que l’émetteur) |
| `POST` | `/v1/backoffice/refunds/{refundId}/instruction` | personnel | private, no-store | oui | oui | — | clé de signature des instructions, partie de confiance du personnel | Instruction signée du remboursement |
| `POST` | `/v1/backoffice/risk/alerts/{alertId}/decision` | personnel | private, no-store | oui | oui | — | partie de confiance du personnel | Décision tracée sur une alerte de fraude (D53) |
| `GET` | `/v1/backoffice/screenings/{screeningId}` | personnel | private, no-store | non | non | — | partie de confiance du personnel | Détail d'un filtrage pour l'examen (D74) |
| `POST` | `/v1/backoffice/screenings/{screeningId}/review` | personnel | private, no-store | oui | oui | — | partie de confiance du personnel | Examiner un rapprochement (Conformité, D66) |
| `POST` | `/v1/backoffice/settlements` | personnel | private, no-store | oui | oui | — | clé de signature des instructions, partie de confiance du personnel | Préparer le règlement d’un marchand (D46, ville du périmètre) |
| `POST` | `/v1/backoffice/settlements/{payoutId}/decision` | personnel | private, no-store | oui | oui | — | clé de signature des instructions, partie de confiance du personnel | Décider un règlement, par une autre personne (commission écrite à l’approbation) |
| `POST` | `/v1/backoffice/settlements/{payoutId}/execution` | personnel | private, no-store | oui | oui | — | clé de signature des instructions, partie de confiance du personnel | Exécution du règlement rapportée par l’établissement |
| `POST` | `/v1/backoffice/settlements/{payoutId}/instruction` | personnel | private, no-store | oui | oui | — | clé de signature des instructions, partie de confiance du personnel | Instruction signée du règlement |
| `GET` | `/v1/goals` | client | private, no-store | non | non | — | — | Lister les objectifs du client |
| `POST` | `/v1/goals` | client | private, no-store | oui | oui | GOAL_CREATE | — | Créer un objectif en brouillon (D32) |
| `GET` | `/v1/goals/{goalId}` | client | private, no-store | non | non | — | — | Suivi d'un objectif |
| `POST` | `/v1/goals/{goalId}/activation` | client | private, no-store | oui | oui | GOAL_SIGNED_ACTION | poivre PIN | Activer un brouillon (signature + PIN) |
| `POST` | `/v1/goals/{goalId}/beneficiary-documents` | client | private, no-store | oui | oui | BENEFICIARY_DOCUMENT_SUBMIT | poivre PIN | Déposer l’empreinte de la pièce du bénéficiaire (bail, titre foncier) |
| `POST` | `/v1/goals/{goalId}/beneficiary-payment` | client | private, no-store | oui | oui | BENEFICIARY_PAYMENT | poivre PIN | Régler le bénéficiaire d’un objectif C financé (PIN, pièce validée si exigée) |
| `GET` | `/v1/goals/{goalId}/beneficiary-receipt` | client | private, no-store | non | non | — | poivre PIN | Reçu du règlement au bénéficiaire (après exécution par l’établissement) |
| `POST` | `/v1/goals/{goalId}/cancellation` | client | private, no-store | oui | oui | GOAL_SIGNED_ACTION | poivre PIN | Annuler un objectif actif non verrouillé (signature + PIN) |
| `POST` | `/v1/goals/{goalId}/claims` | client | private, no-store | oui | oui | CLAIM_SUBMIT | — | Ouvrir une réclamation sur son objectif (F-SUP-001, D70) |
| `GET` | `/v1/goals/{goalId}/contributions` | client | private, no-store | non | non | — | — | Historique des versements confirmés |
| `POST` | `/v1/goals/{goalId}/lock` | client | private, no-store | oui | oui | GOAL_SIGNED_ACTION | poivre PIN | Verrouiller un objectif actif (PIN) |
| `GET` | `/v1/goals/{goalId}/signing-payload` | client | private, no-store | non | non | — | poivre PIN | Octets à signer par l'appareil (D28) |
| `GET` | `/v1/me` | client | private, no-store | non | non | — | — | Profil du client connecté |
| `GET` | `/v1/me/data-rights` | client | private, no-store | non | non | DATA_RIGHTS_READ | — | Historique des demandes de droits du compte connecte |
| `POST` | `/v1/me/data-rights` | client | private, no-store | oui | oui | DATA_RIGHTS_SUBMIT | — | Enregistrer une demande de droits sur ses donnees |
| `POST` | `/v1/me/legal-name` | client | private, no-store | oui | oui | LEGAL_NAME_DECLARE | — | Déclarer son nom légal (KYC niveau 1, REG-LBC-001, D68) |
| `GET` | `/v1/me/security` | client | private, no-store | non | non | SECURITY_READ | — | Consulter ses appareils et sessions renouvelables |
| `POST` | `/v1/me/security/block` | client | private, no-store | oui | oui | — | — | Bloquer son compte depuis l'application |
| `POST` | `/v1/me/security/revoke-other-sessions` | client | private, no-store | oui | oui | REVOKE_OTHERS | — | Fermer les autres sessions du compte |
| `GET` | `/v1/offers` | public | (défaut) | non | non | — | — | Lister les offres publiées |
| `GET` | `/v1/offers/{offerId}` | public | (défaut) | non | non | — | — | Détail d'une offre |
| `POST` | `/v1/offers/{offerId}/quotes` | client | private, no-store | oui | oui | — | — | Calculer un échéancier côté API |
| `POST` | `/v1/partner/credentials` | public | no-store | oui | oui | — | partie de confiance partenaire | Enrôler une clé de sécurité avec le jeton remis (D63) |
| `POST` | `/v1/partner/handovers` | partenaire | private, no-store | oui | oui | — | partie de confiance partenaire, poivre des codes de remise | Confirmer une remise au comptoir (F-SET-001, D63) |
| `POST` | `/v1/partner/login-challenges` | public | no-store | oui | oui | — | partie de confiance partenaire | Défi de connexion WebAuthn du partenaire (D63) |
| `GET` | `/v1/partner/offers` | partenaire | private, no-store | non | non | — | partie de confiance partenaire | Offres du partenaire, en lecture (F-PRT-002, D63) |
| `GET` | `/v1/partner/orders` | partenaire | private, no-store | non | non | — | partie de confiance partenaire | Commandes du partenaire, sans donnée client (F-PRT-004, D63) |
| `GET` | `/v1/partner/orders/export` | partenaire | private, no-store | non | non | — | partie de confiance partenaire | Export CSV des commandes, gérant uniquement (F-PRT-004, D63) |
| `GET` | `/v1/partner/payouts` | partenaire | private, no-store | non | non | — | partie de confiance partenaire | Règlements du partenaire, gérant uniquement (F-PRT-003/004, D63) |
| `POST` | `/v1/partner/sellers` | partenaire | private, no-store | oui | oui | — | partie de confiance partenaire | Créer un vendeur (gérant uniquement, F-PRT-003) |
| `POST` | `/v1/partner/sellers/{sellerId}/disable` | partenaire | private, no-store | oui | oui | — | partie de confiance partenaire | Désactiver un vendeur avec motif (gérant uniquement) |
| `POST` | `/v1/partner/sellers/{sellerId}/enrollments` | partenaire | private, no-store | oui | oui | — | partie de confiance partenaire | Émettre l'enrôlement d'une clé du vendeur (jeton rendu une seule fois) |
| `POST` | `/v1/partner/sessions` | public | no-store | oui | oui | — | partie de confiance partenaire | Connexion du portail partenaire par assertion WebAuthn (D63, SEC-AUTH-006) |
| `DELETE` | `/v1/partner/sessions/current` | public | no-store | oui | oui | — | partie de confiance partenaire | Déconnexion du partenaire (révocation immédiate) |
| `GET` | `/v1/partner/sessions/current` | partenaire | private, no-store | non | non | — | partie de confiance partenaire | Session partenaire courante (D63) |
| `GET` | `/v1/partner/users` | partenaire | private, no-store | non | non | — | partie de confiance partenaire | Comptes du partenaire (gérant uniquement, F-PRT-003) |
| `GET` | `/v1/plans` | public | (défaut) | non | non | — | — | Plans de paiement approuvés (D26) |
| `POST` | `/v1/staff/credentials` | public | no-store | oui | oui | — | partie de confiance du personnel | Enrôler une clé de sécurité avec le jeton remis (D62) |
| `POST` | `/v1/staff/login-challenges` | public | no-store | oui | oui | — | partie de confiance du personnel | Défi de connexion WebAuthn du personnel (D62) |
| `POST` | `/v1/staff/sessions` | public | no-store | oui | oui | — | partie de confiance du personnel | Connexion du personnel par assertion WebAuthn (D62) |
| `DELETE` | `/v1/staff/sessions/current` | public | no-store | oui | oui | — | partie de confiance du personnel | Déconnexion du personnel (révocation immédiate) |
