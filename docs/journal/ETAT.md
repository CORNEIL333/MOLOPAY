# État du sprint — 2026-11-11

## Décisions prises par délégation (D1–D57) et mise en œuvre
- Compte rendu : `docs/journal/COMPTE_RENDU_DECISIONS_2026-11-10.md` ; prompts mobiles : `PROMPT_STITCH_APP_MOBILE.md`, `PROMPT_CHATGPT_APP_MOBILE.md`.
- Fait : D26 (plans approuvés, 0033), D27 (durée en mois, 0034), D38 (quotas, 0035), D43 (plafonds KYC, 0036), D39 (reçus par client, 0037), D42 (identifiant comptable partenaire, 0038), lot 12 (remise 0039/0040, règlement 0041, instruction signée et exécution 0042 ; D45, D46), D32 (contrat 0.3.0, lecture, brouillon, activation/annulation/verrou sous PIN et signature), D47 (notifications en outbox), plans et devis serveur, D48 (règlement C au bénéficiaire, 0043/0044), D49 (remboursement après annulation, 0045/0046), D50 (virement au bénéficiaire C, alerte 24 h commune, 0047), routes client C (contrat 0.4.0), D51 (trop-perçu, nouvelle tentative, 0048), D52 (notification des fonds sortis), D53 (lot 16 : règles de fraude, alertes, 0049), D54 (lot 14 : classement des écarts, 0050), D55 (suspens 2900, 0051), D56 (clôture des réclamations, 0052), D57 (réservation du stock, 0053).
- **1210 unitaires, 687 PostgreSQL (36 suites), 45 attaques, 1 E2E, 128 web, 10 Rust, build Next, OpenAPI, `verify:ledger`, sécurité OK.** Revue indépendante non faite (L2/L3) ; revue humaine avant fusion.
- Ouvert pour le fondateur : taux de commission et délai de contestation (D46), financeur B (D44), textes juridiques (D23), validations ⚖ du compte rendu.
- Suite prévue : back-office HTTP (bloqué : authentification du personnel), notifications REFUND_SENT et marchand (lot 17), branchement de l'app mobile quand ChatGPT l'aura livrée.

## Fait · Lot 11 tranche 1, tentatives de paiement sans prestataire (L3)
- Migration 0026 : tentatives immuables sur accord ACTIVE, clé d'idempotence unique, journal d'états CDC_05 § 5.1 en ajout seul, anti-rejeu des webhooks (nonce, ± 5 min). CONFIRMED et remboursement refusés en base jusqu'au lien grand livre (I-6).
- Domaine : machine à états, HMAC-SHA256 en temps constant ; port `PaymentProvider` sans implémentation (zéro simulation).
- Tranche 2 : confirmation liée au grand livre (migration 0027, débit 1200 / crédit 2100 du client, CDC_04 § 2.2) ; premier store d'écriture du grand livre (`ledger/entry.store.ts`) ; suite d'attaque paiements.
- Accord FUNDED à 100 % dérivé du grand livre (0028/0029), flux confirmation + FUNDED en une transaction.
- Lot 14 tranche 1 : contrôle de l'invariant de cantonnement (0030), incidents et escalade 48 h (D40).
- Détection des écritures de confirmation sans contribution et solde du suspens 2900 (0031).
- Lot 15 tranche 1 : réclamations numérotées, litiges qui suspendent l'accord, historique chronologique (0032, D41).
- **1066 unitaires, 439 PostgreSQL, 45 attaques, 1 E2E, `verify:ledger`, sécurité OK.** Revue indépendante non faite. Points ouverts : D39.

## Fait · SEC-API-003 partiel, quotas des routes compte (L2)
- Migration 0025 : politiques versionnées en ajout seul, sans valeur par défaut, compteurs accessibles uniquement par `identity.consume_customer_quota`. Tout ou rien sur compte et appareil, horloge serveur après attente du verrou, session revérifiée sous verrou.
- Garde `CustomerQuotaGuard` sur quatre opérations (lecture sécurité, fermeture des autres sessions, lecture et dépôt de demandes de droits). Tentative validée avant la commande : un échec métier ou un rejeu compte. Déconnexion et blocage restent hors quota.
- Réponses 429 + Retry-After, 503 si politique absente, `private, no-store`, corps sans compteur ni identifiant. Contrat mis à jour (0.2.1 inchangée).
- **CI locale 12/12 verte sur grappe jetable : 1019 unitaires, 343 PostgreSQL, 38 attaques, 1 E2E ; 114 tests web et build Next verts.** Revue indépendante de cette tranche **non faite** ; revue humaine requise avant fusion. Limites par IP, téléphone et partenaire restent ouvertes (D38).
- Pas d'exploitation possible des quatre routes sans politique insérée par le propriétaire de migration (503) : valeurs à décider (D38).

