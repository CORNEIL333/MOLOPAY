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

## Qoder — plateforme serveur, CRM, erreurs, journaux, archivage

| Lot | Contenu | Branche | Échéance | Statut |
|---|---|---|---|---|
| Q1 | Arrivée : prise de connaissance (lecture seule, note) | `agent/qoder/arrivee` | J1 | Livré — [PR #2](https://github.com/CORNEIL333/MOLOPAY/pull/2) |
| Q2 | Journalisation structurée JSON, identifiant de corrélation, masquage des données sensibles (`apps/api/src/observability/`) | `agent/qoder/journaux` | J2 | Livré — [PR #6](https://github.com/CORNEIL333/MOLOPAY/pull/6) (revue attendue) |
| Q3 | Gestion des erreurs : catalogue des codes métier, messages FR/EN, filtre RFC 9457, 5xx inattendues sans fuite | `agent/qoder/erreurs` | J3 | Livré — [PR #8](https://github.com/CORNEIL333/MOLOPAY/pull/8) (revue attendue, empilé sur #6) |
| Q4 | Serveurs : images de conteneur, composition locale, santé et disponibilité, configuration, sauvegarde et restauration de la base | `agent/qoder/serveurs` | J4 | Livré — [PR #9](https://github.com/CORNEIL333/MOLOPAY/pull/9) (revue attendue, empilé sur #8 → #6) |
| Q5 | CRM : fiche client 360° (lecture motivée et journalisée), interactions de support et tâches de suivi en ajout seul, écrans du back-office | `agent/qoder/crm` | J6 | À démarrer |
| Q6 | Archivage : archives signées du grand livre et de l'audit, conservation selon le registre, restauration vérifiée | `agent/qoder/archivage` | J6 | À démarrer |
| Q7 | Procédures d'exploitation, exercice de restauration chronométré, test de charge | `agent/qoder/exploitation` | J9 | À démarrer |

**Bloqués par un accès externe :** Q4 (Docker absent du poste — D2 : images non constructibles ici, composition et procédures à valider sur un poste équipé) ; Q6 (témoins d'ancrage et autorité d'horodatage — D6). Q2, Q3, Q5 et Q7 ne sont pas bloqués.

**CI du dépôt hors service (constaté le 19 novembre) :** les jobs GitHub échouent en 1–2 s sans exécuter aucune étape, sur toutes les PR (y compris celles de Gemini), indépendamment du code. La configuration du dépôt n'est pas du périmètre d'un agent : signalé au fondateur. Les vérifications sont donc exécutées localement et jointes aux PR.

## Demandes de contrat (remplies par Gemini et Qoder, traitées par Claude)

| Demandé par | Besoin (route, champ) | Lot concerné | Statut |
|---|---|---|---|
| Qoder | En-tête de réponse `X-Correlation-Id` sur toutes les routes ; en-tête de requête facultatif du même nom (NF-OBS-001) | Q2 | Demandé — [PR #6](https://github.com/CORNEIL333/MOLOPAY/pull/6) |
| Qoder | `Accept-Language` (requête) et `Content-Language` (réponse) décrits dans OpenAPI ; nouveaux codes génériques de couche HTTP en exemples (NF-UX-002, NF-COMP-002) | Q3 | Demandé — [PR #8](https://github.com/CORNEIL333/MOLOPAY/pull/8) |
| Qoder | `GET /health/ready` : 200 `{status:'ready'}`, 503 problème `SERVICE_UNAVAILABLE` sans détail (sonde de disponibilité, NF-REL-001) ; à reporter dans OpenAPI | Q4 | Demandé |
| Claude (pour Gemini) | Recâbler l'inscription et la connexion du client web et du mobile sur le contrat 0.34.0 : `POST /v1/auth/otp-challenges` → `POST /v1/auth/signups` (code, PIN, clé Ed25519 de l'appareil en SPKI base64, nom, version des conditions) ; connexion `POST /v1/auth/device-challenges` (`purpose: LOGIN`) → signature du défi (message décrit dans `ClientLoginChallenge`) → `POST /v1/auth/sessions` ; renouvellement : défi `purpose: REFRESH` signé par l'appareil → `POST /v1/auth/session-refreshes` (contrat 0.35.0, SEC-AUTH-005) ; profil `GET /v1/me`. Les anciens formulaires web (`phone-otp-form`, `pin-login-form`) n'envoient plus rien et s'affichent indisponibles. | G2, G4 | À faire (Gemini) |

> Note : Claude commite sur `sprint/integration-t01urw` (branche de travail de sa session), pas sur `agent/claude/*`. Avant le démarrage de Qoder, Claude a ajouté trois codes d'erreur (`IDENTITY_ACCOUNT_EXISTS`, `SMS_UNCONFIGURED`, `SMS_DELIVERY_FAILED`) dans `packages/contracts/src/errors.ts` et `apps/api/src/http/problem.ts`, fichiers désormais du périmètre de Qoder.
