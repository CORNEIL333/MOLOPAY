# Attributions des lots entre agents — MVP J10 (29 novembre 2026)

> Tenu par le fondateur (ou par un agent sur sa demande explicite). Règles : `docs/03_agents_ia/PROMPT_TRAVAIL_GEMINI_QODER.md` § 2 (périmètres de fichiers, numérotation). Un agent ne travaille que sur un lot qui lui est attribué ici, sur la branche indiquée. Revue croisée : Claude relit Qoder, Qoder relit Gemini, Gemini relit Claude (points d'interface).

## Gemini — interfaces

| Lot | Contenu | Branche | Échéance | Statut |
|---|---|---|---|---|
| G1 | Arrivée : prise de connaissance (lecture seule, note) | `agent/gemini/arrivee` | J1 | À démarrer |
| G2 | `apps/mobile` : application client Flutter à partir du design de `apps/mobile-showcase` ; connexion, catalogue, objectifs branchés sur l'API réelle | `agent/gemini/mobile-socle` | J2 | À démarrer |
| G3 | Parcours mobile et bureau A, B, C (versements, reçus, remise, annulation, bénéficiaire C), FR/EN, accessibilité, hors connexion lisible | `agent/gemini/mobile-parcours` | J6 | À démarrer |
| G4 | Application web client : écrans manquants au regard des routes de `INVENTAIRE_ROUTES.md` | `agent/gemini/web-client` | J6 | À démarrer |
| G5 | Portail partenaire : écrans manquants, parcours de bout en bout | `agent/gemini/portail-partenaire` | J6 | À démarrer |
| G6 | Tests de bout en bout des parcours (mobile, bureau, web) | `agent/gemini/e2e` | J8 | À démarrer |

## Claude — serveur métier et back-office

| Lot | Contenu | Branche | Échéance | Statut |
|---|---|---|---|---|
| C1 | Intégration de la branche du sprint, revues indépendantes | `sprint/integration-t01urw` | Continu | En cours |
| C2 | Contrat 1.0 : routes nécessaires aux interfaces (demandes de Gemini et de Qoder), figé à J7 | `sprint/integration-t01urw` | J7 | En cours : `GET /v1/me`, renouvellement de session, inscription par OTP et connexion appareil + PIN, renouvellement lié à l'appareil livrés (contrat 0.35.0) |
| C3 | Back-office prêt à la mise en service (hors CRM), durcissement, tests d'attaque | `sprint/integration-t01urw` | J6 | À démarrer |
| C4 | Blocage d'un compte client par le support (F-ACC-006) : route, base, écran `/clients/blocage` | `sprint/integration-t01urw` | J4 | Livré (contrat 0.36.0, migration 0068) |
| C5 | Fil de notifications du client dans l'application (`GET /v1/me/notifications`), sans prestataire | `sprint/integration-t01urw` | J5 | Livré (contrat 0.37.0, migration 0069) |

## Qoder — plateforme serveur, CRM, erreurs, journaux, archivage

| Lot | Contenu | Branche | Échéance | Statut |
|---|---|---|---|---|
| Q1 | Arrivée : prise de connaissance (lecture seule, note) | `agent/qoder/arrivee` | J1 | À démarrer |
| Q2 | Journalisation structurée JSON, identifiant de corrélation, masquage des données sensibles (`apps/api/src/observability/`) | `agent/qoder/journaux` | J2 | À démarrer |
| Q3 | Gestion des erreurs : catalogue des codes métier, messages FR/EN, filtre RFC 9457, 5xx inattendues sans fuite | `agent/qoder/erreurs` | J3 | À démarrer |
| Q4 | Serveurs : images de conteneur, composition locale, santé et disponibilité, configuration, sauvegarde et restauration de la base | `agent/qoder/serveurs` | J4 | À démarrer |
| Q5 | CRM : fiche client 360° (lecture motivée et journalisée), interactions de support et tâches de suivi en ajout seul, écrans du back-office | `agent/qoder/crm` | J6 | À démarrer |
| Q6 | Archivage : archives signées du grand livre et de l'audit, conservation selon le registre, restauration vérifiée | `agent/qoder/archivage` | J6 | À démarrer |
| Q7 | Procédures d'exploitation, exercice de restauration chronométré, test de charge | `agent/qoder/exploitation` | J9 | À démarrer |

## Demandes de contrat (remplies par Gemini et Qoder, traitées par Claude)

| Demandé par | Besoin (route, champ) | Lot concerné | Statut |
|---|---|---|---|
| Claude (pour Gemini) | Recâbler l'inscription et la connexion du client web et du mobile sur le contrat 0.34.0 : `POST /v1/auth/otp-challenges` → `POST /v1/auth/signups` (code, PIN, clé Ed25519 de l'appareil en SPKI base64, nom, version des conditions) ; connexion `POST /v1/auth/device-challenges` (`purpose: LOGIN`) → signature du défi (message décrit dans `ClientLoginChallenge`) → `POST /v1/auth/sessions` ; renouvellement : défi `purpose: REFRESH` signé par l'appareil → `POST /v1/auth/session-refreshes` (contrat 0.35.0, SEC-AUTH-005) ; profil `GET /v1/me`. Les anciens formulaires web (`phone-otp-form`, `pin-login-form`) n'envoient plus rien et s'affichent indisponibles. | G2, G4 | À faire (Gemini) |

> Note : Claude commite sur `sprint/integration-t01urw` (branche de travail de sa session), pas sur `agent/claude/*`. Avant le démarrage de Qoder, Claude a ajouté trois codes d'erreur (`IDENTITY_ACCOUNT_EXISTS`, `SMS_UNCONFIGURED`, `SMS_DELIVERY_FAILED`) dans `packages/contracts/src/errors.ts` et `apps/api/src/http/problem.ts`, fichiers désormais du périmètre de Qoder.
| Gemini | Ouverture de session client (`POST /v1/auth/sessions`, flux clé + PIN, D71) | G2 / G3 / G4 | **Livré** : contrats 0.34.0 et 0.35.0 (inscription, connexion, renouvellement lié à l'appareil) ; branches mobiles déjà alignées |
| Gemini | Émission explicite du code de remise à 100 % (remplace `GET …/handover-code`) | G3 / G4 | Bloqué par D69 (décision du fondateur) |
| Gemini | Initiation d'un versement client sur un objectif actif | G3 / G4 | Bloqué : accès à l'agrégateur de paiement (environnement de test) |
| Qoder | En-tête `X-Correlation-Id` (réponse, requête facultative) | Q2 | Accepté : ajouté au contrat à l'intégration de la PR #6 (revue croisée publiée) |
| Qoder | `Accept-Language` / `Content-Language` et cinq codes génériques de couche HTTP | Q3 | Accepté : ajouté au contrat à l'intégration de la PR #8 (revue croisée publiée : codes SMS à garder en 503 lors de la fusion) |
| Claude (pour Gemini) | Écran Notifications du mobile et du web : `GET /v1/me/notifications` (contrat 0.37.0) ; écran de blocage au back-office déjà livré (`/clients/blocage`). | G3 / G4 | À brancher (Gemini) |
| Qoder | `GET /health/ready` (sonde de disponibilité, 503 sans détail) | Q4 | Accepté : ajouté au contrat à l'intégration de la PR #9 (revue croisée publiée le 20 novembre : restauration sans droits, connexion de l'API en superutilisateur à corriger) |