- Lots 06/19, F-ACC-005 partiel : `/compte/donnees` FR/EN, réception authentifiée de quatre types de demande, reçu horodaté, historique privé paginé, registre immuable (0024), audit/idempotence atomiques. Réautorisation sous verrou aussi avant rejeu. Correction du calcul de durée de rotation de session existant (D37), sans assouplir la limite. **997 unitaires, 326 PostgreSQL / 16 suites, 38 attaques, 1 E2E API existant, 114 tests web et build Next verts** ; les 12 contrôles ont passé avec lint repris séparément après correction (invocation CI initiale 11/12). Revue indépendante sans blocage : 21 serveur, 4 UI et 4 cache rejoués. SBOM CycloneDX 1.6 régénéré sans dépendance ajoutée. F-ACC-005 complet reste ouvert : traitement humain, échanges sécurisés, export complet et conservation (D36). Couverture chiffrée et parcours navigateur non mesurés ; tranche prête pour revue humaine, aucun lancement/fusion/déploiement.

- Lots 06/19, parcours sécurité du compte : `/compte` FR/EN, consultation propre au compte, fermeture des autres sessions, déconnexion et blocage APP transactionnels avec audit/idempotence. Migration 0023 retire le déblocage direct au rôle applicatif. **CI finale 12/12 verte : 976 unitaires, 305 PostgreSQL / 15 suites, 38 attaques, 1 E2E API existant ; 110 tests web et build Next.js verts**. Revue indépendante sans blocage après correction du rejeu concurrent de logout ; 11 tests serveur, 6 composants et 4 tests cache rejoués indépendamment. D35 décrit les limites (session existante, aucun OTP/déblocage/ré-enrôlement). Grappes jetables arrêtées, aucune fusion ni déploiement.

- Catalogue web (lot 09/19, L1) : cinq filtres disponibles dans le formulaire et l'URL, choix de partenaires issus des offres publiques réelles, prix conservé en texte, refus HTTP corrigeable. **965 unitaires, 106 tests web, 38 attaques et 1 E2E API existant verts** ; contrôles qualité hors DB **11/11 verts**, build Next.js/TypeScript et lint final verts. Aucune modification serveur/base dans cette tranche.
- Revue indépendante sans blocage : **20 tests helper**, puis **8 tests du composant final** rejoués et verts. Vérification visuelle réelle non effectuée : démarrage Next local rejeté par le contrôle automatique (« blocked by policy »), sans contournement ; API et grappe jetable arrêtées. Détail et limites dans `2026-11-06.md`.

- Lot 09, lectures publiques du catalogue : GET `/v1/offers` et `/v1/offers/{offerId}` enregistrés ; présentation par version, visibilité imposée en base, filtres stricts et prix exacts. **CI complète 12/12 verte : 945 unitaires, 285 PostgreSQL / 14 suites, 38 attaques, 1 E2E**. Après les deux compléments de preuve : **10/10 tests catalogue PostgreSQL/HTTP finaux verts**, lint ciblé et types verts.
- Revue indépendante L2/sécurité sans blocage, **19/19 unitaires indépendants verts** ; compléments rôle app_ro et TRUNCATE relus. Aucun test DB indépendant revendiqué. Grappe jetable utilisée pour les 10 tests arrêtée. D26/D32 et les chantiers notifications différés restent ouverts ; aucune fusion ni aucun déploiement.

