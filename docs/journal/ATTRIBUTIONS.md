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
| C2 | Contrat 1.0 : routes nécessaires aux interfaces (demandes de Gemini et de Qoder), figé à J7 | `agent/claude/contrat-1-0` | J7 | À démarrer |
| C3 | Back-office prêt à la mise en service (hors CRM), durcissement, tests d'attaque | `agent/claude/backoffice` | J6 | À démarrer |

## Qoder — plateforme serveur, CRM, erreurs, journaux, archivage

| Lot | Contenu | Branche | Échéance | Statut |
|---|---|---|---|---|
| Q1 | Arrivée : prise de connaissance (lecture seule, note) | `agent/qoder/arrivee` | J1 | Livré — [PR #2](https://github.com/CORNEIL333/MOLOPAY/pull/2) |
| Q2 | Journalisation structurée JSON, identifiant de corrélation, masquage des données sensibles (`apps/api/src/observability/`) | `agent/qoder/journaux` | J2 | Livré — [PR #6](https://github.com/CORNEIL333/MOLOPAY/pull/6) (revue attendue) |
| Q3 | Gestion des erreurs : catalogue des codes métier, messages FR/EN, filtre RFC 9457, 5xx inattendues sans fuite | `agent/qoder/erreurs` | J3 | À démarrer |
| Q4 | Serveurs : images de conteneur, composition locale, santé et disponibilité, configuration, sauvegarde et restauration de la base | `agent/qoder/serveurs` | J4 | À démarrer |
| Q5 | CRM : fiche client 360° (lecture motivée et journalisée), interactions de support et tâches de suivi en ajout seul, écrans du back-office | `agent/qoder/crm` | J6 | À démarrer |
| Q6 | Archivage : archives signées du grand livre et de l'audit, conservation selon le registre, restauration vérifiée | `agent/qoder/archivage` | J6 | À démarrer |
| Q7 | Procédures d'exploitation, exercice de restauration chronométré, test de charge | `agent/qoder/exploitation` | J9 | À démarrer |

**Bloqués par un accès externe :** Q4 (Docker absent du poste — D2 : images non constructibles ici, composition et procédures à valider sur un poste équipé) ; Q6 (témoins d'ancrage et autorité d'horodatage — D6). Q2, Q3, Q5 et Q7 ne sont pas bloqués.

## Demandes de contrat (remplies par Gemini et Qoder, traitées par Claude)

| Demandé par | Besoin (route, champ) | Lot concerné | Statut |
|---|---|---|---|
| Qoder | En-tête de réponse `X-Correlation-Id` sur toutes les routes ; en-tête de requête facultatif du même nom (NF-OBS-001) | Q2 | Demandé — [PR #6](https://github.com/CORNEIL333/MOLOPAY/pull/6) |