- Instruction du fondateur : SMS/push, coordination des rappels et supervision automatique **différés** ; le plan périodique ci-dessous est suspendu avant code. Reprise sur le catalogue public (lot 09), sans arbitrer D26/D32.
- Suite lot 17 : diagnostic ponctuel local ajouté (`pnpm notifications:check`), rôle observateur limité aux compteurs, seuils explicites et sorties fermées 0/1/2. **CI 12/12 verte : 926 unitaires, 276 PostgreSQL / 13 suites, 38 attaques, 1 E2E**. Revue indépendante L2/sécurité sans blocage et **46/46 unitaires indépendants verts** ; DB indépendante empêchée avant démarrage par son bac à sable, preuves DB issues de la session principale. Aucun envoi, ordonnanceur ou relais d'alerte ; supervision active et livraison restent ouvertes. Preuves dans `2026-11-05.md`.
- Suite lot 17 : migration 0020 et store de prise/reprise ajoutés, configuration sans défaut et rôle travailleur distinct ; reprises bornées et compteurs agrégés. Rappels différés (D33/D34), aucun envoi/acquittement ajouté. CI complète **12/12 verte : 880 unitaires, 264 PostgreSQL / 12 suites, 38 attaques, 1 E2E**. Version finale des **24 tests dispatch** rejouée séparément, **24/24 verte** (inclut les 2 dernières régressions et le pool limité à une connexion) ; voir `2026-11-05.md`.
- Revue indépendante de 0020/store/tests sans blocage restant. Son rejeu a été empêché avant démarrage PostgreSQL : **0 test indépendant**, preuves ci-dessus issues de la session principale. Aucune grappe de test restante ; revue humaine reste requise avant fusion.
- Reprise lot 17 : validation de l'outbox 0019 et du store terminée pour cette tranche, revue indépendante sans blocage. **880 unitaires, 242 tests PostgreSQL / 11 suites, 38 attaques, 1 E2E verts** ; lint, frontières, types, OpenAPI et recherche de secrets verts.
- Exécution CI agrégée : **11/12**, seul SCA échoue à cause de l'ancien shim pnpm Windows. `pnpm security:scan` rejoué avec `.toolchains/pnpm` en tête du PATH : **vert**, aucune vulnérabilité connue signalée. Installation `pnpm install --frozen-lockfile` réussie avec pnpm 12.6.0. Aucun contrôle affaibli.
- Grappes PostgreSQL locales jetables arrêtées après tests (voir `2026-11-05.md` pour les preuves et limites). Reste du lot 17 : adaptateur officiel, acquittement de succès, coordination des rappels, supervision active ; aucune livraison ni fin du lot 17 revendiquée. D26/D32 restent ouverts.

- Branche : `sprint/integration`, remote `origin` configuré ; aucun déploiement vérifié.
- Lots 09/10 partiels : D26 (plans) et D32 (contrat des objectifs) restent ouverts ; le catalogue public et la sécurité du compte sont enregistrés, les routes d'accord et de paiement restent absentes.
- Validation historique du 3 novembre : 17 migrations alors présentes ; **212 tests PostgreSQL / 9 suites verts**, **799 unitaires verts**, **1 E2E vert** ; les preuves plus récentes figurent en tête de ce journal.
- Reproduction : `node node_modules/tsx/dist/cli.mjs tools/local-postgres.ts db` ; commande `pnpm test:db:local` ajoutée. Revue indépendante des changements d'outillage effectuée, corrections prises en compte.
- D26/D32 : décisions différées par l'équipe à la demande du fondateur ; poursuivre les périmètres indépendants sans arbitrer les conflits ni exposer les routes d'accord.
- Lot 17 partiel : gabarits génériques FR/EN pour six événements et politique de rappels implémentés (F-NOT-001/002/003 partiels), **65 nouveaux tests verts**, revue indépendante sans blocage. Total unitaires : **864**. Aucun envoi ni persistance de notification.
- Reprise cœur : migration **0018** et store de réservation des rappels ajoutés ; quotas et horaires imposés en base, rejeu et concurrence contrôlés. **CI locale 12/12 verte : 864 unitaires, 227 tests base, 38 attaques, 1 E2E**. D33 précise les limites : aucun envoi ni outbox, configuration sans défaut.
- Barrière finale de cette reprise : **CI locale 12/12 verte**, installation figée avec `--ignore-scripts` réussie après correction du lockfile ; détails dans `2026-11-03.md`. Pas de fusion ni déploiement.

## Plan de cette intervention (lot 00, SEC-SDLC-001, risque L2)

### Lots 06/19 — parcours sécurité du compte (L2)
1. SEC-AUTH-005/F-ACC-006, NF-UX-001/002/005 : inventaire identité/session/audit, contrat d'appareils et sessions du seul compte authentifié.
2. Tranche A : consultation minimale, fermeture des autres sessions et déconnexion courante ; contrôles d'origine, idempotence et audit atomique.
3. Tranche B : blocage immédiat depuis une session d'appareil enregistré, révoquant appareils et sessions dans la même transaction ; aucun déblocage ni mouvement financier.
4. Tests PostgreSQL/HTTP d'abord : isolation entre comptes, état périmé, concurrence, rejeu, rollback audit et refus exacts ; tests UI de confirmation sans faux prestataire.
5. Espace web /compte FR/EN, confirmations explicites, réseau requis, données non mises en cache ; revue indépendante, contrôles complets et build.

### Suite lot 09/19 — cinq filtres du catalogue web (L1)
1. F-CAT-004 et NF-UX-001/002 : compléter le formulaire existant par modèle, prix maximal et partenaire, sans calcul monétaire côté client.
2. URL en liste blanche : filtres répétés/invalides refusés explicitement ; valeurs vides du formulaire omises, cinq filtres valides transmis au serveur.
3. Partenaires proposés depuis le catalogue public réel non filtré, par nom ; aucun faux annuaire ni identifiant affiché comme libellé.
4. Tests d'abord : parsage pur, conservation des cinq champs/FormData, FR/EN et accessibilité ; tests et build web pertinents puis contrôles/revue.
5. Aucun devis, accord, paiement, nouvelle dépendance ou reprise des notifications ; décisions D26/D32 inchangées.

### Suite lot 09 — catalogue public HTTP (L2)
1. F-CAT-001/004, contrat GET /v1/offers et /v1/offers/{offerId} : inventaire des offres versionnées, socle HTTP et champs publics.
2. Présentation de version additive avec titre explicite ; aucune valeur inventée pour les offres historiques sans titre.
3. Vue publique fermée : publication, partenaire validé et absence de défaillance imposées en base ; noms publics sans référence sensible.
4. Tests PostgreSQL/HTTP d'abord : filtres stricts, montants canoniques, invisible=404, présentation obligatoire et permissions.
5. Store, contrôleur et revue indépendante/CI ; aucun devis, plan, accord ou flux financier ajouté.

### Suite lot 17 — surveillance périodique locale et préparation des rappels (L2, différé)
1. NF-REL-005 : boucle de diagnostic réel, intervalle explicite, aucun chevauchement, arrêt propre ; silence si état stable.
2. Alertes locales fermées sur apparition/changement d'incident et retour à la normale ; aucun envoi externe sans canal décidé.
3. Tests d'abord : transitions pures puis processus réel sur PostgreSQL jetable ; erreurs fermées, arrêt et absence de mutation.
4. F-NOT-003 : étudier le lien entre réservation et outbox sans activer l'envoi différé ni lever l'exclusion de rappels sans contrat prestataire.
5. Prestataires SMS/push et canal d'alerte demandés au fondateur ; aucun secret demandé, aucun compte externe contacté ; revue indépendante et CI.

### Suite lot 17 — contrôle de supervision local en lecture seule (L2)
1. NF-REL-005 partiel et F-NOT-002 : évaluation des compteurs réels, seuils explicites sans défaut ; épuisement toujours signalé.
2. Migration 0021 : rôle observateur distinct, seule exécution de dispatch_counts autorisée ; aucun accès aux enveloppes ou aux baux.
3. Tests d'abord : limites exactes, valeurs invalides, permissions SQL et commande réelle sur PostgreSQL jetable, sans faux prestataire.
4. Commande locale réservée à molopay_test en boucle locale, sortie JSON fermée et codes de sortie 0/1/2 ; aucune URL ou erreur brute affichée.
5. Revue indépendante et CI ; ordonnanceur, transmission d'alertes, prestataire et livraison restent hors tranche (D34).

### Suite lot 17 — baux de consommation et reprises (L2)
1. NF-REL-005 partiel, F-NOT-002/003 : migration additive 0020 et store de baux, sans envoi ni acquittement de livraison.
2. Rôle travailleur distinct, configuration explicite sans défaut ; prise concurrente exclusive, bail expirant et identifiant de tentative renouvelé.
3. Tests PostgreSQL d'abord : concurrence, rollback, reprise, délai, épuisement, refus de bail périmé et permissions exactes.
4. Rappels exclus de la prise tant que D33 n'est pas résolu ; décompte agrégé des files pour le futur moniteur, aucune donnée libre.
5. Revue indépendante et CI complète ; fournisseur, acquittement de succès et surveillance active restent à construire.

### Suite lot 17 — enveloppes outbox transactionnelles (L2)
1. F-NOT-001/002, CDC_05 et NF-REL-005 partiel : enveloppe fermée sans texte libre.
2. Enqueue idempotent en base, conflit de contenu refusé ; aucune livraison revendiquée.
3. Tests PostgreSQL d'abord : commit/rollback avec réservation, concurrence et ACL.
4. Store serveur et migration additive 0019, sans fournisseur, route ou table financière.
5. Revue indépendante et CI ; travailleurs/envoi/reprises restent une tranche ultérieure.

### Reprise cœur — lot 17, réservation des rappels (L2)
1. F-NOT-003 : politique persistée, contrôle horaire et quota imposés en base.
2. Réservation sérialisée par destinataire, idempotente tous canaux confondus.
3. Tests PostgreSQL réels : concurrence, rejeu, quota, horaires et permissions.
4. Aucun envoi, fournisseur ou message libre ; aucun fichier financier modifié.
5. Revue indépendante et contrôles ; D26/D32 restent ouverts.

### Suite autorisée — lot 17, domaine notifications, risque L1

1. F-NOT-001/002 : six gabarits FR/EN sans interpolation de données personnelles.
2. F-NOT-003 : plages locales et plafond de fréquence configurables, refus par défaut.
3. Tests de refus d'abord : champs inconnus, paramètres invalides, hors plage et quota.
4. Pas de fournisseur simulé, de route, de migration ni d'envoi ; domaine pur seulement.
5. Revue indépendante puis contrôles ; D26/D32 restent différés par l'équipe.

1. Inventorier les outils et lire les blocages avant toute route financière.
2. Ajouter un lanceur de grappe locale jetable, sans base ni URL héritée.
3. Tester les refus et rejouer toutes les suites PostgreSQL réelles.
4. Rétablir l'accès à pnpm 12.6.0 et vérifier installation figée / scans.
5. Documenter les preuves, demander une revue indépendante ; aucune fusion.

## Historique conservé — état déclaré le 2026-10-29

- **Branche :** `sprint/integration` (jamais `main`, aucun remote)
- **Lot en cours :** 10 Agreements A/C (domaine + migration 0011 faits) ; lot 09 partiel (plans bloqués par D26)
- **Journal du jour :** `docs/journal/2026-10-28.md` (précédent : `2026-10-26.md`)
- **Client web :** PWA commitée (`d896b37`), ADR-0006 **Proposé**, fusion soumise au fondateur

## Reprise de session (après-midi)

| Sujet | Statut | Commit(s) | Preuve |
|---|---|---|---|
| Vérificateur · liste blanche des types | terminé | `a2deb98` | 29 tests TS + 9 tests Rust verts ; type inconnu au hash recalculé → `ENTRY_INVALID` |
| Audit · refs en liste blanche par action | terminé | `458454d` | 21 tests domaine verts ; action inconnue et clé interdite refusées |
| Récupération · solde dérivé du grand livre | terminé | `60aef00` | `ClientBalance` à constructeur privé, lecture `ledger.account_balance` (2100, LIABILITY) ; 34 tests domaine + 31 tests d’attaque verts |
| Identity · OTP et rotation atomiques | terminé (code) | `8b3f55b` | `UPDATE … WHERE … RETURNING` unique ; SQL **non exécuté** (D2) |
| `test:db` · `DATABASE_URL` | terminé | `9f5cf41` | harnais Testcontainers ou base existante avec garde locale ; README racine |
| Identity · tests base des stores | écrits, **non exécutés** | `8940d67`, `fac6e12` | 8 tests ajoutés (31 → 32 dans `identity.db.test.ts`) |
| Lot 09 · logique pure catalogue | terminé (partiel) | `ecc99d9` | 23 tests verts ; offre complète, partenaire validé, plans approuvés, filtres, stock ; **aucune migration**, ni persistance ni HTTP |

## Lots

| Lot | Statut | Notes |
|---|---|---|
| 00 · Outillage | terminé | lint, typecheck, tests, attaques, CI, frontières, secrets, SCA |
| 01 · Money | terminé | XAF `bigint`, tests de propriété |
| 02 · Ledger | terminé (code) | 32 tests base écrits, non exécutés (D2) |
| 03 · Chaînage/Merkle | terminé | Merkle RFC 9162, STH Ed25519, RFC 3161 réel |
| 04 · Vérificateur | terminé | Rust, liste blanche des types d’écriture ajoutée |
| 05 · Audit | terminé (code) | refs en liste blanche par action ; 10 tests base écrits |
| 06 · Identity | terminé (code) | stores OTP/rotation atomiques, solde dérivé du grand livre ; 32 tests base écrits, non exécutés |
| 08 · Admin | terminé (code) | 184 tests domaine verts ; 13 tests base écrits |
| 09 · Catalog | partiel | onboarding partenaire maker-checker (`0eb1088`, `f82bb11`) ; offres versionnées 0009 (`bbcc012`) ; activation de plan journalisée + `CATALOG_ACTION` 0010 (`d69e1ee`) ; persistance des plans en attente de D26 |
| 10 · Agreements A/C | partiel | domaine `a1438ae` (233 tests verts, 100 % des paires de transitions) ; migration 0011 `b915c63` (prix figé et transitions imposés par la base, FUNDED/REFUNDED bloqués sans lien grand livre) ; **24 tests base écrits, non exécutés** ; D27 |

## Prochaine étape exacte

1. ~~Exécuter les tests base~~ : fait le 2026-10-29, **110/110 verts** sur PostgreSQL 16.15 réel (D24). Relancer la grappe jetable (port 54329, arrêtée par le système faute de mémoire) pour exécuter les 24 tests de `agreements.db.test.ts`.
2. Réparer `pnpm` 12.6.0 sur le poste et relancer `pnpm security:scan` (SCA non exécutée).
3. Lot 09 : persistance des plans approuvés après décision D26 ; sinon passer au lot 10 (accords A/C, prix figé sur `(offer_id, version)`).
4. Contrôleurs HTTP derrière un guard réel, puis lot 11 (paiements).

## Barrière finale (reprise)

- `pnpm typecheck` : OK
- `pnpm lint` : OK (`Module boundaries: OK`)
- `pnpm test` : **405 tests verts**, 15 fichiers
- `pnpm test:attack` : **38 tests verts**, 2 fichiers
- `cargo test --manifest-path tools/verifier/Cargo.toml` : **9 tests verts**
- `pnpm verify:ledger` : `LEDGER VERIFIED entries=6 heads=3 witnesses=2 last_tree_size=6 log_id=achat-ledger-fixture-v1`
- `pnpm openapi:check` : OK
- `pnpm security:scan` : OK (secrets et SCA)
- `pnpm test:db` (2026-10-29) : **110 tests verts**, 5 fichiers (32 ledger, 12 audit, 13 admin, 32 identité, 21 catalogue), migrations 0001–0010, PostgreSQL 16.15 local. Premier passage : 105/110 ; les 5 échecs étaient des jeux de données de test violant des contraintes existantes (corrigés côté test, aucune contrainte modifiée).
- `pnpm test:tsa` : non relancé pendant la reprise (5 tests réseau déjà verts le matin)
- `pnpm test:e2e` : non relancé pendant la reprise (1 test vert le matin)
## Plan exécuté — F-ACC-005 · demandes de droits (6 novembre)
- Inventaire : sécurité compte déjà câblée ; aucun registre ni route d'exercice des droits ; textes juridiques D23 toujours provisoires.
- Ajouter un registre immuable de demandes ACCESS/RECTIFICATION/OBJECTION/ERASURE, reçu horodaté et historique paginé du seul compte authentifié.
- Écriture via fonction SQL bornée, session reverifiée sous verrou, idempotence transactionnelle ; aucun texte libre, pièce jointe, effacement ni export partiel présenté comme complet.
- API et écran FR/EN depuis /compte ; tests de refus avant code, PostgreSQL réel, isolation, concurrence, rollback, puis CI, build et revue indépendante.
- L2 ; F-ACC-005 partiel : traitement humain, export complet et conservation à décider ; aucun invariant financier touché.
